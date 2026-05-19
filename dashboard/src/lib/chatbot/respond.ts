/**
 * Bot-Antwort für eine bestehende Session generieren + speichern.
 * Wird von Webhook-Handlern aufgerufen (Instagram/WhatsApp) sowie von /api/chat.
 */
import Anthropic from "@anthropic-ai/sdk";
import { createServiceClient } from "@/lib/supabase/server";
import { TOOLS, TOOL_SCHEMAS, type ToolContext } from "@/lib/chatbot/tools";

const MODEL = "claude-sonnet-4-5";
const MAX_ITER = 5;

/**
 * Falls Claude in einen Stutter-Loop fällt und denselben Text 2× hintereinander
 * schreibt (z.B. "Ich bin da... Magst du... Ich bin da... Magst du..."),
 * halbieren wir die Antwort.
 */
function dedupRepeatedHalf(text: string): string {
  const t = text.trim();
  if (t.length < 60) return t;
  // Geradzahlige Halbierung — wenn beide Hälften gleich sind
  if (t.length % 2 === 0) {
    const half = t.length / 2;
    if (t.slice(0, half).trim() === t.slice(half).trim()) {
      return t.slice(0, half).trim();
    }
  }
  // Heuristik: wenn der Anfang (erste 80 Zeichen) auch ungefähr in der Mitte
  // wieder auftaucht, dedupliziere bis dahin.
  const prefix = t.slice(0, Math.min(80, Math.floor(t.length / 3)));
  const secondHalfStart = t.indexOf(prefix, prefix.length + 10);
  if (secondHalfStart > 0 && secondHalfStart < t.length * 0.6) {
    const a = t.slice(0, secondHalfStart).trim();
    const b = t.slice(secondHalfStart).trim();
    // Beide Teile müssen ähnlich lang sein und ähnlich anfangen
    if (Math.abs(a.length - b.length) < 30) {
      return a;
    }
  }
  return t;
}

/**
 * Teilt lange Texte an Absatz-Grenzen in Stücke <= maxLen Zeichen.
 * Instagram-Messaging-API: 1000 Zeichen pro Message → wir splitten ab 700 sicher.
 */
export function splitLongMessage(text: string, maxLen = 700): string[] {
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return [trimmed];
  const paragraphs = trimmed.split(/\n\n+/);
  const parts: string[] = [];
  let buf = "";
  for (const p of paragraphs) {
    const candidate = buf ? `${buf}\n\n${p}` : p;
    if (candidate.length <= maxLen) {
      buf = candidate;
    } else {
      if (buf) parts.push(buf);
      // Wenn ein einzelner Absatz selbst zu lang ist: hart splitten an Satz-Grenze
      if (p.length > maxLen) {
        const sentences = p.split(/(?<=[.!?])\s+/);
        let sbuf = "";
        for (const s of sentences) {
          const sc = sbuf ? `${sbuf} ${s}` : s;
          if (sc.length <= maxLen) sbuf = sc;
          else {
            if (sbuf) parts.push(sbuf);
            sbuf = s.length > maxLen ? s.slice(0, maxLen) : s;
          }
        }
        if (sbuf) buf = sbuf;
        else buf = "";
      } else {
        buf = p;
      }
    }
  }
  if (buf) parts.push(buf);
  return parts.filter(p => p.trim().length > 0);
}

/**
 * Entfernt / ersetzt interne Lagerzahlen aus dem Bot-Output.
 * Wenn Claude trotz System-Prompt mal "850g auf Lager" schreibt, fangen wir
 * das hier ab und ersetzen mit kunden-sicheren Phrasen.
 */
function sanitizeStockLeaks(text: string): string {
  let t = text;
  // ZUERST: "Bestand 0" / "Quantity 0" / "Quantity = 0" → ausverkauft
  // (vor den anderen Patterns, sonst frisst die generische Regel die 0)
  t = t.replace(/\b(?:Lager(?:bestand)?|Bestand)\s*[:=]?\s*0\s*g?\b/gi, "ausverkauft");
  t = t.replace(/\bQuantity\s*[:=]?\s*0\b/gi, "ausverkauft");
  // "850g auf Lager", "850 g verfügbar", "(850g verfügbar)", "1200g vorrätig"
  t = t.replace(
    /\(?\s*\d{2,5}\s*g(?:ramm)?\s*(?:auf\s*Lager|verfügbar|vorrätig|im\s*Lager|da)\s*\)?/gi,
    "haben wir da",
  );
  // "850g verfügbar" ohne Klammer-Variante
  t = t.replace(/\b\d{2,5}\s*g(?:ramm)?\b\s*\b(?:verfügbar|vorrätig|am\s*Lager)\b/gi, "verfügbar");
  // "Bestand: 125g" / "Lagerbestand: 850g" (Zahlen ≠ 0, schon oben gemacht)
  t = t.replace(/\b(?:Lager(?:bestand)?|Bestand)\s*[:=]?\s*\d{1,5}\s*g?\b/gi, "verfügbar");
  // "Quantity = 5" (Zahl ≠ 0)
  t = t.replace(/\bQuantity\s*[:=]?\s*\d+\b/gi, "");
  // "noch 4 Stück" / "nur noch 12 Packungen"
  t = t.replace(/\b(?:noch\s+|nur\s+noch\s+)?\d{1,3}\s*(Stück|Packungen)\b/gi, "in begrenzter Menge");
  // "850g im Lager"
  t = t.replace(/\b\d{2,5}\s*g(?:ramm)?\s+im\s+Lager\b/gi, "im Lager");
  // Mehrfach-Leerzeichen / leere Klammern bereinigen
  t = t.replace(/\(\s*\)/g, "");
  t = t.replace(/[ \t]{2,}/g, " ");
  return t;
}

