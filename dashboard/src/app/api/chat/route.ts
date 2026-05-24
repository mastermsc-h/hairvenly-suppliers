/**
 * POST /api/chat
 *
 * Body: { sessionId?, message, channel?, attachments? }
 *
 * - Lädt oder erstellt Session
 * - Sammelt Conversation-History
 * - Ruft Claude mit Tools auf
 * - Speichert Bot-Antwort + Tool-Calls in chat_messages
 * - Gibt Bot-Antwort zurück
 */
import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServiceClient } from "@/lib/supabase/server";
import { TOOLS, TOOL_SCHEMAS, type ToolContext } from "@/lib/chatbot/tools";

const MODEL = "claude-sonnet-4-5";
const MAX_TOOL_ITERATIONS = 5;

interface ChatRequest {
  sessionId?:  string;
  message:     string;
  channel?:    "web" | "instagram" | "whatsapp";
  attachments?: { type: "image"; url: string }[];
  avatarName?: string;  // Optional: erzwinge einen bestimmten Avatar (wenn nicht angegeben → zufällig)
}

interface PersonaRow {
  name: string;
  system_prompt: string;
}

interface AvatarRow {
  name: string;
  personality: string;
  weight: number;
}

/** Weighted random pick */
function pickWeighted<T extends { weight: number }>(items: T[]): T {
  const total = items.reduce((s, i) => s + i.weight, 0);
  let r = Math.random() * total;
  for (const item of items) {
    r -= item.weight;
    if (r <= 0) return item;
  }
  return items[items.length - 1];
}

async function getOrCreateSession(
  supabase: ReturnType<typeof createServiceClient>,
  sessionId: string | undefined,
  channel: string,
  signatureName: string,
) {
  if (sessionId) {
    const { data } = await supabase.from("chat_sessions").select("*").eq("id", sessionId).single();
    if (data) return data;
  }
  const { data, error } = await supabase
    .from("chat_sessions")
    .insert({
      channel,
      status: "active",
      bot_signature_name: signatureName,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

async function loadHistory(
  supabase: ReturnType<typeof createServiceClient>,
  sessionId: string,
): Promise<Anthropic.MessageParam[]> {
  const { data } = await supabase
    .from("chat_messages")
    .select("role, content, tool_calls, tool_results, attachments")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });
  if (!data) return [];
  const msgs: Anthropic.MessageParam[] = [];
  for (const m of data) {
    if (m.role === "user") {
      const content: Anthropic.ContentBlockParam[] = [];
      const atts = (m.attachments as { type: string; url: string }[] | null) || [];
      for (const a of atts) {
        if (a.type === "image") {
          content.push({
            type: "image",
            source: { type: "url", url: a.url },
          });
        }
      }
      if (m.content) content.push({ type: "text", text: m.content });
      msgs.push({ role: "user", content: content.length > 0 ? content : (m.content || "") });
    } else if (m.role === "assistant") {
      const blocks: Anthropic.ContentBlockParam[] = [];
      if (m.content) blocks.push({ type: "text", text: m.content });
      const toolCalls = (m.tool_calls as { id: string; name: string; input: Record<string, unknown> }[] | null) || [];
      for (const tc of toolCalls) {
        blocks.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.input });
      }
      msgs.push({ role: "assistant", content: blocks });

      // Tool results als USER-Block (Claude-Konvention)
      const results = (m.tool_results as { tool_use_id: string; content: string }[] | null) || [];
      if (results.length > 0) {
        msgs.push({
          role: "user",
          content: results.map(r => ({
            type: "tool_result" as const,
            tool_use_id: r.tool_use_id,
            content: r.content,
          })),
        });
      }
    } else if (m.role === "human_agent") {
      // Mitarbeiter-Nachricht als assistant darstellen damit Bot Kontext hat
      msgs.push({ role: "assistant", content: m.content || "" });
    }
  }
  return msgs;
}

