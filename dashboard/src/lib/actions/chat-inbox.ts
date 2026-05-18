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

  // Lade Session inkl. Channel + External-ID
  const { data: cur } = await svc
    .from("chat_sessions")
    .select("status, channel, external_id")
    .eq("id", sessionId).single();
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

  // An echten Channel zurücksenden (außer 'web' — da pollt der Browser)
  if (cur?.channel === "instagram" && cur?.external_id) {
    const { sendInstagramMessage } = await import("@/lib/messaging/meta");
    const result = await sendInstagramMessage(cur.external_id, content.trim());
    if (!result.success) {
      console.error("[chat-inbox] sendInstagramMessage failed:", result.error);
    }
  } else if (cur?.channel === "whatsapp" && cur?.external_id) {
    const { sendWhatsAppMessage } = await import("@/lib/messaging/meta");
    const result = await sendWhatsAppMessage(cur.external_id, content.trim());
    if (!result.success) {
      console.error("[chat-inbox] sendWhatsAppMessage failed:", result.error);
    }
  }

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

/** Setzt den Avatar (Bot-Signatur) für eine Session */
export async function setSessionAvatar(sessionId: string, avatarName: string) {
  const svc = createServiceClient();
  // Validierung: Avatar muss existieren + aktiv sein
  const { data: avatar } = await svc
    .from("chatbot_avatars")
    .select("name")
    .eq("name", avatarName)
    .eq("active", true)
    .maybeSingle();
  if (!avatar) throw new Error(`Avatar "${avatarName}" nicht aktiv oder nicht gefunden`);
  await svc.from("chat_sessions").update({ bot_signature_name: avatarName }).eq("id", sessionId);
  revalidatePath(`/chatbot/inbox/${sessionId}`);
  revalidatePath("/chatbot/inbox");
}

/** Toggle Bot-Auto-Reply für eine Session */
export async function toggleBotAutoReply(sessionId: string, enabled: boolean) {
  const svc = createServiceClient();
  await svc.from("chat_sessions").update({ bot_auto_reply: enabled }).eq("id", sessionId);
  revalidatePath(`/chatbot/inbox/${sessionId}`);
  revalidatePath("/chatbot/inbox");
}

/** Setzt den Bot-Modus (auto/assisted/off) für eine Session */
export async function setBotMode(sessionId: string, mode: "auto" | "assisted" | "off") {
  const svc = createServiceClient();
  await svc.from("chat_sessions").update({
    bot_mode: mode,
    // Kompat: bot_auto_reply spiegelt 'auto' wider
    bot_auto_reply: mode === "auto",
  }).eq("id", sessionId);
  revalidatePath(`/chatbot/inbox/${sessionId}`);
  revalidatePath("/chatbot/inbox");
}

/**
 * Approve eines Bot-Entwurfs:
 * - Bei Korrektur: Training-Eintrag (bad=Original, good=Edit)
 * - Sendet finalen Text an Channel
 * - Speichert als assistant-Message in chat_messages
 */
export async function approveDraft(draftId: string, finalText: string) {
  if (!finalText?.trim()) throw new Error("Leerer Text");
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const svc = createServiceClient();
  const { data: draft } = await svc
    .from("chat_drafts")
    .select("id, session_id, original_text, tool_calls, tool_results, status, trigger_message_id")
    .eq("id", draftId).single();
  if (!draft) throw new Error("Entwurf nicht gefunden");
  if (draft.status !== "pending") throw new Error("Entwurf bereits bearbeitet");

  const final = finalText.trim();
  const original = draft.original_text.trim();
  const wasEdited = final !== original;

  // Session-Daten für Channel + Avatar
  const { data: session } = await svc
    .from("chat_sessions")
    .select("channel, external_id, bot_signature_name")
    .eq("id", draft.session_id).single();
  if (!session) throw new Error("Session nicht gefunden");

  // Final-Message als assistant in chat_messages speichern
  await svc.from("chat_messages").insert({
    session_id:   draft.session_id,
    role:         "assistant",
    content:      final,
    tool_calls:   draft.tool_calls,
    tool_results: draft.tool_results,
  });
  await svc.from("chat_sessions")
    .update({ last_message_at: new Date().toISOString() })
    .eq("id", draft.session_id);

  // Draft als approved markieren
  await svc.from("chat_drafts").update({
    edited_text: wasEdited ? final : null,
    status:      "approved",
    approved_at: new Date().toISOString(),
    approved_by: user.id,
  }).eq("id", draftId);

  // Training-Eintrag bei Korrektur — Auto-Lern-Modus
  if (wasEdited && draft.trigger_message_id) {
    const { data: trigger } = await svc
      .from("chat_messages")
      .select("content")
      .eq("id", draft.trigger_message_id)
      .maybeSingle();
    if (trigger?.content) {
      await svc.from("chatbot_training").insert({
        user_message: trigger.content,
        good_answer:  final,
        bad_answer:   original,
        feedback:     "Korrektur via Bot-Begleitung (Mitarbeiter editierte Entwurf)",
        avatar_name:  session.bot_signature_name,
        active:       true,
        tags:         ["assisted_correction"],
      });
    }
  }

  // An Channel senden
  if (session.channel === "instagram" && session.external_id) {
    const { sendInstagramMessage } = await import("@/lib/messaging/meta");
    const r = await sendInstagramMessage(session.external_id, final);
    if (!r.success) console.error("[approveDraft] IG send failed:", r.error);
  } else if (session.channel === "whatsapp" && session.external_id) {
    const { sendWhatsAppMessage } = await import("@/lib/messaging/meta");
    const r = await sendWhatsAppMessage(session.external_id, final);
    if (!r.success) console.error("[approveDraft] WA send failed:", r.error);
  }

  revalidatePath(`/chatbot/inbox/${draft.session_id}`);
  revalidatePath("/chatbot/inbox");
}

/** Verwirft einen Entwurf ohne zu senden */
export async function discardDraft(draftId: string) {
  const svc = createServiceClient();
  const { data: draft } = await svc.from("chat_drafts").select("session_id").eq("id", draftId).single();
  await svc.from("chat_drafts").update({ status: "discarded" }).eq("id", draftId);
  if (draft?.session_id) revalidatePath(`/chatbot/inbox/${draft.session_id}`);
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
