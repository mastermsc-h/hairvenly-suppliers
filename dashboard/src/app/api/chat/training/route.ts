/**
 * POST /api/chat/training
 *
 * Speichert eine Korrektur als Trainings-Beispiel.
 * Body: { sessionId, messageId, goodAnswer, feedback?, tags?[] }
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

interface Body {
  sessionId:   string;
  messageId?:  string;             // ID der zu korrigierenden Assistant-Nachricht
  goodAnswer:  string;
  feedback?:   string;
  tags?:       string[];
  applyToAll?: boolean;            // true → global für alle Avatare (avatar_name = null)
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as Body;
  if (!body.sessionId || !body.goodAnswer?.trim()) {
    return NextResponse.json({ error: "sessionId + goodAnswer required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth required" }, { status: 401 });

  const svc = createServiceClient();

  // Lade Session-Verlauf bis zur korrigierten Nachricht
  const { data: messages } = await svc
    .from("chat_messages")
    .select("id, role, content, created_at")
    .eq("session_id", body.sessionId)
    .order("created_at", { ascending: true });

  if (!messages || messages.length === 0) {
    return NextResponse.json({ error: "no messages in session" }, { status: 400 });
  }

  // Finde die Bot-Nachricht (entweder per messageId oder letzte assistant)
  let badMsgIdx = -1;
  if (body.messageId) {
    badMsgIdx = messages.findIndex(m => m.id === body.messageId);
  }
  if (badMsgIdx === -1) {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === "assistant") { badMsgIdx = i; break; }
    }
  }
  if (badMsgIdx === -1) {
    return NextResponse.json({ error: "no assistant message found" }, { status: 400 });
  }

  const badAnswer = messages[badMsgIdx].content || "";

  // Finde die letzte User-Frage vor der korrigierten Antwort
  let userMessage = "";
  for (let i = badMsgIdx - 1; i >= 0; i--) {
    if (messages[i].role === "user") { userMessage = messages[i].content || ""; break; }
  }

  // Kontext = die letzten 5 Nachrichten vor der korrigierten Antwort
  const contextStart = Math.max(0, badMsgIdx - 5);
  const context = messages.slice(contextStart, badMsgIdx).map(m => ({
    role: m.role,
    content: m.content,
  }));

  // Avatar der Session ermitteln (für gezielte Avatar-Korrekturen)
  const { data: sessionRow } = await svc
    .from("chat_sessions")
    .select("bot_signature_name")
    .eq("id", body.sessionId)
    .single();
  const sessionAvatar = sessionRow?.bot_signature_name || null;

  const { data, error } = await svc.from("chatbot_training").insert({
    context_messages: context,
    user_message:     userMessage,
    bad_answer:       badAnswer,
    good_answer:      body.goodAnswer,
    feedback:         body.feedback || null,
    tags:             body.tags || [],
    // applyToAll=true → null (für alle Avatare); sonst gezielt für Session-Avatar
    avatar_name:      body.applyToAll ? null : sessionAvatar,
    created_by:       user.id,
  }).select().single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Optional: die korrigierte Antwort auch direkt in chat_messages als neue Assistant-Nachricht speichern
  // damit die Korrektur in der Session sichtbar ist
  await svc.from("chat_messages").insert({
    session_id: body.sessionId,
    role:       "assistant",
    content:    body.goodAnswer + "\n\n_(korrigierte Version)_",
  });

  return NextResponse.json({ ok: true, trainingId: data.id });
}

export async function GET(req: NextRequest) {
  const svc = createServiceClient();
  const avatarFilter = req.nextUrl.searchParams.get("avatar"); // 'Larissa' | 'global' | null (alle)
  let q = svc
    .from("chatbot_training")
    .select("id, user_message, good_answer, bad_answer, feedback, tags, active, avatar_name, created_at")
    .order("created_at", { ascending: false })
    .limit(200);
  if (avatarFilter === "global") {
    q = q.is("avatar_name", null);
  } else if (avatarFilter) {
    q = q.eq("avatar_name", avatarFilter);
  }
  const { data } = await q;
  return NextResponse.json({ training: data || [] });
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth required" }, { status: 401 });
  const svc = createServiceClient();
  await svc.from("chatbot_training").delete().eq("id", id);
  return NextResponse.json({ ok: true });
}
