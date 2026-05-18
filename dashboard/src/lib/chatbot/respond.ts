/**
 * Bot-Antwort für eine bestehende Session generieren + speichern.
 * Wird von Webhook-Handlern aufgerufen (Instagram/WhatsApp) sowie von /api/chat.
 */
import Anthropic from "@anthropic-ai/sdk";
import { createServiceClient } from "@/lib/supabase/server";
import { TOOLS, TOOL_SCHEMAS, type ToolContext } from "@/lib/chatbot/tools";

const MODEL = "claude-sonnet-4-5";
const MAX_ITER = 5;

interface RespondResult {
  success: boolean;
  text?: string;
  toolsUsed?: string[];
  toolCalls?: { id: string; name: string; input: Record<string, unknown> }[];
  toolResults?: { tool_use_id: string; content: string }[];
  error?: string;
}

interface RespondOptions {
  /** Wenn true: Text NICHT in chat_messages speichern (für Bot-Begleitung-Entwurf) */
  assisted?: boolean;
  /**
   * ISO-Timestamp: ab wann gilt eine Kundennachricht als "im aktuellen Burst".
   * Verhindert dass uralte unbeantwortete Fragen mit-beantwortet werden.
   */
  burstSinceIso?: string;
}

/**
 * Generiert Bot-Antwort für eine Session basierend auf bisherigem Verlauf,
 * speichert sie als assistant-Message in chat_messages.
 */
