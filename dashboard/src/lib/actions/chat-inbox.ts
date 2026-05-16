"use server";

import { createClient, createServiceClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

/** Übernimmt eine Session: setzt assigned_to + status = awaiting_human */
export async function takeoverSession(sessionId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const svc = createServiceClient();
  await svc.from("chat_sessions")
    .update({
      assigned_to: user.id,
      status: "awaiting_human",
    })
    .eq("id", sessionId);
  revalidatePath("/chatbot/inbox");
  revalidatePath(`/chatbot/inbox/${sessionId}`);
}

/** Sendet eine Mitarbeiter-Nachricht in eine Session — reaktiviert geschlossene Sessions */
export async function sendHumanMessage(sessionId: string, content: string) {
  if (!content?.trim()) return;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const svc = createServiceClient();

  // Wenn Session "closed" war → automatisch wieder auf "awaiting_human" setzen
  // (Mitarbeiter schreibt wieder rein, Bot bleibt erstmal pausiert)
  const { data: cur } = await svc
    .from("chat_sessions").select("status").eq("id", sessionId).single();
  const wasClosed = cur?.status === "closed";

  await svc.from("chat_messages").insert({
    session_id: sessionId,
    role: "human_agent",
    content: content.trim(),
    agent_id: user.id,
  });
  await svc.from("chat_sessions")
    .update({
      last_message_at: new Date().toISOString(),
      ...(wasClosed ? { status: "awaiting_human", assigned_to: user.id } : {}),
    })
    .eq("id", sessionId);
  revalidatePath(`/chatbot/inbox/${sessionId}`);
}

/** Gibt Session zurück an den Bot (Mitarbeiter ist fertig) */
export async function resumeBot(sessionId: string) {
  const svc = createServiceClient();
  await svc.from("chat_sessions")
    .update({ status: "active", assigned_to: null })
    .eq("id", sessionId);
  revalidatePath("/chatbot/inbox");
  revalidatePath(`/chatbot/inbox/${sessionId}`);
}

/** Toggle Bot-Auto-Reply für eine Session */
export async function toggleBotAutoReply(sessionId: string, enabled: boolean) {
  const svc = createServiceClient();
  await svc.from("chat_sessions").update({ bot_auto_reply: enabled }).eq("id", sessionId);
  revalidatePath(`/chatbot/inbox/${sessionId}`);
  revalidatePath("/chatbot/inbox");
}

/** Schließt eine Session */
export async function closeSession(sessionId: string) {
  const svc = createServiceClient();
  await svc.from("chat_sessions")
    .update({ status: "closed" })
    .eq("id", sessionId);
  revalidatePath("/chatbot/inbox");
}

/** Löscht eine Session komplett (inkl. Messages via CASCADE) */
export async function deleteSession(sessionId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const svc = createServiceClient();
  await svc.from("chat_sessions").delete().eq("id", sessionId);
  revalidatePath("/chatbot/inbox");
}
