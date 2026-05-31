/**
 * Zentrales Logging für Anthropic-API-Calls.
 *
 * Jeder Bot-Generation-, Refine-, Classify-, Guardian-Call wird hier
 * protokolliert mit Token-Verbrauch + berechneten Kosten. Datenbasis für
 *  - Cost-Dashboard (was kostet wie viel pro Tag/Kategorie?)
 *  - Regression-Erkennung (gestern $5 für Refines, heute $40 — Warum?)
 *  - Optimierungs-Validierung (vorher/nachher beim Knowledge-Graph-Switch)
 *
 * USAGE:
 *   const response = await anthropic.messages.create({...});
 *   await logUsage({
 *     purpose: "respond",
 *     model: "claude-sonnet-4-5",
 *     usage: response.usage,
 *     sessionId,
 *     durationMs,
 *   });
 *
 * Wir LOGGEN fire-and-forget — niemals den eigentlichen Pfad blockieren,
 * niemals den Bot-Output verzögern. DB-Insert ist async ohne await wenn
 * möglich, errors werden geschluckt + auf console.warn geloggt.
 */
import { createServiceClient } from "@/lib/supabase/server";

// Anthropic Pricing per 1M Token (USD), Stand 23.05.2026.
// Bei Modell-Updates HIER anpassen — nirgendwo sonst hardcoded.
const PRICING: Record<string, {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}> = {
  "claude-sonnet-4-5":      { input: 3.00, output: 15.00, cacheRead: 0.30, cacheWrite: 3.75 },
  "claude-sonnet-4-6":      { input: 3.00, output: 15.00, cacheRead: 0.30, cacheWrite: 3.75 },
  "claude-sonnet-4-7":      { input: 3.00, output: 15.00, cacheRead: 0.30, cacheWrite: 3.75 },
  "claude-haiku-4-5":       { input: 1.00, output: 5.00,  cacheRead: 0.10, cacheWrite: 1.25 },
  "claude-3-5-haiku":       { input: 1.00, output: 5.00,  cacheRead: 0.10, cacheWrite: 1.25 },
  "claude-opus-4":          { input: 15.0, output: 75.0,  cacheRead: 1.50, cacheWrite: 18.75 },
  "claude-opus-4-1":        { input: 15.0, output: 75.0,  cacheRead: 1.50, cacheWrite: 18.75 },
  // DeepSeek V3 (OpenAI-kompatibel) — Mini-Tasks (classify/needs_answer/
  // guardian/auto_consolidate). Preise Stand 2026 (cache-miss-Tarif, USD/Mtok).
  // Kein Prompt-Caching genutzt → cacheRead/Write = input-Preis.
  "deepseek-chat":          { input: 0.27, output: 1.10,  cacheRead: 0.07, cacheWrite: 0.27 },
};

export type UsagePurpose =
  | "respond"           // Haupt-Bot-Antwort
  | "refine"            // Neu-generieren via Mitarbeiter-Feedback
  | "classify_category" // Session-Kategorie
  | "guardian_analyze"  // Guardian Qualitäts-Check
  | "needs_answer"      // Long-Wait: braucht Antwort?
  | "auto_consolidate"  // Trainings → FAQ-Vorschläge
  | "grammar"           // Grammatik-Check auf Knopfdruck
  | "critic_pass"       // Fact-Check vor Senden (Phase B6)
  | "training_insight"  // Insights aus Training generieren
  | "other";

interface AnthropicUsage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

interface LogUsageArgs {
  purpose: UsagePurpose;
  model: string;
  usage: AnthropicUsage | null | undefined;
  sessionId?: string | null;
  triggerUserId?: string | null;
  durationMs?: number;
  error?: string | null;
  extra?: Record<string, unknown>;
}

/**
 * Berechnet Kosten in USD aus Token-Verbrauch.
 * Wenn Modell nicht im PRICING-Map: 0 (mit Warning geloggt) — niemals fail.
 */
export function computeCostUsd(model: string, usage: AnthropicUsage): number {
  const tier = PRICING[model] || PRICING[model.replace(/-\d{8}$/, "")]; // fallback: stripped date suffix
  if (!tier) {
    console.warn(`[usage-logger] Unbekanntes Modell '${model}' — Kosten = 0`);
    return 0;
  }
  const input = (usage.input_tokens || 0) / 1_000_000;
  const output = (usage.output_tokens || 0) / 1_000_000;
  const cacheRead = (usage.cache_read_input_tokens || 0) / 1_000_000;
  const cacheWrite = (usage.cache_creation_input_tokens || 0) / 1_000_000;
  return (
    input * tier.input +
    output * tier.output +
    cacheRead * tier.cacheRead +
    cacheWrite * tier.cacheWrite
  );
}

/**
 * Fire-and-forget Logging. Blockt niemals den Caller.
 */
export function logUsage(args: LogUsageArgs): void {
  const { purpose, model, usage, sessionId, triggerUserId, durationMs, error, extra } = args;
  const safeUsage: AnthropicUsage = usage || {};
  const cost = computeCostUsd(model, safeUsage);

  // async ohne await — fire and forget.
  (async () => {
    try {
      const svc = createServiceClient();
      await svc.from("chatbot_usage_log").insert({
        purpose,
        model,
        input_tokens: safeUsage.input_tokens || 0,
        output_tokens: safeUsage.output_tokens || 0,
        cache_read_input_tokens: safeUsage.cache_read_input_tokens || 0,
        cache_creation_input_tokens: safeUsage.cache_creation_input_tokens || 0,
        cost_usd: cost,
        session_id: sessionId || null,
        trigger_user_id: triggerUserId || null,
        duration_ms: durationMs || null,
        error: error || null,
        extra: extra || {},
      });
    } catch (e) {
      console.warn("[usage-logger] insert failed:", (e as Error).message);
    }
  })();
}
