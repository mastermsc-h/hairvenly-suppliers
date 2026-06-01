/**
 * GET /api/chat/inbox-stats
 *
 * - Liefert Counts für Sidebar-Badge + Notifications
 * - Führt nebenbei Auto-Close für Sessions aus die >24h still sind
 */
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

// HINWEIS 2026-05-31: Der frühere IG-Light-Sync-Piggyback (alle 10 Min aus
// diesem Endpoint) wurde ENTFERNT. Grund: die Instagram-Login-Graph-API
// liefert kein `unread_count` (verifiziert über 500 Conversations, alle null),
// d.h. ein IG-seitiges "als ungelesen markieren" ist über die API gar nicht
// erkennbar. Der Poll lief also für nichts. Dashboard→IG mark_seen läuft
// unabhängig weiter (markSessionAsSeen → markInstagramSeen). Der manuelle
// Sync-Endpoint /api/chatbot/sync-instagram-light bleibt für Notfälle.

export async function GET() {
  const svc = createServiceClient();

  // Zähle awaiting_human
  const { count: awaitingHuman } = await svc
    .from("chat_sessions")
    .select("id", { count: "exact", head: true })
    .eq("status", "awaiting_human");

  // Zähle "ungelesene Kundennachrichten" — Sessions mit awaiting_human Status,
  // wo Kunde nach letzter Mitarbeiter-Aktion geschrieben hat
  const { data: awaitingSessions } = await svc
    .from("chat_sessions")
    .select("id, last_customer_msg_at, last_seen_by_agent_at")
    .eq("status", "awaiting_human");

  let unreadCustomerMsgs = 0;
  for (const s of awaitingSessions || []) {
    if (!s.last_customer_msg_at) continue;
    if (!s.last_seen_by_agent_at || s.last_customer_msg_at > s.last_seen_by_agent_at) {
      unreadCustomerMsgs++;
    }
  }

  // unread_all + todo_approx — EXAKTE Replikation der "Zu tun"-Logik aus
  // inbox/page.tsx (isInTodo). User-Anweisung 2026-05-30: Sidebar-Counter und
  // Tab-Counter müssen 1:1 identisch sein.
  //
  // 5 Komponenten der vollständigen isInTodo-Logik:
  //   1. Pending Draft existiert
  //   2. Ungelesen (last_customer_msg_at > last_seen_by_agent_at)
  //   3. B2B-Autobot-Warning (Gewerbe + autonome Bot-Antwort)
  //   4. 24h-Grace nach MA-Antwort (lastWasOurs + age < 24h)
  //   5. Handoff-Promise im letzten Bot-Text (HANDOFF_RE / HANDOFF_DAY_RE)
  //
  // Plus: EXPLIZIT-ERLEDIGT-Override (last_seen_by_agent_at > last_message_at +
  // 5s → false), Sentinel-Check für "Nicht erledigt"-Flag (Jahr < 2000).
  const { data: openSessions } = await svc
    .from("chat_sessions")
    .select("id, status, category, last_message_at, last_customer_msg_at, last_seen_by_agent_at")
    .neq("status", "closed");

  // (a) Pending Drafts
  // 🛡 STALE-DRAFT-INVARIANTE (Bug 01.06): Drafts, die ÄLTER sind als die
  // letzte Kundennachricht ihrer Session, sind veraltet und dürfen NICHT als
  // offener "Zu-tun"-Draft zählen (sonst Geister-Counter im Sidebar-Badge).
  // Gleiche Regel wie Inbox-Listing + Session-Detail-View.
  const { data: pendingDrafts } = await svc
    .from("chat_drafts")
    .select("session_id, created_at")
    .eq("status", "pending");
  const lastCustomerBySession = new Map<string, string>();
  for (const s of openSessions || []) {
    if (s.last_customer_msg_at) lastCustomerBySession.set(s.id, s.last_customer_msg_at as string);
  }
  const newestDraftBySession = new Map<string, string>();
  for (const d of pendingDrafts || []) {
    const prev = newestDraftBySession.get(d.session_id);
    if (!prev || (d.created_at as string) > prev) newestDraftBySession.set(d.session_id, d.created_at as string);
  }
  const draftSessionIds = new Set<string>();
  for (const [sid, draftAt] of newestDraftBySession) {
    const lastUserAt = lastCustomerBySession.get(sid);
    if (!lastUserAt || draftAt >= lastUserAt) draftSessionIds.add(sid);
  }

  // (b) Pro Session: lastMsgRole, lastMsgAutoSent, lastBot, autobotCount.
  // Aggregation aus chat_messages (DESC, first-seen-wins für die neueste msg).
  type SessionStats = {
    lastMsgRole?: string;
    lastMsgAutoSent?: boolean;
    lastBot?: string;
    autobotCount: number;
  };
  const stats: Record<string, SessionStats> = {};
  const openSessionIds = (openSessions || []).map(s => s.id);
  if (openSessionIds.length > 0) {
    // 120-Tage-Window + limit 20000, EXAKT wie inbox/page.tsx stats-Query
    // (sonst werden Handoff-Promise-Sessions 30-120 Tage alt nicht erkannt).
    const cutoff = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();
    const { data: msgs } = await svc
      .from("chat_messages")
      .select("session_id, role, content, created_at, auto_sent")
      .in("session_id", openSessionIds)
      .is("deleted_at", null)
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(20000);
    for (const m of msgs || []) {
      const s = stats[m.session_id] ??= { autobotCount: 0 };
      const autoSent = (m as { auto_sent?: boolean }).auto_sent === true;
      if (m.role === "assistant" && autoSent) s.autobotCount++;
      if (!s.lastMsgRole) {
        s.lastMsgRole = m.role;
        s.lastMsgAutoSent = m.role === "assistant" ? autoSent : false;
      }
      if ((m.role === "assistant" || m.role === "human_agent") && !s.lastBot) {
        s.lastBot = m.content || undefined;
      }
    }
  }

  // (c) isInTodo — EXAKTE Kopie aus inbox/page.tsx
  const HANDOFF_RE = /\b(kollegin|stylistin|farb-?expertin|mitarbeiterin)\b[^.\n]{0,80}\b(meldet|schreibt|kommt|kümmert|schaut)/i;
  const HANDOFF_DAY_RE = /\b(montag|dienstag|mittwoch|donnerstag|freitag|morgen)\b[^.\n]{0,30}\b(früh|ab\s+10|10\s*uhr|ankommt)/i;
  const now = Date.now();

  let unreadAll = 0;
  const todoIds = new Set<string>();
  for (const s of openSessions || []) {
    // Unread-Berechnung — EXAKT wie inbox/page.tsx unreadMap:
    //   isExplicitlyNotDone OR (!ourTurn AND customerMsg > lastSeen)
    // 🛡 ourTurn-Guard ist KRITISCH (Bug 2026-05-30): wenn die letzte
    // Nachricht von UNS ist (assistant/human_agent), zählt die Session NICHT
    // als ungelesen — auch wenn last_customer_msg_at > last_seen. Ohne den
    // Guard zählte das API 62 Sessions zu viel (Sidebar 122 statt Tab 97).
    const stForUnread = stats[s.id];
    const lastRole = stForUnread?.lastMsgRole;
    const ourTurn = lastRole === "assistant" || lastRole === "human_agent";
    const isExplicitlyNotDone = !!s.last_seen_by_agent_at &&
      new Date(s.last_seen_by_agent_at).getFullYear() < 2000;
    const isUnread = isExplicitlyNotDone || (!ourTurn && !!(s.last_customer_msg_at && (
      !s.last_seen_by_agent_at || s.last_customer_msg_at > s.last_seen_by_agent_at
    )));
    if (isUnread) unreadAll++;

    // EXPLIZIT-ERLEDIGT-Override (manuell "Erledigt"-Klick → seenAt > lastMsg + 5s)
    const seenAt = s.last_seen_by_agent_at;
    const lastMsgAt = s.last_message_at;
    if (seenAt && lastMsgAt) {
      const seenAtMs = new Date(seenAt).getTime();
      const lastMsgMs = new Date(lastMsgAt).getTime();
      const isSentinel = new Date(seenAt).getFullYear() < 2000;
      if (!isSentinel && seenAtMs - lastMsgMs > 5000) {
        continue; // explizit erledigt — raus aus Zu-tun
      }
    }

    // Triggers (any of)
    if (draftSessionIds.has(s.id)) { todoIds.add(s.id); continue; }
    if (isUnread) { todoIds.add(s.id); continue; }
    const st = stats[s.id];
    // B2B-Autobot-Warning
    if (s.category === "gewerbe" && (st?.autobotCount || 0) > 0) {
      todoIds.add(s.id); continue;
    }
    // 24h-Grace nach MA-Antwort
    if (lastMsgAt && st) {
      const ageH = (now - new Date(lastMsgAt).getTime()) / 3_600_000;
      const lastWasOurs = st.lastMsgRole === "human_agent" ||
        (st.lastMsgRole === "assistant" && !st.lastMsgAutoSent);
      if (ageH < 24 && lastWasOurs) {
        todoIds.add(s.id); continue;
      }
    }
    // Handoff-Promise im letzten Bot-Text
    if (st?.lastBot && (HANDOFF_RE.test(st.lastBot) || HANDOFF_DAY_RE.test(st.lastBot))) {
      todoIds.add(s.id); continue;
    }
  }
  const todoApprox = todoIds.size;

  const { count: active } = await svc
    .from("chat_sessions")
    .select("id", { count: "exact", head: true })
    .eq("status", "active");

  // Fällige Follow-Ups: Status=active, >3 Tage still, kein Follow-Up gesendet
  const followUpCutoff = new Date(Date.now() - 3 * 86400 * 1000).toISOString();
  const { count: dueFollowUps } = await svc
    .from("chat_sessions")
    .select("id", { count: "exact", head: true })
    .eq("status", "active")
    .is("follow_up_sent_at", null)
    .lt("last_message_at", followUpCutoff);

  return NextResponse.json({
    awaiting_human: awaitingHuman ?? 0,
    active: active ?? 0,
    unread_customer_msgs: unreadCustomerMsgs,
    unread_all: unreadAll,
    /** Annäherung an "Zu tun"-Tab — Drafts + Ungelesen + B2B-Warning.
     *  Punkte 4-5 (24h-Grace + Handoff-Promise) bewusst weggelassen für
     *  Performance. Sidebar weicht typisch um ±1-3 vom Tab ab. */
    todo_approx: todoApprox,
    due_follow_ups: dueFollowUps ?? 0,
  });
}