interface RespondResult {
  success: boolean;
  text?: string;
  toolsUsed?: string[];
  toolCalls?: { id: string; name: string; input: Record<string, unknown> }[];
  toolResults?: { tool_use_id: string; content: string }[];
  /** ID des gerade gespeicherten assistant-Eintrags — Caller updated external_id (MID) nach Versand */
  insertedMessageId?: string;
  error?: string;
}

interface RespondOptions {
  /** Wenn true: Text NICHT in chat_messages speichern (für Bot-Begleitung-Entwurf) */
  assisted?: boolean;
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
    .limit(8);
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

  // Conversation laden — letzte 60 Nachrichten (reduziert von 150 für Kosten)
  // Bei sehr langen Verläufen wird damit ältester Kontext verloren — der wichtige
  // Verlauf der letzten Tage/Stunden bleibt aber vollständig erhalten.
  const { data: msgsDesc } = await svc
    .from("chat_messages")
    .select("role, content, tool_calls, tool_results, attachments, created_at")
    .eq("session_id", sessionId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(60);
  const msgs = (msgsDesc || []).slice().reverse();

  if (!msgs || msgs.length === 0) return { success: false, error: "no messages" };

  // OFFENE TURNS ERMITTELN — ALLE Kundennachrichten SEIT der letzten Agent-/
  // Bot-Antwort gehören zusammen. Sorry nur wenn die WERKTAGS-Stunden ≥ 24h
  // sind (Wochenenden zählen nicht — Freitag 18h → Montag 9h = kein Sorry).
  function businessHoursBetween(fromMs: number, toMs: number): number {
    if (toMs <= fromMs) return 0;
    let total = 0;
    const cur = new Date(fromMs);
    const to = new Date(toMs);
    while (cur < to) {
      const day = cur.getDay(); // 0=So, 6=Sa
      const endOfDay = new Date(cur); endOfDay.setHours(24, 0, 0, 0);
      const segEnd = endOfDay < to ? endOfDay : to;
      if (day >= 1 && day <= 5) {
        total += (segEnd.getTime() - cur.getTime()) / 3600000;
      }
      cur.setTime(endOfDay.getTime());
    }
    return total;
  }

  let openTurnsHint = "";
  {
    const tail = msgs.slice(-15).slice().reverse();
    const lastAgentRev = tail.findIndex(m => m.role === "assistant" || m.role === "human_agent");
    const openUsrDesc = lastAgentRev === -1
      ? tail.filter(m => m.role === "user")
      : tail.slice(0, lastAgentRev).filter(m => m.role === "user");

    if (openUsrDesc.length > 0) {
      const orderedOldestFirst = openUsrDesc.slice().reverse();

      // Werktags-Stunden seit der jüngsten offenen Frage bis jetzt
      const youngestT = new Date(orderedOldestFirst[orderedOldestFirst.length - 1].created_at).getTime();
      const businessHoursSinceYoungest = businessHoursBetween(youngestT, Date.now());
      const apologyDue = businessHoursSinceYoungest >= 24;

      if (openUsrDesc.length > 1) {
        openTurnsHint =
          `\n\n## OFFENE KUNDEN-NACHRICHTEN (${openUsrDesc.length} Stück seit letzter Antwort von uns)\n` +
          orderedOldestFirst.map((m, i) => {
            const dt = new Date(m.created_at);
            const fmt = `${dt.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })} ${dt.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`;
            return `${i + 1}. [${fmt}] ${m.content}`;
          }).join("\n");

        openTurnsHint += `\n\n→ ALLE diese Nachrichten gehören zum SELBEN Anliegen (zwischendurch kam keine Antwort von uns). ` +
          `Beantworte sie als ZUSAMMENHÄNGENDEN BLOCK in EINER Antwort — natürlich wie eine echte Mitarbeiterin, ` +
          `nicht stur Punkt für Punkt. Greife die ältere Sachfrage genauso auf wie das spätere Nachhaken.`;
      } else {
        openTurnsHint =
          `\n\n## OFFENE KUNDEN-NACHRICHT\nDer Kunde hat eine Frage, die noch unbeantwortet ist. ` +
          `Achte auf den GESAMTEN bisherigen Verlauf — was wurde schon besprochen (Haarstruktur, Farbe, Methode), ` +
          `was wurde versprochen.`;
      }

      // Sorry-Regel: NUR wenn Werktags-Stunden ≥ 24h
      if (apologyDue) {
        const businessDays = Math.round(businessHoursSinceYoungest / 24);
        openTurnsHint += `\n\n**Antwort-Verzögerung:** ~${businessDays} Werktag${businessDays === 1 ? "" : "e"} ` +
          `(${Math.round(businessHoursSinceYoungest)}h Werktagsstunden) seit der Kundennachricht. ` +
          `→ Bitte mit kurzer ehrlicher Entschuldigung beginnen, dann inhaltlich antworten.`;
      } else {
        openTurnsHint += `\n\n**KEINE Entschuldigung** für die Antwortzeit nötig (Wartezeit innerhalb normaler Werktags-Reaktionszeit, ` +
          `Wochenenden zählen nicht). Direkt inhaltlich antworten.`;
      }
    }
  }
  // Wichtig: systemPrompt (= persona + avatar + training + strategies) bleibt STABIL
  // pro Avatar und wird via Prompt-Caching wiederverwendet. Variable Teile
  // (openTurnsHint, sorry-hint) gehen in einen separaten Block — werden nicht
  // gecacht, sind aber pro Call eh klein.
  const systemPromptStable = systemPrompt;
  const systemPromptVariable = openTurnsHint;

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

  // Claude aufrufen — mit Prompt-Caching auf dem stabilen System-Teil + Tool-Defs
  // Cache-TTL = 5 Min. Spart ~75% Input-Token-Kosten auf wiederholten Calls
  // mit gleichem Avatar / gleicher Trainings-Menge / gleichen Strategien.
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const toolCtx: ToolContext = { sessionId, signatureName };
  const toolsUsed: string[] = [];
  let finalText = "";
  let convo = messages;
  const allToolCalls: { id: string; name: string; input: Record<string, unknown> }[] = [];
  const allToolResults: { tool_use_id: string; content: string }[] = [];

  const systemBlocks: Anthropic.TextBlockParam[] = [
    { type: "text", text: systemPromptStable, cache_control: { type: "ephemeral" } as const },
  ];
  if (systemPromptVariable.trim()) {
    systemBlocks.push({ type: "text", text: systemPromptVariable });
  }
  // Tools-Schema ebenfalls cachen (letztes Tool kriegt cache_control)
  const cachedTools = TOOL_SCHEMAS.map((t, i) =>
    i === TOOL_SCHEMAS.length - 1
      ? { ...t, cache_control: { type: "ephemeral" } as const }
      : t
  );

  for (let iter = 0; iter < MAX_ITER; iter++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: systemBlocks,
      tools: cachedTools,
      messages: convo,
    });

