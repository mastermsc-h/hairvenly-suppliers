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

/**
 * Setzt den Bot-Modus (auto/assisted/off) für eine Session.
 * Bei Wechsel auf 'assisted': generiert sofort einen Entwurf zur letzten
 * Kundennachricht (falls noch keine Antwort/Entwurf darauf existiert), damit
 * man nicht auf eine neue DM warten muss.
 */
export async function setBotMode(sessionId: string, mode: "auto" | "assisted" | "off") {
  const svc = createServiceClient();
  await svc.from("chat_sessions").update({
    bot_mode: mode,
    bot_auto_reply: mode === "auto",
  }).eq("id", sessionId);

  if (mode === "assisted") {
    // Schon ein pending Draft? Dann nichts tun.
    const { data: existingDraft } = await svc
      .from("chat_drafts")
      .select("id")
      .eq("session_id", sessionId)
      .eq("status", "pending")
      .limit(1)
      .maybeSingle();

    if (!existingDraft) {
      // CLUSTER-DETECTION: die letzten 10 Messages laden und schauen,
      // ob es einen Block offener Kundennachrichten gibt (Kunde hat
      // mehrfach geschrieben, ohne dass Bot/Mitarbeiter danach geantwortet
      // hat). respondAsBot sieht ohnehin die letzten 150 Messages, aber
      // hier entscheiden wir OB überhaupt ein Entwurf erzeugt wird.
      const { data: recent } = await svc
        .from("chat_messages")
        .select("id, role, created_at")
        .eq("session_id", sessionId)
        .order("created_at", { ascending: false })
        .limit(10);

      const msgs = recent || [];
      // CLUSTER = alle Kundennachrichten SEIT der letzten Agent-/Bot-Antwort.
      // KEINE Zeit-Gap-Trennung: wenn Kunde Freitag fragt und Montag nachhakt,
      // gehört das zusammen — Bot soll auch die Freitags-Frage angucken.
      const lastAgentIdx = msgs.findIndex(m => m.role === "assistant" || m.role === "human_agent");
      const openCustomerMsgs =
        lastAgentIdx === -1
          ? msgs.filter(m => m.role === "user")
          : msgs.slice(0, lastAgentIdx).filter(m => m.role === "user");

      // STALE-SCHUTZ: Sessions wo selbst die JÜNGSTE offene Frage älter als
      // 60 Tage ist, werden nicht von selbst reaktiviert.
      const STALE_MAX_AGE_MS = 60 * 24 * 60 * 60 * 1000;
      if (openCustomerMsgs.length > 0) {
        const youngest = new Date(openCustomerMsgs[0].created_at).getTime();
        if (Date.now() - youngest > STALE_MAX_AGE_MS) {
          openCustomerMsgs.length = 0;
        }
      }

      if (openCustomerMsgs.length > 0) {
        const triggerMsg = openCustomerMsgs[openCustomerMsgs.length - 1];

        try {
          const { respondAsBot } = await import("@/lib/chatbot/respond");
          const result = await respondAsBot(sessionId, { assisted: true });
          if (result.success && result.text) {
            await svc.from("chat_drafts").insert({
              session_id:    sessionId,
              original_text: result.text,
              tool_calls:    result.toolCalls && result.toolCalls.length > 0 ? result.toolCalls : null,
              tool_results:  result.toolResults && result.toolResults.length > 0 ? result.toolResults : null,
              trigger_message_id: triggerMsg.id,
              status:        "pending",
            });
            console.log(`[setBotMode] draft for ${openCustomerMsgs.length} open turn(s) created`);
          } else {
            console.error("[setBotMode] respondAsBot failed:", result.error);
          }
        } catch (e) {
          console.error("[setBotMode] draft generation crashed:", e);
        }
      }
    }
  }

  revalidatePath(`/chatbot/inbox/${sessionId}`);
  revalidatePath("/chatbot/inbox");
}

/**
 * Approve eines Bot-Entwurfs:
 * - Bei Korrektur: Training-Eintrag (bad=Original, good=Edit)
 * - Sendet finalen Text an Channel
 * - Speichert als assistant-Message in chat_messages
 */
