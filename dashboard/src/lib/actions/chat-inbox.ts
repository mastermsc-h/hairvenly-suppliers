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

/**
 * Manuelle Priorität setzen — überstimmt Auto-Computed-Priorität in der Inbox.
 * priority="auto" oder null → zurück auf Auto-Mode (Server berechnet aus Triggern).
 */
export async function setSessionPriority(
  sessionId: string,
  priority: "high" | "normal" | "low" | "auto" | null,
) {
  const svc = createServiceClient();
  const dbValue = priority === "auto" || priority === null ? null : priority;
  await svc.from("chat_sessions").update({ manual_priority: dbValue }).eq("id", sessionId);
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
export async function setBotMode(sessionId: string, mode: "auto" | "selective_auto" | "assisted" | "off") {
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

  // Helper: gibt es offene Customer-Messages (= Kundin hat zuletzt geschrieben,
  // noch keine Bot/Agent-Antwort danach)? Wenn ja → Bot triggern, sonst nichts.
  const findOpenCustomerMsg = async () => {
    const { data: recent } = await svc.from("chat_messages")
      .select("id, role, created_at")
      .eq("session_id", sessionId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(10);
    const msgs = recent || [];
    const lastAgentIdx = msgs.findIndex(m => m.role === "assistant" || m.role === "human_agent");
    const openCustomerMsgs =
      lastAgentIdx === -1 ? msgs.filter(m => m.role === "user")
                          : msgs.slice(0, lastAgentIdx).filter(m => m.role === "user");
    // Stale-Schutz: jüngste offene Frage > 60 Tage alt → nicht reaktivieren
    if (openCustomerMsgs.length > 0) {
      const youngest = new Date(openCustomerMsgs[0].created_at).getTime();
      if (Date.now() - youngest > 60 * 24 * 60 * 60 * 1000) return null;
    }
    return openCustomerMsgs.length > 0 ? openCustomerMsgs[openCustomerMsgs.length - 1] : null;
  };

  // Bei Wechsel auf "auto" oder "selective_auto" mit offener Kunden-Nachricht:
  // sofort Bot generieren + senden (analog zu Webhook-Trigger), damit die
  // Kundin nicht warten muss bis sie nochmal schreibt.
  if (mode === "auto" || mode === "selective_auto") {
    // Klassifikation nachholen falls fehlt — SYNCHRON, weil granularer
    // Kill-Switch unten die category als Whitelist-Lookup braucht.
    let triggerCategory: string | null = null;
    try {
      const { data: cur } = await svc.from("chat_sessions").select("category").eq("id", sessionId).single();
      if (cur?.category) {
        triggerCategory = cur.category as string;
      } else {
        const { classifySession } = await import("@/lib/chatbot/classify");
        triggerCategory = (await classifySession(sessionId)) || null;
      }
    } catch {}

    const openMsg = await findOpenCustomerMsg();
    if (openMsg) {
      const { data: existingDraft } = await svc.from("chat_drafts")
        .select("id").eq("session_id", sessionId).eq("status", "pending").maybeSingle();
      // 🛑 GRANULAR KILL-SWITCH (gleicher Helper wie im Webhook).
      // Bei deaktiviertem Master-Switch werden nur "safe" Categories
      // (availability/general/pricing/order_status) zugelassen. Risky
      // Categories warten weiter auf Mitarbeiter-Click.
      const { isProactiveGenerationEnabled } = await import("@/lib/chatbot/settings");
      const proactiveAllowed = await isProactiveGenerationEnabled(triggerCategory);
      if (!existingDraft && proactiveAllowed) {
        try {
          const { respondAsBot, splitLongMessage } = await import("@/lib/chatbot/respond");
          // Bei auto: direkt senden. Bei selective_auto: erstmal generieren,
          // dann via Confidence-Check entscheiden ob senden oder Draft.
          const willDecideAfter = mode === "selective_auto";
          const result = await respondAsBot(sessionId, { assisted: willDecideAfter });
          if (result.success && result.text) {
            // Channel ermitteln
            const { data: ses } = await svc.from("chat_sessions")
              .select("channel, external_id, category").eq("id", sessionId).single();

            let shouldSendAutonomous = mode === "auto";
            if (mode === "selective_auto") {
              // Confidence-Check inline (vermeiden Import-Loop mit webhook)
              const replyText = result.text;
              const category = ses?.category || null;
              const safeCategories = new Set(["availability", "general", "pricing"]);
              const looksClarify = replyText.length < 1000 &&
                /\?/.test(replyText) &&
                /\b(suchst|brauchst|möchtest|welche|magst\s+du|hast\s+du)\b/i.test(replyText) &&
                !/hairvenly\.de\/products\//i.test(replyText);
              shouldSendAutonomous = looksClarify || (category && safeCategories.has(category) && (
                /hairvenly\.de\/products\//i.test(replyText) ||
                /(auf lager|sofort verfügbar|gerade unterwegs|ausverkauft)/i.test(replyText)
              )) || false;
            }

            if (shouldSendAutonomous) {
              // assistant-Message + senden
              const { data: inserted } = await svc.from("chat_messages").insert({
                session_id: sessionId, role: "assistant", content: result.text,
                tool_calls:   result.toolCalls && result.toolCalls.length > 0 ? result.toolCalls : null,
                tool_results: result.toolResults && result.toolResults.length > 0 ? result.toolResults : null,
                auto_sent: true,
              }).select("id").single();
              await svc.from("chat_sessions").update({ last_message_at: new Date().toISOString() }).eq("id", sessionId);

              if (ses?.channel === "instagram" && ses.external_id) {
                const { sendInstagramMessage } = await import("@/lib/messaging/meta");
                const parts = splitLongMessage(result.text);
                let firstMid: string | undefined;
                for (let i = 0; i < parts.length; i++) {
                  const r = await sendInstagramMessage(ses.external_id, parts[i]);
                  if (i === 0 && r.success && r.message_id) firstMid = r.message_id;
                  if (i < parts.length - 1) await new Promise(s => setTimeout(s, 600));
                }
                if (firstMid && inserted?.id) {
                  await svc.from("chat_messages").update({ external_id: firstMid }).eq("id", inserted.id);
                }
              } else if (ses?.channel === "whatsapp" && ses.external_id) {
                const { sendWhatsAppMessage } = await import("@/lib/messaging/meta");
                const r = await sendWhatsAppMessage(ses.external_id, result.text);
                if (r.success && r.message_id && inserted?.id) {
                  await svc.from("chat_messages").update({ external_id: r.message_id }).eq("id", inserted.id);
                }
              }
              console.log(`[setBotMode] AUTO-SENT for session ${sessionId} (mode=${mode})`);
            } else {
              // Draft speichern (selective_auto + nicht confident)
              await svc.from("chat_drafts").insert({
                session_id: sessionId, original_text: result.text,
                tool_calls:   result.toolCalls && result.toolCalls.length > 0 ? result.toolCalls : null,
                tool_results: result.toolResults && result.toolResults.length > 0 ? result.toolResults : null,
                trigger_message_id: openMsg.id, status: "pending",
              });
              console.log(`[setBotMode] draft for session ${sessionId} (selective_auto, not confident)`);
            }
          }
        } catch (e) {
          console.error("[setBotMode] auto-trigger crashed:", e);
        }
      }
    }
  }

  if (mode === "assisted") {
    // Klassifikation nachholen falls noch keine — SYNCHRON, weil granularer
    // Kill-Switch unten die category als Whitelist-Lookup braucht.
    let assistedTriggerCategory: string | null = null;
    try {
      const { data: cur } = await svc.from("chat_sessions").select("category").eq("id", sessionId).single();
      if (cur?.category) {
        assistedTriggerCategory = cur.category as string;
      } else {
        const { classifySession } = await import("@/lib/chatbot/classify");
        assistedTriggerCategory = (await classifySession(sessionId)) || null;
      }
    } catch {}

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

      // 🛑 GRANULAR KILL-SWITCH (Cluster-Detection-Pfad — auch proaktiv).
      // Bei deaktiviertem Master-Switch nur safe Categories (siehe settings.ts).
      const { isProactiveGenerationEnabled: isProactive2 } = await import("@/lib/chatbot/settings");
      const proactiveAllowed2 = await isProactive2(assistedTriggerCategory);
      if (openCustomerMsgs.length > 0 && proactiveAllowed2) {
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
export async function approveDraft(
  draftId: string,
  finalText: string,
  note?: string,
  saveAsTraining = true, // Default = ja, Mitarbeiterin kann via Checkbox abwählen
  markAsPositive = false, // 👍 — auch ohne Edit als positives Vorbild speichern
) {
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
  // auto_sent=false explizit → diese Message wurde via assisted-Modus + Mitarbeiter-Approve
  // gesendet (= "manueller autobot"), nicht autonom vom Bot.
  // Wenn explizit als positives Vorbild bewertet: sentiment + feedback-marker direkt setzen.
  const { data: insertedMsg } = await svc.from("chat_messages").insert({
    session_id:   draft.session_id,
    role:         "assistant",
    content:      final,
    tool_calls:   draft.tool_calls,
    tool_results: draft.tool_results,
    auto_sent:    false,
    teach_feedback_at: markAsPositive ? new Date().toISOString() : null,
    teach_feedback_by: markAsPositive ? user.id : null,
    teach_sentiment:   markAsPositive ? "positive" : null,
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
  // Nur ausführen wenn saveAsTraining=true — sonst lernt der Bot ungewollt
  // aus einmaligen situativen Edits.
  if (saveAsTraining && wasEdited) {
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

  if (saveAsTraining && (wasEdited || hasNote || hasRefineFeedback || markAsPositive) && draft.trigger_message_id) {
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
      if (markAsPositive && !wasEdited && !hasRefineFeedback) {
        feedbackParts.push("👍 POSITIVES VORBILD: Diese Bot-Antwort war so gut, dass die Mitarbeiterin sie unverändert senden konnte. Antworte bei ähnlichen Fragen in diesem Stil/mit diesem Inhalt.");
      } else if (markAsPositive) {
        feedbackParts.push("👍 ALS GUT BEWERTET nach Mitarbeiter-Approve (mit ggf. Edit/Refine).");
      }
      if (hasRefineFeedback) {
        feedbackParts.push(
          "REFINE-FEEDBACKS DER MITARBEITERIN (in chronologischer Reihenfolge):\n" +
          refineFeedbacks.map((f, i) => `${i + 1}. ${f}`).join("\n")
        );
      }
      if (hasNote) feedbackParts.push(`STRATEGIE-HINWEIS: ${note!.trim()}`);
      if (wasEdited) feedbackParts.push("Mitarbeiterin hat finalen Text noch direkt editiert");

      const tags = markAsPositive && !wasEdited && !hasRefineFeedback
        ? ["positive_exemplar", "thumbs_up"]
        : ["assisted_correction"];
      if (hasRefineFeedback) tags.push("refined");
      if (hasNote) tags.push("with_strategy_note");
      if (markAsPositive && (wasEdited || hasRefineFeedback)) tags.push("positive_exemplar");

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
        // Reine positive Vorbilder werden gepinnt, damit der Bot sie priorisiert.
        // Mixed-Fälle (positive + edit/refine) sind eher Korrektur — nicht pinnen.
        pinned:          markAsPositive && !wasEdited && !hasRefineFeedback,
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

  // REFINE-LIMIT: Maximal 2 Iterationen pro Draft. Jeder Refine kostet einen
  // vollen Sonnet-Call (~$0.04-0.17). Bei mehr als 2 Versuchen: Mitarbeiter:in
  // sollte manuell editieren statt weiter generieren — sonst Kosten-Explosion
  // ohne Mehrwert.
  const existingRefines = ((draft.refinement_history as Array<unknown> | null) || []).length;
  const MAX_REFINES = 2;
  if (existingRefines >= MAX_REFINES) {
    throw new Error(
      `Limit erreicht: maximal ${MAX_REFINES} "Neu generieren" pro Entwurf. ` +
      `Bitte den Text jetzt manuell editieren oder verwerfen und selbst antworten.`
    );
  }

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
export async function generateDraftOnDemand(
  sessionId: string,
  opts: { force?: boolean } = {},
): Promise<{ ok: true } | { ok: false; reason: string }> {
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
  // User-Bug 2026-05-27: nach Deploy mit neuem Code zeigte UI immer noch den
  // alten Draft (mit altem Code generiert), weil generateDraftOnDemand stumm
  // abbrach wenn ein pending Draft existierte. Mit `force: true` wird der alte
  // Draft als cancelled markiert und ein neuer generiert.
  const { data: existing } = await svc
    .from("chat_drafts")
    .select("id")
    .eq("session_id", sessionId)
    .eq("status", "pending")
    .limit(1)
    .maybeSingle();
  if (existing) {
    if (!opts.force) {
      return { ok: false, reason: "Es liegt bereits ein offener Entwurf vor." };
    }
    // Force-Regenerate: alten Draft als discarded markieren, dann neuen erstellen
    await svc.from("chat_drafts")
      .update({ status: "discarded" })
      .eq("id", existing.id);
    console.log(`[generateDraftOnDemand] FORCE — discarded old draft ${existing.id.slice(0,8)} for session ${sessionId.slice(0,8)}`);
  }

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
    .update({
      last_seen_by_agent_at: new Date().toISOString(),
      ig_unread_count: 0, // optimistisches Lokales Update — Banner verschwindet sofort
    })
    .eq("id", sessionId);

  // 📲 IG-SYNC: sender_action=mark_seen zu Meta API, damit der IG-Counter
  // auch in der Instagram-App runtergeht. Fire-and-forget, blockt nicht.
  // User-Anweisung 2026-05: Dashboard ist Master. Bei Dashboard-Action
  // soll IG automatisch nachziehen.
  void (async () => {
    const { data: sess } = await svc.from("chat_sessions")
      .select("channel, external_id")
      .eq("id", sessionId)
      .maybeSingle();
    if (sess?.channel === "instagram" && sess.external_id) {
      const { markInstagramSeen } = await import("@/lib/messaging/meta");
      const r = await markInstagramSeen(sess.external_id);
      if (!r.success) {
        console.warn(`[markSessionAsSeen] IG-mark_seen failed for session=${sessionId.slice(0,8)}: ${r.error}`);
      }
    }
  })();

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
/**
 * Markiert eine Session für manuelles Follow-Up — z.B. wenn eine Konversation
 * unklar endet ("danke!") und wir später nochmal nachfragen wollen ob die
 * Kundin gekauft hat oder Bedenken hat. Setzt followup_due_at = jetzt+N Tage.
 * Übergib daysFromNow=0 um die Markierung zu entfernen.
 */
export async function setFollowupReminder(sessionId: string, daysFromNow: number, reason?: string) {
  const svc = createServiceClient();
  if (daysFromNow <= 0) {
    await svc.from("chat_sessions")
      .update({ followup_due_at: null, followup_reason: null })
      .eq("id", sessionId);
  } else {
    const due = new Date(Date.now() + daysFromNow * 86400 * 1000).toISOString();
    await svc.from("chat_sessions")
      .update({
        followup_due_at: due,
        followup_reason: reason?.trim() || null,
      })
      .eq("id", sessionId);
  }
  revalidatePath("/chatbot/inbox");
  revalidatePath(`/chatbot/inbox/${sessionId}`);
  revalidatePath("/chatbot/follow-ups");
}

/** Speichert interne Team-Notizen zu einer Session (für Mitarbeiter, nie an Kundin). */
export async function updateTeamNotes(sessionId: string, notes: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const svc = createServiceClient();
  const trimmed = notes.trim();
  await svc.from("chat_sessions")
    .update({
      team_notes: trimmed || null,
      team_notes_updated_at: trimmed ? new Date().toISOString() : null,
      team_notes_updated_by: trimmed ? user.id : null,
    })
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

/**
 * Erfasst Mitarbeiter-Feedback zu einer autonom-vom-Bot-gesendeten Nachricht.
 * Wird als chatbot_training-Entry gespeichert: bad_answer = der ursprüngliche
 * Autobot-Text, good_answer = die Mitarbeiter-Korrektur, feedback = die Notiz.
 * Damit lernt der Bot beim nächsten ähnlichen Fall, was er anders machen soll.
 *
 * WICHTIG: Diese Funktion sendet NICHTS an die Kundin — sie ist rein für die
 * interne Trainingsbasis. Die Original-Bot-Message bleibt unverändert im Chat.
 */
export async function teachFromAutobotMessage(
  messageId: string,
  correctedText: string,
  feedback: string
) {
  if (!correctedText?.trim()) throw new Error("Korrigierte Antwort fehlt");
  if (!feedback?.trim())      throw new Error("Feedback-Notiz fehlt");

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const svc = createServiceClient();

  // 1) Original-Bot-Message holen (für bad_answer + Kontext)
  const { data: msg } = await svc.from("chat_messages")
    .select("id, session_id, content, role, auto_sent, created_at")
    .eq("id", messageId)
    .single();
  if (!msg) throw new Error("Bot-Message nicht gefunden");
  if (msg.role !== "assistant") throw new Error("Nur Bot-Antworten können nachtrainiert werden");

  // 2) Letzte User-Message vor der Bot-Message holen (= Trigger)
  const { data: triggerMsg } = await svc.from("chat_messages")
    .select("content")
    .eq("session_id", msg.session_id)
    .eq("role", "user")
    .is("deleted_at", null)
    .lt("created_at", msg.created_at)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // 3) Letzte ~6 Messages als Kontext für context_messages
  const { data: contextMsgs } = await svc.from("chat_messages")
    .select("role, content, created_at")
    .eq("session_id", msg.session_id)
    .is("deleted_at", null)
    .lte("created_at", msg.created_at)
    .order("created_at", { ascending: false })
    .limit(8);
  const context = (contextMsgs || []).reverse().map(m => ({ role: m.role, content: m.content }));

  // 4) Mitarbeiter-Name aus profiles
  const { data: profile } = await svc.from("profiles")
    .select("display_name, email").eq("id", user.id).maybeSingle();
  const authorLabel = profile?.display_name || profile?.email || "Mitarbeiterin";

  // 5) Training-Entry speichern (pinned damit Bot ihn priorisiert)
  const trainErr = await svc.from("chatbot_training").insert({
    user_message:     triggerMsg?.content || "(keine direkte Kunden-Frage davor)",
    bad_answer:       msg.content,
    good_answer:      correctedText.trim(),
    feedback:         `[Nachtraining von ${authorLabel}] ${feedback.trim()}`,
    context_messages: context,
    tags:             ["autobot-nachtraining", "manuelle-korrektur"],
    pinned:           true,
    active:           true,
    created_by:       user.id,
  });
  if (trainErr.error) throw new Error("Training konnte nicht gespeichert werden: " + trainErr.error.message);

  // 6) Auf der Bot-Message ein Flag setzen, damit UI weiß "diese wurde nachtrainiert"
  //    — verhindert dass dieselbe Korrektur 5× landet.
  await svc.from("chat_messages")
    .update({
      teach_feedback_at: new Date().toISOString(),
      teach_feedback_by: user.id,
      teach_sentiment:   "correction",
    })
    .eq("id", messageId);

  revalidatePath(`/chatbot/inbox/${msg.session_id}`);
  return { ok: true as const };
}

/**
 * Positiv-Bewertung: Mitarbeiter:in sagt "diese Bot-Antwort war gut, nimm sie
 * als Vorbild für ähnliche Fälle". Speichert einen Training-Eintrag mit
 *   good_answer = Bot-Text (unverändert)
 *   bad_answer  = null  (es gibt keine Gegen-Version)
 *   tags        = ["positive_exemplar", "thumbs_up"]
 *   pinned      = true  (Bot priorisiert positive Vorbilder)
 *
 * Damit lernt der Bot: "wenn jemand sowas Ähnliches fragt → antworte in dem
 * Stil/Inhalt". Anders als bei Korrekturen gibt's hier keinen Diff zu lernen,
 * sondern ein positives Muster zu verankern.
 *
 * Funktioniert für JEDE assistant-Message — autonom-gesendete Autobot-Antworten
 * UND nach Approve gesendete Assisted-Antworten. Beide Wege bekommen ein
 * teach_sentiment='positive' auf chat_messages.
 */
export async function markBotMessageAsGood(messageId: string, note?: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const svc = createServiceClient();

  // 1) Bot-Message holen
  const { data: msg } = await svc.from("chat_messages")
    .select("id, session_id, content, role, created_at, teach_feedback_at")
    .eq("id", messageId).single();
  if (!msg) throw new Error("Bot-Message nicht gefunden");
  if (msg.role !== "assistant") throw new Error("Nur Bot-Antworten können bewertet werden");
  if (msg.teach_feedback_at) {
    // bereits bewertet — Idempotent, einfach nichts tun
    return { ok: true as const, alreadyRated: true };
  }

  // 2) Letzte User-Message davor = Trigger
  const { data: triggerMsg } = await svc.from("chat_messages")
    .select("content")
    .eq("session_id", msg.session_id)
    .eq("role", "user")
    .is("deleted_at", null)
    .lt("created_at", msg.created_at)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  // 3) Letzte ~6 Messages bis inkl. der Bot-Message als Kontext
  const { data: contextMsgs } = await svc.from("chat_messages")
    .select("role, content, created_at")
    .eq("session_id", msg.session_id)
    .is("deleted_at", null)
    .lte("created_at", msg.created_at)
    .order("created_at", { ascending: false })
    .limit(8);
  const context = (contextMsgs || [])
    .slice().reverse()
    .filter(m => (m.role === "user" || m.role === "assistant" || m.role === "human_agent") && m.content)
    .map(m => ({
      role: m.role === "human_agent" ? "assistant" : m.role,
      content: (m.content || "").trim(),
    }));

  // 4) Mitarbeiter:in
  const { data: profile } = await svc.from("profiles")
    .select("display_name, email").eq("id", user.id).maybeSingle();
  const authorLabel = profile?.display_name || profile?.email || "Mitarbeiterin";

  // 5) Training-Eintrag: positives Vorbild
  const cleanedNote = note?.trim();
  const feedbackText = cleanedNote
    ? `[👍 POSITIVES VORBILD — bewertet von ${authorLabel}] ${cleanedNote}`
    : `[👍 POSITIVES VORBILD — bewertet von ${authorLabel}] Diese Bot-Antwort war gut so. Antwortet bei ähnlichen Fragen in diesem Stil/mit diesem Inhalt.`;

  const trainErr = await svc.from("chatbot_training").insert({
    user_message:     triggerMsg?.content || "(keine direkte Kunden-Frage davor)",
    bad_answer:       null, // bewusst null — es gibt keine Gegen-Version
    good_answer:      msg.content,
    feedback:         feedbackText,
    context_messages: context,
    tags:             ["positive_exemplar", "thumbs_up"],
    pinned:           true,
    active:           true,
    created_by:       user.id,
  });
  if (trainErr.error) throw new Error("Training konnte nicht gespeichert werden: " + trainErr.error.message);

  // 6) Marker auf der Bot-Message
  await svc.from("chat_messages")
    .update({
      teach_feedback_at: new Date().toISOString(),
      teach_feedback_by: user.id,
      teach_sentiment:   "positive",
    })
    .eq("id", messageId);

  revalidatePath(`/chatbot/inbox/${msg.session_id}`);
  return { ok: true as const };
}
