/**
 * AVAILABILITY-HALLUCINATION-DETEKTOR
 * (Schicht-2-Netz, Teil der Anti-Halluzinations-Architektur)
 *
 * ROOT CAUSE (wiederkehrend, zuletzt 02.06 Mocha Melt): Der Bot verwechselt
 * "Farbe EXISTIERT im Katalog" (get_available_colors) mit "Farbe ist auf
 * LAGER" (get_stock_eta). get_available_colors warnt sogar explizit, dass es
 * KEINE Verfügbarkeit aussagt — der Bot ignoriert das und behauptet trotzdem
 * "55cm sofort verfügbar", ohne je get_stock_eta für 55cm aufzurufen.
 *
 * STRUKTURELLE INVARIANTE: Jede "sofort/jetzt verfügbar / hätten wir da"-
 * Behauptung in der Bot-Antwort MUSS durch ein get_stock_eta-Ergebnis mit
 * einem echten IN-STOCK-Status gedeckt sein. Liegt KEIN solcher Beleg vor →
 * verdächtig → Force-Draft. Formulierungs-unabhängig (kein Wort-Pflaster).
 *
 * get_available_colors zählt NICHT als Verfügbarkeits-Beleg (sagt nur was es
 * im Katalog GIBT, nicht was auf Lager ist).
 */

export interface AvailabilityHallucinationResult {
  suspicious: boolean;
  reason?: string;
  matchedSnippet?: string;
}

// Status-Werte von get_stock_eta, die ECHTE Lagerverfügbarkeit bedeuten.
const IN_STOCK_STATUSES = new Set([
  "in_stock",
  "in_stock_low",
  "in_stock_partial_unterwegs",
  "in_stock_low_partial_unterwegs",
  "multi_length_results", // enthält ggf. in_stock-Anteil — wird unten genauer geprüft
]);

// Phrasen, mit denen der Bot SOFORT-Verfügbarkeit behauptet.
const AVAILABILITY_CLAIM_RE =
  /\b(sofort\s+(verfügbar|verfuegbar|lieferbar|da)|jetzt\s+(verfügbar|verfuegbar|lieferbar|da)|aktuell\s+(verfügbar|verfuegbar|lieferbar|auf\s*lager)|haben\s+wir\s+(noch\s+)?(da|auf\s*lager|sofort|gerade)|hätten\s+wir\s+(die|sie|den|das)?\s*(in\s+\d+\s*cm\s+)?(sofort|gerade|noch|aktuell)?\s*(verfügbar|verfuegbar|da|auf\s*lager)|ist\s+(verfügbar|verfuegbar|auf\s*lager|lieferbar)|sind\s+(verfügbar|verfuegbar|auf\s*lager|lieferbar)|gibt'?s\s+(noch|sofort)|auf\s*lager)\b/i;

/**
 * @param finalText   die fertige Bot-Antwort
 * @param toolResults Tool-Ergebnisse dieses Turns ({name, content})
 */
export function detectAvailabilityHallucination(
  finalText: string,
  toolResults: Array<{ name?: string; content: string }>,
): AvailabilityHallucinationResult {
  const text = finalText || "";

  const claim = text.match(AVAILABILITY_CLAIM_RE);
  if (!claim) return { suspicious: false };

  // Gibt es ein get_stock_eta-Ergebnis mit echtem In-Stock-Status?
  let hasInStockProof = false;
  for (const tr of toolResults || []) {
    const content = tr?.content || "";
    if (!content) continue;
    // Wir prüfen string-basiert (robuster als JSON-Parse bei Teil-Strings).
    // get_available_colors zählt NICHT — nur get_stock_eta-Status.
    let status: string | null = null;
    try {
      const j = JSON.parse(content) as { status?: string };
      status = j.status || null;
    } catch {
      // Fallback: status per Regex aus dem String ziehen
      const m = content.match(/"status"\s*:\s*"([^"]+)"/);
      status = m ? m[1] : null;
    }
    if (!status) continue;
    if (IN_STOCK_STATUSES.has(status)) {
      // multi_length_results nur dann als Beleg, wenn auch echter Bestand drin.
      if (status === "multi_length_results") {
        if (/"in_stock"\s*:\s*\[\s*\{/.test(content)) hasInStockProof = true;
      } else {
        hasInStockProof = true;
      }
    }
  }

  if (hasInStockProof) return { suspicious: false };

  // Verfügbarkeit behauptet, aber KEIN get_stock_eta-In-Stock-Beleg.
  const idx = claim.index ?? 0;
  const snippet = text.slice(Math.max(0, idx - 50), Math.min(text.length, idx + 70)).trim();
  return {
    suspicious: true,
    reason: "Bot behauptet Sofort-Verfügbarkeit, aber KEIN get_stock_eta-Ergebnis mit In-Stock-Status liegt vor (mögliche Verwechslung Katalog-Existenz ↔ Lagerbestand).",
    matchedSnippet: snippet.slice(0, 120),
  };
}
