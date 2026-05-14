/**
 * POST /api/chat/human-message
 * Body: { sessionId, content }
 *
 * Speichert eine Mitarbeiter-Nachricht in eine Session — OHNE Bot zu triggern.
 * Wird im Training-Modus genutzt wenn der Admin als "Mitarbeiterin" tippt.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export async function POST(req: NextRequest) {
  const { sessionId, content } = await req.json();
  if (!sessionId || !content?.trim()) {
    return NextResponse.json({ error: "sessionId + content required" }, { status: 400 });
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth required" }, { status: 401 });

  const svc = createServiceClient();
  await svc.from("chat_messages").insert({
    session_id: sessionId,
    role: "human_agent",
    content: content.trim(),
    agent_id: user.id,
  });
  await svc.from("chat_sessions")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", sessionId);
  return NextResponse.json({ ok: true });
}
