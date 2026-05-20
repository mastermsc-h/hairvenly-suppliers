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

  const { data: insertedMsg } = await svc.from("chat_messages").insert({
    session_id: sessionId,
    role: "human_agent",
    content: content.trim(),
    agent_id: user.id,
  }).select("id").single();
  await svc.from("chat_sessions")
    .update({
      last_message_at: new Date().toISOString(),
      // Beim tatsächlichen Senden gilt die Session als "gesehen"
      last_seen_by_agent_at: new Date().toISOString(),
      ...(wasClosed ? { status: "awaiting_human", assigned_to: user.id } : {}),
    })
    .eq("id", sessionId);

  // An echten Channel zurücksenden (außer 'web' — da pollt der Browser)
  if (cur?.channel === "instagram" && cur?.external_id) {
    const [{ sendInstagramMessage }, { splitLongMessage }] = await Promise.all([
      import("@/lib/messaging/meta"),
      import("@/lib/chatbot/respond"),
    ]);
    const parts = splitLongMessage(content.trim());
    let firstMid: string | undefined;
    for (let i = 0; i < parts.length; i++) {
      const result = await sendInstagramMessage(cur.external_id, parts[i]);
      if (!result.success) console.error(`[chat-inbox] IG send failed (${i + 1}/${parts.length}):`, result.error);
      else if (i === 0 && result.message_id) firstMid = result.message_id;
      if (i < parts.length - 1) await new Promise(s => setTimeout(s, 600));
    }
    if (firstMid && insertedMsg?.id) {
      await svc.from("chat_messages").update({ external_id: firstMid }).eq("id", insertedMsg.id);
    }
  } else if (cur?.channel === "whatsapp" && cur?.external_id) {
    const { sendWhatsAppMessage } = await import("@/lib/messaging/meta");
    const result = await sendWhatsAppMessage(cur.external_id, content.trim());
    if (!result.success) {
      console.error("[chat-inbox] sendWhatsAppMessage failed:", result.error);
    } else if (result.message_id && insertedMsg?.id) {
      await svc.from("chat_messages").update({ external_id: result.message_id }).eq("id", insertedMsg.id);
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

  // Self-DM-Guard — Bot darf in Self-DM-Sessions nie aktiviert werden
  if (mode !== "off") {
    const { data: ses } = await svc.from("chat_sessions").select("external_id").eq("id", sessionId).single();
    const ourIgId = process.env.META_INSTAGRAM_USER_ID;
    if (ses?.external_id && ourIgId && ses.external_id === ourIgId) {
      throw new Error("Diese Session ist ein Self-DM (unser eigener Account schreibt an sich selbst). Bot kann hier nicht aktiviert werden — bitte Session löschen oder schließen.");
    }
  }

  await svc.from("chat_sessions").update({
    bot_mode: mode,
    bot_auto_reply: mode === "auto",
  }).eq("id", sessionId);

  if (mode === "assisted") {
    // Klassifikation nachholen falls noch keine (fire-and-forget)
    (async () => {
      try {
        const { classifySession } = await import("@/lib/chatbot/classify");
        const { data: cur } = await svc.from("chat_sessions").select("category").eq("id", sessionId).single();
        if (!cur?.category) await classifySession(sessionId);
      } catch {}
    })();

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
        .is("deleted_at", null)
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

  // Final-Message als assistant in chat_messages speichern (ID merken für MID-Update nach Versand)
  const { data: insertedMsg } = await svc.from("chat_messages").insert({
    session_id:   draft.session_id,
    role:         "assistant",
    content:      final,
    tool_calls:   draft.tool_calls,
    tool_results: draft.tool_results,
  }).select("id").single();
  await svc.from("chat_sessions")
    .update({
      last_message_at: new Date().toISOString(),
      // Approve = aktive Antwort vom Mitarbeiter → Session ist "gesehen"
      last_seen_by_agent_at: new Date().toISOString(),
    })
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
  // AUTO-LERN-SANITIZER: aus dem Edit-Diff erkennen welche Wörter/Phrasen der
  // Mitarbeiter entfernt hat. Ab 3 Vorkommen → automatisch im Sanitizer aktiv.
  if (wasEdited) {
    try {
      const { recordEditDiff } = await import("@/lib/chatbot/word-filter-learning");
      const stats = await recordEditDiff(original, final, draft.session_id);
      if (stats.auto_activated > 0) {
        console.log(`[approveDraft] AUTO-AKTIVIERT: ${stats.auto_activated} neue Wort-Filter (gelernt aus Edit-Diff)`);
      }
    } catch (e) {
      console.warn("[approveDraft] word-filter-learning failed:", (e as Error).message);
    }
  }

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
        .is("deleted_at", null)
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

      const { data: insertedTraining, error: trainErr } = await svc.from("chatbot_training").insert({
        user_message:    trigger.content,
        good_answer:     final,
        bad_answer:      hasRefineFeedback ? (refineHistory[0] as { prev_text?: string })?.prev_text || (wasEdited ? original : null) : (wasEdited ? original : null),
        feedback:        feedbackParts.join("\n\n") || "Bot-Begleitung Approval",
        // avatar_name=null → ALLE Avatare lernen aus dieser Korrektur (Avatar-übergreifend).
        // Vorher: nur derjenige Avatar der die Session gerade hatte. Jetzt: universelles Lernen.
        // Wenn die Lektion wirklich Avatar-spezifisch wäre, würde der Mitarbeiter das in der
        // Strategie-Notiz festhalten.
        avatar_name:     null,
        active:          true,
        tags:            [...tags, `from_avatar:${session.bot_signature_name || "unknown"}`],
        // context_messages ist NOT NULL in der DB (default '[]') — niemals null senden,
        // sonst schlägt der Insert silently fehl und es entsteht KEIN Trainings-Eintrag.
        // Bei brandneuen Sessions (Trigger ist die erste Nachricht) ist contextMessages [].
        context_messages: contextMessages,
      }).select("id").single();
      if (trainErr) {
        console.error("[approveDraft] chatbot_training INSERT FAILED:", trainErr.code, trainErr.message);
      } else {
        console.log("[approveDraft] training row created", { wasEdited, hasNote, hasRefineFeedback, ctxLen: contextMessages.length });
        // Auto-Konsolidierung: prüfen ob die Korrektur ein statischer Fakt ist
        // und automatisch in die Wissensdatenbank konsolidieren. Fire-and-forget,
        // soll den Approval nicht blockieren.
        if (insertedTraining?.id) {
          (async () => {
            try {
              const { consolidateCorrection } = await import("@/lib/chatbot/auto-consolidate");
              await consolidateCorrection(insertedTraining.id);
            } catch (e) {
              console.warn("[approveDraft] auto-consolidate failed:", (e as Error).message);
            }
          })();
        }
      }
    }
  }

  // An Channel senden — bei IG: lange Texte automatisch in mehrere Messages splitten
  if (session.channel === "instagram" && session.external_id) {
    const [{ sendInstagramMessage }, { splitLongMessage }] = await Promise.all([
      import("@/lib/messaging/meta"),
      import("@/lib/chatbot/respond"),
    ]);
    const parts = splitLongMessage(final);
    let firstMid: string | undefined;
    for (let i = 0; i < parts.length; i++) {
      const r = await sendInstagramMessage(session.external_id, parts[i]);
      if (!r.success) console.error(`[approveDraft] IG send failed (${i + 1}/${parts.length}):`, r.error);
      else if (i === 0 && r.message_id) firstMid = r.message_id;
      if (i < parts.length - 1) await new Promise(s => setTimeout(s, 600));
    }
    if (firstMid && insertedMsg?.id) {
      await svc.from("chat_messages").update({ external_id: firstMid }).eq("id", insertedMsg.id);
    }
  } else if (session.channel === "whatsapp" && session.external_id) {
    const { sendWhatsAppMessage } = await import("@/lib/messaging/meta");
    const r = await sendWhatsAppMessage(session.external_id, final);
    if (!r.success) console.error("[approveDraft] WA send failed:", r.error);
    else if (r.message_id && insertedMsg?.id) {
      await svc.from("chat_messages").update({ external_id: r.message_id }).eq("id", insertedMsg.id);
    }
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

  // Self-DM-Guard
  const { data: ses } = await svc.from("chat_sessions").select("external_id").eq("id", sessionId).single();
  const ourIgId = process.env.META_INSTAGRAM_USER_ID;
  if (ses?.external_id && ourIgId && ses.external_id === ourIgId) {
    return { ok: false, reason: "Self-DM-Session — Bot kann hier nicht antworten (eigener Account)." };
  }

  // Bereits ein Draft offen?
  const { data: existing } = await svc
    .from("chat_drafts")
    .select("id")
    .eq("session_id", sessionId)
    .eq("status", "pending")
    .limit(1)
    .maybeSingle();
  if (existing) return { ok: false, reason: "Es liegt bereits ein offener Entwurf vor." };

  // Letzte (nicht gelöschte) Message holen — egal von wem.
  const { data: lastMsg } = await svc
    .from("chat_messages")
    .select("id, role")
    .eq("session_id", sessionId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!lastMsg) return { ok: false, reason: "Keine Nachrichten in dieser Session." };

  // Letzte 15 Messages durchsuchen — wir brauchen mindestens EINE Kundennachricht
  // damit der Bot was zu beantworten hat. Egal ob die letzte Message von uns ist —
  // der Bot guckt sich den Verlauf an und antwortet auf die offene Kundenfragen.
  const { data: recent } = await svc
    .from("chat_messages")
    .select("id, role, created_at")
    .eq("session_id", sessionId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(15);

  // Gibt es überhaupt eine Kundennachricht in den letzten 15?
  const hasAnyCustomerMsg = (recent || []).some(m => m.role === "user");
  if (!hasAnyCustomerMsg) {
    return { ok: false, reason: "Keine Kundennachricht in den letzten 15 Messages — der Bot hätte nichts zu beantworten." };
  }
  // Trigger-Message-ID = jüngste Kundennachricht überhaupt (für Training-Kontext).
  // Falls letzte Message von uns ist und davor Kundenfragen offen → Bot guckt
  // sich Verlauf an und antwortet darauf.
  const mostRecentUserMsg = (recent || []).find(m => m.role === "user");
  const triggerMsgId = mostRecentUserMsg?.id || lastMsg.id;

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

/**
 * Markiert eine Session als ungelesen — setzt last_seen_by_agent_at zurück.
 * In der Inbox erscheint dann der pinke Strich + "NEU"-Badge wieder.
 */
/**
 * SENTINEL-Zeitstempel = explizit vom Mitarbeiter geflaggt.
 * Wird im Filter-Code erkannt und überschreibt die "wer schrieb zuletzt"-Heuristik.
 * Eine echte ältere Antwort hätte nie ein Datum vor 1990.
 */
const FLAG_SENTINEL = "1970-01-01T00:00:00Z";

export async function markSessionUnread(sessionId: string) {
  const svc = createServiceClient();
  // Beide auf Sentinel setzen → Filter + Bold-Optik feuern, unabhängig davon
  // wer zuletzt geschrieben hat (z.B. wir via IG-App).
  await svc.from("chat_sessions").update({
    last_seen_by_agent_at: FLAG_SENTINEL,
    last_opened_by_agent_at: FLAG_SENTINEL,
  }).eq("id", sessionId);
  revalidatePath("/chatbot/inbox");
  revalidatePath(`/chatbot/inbox/${sessionId}`);
}

/**
 * Markiert eine Session manuell als erledigt/beantwortet — auch wenn die letzte
 * Nachricht von der Kundin kam und gar keine Antwort nötig ist (z.B. "Danke!").
 * Setzt last_seen_by_agent_at = jetzt, damit sie aus dem "Nur unbeantwortet"-Filter
 * verschwindet, OHNE den Status der Session zu verändern.
 */
export async function markSessionAsSeen(sessionId: string) {
  const svc = createServiceClient();
  await svc.from("chat_sessions")
    .update({ last_seen_by_agent_at: new Date().toISOString() })
    .eq("id", sessionId);
  revalidatePath("/chatbot/inbox");
  revalidatePath(`/chatbot/inbox/${sessionId}`);
}

/**
 * Gegenstück zu markSessionAsSeen — "Nicht erledigt":
 * Session erscheint wieder im "Nur unbeantwortet"-Filter, aber die
 * Bold/Normal-Optik (last_opened_by_agent_at) bleibt unberührt — du hast die
 * Session ja schon gesehen, du willst sie nur wieder als "noch zu tun" markieren.
 */
export async function markSessionAsNotDone(sessionId: string) {
  const svc = createServiceClient();
  // Sentinel statt null → Filter berücksichtigt explizite Flagge auch wenn
  // wir zuletzt geschrieben haben. last_opened bleibt unberührt.
  await svc.from("chat_sessions")
    .update({ last_seen_by_agent_at: FLAG_SENTINEL })
    .eq("id", sessionId);
  revalidatePath("/chatbot/inbox");
  revalidatePath(`/chatbot/inbox/${sessionId}`);
}

/**
 * Gegenstück zu markSessionUnread — "Gelesen":
 * Setzt last_opened_by_agent_at = jetzt → Name wird in der Inbox normal/nicht-fett.
 * last_seen_by_agent_at bleibt unberührt (Filter-Status wird nicht geändert).
 */
export async function markSessionAsRead(sessionId: string) {
  const svc = createServiceClient();
  await svc.from("chat_sessions")
    .update({ last_opened_by_agent_at: new Date().toISOString() })
    .eq("id", sessionId);
  revalidatePath("/chatbot/inbox");
  revalidatePath(`/chatbot/inbox/${sessionId}`);
}

/**
 * Markiert eine Session als "Nur für Team" — Bot antwortet ab sofort nicht
 * mehr selbstständig auf neue Kundennachrichten. Setzt zusätzlich bot_mode='off'
 * damit auch assisted/auto-Generierung gestoppt wird.
 */
/** Speichert interne Team-Notizen zu einer Session (für Mitarbeiter, nie an Kundin). */
export async function updateTeamNotes(sessionId: string, notes: string) {
  const svc = createServiceClient();
  const trimmed = notes.trim();
  await svc.from("chat_sessions")
    .update({ team_notes: trimmed || null })
    .eq("id", sessionId);
  revalidatePath("/chatbot/inbox");
  revalidatePath(`/chatbot/inbox/${sessionId}`);
}

export async function toggleHumanOnly(sessionId: string, value: boolean) {
  const svc = createServiceClient();
  await svc.from("chat_sessions").update({
    human_only: value,
    ...(value ? { bot_mode: "off", bot_auto_reply: false } : {}),
  }).eq("id", sessionId);
  revalidatePath("/chatbot/inbox");
  revalidatePath(`/chatbot/inbox/${sessionId}`);
}

/** Schließt eine Session */
export async function closeSession(sessionId: string) {
  const svc = createServiceClient();
  await svc.from("chat_sessions")
    .update({ status: "closed" })
    .eq("id", sessionId);
  revalidatePath("/chatbot/inbox");
}

/** Globalen Default-Bot-Modus für NEUE Sessions setzen */
export async function setGlobalDefaultBotMode(mode: "auto" | "assisted" | "off") {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const svc = createServiceClient();
  await svc.from("chatbot_settings").update({
    default_bot_mode: mode,
    updated_at: new Date().toISOString(),
  }).eq("id", 1);
  revalidatePath("/chatbot/inbox");
}

export type SessionCategory =
  "availability" | "pricing" | "color_advice" | "appointment"
  | "complaint" | "order_status" | "gewerbe" | "partnership" | "general";

/** Manuelles Override der Kategorie (Mitarbeiter korrigiert Bot-Klassifikation).
 *  Setzt zusätzlich category_manual=true, damit der Auto-Klassifizierer
 *  bei eingehenden Nachrichten den Wert nicht überschreibt. */
export async function setSessionCategory(sessionId: string, category: SessionCategory) {
  const svc = createServiceClient();
  await svc.from("chat_sessions").update({ category, category_manual: true }).eq("id", sessionId);
  revalidatePath("/chatbot/inbox");
  revalidatePath(`/chatbot/inbox/${sessionId}`);
}

/** Triggert erneute Auto-Klassifikation via Haiku — hebt das Manual-Lock auf */
export async function reclassifySession(sessionId: string) {
  const svc = createServiceClient();
  await svc.from("chat_sessions").update({ category_manual: false }).eq("id", sessionId);
  const { classifySession } = await import("@/lib/chatbot/classify");
  await classifySession(sessionId);
  revalidatePath("/chatbot/inbox");
  revalidatePath(`/chatbot/inbox/${sessionId}`);
}

/**
 * Markiert eine einzelne Message als gelöscht (soft-delete via deleted_at).
 * Notfall-Tool wenn IG-Recall nicht durchgesynced wurde oder
 * Mitarbeiter eine Nachricht aus der Inbox-Ansicht entfernen will,
 * damit der Bot sie nicht mehr als "offene Frage" interpretiert.
 */
export async function deleteMessage(messageId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const svc = createServiceClient();
  const { data: msg } = await svc.from("chat_messages")
    .select("session_id").eq("id", messageId).single();
  await svc.from("chat_messages")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", messageId);
  if (msg?.session_id) revalidatePath(`/chatbot/inbox/${msg.session_id}`);
  revalidatePath("/chatbot/inbox");
}

/** Macht ein Soft-Delete rückgängig (für versehentliche Löschungen) */
export async function undeleteMessage(messageId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const svc = createServiceClient();
  const { data: msg } = await svc.from("chat_messages")
    .select("session_id").eq("id", messageId).single();
  await svc.from("chat_messages")
    .update({ deleted_at: null }).eq("id", messageId);
  if (msg?.session_id) revalidatePath(`/chatbot/inbox/${msg.session_id}`);
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