export async function approveDraft(draftId: string, finalText: string, note?: string) {
  if (!finalText?.trim()) throw new Error("Leerer Text");
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const svc = createServiceClient();
  const { data: draft } = await svc
    .from("chat_drafts")
    .select("id, session_id, original_text, tool_calls, tool_results, status, trigger_message_id, refinement_history")
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

  // Refinement-Feedbacks (alle Kommentare während des Loops) zu einem Strategie-Text bündeln
  const refineHistory = (draft.refinement_history as Array<{ feedback: string }> | null) || [];
  const refineFeedbacks = refineHistory.map(h => h.feedback).filter(Boolean);

  // Training-Eintrag bei Korrektur ODER wenn explizit Notiz mitgegeben ODER Refine-Feedbacks da — Auto-Lern-Modus
  const hasNote = !!note?.trim();
  const hasRefineFeedback = refineFeedbacks.length > 0;
  if ((wasEdited || hasNote || hasRefineFeedback) && draft.trigger_message_id) {
    const { data: trigger } = await svc
      .from("chat_messages")
      .select("content, created_at")
      .eq("id", draft.trigger_message_id)
      .maybeSingle();

    if (trigger?.content) {
      // Letzte ~6 Turns VOR der Trigger-Nachricht als Kontext mitspeichern,
      // damit der Bot beim Lernen den Gesprächsverlauf + Strategie versteht.
      const { data: ctxRows } = await svc
        .from("chat_messages")
        .select("role, content, created_at")
        .eq("session_id", draft.session_id)
        .lt("created_at", trigger.created_at)
        .order("created_at", { ascending: false })
        .limit(6);
      const contextMessages = (ctxRows || [])
        .slice().reverse()
        .filter(r => (r.role === "user" || r.role === "assistant" || r.role === "human_agent") && r.content)
        .map(r => ({
          role: r.role === "human_agent" ? "assistant" : r.role,
          content: (r.content || "").trim(),
        }));

      const feedbackParts: string[] = [];
      if (hasRefineFeedback) {
        feedbackParts.push(
          "REFINE-FEEDBACKS DER MITARBEITERIN (in chronologischer Reihenfolge):\n" +
          refineFeedbacks.map((f, i) => `${i + 1}. ${f}`).join("\n")
        );
      }
      if (hasNote) feedbackParts.push(`STRATEGIE-HINWEIS: ${note!.trim()}`);
      if (wasEdited) feedbackParts.push("Mitarbeiterin hat finalen Text noch direkt editiert");

      const tags = ["assisted_correction"];
      if (hasRefineFeedback) tags.push("refined");
      if (hasNote) tags.push("with_strategy_note");

      await svc.from("chatbot_training").insert({
        user_message:    trigger.content,
        good_answer:     final,
        bad_answer:      hasRefineFeedback ? (refineHistory[0] as { prev_text?: string })?.prev_text || (wasEdited ? original : null) : (wasEdited ? original : null),
        feedback:        feedbackParts.join("\n\n") || "Bot-Begleitung Approval",
        avatar_name:     session.bot_signature_name,
        active:          true,
        tags,
        context_messages: contextMessages.length > 0 ? contextMessages : null,
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

/**
 * Refine: Mitarbeiter gibt Feedback in natürlicher Sprache,
 * Bot generiert die Antwort neu. Feedback wird in refinement_history gespeichert,
 * landet beim finalen Approval automatisch im Strategie-Hinweis.
 */
export async function refineDraftWithFeedback(
  draftId: string,
  currentText: string,
  feedback: string,
): Promise<{ newText: string }> {
  if (!feedback?.trim()) throw new Error("Feedback leer");
  const svc = createServiceClient();
  const { data: draft } = await svc
    .from("chat_drafts")
    .select("session_id, refinement_history, status")
    .eq("id", draftId).single();
  if (!draft) throw new Error("Entwurf nicht gefunden");
  if (draft.status !== "pending") throw new Error("Entwurf bereits bearbeitet");

  const { refineBotDraft } = await import("@/lib/chatbot/refine");
  const result = await refineBotDraft(draft.session_id, currentText, feedback);
  if (!result.success || !result.text) {
    throw new Error(result.error || "Refine fehlgeschlagen");
  }

  const history = (draft.refinement_history as Array<{ feedback: string; prev_text: string; new_text: string; at: string }> | null) || [];
  history.push({
    feedback: feedback.trim(),
    prev_text: currentText,
    new_text: result.text,
    at: new Date().toISOString(),
  });

  await svc.from("chat_drafts").update({
    original_text: result.text,           // neuester Stand wird Default beim erneuten Laden
    refinement_history: history,
  }).eq("id", draftId);

  revalidatePath(`/chatbot/inbox/${draft.session_id}`);
  return { newText: result.text };
}

/**
 * On-Demand: Mitarbeiter klickt "Antwort generieren" → Bot erstellt sofort
 * einen Entwurf zur aktuellen Session-Lage. Ändert NICHT den Modus.
 *
 * Wirft Fehler wenn:
 *  - keine offenen Kundennachrichten da sind (Bot hätte nichts zu antworten)
 *  - bereits ein pending Draft existiert (UI sollte den Button verstecken)
 */
export async function generateDraftOnDemand(sessionId: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const svc = createServiceClient();

  // Bereits ein Draft offen?
  const { data: existing } = await svc
    .from("chat_drafts")
    .select("id")
    .eq("session_id", sessionId)
    .eq("status", "pending")
    .limit(1)
    .maybeSingle();
  if (existing) return { ok: false, reason: "Es liegt bereits ein offener Entwurf vor." };

  // Letzte Message muss von Kunde sein (sonst nichts zu antworten)
  const { data: lastMsg } = await svc
    .from("chat_messages")
    .select("id, role")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!lastMsg) return { ok: false, reason: "Keine Nachrichten in dieser Session." };
  if (lastMsg.role !== "user") {
    return { ok: false, reason: "Letzte Nachricht ist nicht vom Kunden — keine offene Frage zu beantworten." };
  }

  // Trigger-Message-ID: jüngste offene Kunden-Nachricht (= Cluster-Start für Training)
  const { data: recent } = await svc
    .from("chat_messages")
    .select("id, role, created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(10);
  const lastAgentIdx = (recent || []).findIndex(m => m.role === "assistant" || m.role === "human_agent");
  const openMsgs = lastAgentIdx === -1
    ? (recent || []).filter(m => m.role === "user")
    : (recent || []).slice(0, lastAgentIdx).filter(m => m.role === "user");
  const triggerMsgId = (openMsgs[openMsgs.length - 1] || lastMsg).id;

  try {
    const { respondAsBot } = await import("@/lib/chatbot/respond");
    const result = await respondAsBot(sessionId, { assisted: true });
    if (!result.success || !result.text) {
      return { ok: false, reason: result.error || "Generierung fehlgeschlagen" };
    }
    await svc.from("chat_drafts").insert({
      session_id:    sessionId,
      original_text: result.text,
      tool_calls:    result.toolCalls && result.toolCalls.length > 0 ? result.toolCalls : null,
      tool_results:  result.toolResults && result.toolResults.length > 0 ? result.toolResults : null,
      trigger_message_id: triggerMsgId,
      status:        "pending",
    });
    revalidatePath(`/chatbot/inbox/${sessionId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: (e as Error).message };
  }
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
