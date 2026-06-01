/**
 * FORCE-TOOL-INTENT — Schicht 1 der Anti-Halluzinations-Architektur.
 * (Design: CHATBOT_ANTI_HALLUCINATION.md)
 *
 * Die Baseline-Messung (01.06) bewies: der Bot ruft die Fakten-Tools nur in
 * ~23% der Faktenantworten auf → er rät den Rest ("beide gleich teuer",
 * "Bitter Cacao verfügbar"). Prompt-Hinweise ("nutze IMMER get_price")
 * reichen nachweislich NICHT.
 *
 * Lösung: Wenn die letzte Kundennachricht erkennbar nach einem PRÜFBAREN FAKT
 * fragt (Preis, Verfügbarkeit/Lager, Längen), zwingen wir den Bot über die
 * Anthropic-API (`tool_choice`), erst das passende Tool aufzurufen, BEVOR er
 * antworten darf. Er KANN dann physisch keine geratene Faktenantwort
 * formulieren.
 *
 * Deterministisch (Regex auf die Kundennachricht), KEIN LLM-Raten — damit der
 * Zwang selbst nicht halluziniert. Konservativ: im Zweifel NICHT erzwingen
 * (lieber kein Zwang als ein falscher Zwang, der eine Begrüßung blockiert).
 */

export type ForcedTool =
  | "get_price"
  | "get_stock_eta"
  | "get_available_colors"
  | null;

export interface ForceToolDecision {
  /** Welches Tool erzwungen werden soll, oder null = kein Zwang. */
  tool: ForcedTool;
  /** Grund (für Logging/Debug). */
  reason?: string;
}

// ── Preis-Frage ──────────────────────────────────────────────────────────
// "wie teuer", "was kostet", "preis", "€", "gleich teuer", "günstiger" ...
// "teuer" wird oft als "etuer" vertippt (Buchstabendreher t↔e) → beide Formen.
const TEUER = "(teuer|etuer)";
const PRICE_RE = new RegExp(
  `(\\bwie\\s*(viel|${TEUER})|\\bwas\\s+kostet|\\bkostet\\b|\\bkosten\\b|\\bpreis(e|lich)?\\b|\\b${TEUER}\\b|\\bgünstig|\\bguenstig|gleich\\s+${TEUER}|gleiche[rn]?\\s+preis|preis\\s+(ist\\s+)?(der\\s+)?gleich|€|\\beuro\\b)`,
  "i",
);

// ── Verfügbarkeits-Frage ─────────────────────────────────────────────────
// "habt ihr X", "auf lager", "verfügbar", "noch da", "wann kommt", "lieferbar"
const STOCK_RE =
  /(auf\s*lager|verfügbar|verfuegbar|vorrätig|vorraetig|lieferbar|\bnoch\s+(da|verfügbar|welche|auf\s*lager|lieferbar)|ausverkauft|wann\s+(kommt|wieder|verfügbar|lieferbar)|wieder\s+(da|rein|verfügbar|lieferbar)|\bhabt\s+ihr\b[^?]*\bnoch\b|\bhast\s+du\b[^?]*\bnoch\b|\bgibt\s+es\b[^?]*\bnoch\b|ist\s+\w+\s+(noch\s+)?(da|verfügbar|auf\s*lager)|\b\w+\s+noch\s*\?)/i;

// ── Längen-/Verfügbarkeits-Frage zu konkretem Produkt ────────────────────
// "welche längen", "gibt es X in 55cm", "habt ihr 65cm"
const LENGTH_RE =
  /\b(welche\s+läng|welche\s+laeng|in\s+\d{2}\s*cm|\d{2}\s*cm\b.*(verfügbar|gibt|habt|da)|gibt\s+es\s+\w+\s+in\s+\d{2})\b/i;

// Negativ-Indikatoren: Nachricht ist klar KEINE Faktenfrage trotz Keyword.
// (z.B. Smalltalk, Dank, reine Begrüßung) → kein Zwang.
const NON_FACTUAL_RE =
  /^(hi|hey|hallo|moin|servus|danke|vielen\s+dank|ok|okay|alles\s+klar|super|perfekt|ja|nein)\b[\s!.,❤️🥰😍💕👍🙏]*$/i;

/**
 * Entscheidet, ob bei dieser Kundennachricht ein Tool-Aufruf erzwungen wird.
 *
 * @param customerText  die letzte (aktuelle) Kundennachricht
 * @param toolsAlreadyCalled  Tools, die in diesem Turn schon aufgerufen wurden
 *   (verhindert Endlos-Zwang: wenn das Tool schon lief, kein erneuter Zwang).
 */
export function decideForcedTool(
  customerText: string,
  toolsAlreadyCalled: string[] = [],
): ForceToolDecision {
  const text = (customerText || "").trim();
  if (!text) return { tool: null };
  if (NON_FACTUAL_RE.test(text)) return { tool: null };

  const already = new Set(toolsAlreadyCalled);

  // Preis hat Vorrang: eine Preisfrage MUSS get_price nutzen.
  if (PRICE_RE.test(text) && !already.has("get_price")) {
    return { tool: "get_price", reason: "Preisfrage erkannt → get_price erzwingen" };
  }

  // Verfügbarkeit / Lager → get_stock_eta.
  if (STOCK_RE.test(text) && !already.has("get_stock_eta")) {
    return { tool: "get_stock_eta", reason: "Verfügbarkeitsfrage erkannt → get_stock_eta erzwingen" };
  }

  // Konkrete Längen-/Produkt-Verfügbarkeit → get_stock_eta (kennt Längen+Lager).
  if (LENGTH_RE.test(text) && !already.has("get_stock_eta")) {
    return { tool: "get_stock_eta", reason: "Längen-/Verfügbarkeitsfrage erkannt → get_stock_eta erzwingen" };
  }

  return { tool: null };
}
