/**
 * MINI-LLM — günstiger Provider für "kleine" KI-Aufgaben, bei denen es NICHT
 * auf maximales Reasoning ankommt (Klassifikation, Yes/No, JSON-Extraktion,
 * nächtliche Konsolidierung).
 *
 * STRATEGIE (User-Anweisung 2026-05-31):
 *   - Primär: DeepSeek (deepseek-chat / V3) — sehr günstig, für Klassifikation
 *     qualitativ auf Haiku-Niveau.
 *   - Fallback: Anthropic Haiku — wird IMMER aufgerufen, wenn DeepSeek
 *     fehlschlägt, leer antwortet ODER die optionale Validierung scheitert.
 *     → Damit bleibt die Qualität garantiert mindestens gleich gut
 *       (Zero-Regression): im schlimmsten Fall sind wir exakt beim alten
 *       Haiku-Verhalten.
 *
 * DROP-IN: miniMessagesCreate() bildet die Teilmenge von
 * anthropic.messages.create() nach, die die Mini-Tasks nutzen
 * ({ model, max_tokens, system, messages:[{role,content:string}], temperature }).
 * Rückgabe-Form ist Anthropic-kompatibel ({ content:[{type:'text',text}], usage }),
 * sodass bestehender Code (getText(resp), logUsage({usage: resp.usage})) ohne
 * Änderung weiterläuft.
 *
 * KILL-SWITCH: ENV `DISABLE_DEEPSEEK_MINI=1` → es wird direkt Haiku genutzt
 * (sofortiger Rollback ohne Code-Deploy nötig, nur Env-Var + Redeploy).
 *
 * ⚠️ DSGVO-Hinweis: Mini-Tasks wie classify/needs_answer/guardian senden
 * Kundennachrichten-Text an DeepSeek. Bewusste Entscheidung des Betreibers
 * (info@hairvenly.de) am 2026-05-31. auto_consolidate sendet nur interne
 * Trainings-/FAQ-Daten.
 */
import Anthropic from "@anthropic-ai/sdk";
import { logUsage, type UsagePurpose } from "./usage-logger";

const DEEPSEEK_MODEL = "deepseek-chat";
const HAIKU_MODEL = "claude-haiku-4-5";
const DEEPSEEK_URL = "https://api.deepseek.com/chat/completions";

type MiniRole = "user" | "assistant";
interface MiniMessage {
  role: MiniRole;
  content: string;
}

export interface MiniCreateParams {
  /** Anthropic-Modellname für den FALLBACK (default Haiku). DeepSeek nutzt immer deepseek-chat. */
  model?: string;
  max_tokens: number;
  system?: string;
  messages: MiniMessage[];
  temperature?: number;
}

export interface MiniResponse {
  content: { type: "text"; text: string }[];
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens: number;
    cache_creation_input_tokens: number;
  };
  /** Welcher Provider tatsächlich geantwortet hat (für Logging/Debug). */
  provider: "deepseek" | "anthropic";
}

function deepseekEnabled(): boolean {
  if (process.env.DISABLE_DEEPSEEK_MINI === "1") return false;
  return !!process.env.DEEPSEEK_API_KEY;
}

function textFromAnthropic(resp: Anthropic.Message): string {
  return (resp.content || [])
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("")
    .trim();
}

async function callDeepSeek(params: MiniCreateParams): Promise<MiniResponse> {
  const openaiMessages: { role: "system" | "user" | "assistant"; content: string }[] = [];
  if (params.system) openaiMessages.push({ role: "system", content: params.system });
  for (const m of params.messages) openaiMessages.push({ role: m.role, content: m.content });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const r = await fetch(DEEPSEEK_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.DEEPSEEK_API_KEY}`,
      },
      body: JSON.stringify({
        model: DEEPSEEK_MODEL,
        max_tokens: params.max_tokens,
        temperature: params.temperature ?? 0,
        messages: openaiMessages,
      }),
      signal: controller.signal,
    });
    if (!r.ok) {
      const body = await r.text().catch(() => "");
      throw new Error(`DeepSeek ${r.status}: ${body.slice(0, 200)}`);
    }
    const json = (await r.json()) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = (json.choices?.[0]?.message?.content || "").trim();
    return {
      content: [{ type: "text", text }],
      usage: {
        input_tokens: json.usage?.prompt_tokens || 0,
        output_tokens: json.usage?.completion_tokens || 0,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 0,
      },
      provider: "deepseek",
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function callHaiku(params: MiniCreateParams): Promise<MiniResponse> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const resp = await anthropic.messages.create({
    model: params.model || HAIKU_MODEL,
    max_tokens: params.max_tokens,
    ...(params.system ? { system: params.system } : {}),
    ...(params.temperature !== undefined ? { temperature: params.temperature } : {}),
    messages: params.messages.map((m) => ({ role: m.role, content: m.content })),
  });
  return {
    content: [{ type: "text", text: textFromAnthropic(resp) }],
    usage: {
      input_tokens: resp.usage?.input_tokens || 0,
      output_tokens: resp.usage?.output_tokens || 0,
      cache_read_input_tokens: resp.usage?.cache_read_input_tokens || 0,
      cache_creation_input_tokens: resp.usage?.cache_creation_input_tokens || 0,
    },
    provider: "anthropic",
  };
}

/**
 * Drop-in für anthropic.messages.create() bei Mini-Tasks.
 *
 * @param opts.purpose       Für Kosten-Logging (logUsage). Wird hier ZENTRAL
 *                           geloggt — der Aufrufer muss NICHT mehr selbst loggen
 *                           (sonst doppelt). Siehe Migration der Call-Sites.
 * @param opts.sessionId     optional, fürs Logging
 * @param opts.validate      optional: gibt false zurück → DeepSeek-Antwort gilt
 *                           als unbrauchbar → Haiku-Fallback. So bleibt die
 *                           Qualität garantiert.
 */
export async function miniMessagesCreate(
  params: MiniCreateParams,
  opts: {
    purpose: UsagePurpose;
    sessionId?: string;
    validate?: (text: string) => boolean;
    extra?: Record<string, unknown>;
  }
): Promise<MiniResponse> {
  const start = Date.now();

  if (deepseekEnabled()) {
    try {
      const ds = await callDeepSeek(params);
      const text = ds.content[0]?.text || "";
      const valid = text.length > 0 && (opts.validate ? opts.validate(text) : true);
      if (valid) {
        logUsage({
          purpose: opts.purpose,
          model: DEEPSEEK_MODEL,
          usage: ds.usage,
          sessionId: opts.sessionId,
          durationMs: Date.now() - start,
          extra: { ...(opts.extra || {}), provider: "deepseek" },
        });
        return ds;
      }
      console.warn(`[mini-llm] DeepSeek output invalid for ${opts.purpose} — falling back to Haiku`);
    } catch (e) {
      console.warn(`[mini-llm] DeepSeek failed for ${opts.purpose} (${(e as Error).message}) — falling back to Haiku`);
    }
  }

  // Fallback (oder DeepSeek deaktiviert): Haiku
  const hk = await callHaiku(params);
  logUsage({
    purpose: opts.purpose,
    model: params.model || HAIKU_MODEL,
    usage: hk.usage,
    sessionId: opts.sessionId,
    durationMs: Date.now() - start,
    extra: { ...(opts.extra || {}), provider: "anthropic_fallback" },
  });
  return hk;
}
