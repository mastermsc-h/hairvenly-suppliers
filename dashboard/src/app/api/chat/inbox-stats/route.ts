/**
 * GET /api/chat/inbox-stats
 *
 * - Liefert Counts für Sidebar-Badge + Notifications
 * - Führt nebenbei Auto-Close für Sessions aus die >24h still sind
 */
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

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

  // unread_all + todo_approx — Annäherung an "Zu tun"-Tab in /chatbot/inbox.
  //
  // Vollständige Zu-tun-Logik (inbox/page.tsx isInTodo) hat 5 Komponenten:
  //   1. Pending Draft existiert        ← hier erfasst
  //   2. Ungelesen                       ← hier erfasst
  //   3. B2B-Autobot-Warning             ← hier erfasst
  //   4. 24h-Grace nach MA-Antwort       ← weggelassen (braucht chat_messages-
  //                                         Aggregation, teuer beim Polling)
  //   5. Handoff-Promise im Bot-Text     ← weggelassen (Regex über alle Bot-Msgs)
  //
  // User-Entscheidung 2026-05-30: Pragmatische Annäherung reicht — Sidebar-
  // Zahl weicht um ±1-3 von Tab-Zahl ab, dafür schnelles Polling.
  const { data: openSessions } = await svc
    .from("chat_sessions")
    .select("id, status, category, last_customer_msg_at, last_seen_by_agent_at")
    .neq("status", "closed");

  // (a) Pending Drafts
  const { data: pendingDrafts } = await svc
    .from("chat_drafts")
    .select("session_id")
    .eq("status", "pending");
  const draftSessionIds = new Set((pendingDrafts || []).map(d => d.session_id));

  // (b) Gewerbe-Sessions mit autonom-gesendeter Bot-Antwort (B2B-Warning)
  // — ein Sub-Query auf chat_messages mit auto_sent=true und Session-Join.
  const gewerbeSessionIds = new Set(
    (openSessions || []).filter(s => s.category === "gewerbe").map(s => s.id)
  );
  const b2bWarningIds = new Set<string>();
  if (gewerbeSessionIds.size > 0) {
    const { data: autoBotMsgs } = await svc
      .from("chat_messages")
      .select("session_id")
      .eq("role", "assistant")
      .eq("auto_sent", true)
      .is("deleted_at", null)
      .in("session_id", Array.from(gewerbeSessionIds))
      .limit(500);
    for (const m of autoBotMsgs || []) b2bWarningIds.add(m.session_id as string);
  }

  // Sammle alle "Zu-tun"-Session-IDs + zähle unread_all separat
  let unreadAll = 0;
  const todoIds = new Set<string>();
  for (const s of openSessions || []) {
    let isUnread = false;
    if (s.last_customer_msg_at) {
      const isExplicitlyNotDone = !!s.last_seen_by_agent_at &&
        new Date(s.last_seen_by_agent_at).getFullYear() < 2000;
      if (isExplicitlyNotDone) isUnread = true;
      else if (!s.last_seen_by_agent_at || s.last_customer_msg_at > s.last_seen_by_agent_at) isUnread = true;
    }
    if (isUnread) unreadAll++;
    if (isUnread || draftSessionIds.has(s.id) || b2bWarningIds.has(s.id)) {
      todoIds.add(s.id);
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
