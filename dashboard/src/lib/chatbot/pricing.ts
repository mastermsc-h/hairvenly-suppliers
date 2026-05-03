/**
 * Chatbot Pricing Utility
 *
 * Berechnet: Wie viele Packungen braucht der Kunde, und was kostet das?
 * Grammatik: pack_grams × packs ≥ needed_grams (immer aufrunden!)
 *
 * Packungsgrößen:
 *   Tape:           25g/Pack
 *   Mini Tape:      50g/Pack
 *   Bondings:       50g/Pack
 *   Tressen:        50g/Pack
 *   Genius Weft:    50g/Pack
 *   Invisible Tape: 50g/Pack
 *   Clip-in:        100g / 150g / 225g (Festgrößen)
 *   Ponytail:       130g (Festgröße)
 */

export type Method =
  | "tape"
  | "mini_tape"
  | "bondings"
  | "tressen"
  | "genius_weft"
  | "invisible_tape"
  | "clip_in"
  | "ponytail";

export const METHOD_LABELS: Record<Method, string> = {
  tape: "Tape",
  mini_tape: "Mini Tape",
  bondings: "Bondings",
  tressen: "Tressen",
  genius_weft: "Genius Weft",
  invisible_tape: "Invisible Tape",
  clip_in: "Clip-in",
  ponytail: "Ponytail",
};

/** Gramm pro Packung für normale Methoden (nicht Clip-in/Ponytail) */
export const GRAMS_PER_PACK: Partial<Record<Method, number>> = {
  tape: 25,
  mini_tape: 50,
  bondings: 50,
  tressen: 50,
  genius_weft: 50,
  invisible_tape: 50,
};

/** Clip-in Festgrößen (Gramm pro Packung = auch Kaufgröße) */
export const CLIP_IN_SIZES = [100, 150, 225] as const;
export const PONYTAIL_SIZE = 130;

/**
 * Produktlinien:
 * - amanda = Russisch Glatt, nur 60cm verfügbar
 * - ebru   = Usbekisch Wellig, 45/55/65/85cm
 *
 * Bondings: Amanda nur 60cm | Ebru nur 65cm + 85cm
 * Mini Tape + Classic Tressen: nur Amanda (60cm)
 * Invisible Tape: beide Linien (60cm + 65cm)
 */
export const SUPPLIER_LABELS: Record<string, string> = {
  amanda: "Russisch Glatt (60cm)",
  ebru:   "Usbekisch Wellig",
};

export interface PriceRow {
  method: Method;
  length_cm: number | null;
  gram_label: string | null;
  gram_per_pack: number;
  price_eur: number;
  /** 'amanda' = Russisch Glatt 60cm | 'ebru' = Usbekisch Wellig 45–85cm */
  supplier_line?: "amanda" | "ebru";
}

export interface PackCalcResult {
  method: Method;
  method_label: string;
  length_cm: number;
  needed_grams: number;
  pack_grams: number;
  packs: number;
  total_grams: number;
  price_per_pack: number;
  total_price: number;
  /** Formatted message for the chatbot to use */
  message: string;
}

/**
 * Berechnet Packungsanzahl und Gesamtpreis.
 *
 * @param prices  - Preiszeilen aus chatbot_prices Tabelle
 * @param method  - Methode
 * @param length_cm - Haarlänge in cm
 * @param needed_grams - Benötigte Gramm (vom Chatbot geschätzt)
 */
export function calcPacks(
  prices: PriceRow[],
  method: Method,
  length_cm: number,
  needed_grams: number
): PackCalcResult | null {
  const label = METHOD_LABELS[method];

  if (method === "clip_in") {
    // Clip-in: wähle die kleinste Packung die ≥ needed_grams ist
    const size = CLIP_IN_SIZES.find((s) => s >= needed_grams) ?? 225;
    const row = prices.find(
      (p) => p.method === "clip_in" && p.gram_label === `${size}g`
    );
    if (!row) return null;
    const msg =
      `Für Clip-in Extensions empfehle ich das **${size}g Set (60cm)** — ` +
      `das kostet **€${row.price_eur.toFixed(2)}**. ` +
      `Du bekommst es direkt hier: [zum Shop](https://hairvenly.de)`;
    return {
      method, method_label: label, length_cm: 60,
      needed_grams, pack_grams: size, packs: 1, total_grams: size,
      price_per_pack: row.price_eur, total_price: row.price_eur, message: msg,
    };
  }

  if (method === "ponytail") {
    const row = prices.find((p) => p.method === "ponytail");
    if (!row) return null;
    const msg =
      `Unser Ponytail kommt mit **130g (65cm)** und kostet **€${row.price_eur.toFixed(2)}**.`;
    return {
      method, method_label: label, length_cm: row.length_cm ?? 65,
      needed_grams, pack_grams: PONYTAIL_SIZE, packs: 1, total_grams: PONYTAIL_SIZE,
      price_per_pack: row.price_eur, total_price: row.price_eur, message: msg,
    };
  }

  const packG = GRAMS_PER_PACK[method];
  if (!packG) return null;

  // Finde den nächsten verfügbaren Preis (gleiche Länge oder nächsthöhere)
  const candidates = prices
    .filter((p) => p.method === method && p.length_cm !== null)
    .sort((a, b) => (a.length_cm ?? 0) - (b.length_cm ?? 0));

  if (candidates.length === 0) return null;

  // Nimm den Preis für die angefragte Länge oder nächsthöhere
  const row =
    candidates.find((p) => (p.length_cm ?? 0) >= length_cm) ??
    candidates[candidates.length - 1];

  // Packungen aufrunden
  const packs = Math.ceil(needed_grams / packG);
  const total_grams = packs * packG;
  const total_price = packs * row.price_eur;

  const msg =
    `Für **${needed_grams}g ${label} (${length_cm}cm)** brauchst du ` +
    `**${packs} Packung${packs > 1 ? "en" : ""} à ${packG}g = ${total_grams}g**. ` +
    `Das kostet **€${total_price.toFixed(2)}** (${packs} × €${row.price_eur.toFixed(2)}).`;

  return {
    method, method_label: label, length_cm: row.length_cm ?? length_cm,
    needed_grams, pack_grams: packG, packs, total_grams,
    price_per_pack: row.price_eur, total_price,
    message: msg,
  };
}

/** Typische Gramm-Empfehlung nach Haardichte */
export function recommendGrams(
  method: Method,
  hair_density: "dünn" | "normal" | "dicht" = "normal"
): number {
  const base: Record<Method, number> = {
    tape: 100,
    mini_tape: 100,
    bondings: 100,
    tressen: 100,
    genius_weft: 100,
    invisible_tape: 100,
    clip_in: 150,
    ponytail: 130,
  };
  const factor = hair_density === "dünn" ? 0.8 : hair_density === "dicht" ? 1.3 : 1.0;
  return Math.round(base[method] * factor / 25) * 25; // auf 25g runden
}

/** Alle Methoden als lesbares Label-Array */
export const ALL_METHODS: Method[] = [
  "tape", "mini_tape", "bondings", "tressen",
  "genius_weft", "invisible_tape", "clip_in", "ponytail",
];
