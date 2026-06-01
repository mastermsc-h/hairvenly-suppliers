/**
 * PREIS-HALLUZINATIONS-DETEKTOR
 *
 * ROOT CAUSE (User-Bug 01.06): Bot beantwortete eine Preisfrage mal mit dem
 * get_price-Tool (korrekte Zahlen aus chatbot_prices), mal OHNE Tool — dann
 * rät er sich Preise zusammen ("beide Linien gleich teuer" = FALSCH; echte
 * Daten: Russisch 72,50€/Pack vs. Usbekisch 47,25€/Pack).
 *
 * Da es keine Stammdaten-Lücke ist (die Preistabelle ist korrekt), sondern ein
 * unzuverlässiger Tool-Aufruf, erzwingen wir die Korrektheit im CODE statt sie
 * vom LLM zu erhoffen — analog zu message-triage / waitlist-validator.
 *
 * REGEL: Wenn die Bot-Antwort KONKRETE Verkaufs-Preise (Euro-Beträge im
 * Extension-Kontext) nennt, ABER get_price NICHT aufgerufen wurde → verdächtig
 * → Force-Draft (kein Auto-Send). Die MA prüft / der Bot soll beim nächsten Mal
 * das Tool nutzen.
 *
 * Bewusst NICHT geflaggt (kein False-Positive):
 *  - Versandkosten-Schwellen ("ab 150€ kostenlos", "150€ Bestellwert")
 *  - reine Mengen/Längen ohne €-Preis ("150g", "55cm", "6 Packungen")
 *  - Salon-Service-Preise — die laufen über get_salon_service_price, nicht
 *    get_price; aber sie sind ebenfalls verifiziert. Wir prüfen daher auf
 *    BEIDE Preis-Tools.
 */

export interface PriceHallucinationResult {
  suspicious: boolean;
  reason?: string;
  matchedSnippet?: string;
}

// Euro-Betrag in Verkaufs-Höhe: mind. zweistellig, optionale Tausender/Dezimal.
// "5€" ist zu klein für eine Extension → ignorieren (kein typischer Halluzinations-
// Preis). Ab 20€ wird's relevant.
const EURO_AMOUNT_RE =
  /(?<!\d)(\d{2,3}(?:[.\s]\d{3})?(?:[.,]\d{2})?)\s*(€|euro|eur\b)/i;

// Kontext, der zeigt dass es um PRODUKT-/Extension-Verkaufspreise geht
// (nicht Versand-Schwelle, nicht Trinkgeld o.ä.).
const PRICE_CONTEXT_RE =
  /\b(pro\s+pack|packung|pack\b|packs?\b|gramm|g\s+(standard|mini|tape|bonding|tressen)|\d+\s*g\b|kostet|kosten|preis|liegt\s+bei|für\s+\d+\s*g|insgesamt|gesamt|=\s*\d|stück|tape|tapes|bonding|bondings|tressen|extension|verlängerung|russisch|usbekisch|glatt|wellig)\b/i;

// Versandkosten-/Schwellen-Kontext → NICHT als Produktpreis werten.
const SHIPPING_THRESHOLD_RE =
  /\b(ab\s+\d+\s*€?\s*(kostenlos|gratis|versandkostenfrei|frei)|versandkosten|bestellwert|mindestbestell|kostenloser?\s+versand)\b/i;

// QUALITATIVE Preisvergleiche OHNE Zahl — der eigentliche Screenshot-Bug 01.06:
// "der Preis ist gleich", "beide kosten das Gleiche", "günstiger", "teurer".
// Solche Aussagen sind genauso geraten wie konkrete Zahlen, wenn get_price
// nicht aufgerufen wurde — und enthalten KEINE Euro-Zahl, rutschten also bisher
// durch. Echte Daten: Russisch 72,50€/Pack ≠ Usbekisch 47,25€/Pack → "gleich"
// ist FALSCH.
const QUALITATIVE_PRICE_CLAIM_RE =
  /(preis(e|lich)?\s+(ist|sind|bleibt|bleiben)\s+(gleich|identisch|derselbe|dasselbe|der\s+gleiche)|(kostet|kosten)\s+(das\s+)?(gleiche|dasselbe|identisch|gleich\s+viel)|gleich\s+(teuer|viel|günstig)|(günstiger|guenstiger|teurer|preiswerter|billiger)\s+(als|wie)|preislich\s+(gleich|identisch)|(kein|keinen)\s+(preis-?)?unterschied|(preis-?)?unterschied\s+(im\s+preis|gibt'?s\s+(es\s+)?kein))/i;

// Linien-/Produkt-Bezug, der zeigt dass es um Verkaufspreise geht (nicht z.B.
// "gleich teuer wie Friseur XY" allgemein).
const QUALITATIVE_CONTEXT_RE =
  /\b(russisch|usbekisch|glatt|wellig|linie|tape|tapes|bonding|bondings|tressen|extension|methode|pack|packung|gramm|\d+\s*g\b)\b/i;

/**
 * @param finalText   die fertige Bot-Antwort
 * @param toolsUsed   Namen der in dieser Antwort aufgerufenen Tools
 */
export function detectPriceHallucination(
  finalText: string,
  toolsUsed: string[],
): PriceHallucinationResult {
  const text = finalText || "";

  // Hat der Bot ein verifiziertes Preis-Tool genutzt? Dann ist alles ok.
  const usedPriceTool = (toolsUsed || []).some(
    t => t === "get_price" || t === "get_salon_service_price",
  );
  if (usedPriceTool) return { suspicious: false };

  // QUALITATIVE Preisvergleichs-Behauptung ohne Tool (z.B. "der Preis ist
  // gleich", "Usbekisch ist günstiger") → verdächtig, auch ohne Euro-Zahl.
  const qualMatch = text.match(QUALITATIVE_PRICE_CLAIM_RE);
  if (qualMatch) {
    const qi = qualMatch.index ?? 0;
    const qctx = text.slice(Math.max(0, qi - 80), Math.min(text.length, qi + 80));
    if (QUALITATIVE_CONTEXT_RE.test(qctx)) {
      return {
        suspicious: true,
        reason: "Bot macht eine qualitative Preisaussage (gleich/günstiger/teurer) ohne get_price aufzurufen — geraten (Bug 01.06: 'der Preis ist gleich' war falsch; echte Daten: Russisch 72,50€ ≠ Usbekisch 47,25€/Pack).",
        matchedSnippet: qctx.trim().slice(0, 120),
      };
    }
  }

  // Kein Euro-Betrag in Verkaufs-Höhe → nichts mehr zu prüfen.
  const euroMatch = text.match(EURO_AMOUNT_RE);
  if (!euroMatch) return { suspicious: false };

  // Prüfe NUR den Satz/Kontext um den Euro-Betrag herum.
  const idx = euroMatch.index ?? 0;
  const windowStart = Math.max(0, idx - 80);
  const windowEnd = Math.min(text.length, idx + 80);
  const ctx = text.slice(windowStart, windowEnd);

  // Versand-Schwelle ("ab 150€ kostenlos") → kein Produktpreis → ok.
  if (SHIPPING_THRESHOLD_RE.test(ctx)) return { suspicious: false };

  // Echter Produkt-/Verkaufspreis-Kontext?
  if (!PRICE_CONTEXT_RE.test(ctx)) return { suspicious: false };

  return {
    suspicious: true,
    reason: "Bot nennt einen konkreten Verkaufspreis, hat aber get_price / get_salon_service_price NICHT aufgerufen (mögliche geratene Zahl).",
    matchedSnippet: ctx.trim().slice(0, 120),
  };
}