    const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === "text");
    const toolBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");

    // Dedup identische konsekutive Text-Blöcke (Claude-Stutter vermeiden)
    const dedupedTexts: string[] = [];
    for (const tb of textBlocks) {
      const t = (tb.text || "").trim();
      if (!t) continue;
      if (dedupedTexts.length > 0 && dedupedTexts[dedupedTexts.length - 1] === t) continue;
      dedupedTexts.push(t);
    }

    // Text NUR überschreiben wenn diese Iteration auch Text produziert hat
    // (sonst löscht eine letzte tool-only-Iteration den vorigen Text)
    const iterText = dedupedTexts.join("\n").trim();
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
      system: [
        { type: "text", text: systemPromptStable, cache_control: { type: "ephemeral" } as const },
        { type: "text", text: (systemPromptVariable || "") + "\n\nFasse jetzt die Tool-Ergebnisse zusammen und antworte dem Kunden auf seine letzte Frage. KEINE weiteren Tools aufrufen." },
      ],
      messages: convo,
    });
    const finalBlocks = finalResp.content.filter((b): b is Anthropic.TextBlock => b.type === "text");
    const fdedup: string[] = [];
    for (const fb of finalBlocks) {
      const t = (fb.text || "").trim();
      if (!t) continue;
      if (fdedup.length > 0 && fdedup[fdedup.length - 1] === t) continue;
      fdedup.push(t);
    }
    finalText = fdedup.join("\n").trim();
  }

  if (!finalText) return { success: false, error: "empty response after fallback" };

  // SAFETY-NET 1: konkrete Lagerzahlen rausfiltern
  finalText = sanitizeStockLeaks(finalText);

  // SAFETY-NET 2: Dedup wenn ganze Antwort sich wiederholt (Claude-Stutter)
  // Heuristik: wenn finalText aus zwei identischen Hälften besteht, halbieren
  finalText = dedupRepeatedHalf(finalText);

  // Im assisted-Modus: NICHT in chat_messages speichern — der Caller speichert
  // erst nach Mitarbeiter-Approval ggf. die korrigierte Version.
  let insertedMessageId: string | undefined;
  if (!opts.assisted) {
    const { data: ins } = await svc.from("chat_messages").insert({
      session_id:   sessionId,
      role:         "assistant",
      content:      finalText,
      tool_calls:   allToolCalls.length > 0 ? allToolCalls : null,
      tool_results: allToolResults.length > 0 ? allToolResults : null,
    }).select("id").single();
    insertedMessageId = ins?.id;
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
    insertedMessageId,
  };
}