export async function POST(req: NextRequest) {
  const body = (await req.json()) as ChatRequest;
  if (!body.message?.trim() && (!body.attachments || body.attachments.length === 0)) {
    return NextResponse.json({ error: "message or attachment required" }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Persona (Base-Prompt) laden
  const { data: persona } = await supabase
    .from("chatbot_persona")
    .select("name, system_prompt")
    .eq("active", true)
    .limit(1)
    .single<PersonaRow>();
  if (!persona) {
    return NextResponse.json({ error: "no persona configured" }, { status: 500 });
  }

  // Avatars (Persönlichkeiten) laden
  const { data: avatars } = await supabase
    .from("chatbot_avatars")
    .select("name, personality, weight")
    .eq("active", true);
  const activeAvatars = (avatars as AvatarRow[] | null) || [];
  if (activeAvatars.length === 0) {
    return NextResponse.json({ error: "no active avatars" }, { status: 500 });
  }

  // Avatar-Auswahl:
  //  1. Wenn Kunde/Tester einen bestimmten Avatar gewählt hat → den nehmen
  //  2. Sonst zufällig (gewichtet) aus aktiven Avataren
  let chosenAvatar: AvatarRow;
  if (body.avatarName) {
    const explicit = activeAvatars.find(a => a.name.toLowerCase() === body.avatarName!.toLowerCase());
    chosenAvatar = explicit ?? pickWeighted(activeAvatars);
  } else {
    chosenAvatar = pickWeighted(activeAvatars);
  }
  const signatureName = chosenAvatar.name;

  const session = await getOrCreateSession(
    supabase,
    body.sessionId,
    body.channel ?? "web",
    signatureName,
  );

  // Wenn Session "closed" war → automatisch wieder auf "active" öffnen
  // (Kunde schreibt wieder rein, behandeln wie eine fortgesetzte Konversation)
  if (session.status === "closed") {
    await supabase.from("chat_sessions").update({ status: "active" }).eq("id", session.id);
    session.status = "active";
  }

  // Wenn Session awaiting_human → KEINE Bot-Antwort, nur Message speichern
  if (session.status === "awaiting_human") {
    await supabase.from("chat_messages").insert({
      session_id: session.id,
      role: "user",
      content: body.message,
      attachments: body.attachments ?? [],
    });
    await supabase
      .from("chat_sessions")
      .update({
        last_customer_msg_at: new Date().toISOString(),
        last_message_at:      new Date().toISOString(),
      })
      .eq("id", session.id);
    return NextResponse.json({
      sessionId: session.id,
      status: "awaiting_human",
      message: null,
      hint: "Eine Mitarbeiterin übernimmt das Gespräch — der Bot pausiert.",
    });
  }

  const effectiveSignature = session.bot_signature_name || signatureName;

  // User-Message speichern
  await supabase.from("chat_messages").insert({
    session_id: session.id,
    role: "user",
    content: body.message,
    attachments: body.attachments ?? [],
  });

  // last_customer_msg_at aktualisieren + falls Follow-Up gesendet wurde: als 'responded' markieren
  const updates: Record<string, string> = {
    last_customer_msg_at: new Date().toISOString(),
  };
  if ((session as { follow_up_status?: string }).follow_up_status === "sent") {
    updates.follow_up_status = "responded";
  }
  await supabase
    .from("chat_sessions")
    .update(updates)
    .eq("id", session.id);

  // 🚀 CONTACT-INTENT FAST-PATH (gleicher Schutz wie in respondAsBot).
  // Wenn die User-Message nach Adresse/Telefon/Öffnungszeiten/E-Mail fragt
  // → Template aus business-config.ts streamen, KEIN LLM-Call.
  // Garantiert deterministische korrekte Daten — unmöglich zu halluzinieren.
  {
    const { detectContactIntent, renderContactResponse } = await import("@/lib/chatbot/intent-contact");
    const contactIntent = detectContactIntent(body.message);
    if (contactIntent) {
      const templated = renderContactResponse(contactIntent);
      console.log(`[chat/route] CONTACT-INTENT-BYPASS session=${session.id.slice(0,8)} intent=${contactIntent} (0 tokens)`);
      // Direkt in chat_messages speichern
      await supabase.from("chat_messages").insert({
        session_id: session.id,
        role:       "assistant",
        content:    templated,
      });
      await supabase
        .from("chat_sessions")
        .update({ last_message_at: new Date().toISOString() })
        .eq("id", session.id);
      // Als Stream zurückgeben (Client erwartet SSE-Format)
      const sseEncoder = new TextEncoder();
      const sseStream = new ReadableStream({
        start(controller) {
          // Den ganzen Text in einem Chunk (Template ist statisch)
          controller.enqueue(sseEncoder.encode(`data: ${JSON.stringify({ type: "text", delta: templated })}\n\n`));
          controller.enqueue(sseEncoder.encode(`data: ${JSON.stringify({ type: "done", status: "active" })}\n\n`));
          controller.close();
        }
      });
      return new Response(sseStream, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache, no-transform",
          "Connection": "keep-alive",
        }
      });
    }
  }

  // History laden
  const history = await loadHistory(supabase, session.id);

  // System-Prompt: Signatur einsetzen + Avatar-Persönlichkeit einbauen
  let systemPrompt = persona.system_prompt.replaceAll("{signature_name}", effectiveSignature);

  // Avatar-Persönlichkeit ergänzen (aus aktueller Session oder gewähltem Avatar)
  const sessionAvatar = activeAvatars.find(a => a.name === effectiveSignature) || chosenAvatar;
  systemPrompt += `\n\n## DEINE PERSÖNLICHKEIT (als ${sessionAvatar.name})\n${sessionAvatar.personality}`;

  // 🛡 ZENTRALE PRE-LLM PIPELINE (Single Source of Truth — pipeline.ts)
  // Erweitert systemPrompt + liefert ctx für Post-LLM-Sanitizer.
  // Webhook (respond.ts) UND Web-Chat (diese Route) nutzen IDENTISCHE Pipeline.
  //
  // SIBLING-SWEEP: lädt die letzten 5 Customer-Messages (nicht nur body.message),
  // damit Folge-Fragen wie "zeig mir das produkt" den Farbcode aus früheren
  // Messages erkennen — sonst injiziert der Code-Lookup nichts und der Bot
  // antwortet aus dem Kopf.
  const { applyPreLlmContext, applyPostLlmSanitizers } = await import("@/lib/chatbot/pipeline");
  const { data: recentUserMsgs } = await supabase
    .from("chat_messages")
    .select("content")
    .eq("session_id", session.id)
    .eq("role", "user")
    .order("created_at", { ascending: false })
    .limit(5);
  const recentTexts: string[] = (recentUserMsgs || [])
    .map(r => (r.content as string | null) || "")
    .filter(t => t.length > 0)
    .reverse();
  const preLlm = await applyPreLlmContext(systemPrompt, body.message, recentTexts);
  systemPrompt = preLlm.systemPrompt;
  const pipelineCtx = preLlm.ctx;

  // Lade Trainings-Korrekturen: global (avatar_name=null) + spezifisch für aktuellen Avatar
  const { data: trainingExamples } = await supabase
    .from("chatbot_training")
    .select("user_message, good_answer, bad_answer, feedback, avatar_name")
    .eq("active", true)
    .or(`avatar_name.is.null,avatar_name.eq.${effectiveSignature}`)
    .order("created_at", { ascending: false })
    .limit(20);

  if (trainingExamples && trainingExamples.length > 0) {
    systemPrompt += "\n\n## DEINE TRAININGS-BEISPIELE\n";
    systemPrompt += "Diese Korrekturen hat das Team dir beigebracht — verhalte dich in ähnlichen Situationen entsprechend:\n\n";
    for (let i = 0; i < trainingExamples.length; i++) {
      const ex = trainingExamples[i];
      const scope = ex.avatar_name ? `nur für ${ex.avatar_name}` : "für alle Avatare";
      systemPrompt += `### Beispiel ${i + 1} (${scope})\n`;
      systemPrompt += `**Kunde fragt (oder ähnlich):** ${ex.user_message}\n`;
      systemPrompt += `**So antwortest du (richtig):** ${ex.good_answer}\n`;
      if (ex.bad_answer) systemPrompt += `**So NICHT antworten:** ${ex.bad_answer}\n`;
      if (ex.feedback)   systemPrompt += `**Hinweis vom Team:** ${ex.feedback}\n`;
      systemPrompt += "\n";
    }
  }

  // Claude mit Streaming + Tool-Loop
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const toolCtx: ToolContext = { sessionId: session.id, signatureName: effectiveSignature };

  const encoder = new TextEncoder();
  const sse = (data: unknown) => encoder.encode(`data: ${JSON.stringify(data)}\n\n`);

  const stream = new ReadableStream({
    async start(controller) {
      try {
        // Session-Metadaten sofort senden
        controller.enqueue(sse({
          type: "session",
          sessionId: session.id,
          signatureName: effectiveSignature,
        }));

        let messages = history;
        let finalText = "";
        const allToolCalls: { id: string; name: string; input: Record<string, unknown> }[] = [];
        const allToolResults: { tool_use_id: string; content: string }[] = [];

        for (let iter = 0; iter < MAX_TOOL_ITERATIONS; iter++) {
          // Streaming-Aufruf
          let iterText = "";
          const toolBlocks: { id: string; name: string; input: Record<string, unknown> }[] = [];
          let currentToolId = "";
          let currentToolName = "";
          let currentToolInputJson = "";

          const claudeStream = anthropic.messages.stream({
            model: MODEL,
            max_tokens: 1024,
            system: systemPrompt,
            tools: TOOL_SCHEMAS,
            messages,
          });

          for await (const event of claudeStream) {
            if (event.type === "content_block_start") {
              if (event.content_block.type === "tool_use") {
                currentToolId = event.content_block.id;
                currentToolName = event.content_block.name;
                currentToolInputJson = "";

                // Fallback: wenn Bot keine Holding-Message gemacht hat aber ein
                // langsames Tool aufruft → automatisch eine einfügen
                const SLOW_TOOLS = ["get_stock_eta"];
                if (SLOW_TOOLS.includes(currentToolName) && !iterText.trim()) {
                  const holding = "Moment, ich check das eben für dich… 🩷\n\n";
                  iterText += holding;
                  controller.enqueue(sse({ type: "text", delta: holding }));
                }

                controller.enqueue(sse({
                  type: "tool_start",
                  tool: currentToolName,
                }));
              }
            } else if (event.type === "content_block_delta") {
              if (event.delta.type === "text_delta") {
                iterText += event.delta.text;
                controller.enqueue(sse({ type: "text", delta: event.delta.text }));
              } else if (event.delta.type === "input_json_delta") {
                currentToolInputJson += event.delta.partial_json;
              }
            } else if (event.type === "content_block_stop") {
              if (currentToolId) {
                let parsed: Record<string, unknown> = {};
                try { parsed = JSON.parse(currentToolInputJson || "{}"); } catch {}
                toolBlocks.push({ id: currentToolId, name: currentToolName, input: parsed });
                currentToolId = "";
                currentToolName = "";
                currentToolInputJson = "";
              }
            }
          }

          const finalMsg = await claudeStream.finalMessage();
          if (iterText) finalText = iterText;

          // Wenn keine Tool-Calls → fertig
          if (toolBlocks.length === 0 || finalMsg.stop_reason === "end_turn") break;

          // Tools ausführen
          const results: Anthropic.ContentBlockParam[] = [];
          for (const tb of toolBlocks) {
            const tool = TOOLS[tb.name];
            let output: string;
            if (!tool) {
              output = `Tool '${tb.name}' nicht verfügbar`;
            } else {
              try {
                const res = await tool.execute(tb.input, toolCtx);
                output = res.output;
              } catch (e) {
                output = `Tool-Fehler: ${(e as Error).message}`;
              }
            }
            allToolCalls.push({ id: tb.id, name: tb.name, input: tb.input });
            allToolResults.push({ tool_use_id: tb.id, content: output });
            results.push({ type: "tool_result", tool_use_id: tb.id, content: output });

            controller.enqueue(sse({ type: "tool_end", tool: tb.name }));
          }

          messages = [
            ...messages,
            { role: "assistant", content: finalMsg.content as Anthropic.ContentBlockParam[] },
            { role: "user", content: results },
          ];
        }

        // 🛡 ZENTRALE POST-LLM PIPELINE (Single Source of Truth — pipeline.ts)
        // Beide Pipelines (Webhook + Web-Chat) rufen IDENTISCHE Sanitizer-
        // Reihenfolge auf. Neue Sanitizer kommen IMMER in pipeline.ts —
        // dann wirken sie automatisch in beiden Pipelines.
        const sanitized = applyPostLlmSanitizers(finalText, pipelineCtx);
        if (sanitized.changed) {
          console.warn(`[chat/route] post-llm pipeline modified text (session=${session.id.slice(0,8)}, ${finalText.length}→${sanitized.text.length} chars). Sending text_replace event.`);
          controller.enqueue(sse({
            type: "text_replace",
            fullText: sanitized.text,
          }));
        }
        finalText = sanitized.text;

        // Assistant-Antwort speichern (Volltext, sanitized)
        await supabase.from("chat_messages").insert({
          session_id:   session.id,
          role:         "assistant",
          content:      finalText,
          tool_calls:   allToolCalls.length > 0 ? allToolCalls : null,
          tool_results: allToolResults.length > 0 ? allToolResults : null,
        });

        const { data: updated } = await supabase
          .from("chat_sessions")
          .select("status")
          .eq("id", session.id)
          .single();

        await supabase
          .from("chat_sessions")
          .update({ last_message_at: new Date().toISOString() })
          .eq("id", session.id);

        controller.enqueue(sse({
          type: "done",
          status: updated?.status || "active",
          finalText: finalText,
        }));
        // (Wächter läuft per Cron alle 30 Min, nicht in Echtzeit)
      } catch (e) {
        controller.enqueue(sse({
          type: "error",
          error: (e as Error).message,
        }));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
    },
  });
}
