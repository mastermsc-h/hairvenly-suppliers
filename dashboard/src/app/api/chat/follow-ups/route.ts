/**
 * GET   /api/chat/follow-ups          — fällige Sessions auflisten
 * POST  /api/chat/follow-ups/preview  — Vorschlag generieren (NICHT senden)
 * POST  /api/chat/follow-ups/send     — vom Mitarbeiter freigegebene Nachricht senden
 * POST  /api/chat/follow-ups/skip     — Session überspringen (markiert als skipped)
 *
 * Diese Route handhabt nur GET (Liste).
 */
import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

const DAYS_QUIET = 3;

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles").select("is_admin").eq("id", user.id).single();
  return profile?.is_admin ? user : null;
}

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "auth" }, { status: 401 });

  const svc = createServiceClient();
  const cutoff = new Date(Date.now() - DAYS_QUIET * 86400 * 1000).toISOString();
  const { data: sessions } = await svc
    .from("chat_sessions")
    .select("id, channel, bot_signature_name, last_message_at, last_customer_msg_at, status, follow_up_status")
    .eq("status", "active")
    .is("follow_up_sent_at", null)
    .lt("last_message_at", cutoff)
    .order("last_message_at", { ascending: true })
    .limit(100);

  // Filter: nur Sessions wo letzte Nachricht NICHT vom Kunden war
  const eligible: typeof sessions = [];
  for (const s of sessions || []) {
    const { data: lastMsg } = await svc
      .from("chat_messages")
      .select("role, content, created_at")
      .eq("session_id", s.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    if (lastMsg && lastMsg.role !== "user") {
      eligible.push({ ...s, _last_msg: lastMsg } as never);
    }
  }

  // Erste Kunden-Frage pro Session (für Übersicht)
  const sessionIds = eligible.map(s => s.id);
  const previews: Record<string, { firstUser?: string; lastBot?: string }> = {};
  if (sessionIds.length > 0) {
    const { data: allMsgs } = await svc
      .from("chat_messages")
      .select("session_id, role, content, created_at")
      .in("session_id", sessionIds)
      .order("created_at", { ascending: true });
    for (const m of allMsgs || []) {
      const p = previews[m.session_id] ??= {};
      if (m.role === "user" && !p.firstUser) p.firstUser = m.content || "";
      if (m.role === "assistant" || m.role === "human_agent") p.lastBot = m.content || "";
    }
  }

  return NextResponse.json({
    due_count: eligible.length,
    sessions: eligible.map(s => ({
      id: s.id,
      channel: s.channel,
      bot_signature_name: s.bot_signature_name,
      days_quiet: Math.floor((Date.now() - new Date(s.last_message_at).getTime()) / 86400000),
      last_message_at: s.last_message_at,
      first_user_message: previews[s.id]?.firstUser?.slice(0, 200),
      last_bot_message:   previews[s.id]?.lastBot?.slice(0, 200),
    })),
  });
}