export async function respondAsBot(sessionId: string, opts: RespondOptions = {}): Promise<RespondResult> {
  const svc = createServiceClient();

  // Session laden
  const { data: session } = await svc
    .from("chat_sessions")
    .select("id, bot_signature_name, channel, status")
    .eq("id", sessionId)
    .single();
  if (!session) return { success: false, error: "session not found" };
  if (session.status !== "active") return { success: false, error: "session not active" };

  const signatureName = session.bot_signature_name || "Lara";

  // Persona
  const { data: persona } = await svc
    .from("chatbot_persona")
    .select("system_prompt")
    .eq("active", true).limit(1).single();
  if (!persona) return { success: false, error: "no persona" };

  // Avatar
  const { data: avatars } = await svc
    .from("chatbot_avatars")
    .select("name, personality")
    .eq("active", true);
  const avatarRow = (avatars || []).find(a => a.name === signatureName) || (avatars || [])[0];

  // System-Prompt zusammenbauen
  let systemPrompt = persona.system_prompt.replaceAll("{signature_name}", signatureName);
  if (avatarRow) {
    systemPrompt += `\n\n## DEINE PERSÖNLICHKEIT (als ${avatarRow.name})\n${avatarRow.personality}`;
  }

  // Trainings-Beispiele (inkl. Gesprächskontext + Strategie-Hinweise aus Bot-Begleitung)
  const { data: training } = await svc
    .from("chatbot_training")
    .select("user_message, good_answer, bad_answer, feedback, avatar_name, context_messages")
    .eq("active", true)
    .or(`avatar_name.is.null,avatar_name.eq.${signatureName}`)
    .order("created_at", { ascending: false })
    .limit(15);
  if (training && training.length > 0) {
    systemPrompt += "\n\n## DEINE TRAININGS-BEISPIELE\n";
    systemPrompt += "Diese Beispiele zeigen dir den GANZEN Gesprächsverlauf — nicht nur die Einzelfrage. ";
    systemPrompt += "Achte besonders auf STRATEGIE-HINWEISE: sie sagen dir WIE du in ähnlichen Situationen vorgehen sollst.\n\n";
    for (let i = 0; i < training.length; i++) {
      const t = training[i];
      const scope = t.avatar_name ? `nur für ${t.avatar_name}` : "für alle Avatare";
      systemPrompt += `### Beispiel ${i + 1} (${scope})\n`;
      const ctx = (t.context_messages as { role: string; content: string }[] | null) || [];
      if (ctx.length > 0) {
        systemPrompt += "Vorheriger Gesprächsverlauf:\n";
        for (const c of ctx) {
          const who = c.role === "user" ? "Kunde" : "Bot/Mitarbeiter";
          systemPrompt += `  ${who}: ${c.content}\n`;
        }
      }
      systemPrompt += `Kunde fragt jetzt: ${t.user_message}\n`;
      systemPrompt += `→ Gute Antwort: ${t.good_answer}\n`;
      if (t.bad_answer) systemPrompt += `→ FALSCH wäre: ${t.bad_answer}\n`;
      if (t.feedback)   systemPrompt += `→ Hinweis: ${t.feedback}\n`;
      systemPrompt += "\n";
    }
  }

  // Verkaufs-Strategien (höchste Priorität zuerst)
  const { data: strategies } = await svc
    .from("chatbot_strategies")
    .select("name, trigger, steps")
    .eq("active", true)
    .order("priority", { ascending: false })
    .limit(20);
  if (strategies && strategies.length > 0) {
    systemPrompt += "\n\n## VERKAUFS-STRATEGIEN\n";
    systemPrompt += "Wenn der Chat-Kontext zu einer dieser Strategien passt, folge IHRER Reihenfolge:\n\n";
    for (const s of strategies) {
      systemPrompt += `### ${s.name}\n**Trigger:** ${s.trigger}\n${s.steps}\n\n`;
    }
  }

  // Conversation laden — letzte 150 Nachrichten chronologisch
  // (Claude Sonnet 4.5 hat 200k Token Context, weiterer Ausbau via Summarization später)
  const { data: msgsDesc } = await svc
    .from("chat_messages")
    .select("role, content, tool_calls, tool_results, attachments, created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(150);
  const msgs = (msgsDesc || []).slice().reverse();

  if (!msgs || msgs.length === 0) return { success: false, error: "no messages" };

  // OFFENE TURNS ERMITTELN — nur AKTUELLER BURST (Cluster zusammenhängender
  // Kundennachrichten innerhalb kurzer Zeitfenster). Alte unbeantwortete
  // Fragen von vor Wochen/Monaten werden NICHT mit-beantwortet, auch wenn
  // technisch noch offen.
  let openTurnsHint = "";
  {
    const BURST_MAX_GAP_MS = 6 * 60 * 60 * 1000; // 6h zwischen Kundennachrichten = noch derselbe Burst
    const tail = msgs.slice(-12).slice().reverse(); // jüngste zuerst

    // Bis zur jüngsten Agent-/Bot-Antwort gehen
    const lastAgentRev = tail.findIndex(m => m.role === "assistant" || m.role === "human_agent");
    const candidate = lastAgentRev === -1
      ? tail.filter(m => m.role === "user")
      : tail.slice(0, lastAgentRev).filter(m => m.role === "user");

    // Cluster aufbauen: jüngste rein, dann rückwärts solange Gap < 6h
    const burst: typeof candidate = [];
    for (let i = 0; i < candidate.length; i++) {
      if (i === 0) {
        // Optionale harte Untergrenze vom Caller (z.B. setBotMode setzt das Datum
        // der ältesten erkannten offenen Nachricht). Falls jüngste älter ist als
        // dieses Datum, gar nichts mehr aufnehmen.
        if (opts.burstSinceIso && candidate[0].created_at < opts.burstSinceIso) break;
        burst.push(candidate[i]);
        continue;
      }
      const prev = new Date(candidate[i - 1].created_at).getTime();
      const cur  = new Date(candidate[i].created_at).getTime();
      if (prev - cur > BURST_MAX_GAP_MS) break;
      if (opts.burstSinceIso && candidate[i].created_at < opts.burstSinceIso) break;
      burst.push(candidate[i]);
    }

    if (burst.length > 1) {
      const orderedOldestFirst = burst.slice().reverse();
      openTurnsHint =
        `\n\n## OFFENE KUNDEN-NACHRICHTEN — AKTUELLER BURST (${burst.length} Stück, in zeitlicher Reihenfolge)\n` +
        orderedOldestFirst.map((m, i) => `${i + 1}. ${m.content}`).join("\n") +
        `\n\n→ Diese Nachrichten kamen vom Kunden NACHEINANDER und gehören zum aktuellen Anliegen. ` +
        `Beantworte sie als ZUSAMMENHÄNGENDEN BLOCK in EINER Antwort — natürlich wie eine echte ` +
        `Mitarbeiterin, nicht Punkt für Punkt abgearbeitet. ` +
        `WICHTIG: Falls es im Verlauf noch ältere unbeantwortete Fragen gab (vor diesem Burst), ` +
        `NICHT mit-beantworten — die sind veraltet. Konzentriere dich NUR auf den aktuellen Burst.`;
    } else if (burst.length === 1) {
      openTurnsHint =
        `\n\n## OFFENE KUNDEN-NACHRICHT\nDer Kunde hat eine aktuelle Frage. Beziehe den bisherigen ` +
        `Verlauf ein (was wurde schon geklärt — Haarstruktur, Farbe, Methode), aber beantworte NUR ` +
        `die aktuelle Frage. Eventuelle ältere offene Fragen aus früheren Phasen NICHT mit-aufgreifen.`;
    }
  }
  if (openTurnsHint) systemPrompt += openTurnsHint;

  const messages: Anthropic.MessageParam[] = [];
  for (const m of msgs) {
    if (m.role === "user") {
      // Foto-Anhänge als Image-Blocks an Claude weitergeben (Vision)
      const attachments = (m.attachments as { type: string; url: string }[] | null) || [];
      const images = attachments.filter(a => a.type === "image" && a.url);
      if (images.length > 0) {
        const blocks: Anthropic.ContentBlockParam[] = [];
        for (const img of images) {
          blocks.push({
            type: "image",
            source: { type: "url", url: img.url },
          });
        }
        if (m.content) blocks.push({ type: "text", text: m.content });
        messages.push({ role: "user", content: blocks });
      } else {
        messages.push({ role: "user", content: m.content || "" });
      }
    } else if (m.role === "assistant") {
      const blocks: Anthropic.ContentBlockParam[] = [];
      if (m.content) blocks.push({ type: "text", text: m.content });
      const tc = (m.tool_calls as { id: string; name: string; input: Record<string, unknown> }[] | null) || [];
      for (const t of tc) blocks.push({ type: "tool_use", id: t.id, name: t.name, input: t.input });
      if (blocks.length > 0) messages.push({ role: "assistant", content: blocks });
      const tr = (m.tool_results as { tool_use_id: string; content: string }[] | null) || [];
      if (tr.length > 0) {
        messages.push({
          role: "user",
          content: tr.map(r => ({ type: "tool_result" as const, tool_use_id: r.tool_use_id, content: r.content })),
        });
      }
    } else if (m.role === "human_agent") {
      messages.push({ role: "assistant", content: m.content || "" });
    }
  }

  // Letzte Message MUSS user sein
  if (messages[messages.length - 1].role !== "user") {
    return { success: false, error: "last message not from user" };
  }

  // Claude aufrufen
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const toolCtx: ToolContext = { sessionId, signatureName };
  const toolsUsed: string[] = [];
  let finalText = "";
  let convo = messages;
  const allToolCalls: { id: string; name: string; input: Record<string, unknown> }[] = [];
  const allToolResults: { tool_use_id: string; content: string }[] = [];

  for (let iter = 0; iter < MAX_ITER; iter++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      tools: TOOL_SCHEMAS,
      messages: convo,
    });

    const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === "text");
    const toolBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");

    // Text NUR überschreiben wenn diese Iteration auch Text produziert hat
    // (sonst löscht eine letzte tool-only-Iteration den vorigen Text)
    const iterText = textBlocks.map(b => b.text).join("\n").trim();
    if (iterText) finalText = iterText;

    if (toolBlocks.length === 0 || response.stop_reason === "end_turn") break;

    const results: Anthropic.ContentBlockParam[] = [];
    for (const tb of toolBlocks) {
      allToolCalls.push({ id: tb.id, name: tb.name, input: tb.input as Record<string, unknown> });
      const tool = TOOLS[tb.name];
      let output = "";
      if (tool) {
        try {
          const r = await tool.execute(tb.input as Record<string, unknown>, toolCtx);
          output = r.output;
        } catch (e) { output = `Tool-Fehler: ${(e as Error).message}`; }
      }
      toolsUsed.push(tb.name);
      allToolResults.push({ tool_use_id: tb.id, content: output });
      results.push({ type: "tool_result", tool_use_id: tb.id, content: output });
    }
    convo = [
      ...convo,
      { role: "assistant", content: response.content as Anthropic.ContentBlockParam[] },
      { role: "user", content: results },
    ];
  }

  // Fallback: wenn nach MAX_ITER kein Text vorhanden, einen finalen text-only Call
  // damit Claude die Tool-Ergebnisse in eine Antwort verpackt
  if (!finalText) {
    console.warn("[respond] empty after tool loop — forcing final text-only call");
    const finalResp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: systemPrompt + "\n\nFasse jetzt die Tool-Ergebnisse zusammen und antworte dem Kunden auf seine letzte Frage. KEINE weiteren Tools aufrufen.",
      messages: convo,
    });
    const finalBlocks = finalResp.content.filter((b): b is Anthropic.TextBlock => b.type === "text");
    finalText = finalBlocks.map(b => b.text).join("\n").trim();
  }

  if (!finalText) return { success: false, error: "empty response after fallback" };

  // Im assisted-Modus: NICHT in chat_messages speichern — der Caller speichert
  // erst nach Mitarbeiter-Approval ggf. die korrigierte Version.
  if (!opts.assisted) {
    await svc.from("chat_messages").insert({
      session_id:   sessionId,
      role:         "assistant",
      content:      finalText,
      tool_calls:   allToolCalls.length > 0 ? allToolCalls : null,
      tool_results: allToolResults.length > 0 ? allToolResults : null,
    });
    await svc.from("chat_sessions")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", sessionId);
  }

  return {
    success: true,
    text: finalText,
    toolsUsed,
    toolCalls: allToolCalls,
    toolResults: allToolResults,
  };
}
