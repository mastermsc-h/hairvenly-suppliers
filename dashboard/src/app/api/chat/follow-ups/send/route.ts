/**
 * POST /api/chat/follow-ups/send
 * Body: { sessionId, message }
 * Sendet die vom Mitarbeiter freigegebene Follow-Up-Nachricht.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles").select("is_admin").eq("id", user.id).single();
  return profile?.is_admin ? user : null;
}

export async function POST(req: NextRequest) {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const { sessionId, message } = await req.json();
  if (!sessionId || !message?.trim()) {
    return NextResponse.json({ error: "sessionId + message required" }, { status: 400 });
  }

  const svc = createServiceClient();
  // Nachricht in Chat einfügen (als Mitarbeiter)
  await svc.from("chat_messages").insert({
    session_id: sessionId,
    role:       "human_agent",
    content:    message.trim(),
    agent_id:   user.id,
  });
  // Session-Felder aktualisieren
  await svc.from("chat_sessions").update({
    follow_up_sent_at: new Date().toISOString(),
    follow_up_status:  "sent",
    follow_up_message: message.trim(),
    last_message_at:   new Date().toISOString(),
  }).eq("id", sessionId);

  return NextResponse.json({ ok: true });
}
