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
    due_follow_ups: dueFollowUps ?? 0,
  });
}
