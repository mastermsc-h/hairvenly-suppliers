// Salon-Kategorien: bestimmen ob ein Pack angebrochen zurueckkommen kann
// und wenn ja, wieviel Gramm pro Stueck.

export type SalonCategory =
  | "tape"
  | "mini_tape"
  | "bonding"
  | "tresse"
  | "clip"
  | "other";

export interface CategoryInfo {
  category: SalonCategory;
  /** Gramm pro einzelnem Stueck (Tape/Bonding/Mini-Tape). null = nicht anbrechbar. */
  gramsPerPiece: number | null;
  /** Anbrechbar (Friseur kann Reste zurueckgeben)? */
  divisible: boolean;
  /** Lesbarer Name fuer UI. */
  label: string;
}

const CATEGORIES: Record<SalonCategory, Omit<CategoryInfo, "category">> = {
  tape: { gramsPerPiece: 2.5, divisible: true, label: "Tape" },
  mini_tape: { gramsPerPiece: 2, divisible: true, label: "Mini-Tape" },
  bonding: { gramsPerPiece: 1, divisible: true, label: "Bonding" },
  tresse: { gramsPerPiece: null, divisible: false, label: "Tresse" },
  clip: { gramsPerPiece: null, divisible: false, label: "Clip-In" },
  other: { gramsPerPiece: null, divisible: false, label: "Sonstiges" },
};

/**
 * Erkennt die Kategorie aus Produkt-Titel + ggf. Collection-Handles.
 * Mini-Tape hat Vorrang vor Tape (sonst greift "tape" zu frueh).
 */
export function detectCategory(opts: {
  productTitle: string;
  variantTitle?: string | null;
  collectionHandles?: string[];
  collectionTitles?: string[];
}): CategoryInfo {
  const haystack = [
    opts.productTitle,
    opts.variantTitle ?? "",
    ...(opts.collectionHandles ?? []),
    ...(opts.collectionTitles ?? []),
  ]
    .join(" ")
    .toLowerCase();

  let key: SalonCategory = "other";
  if (/\bmini[\s-]?tape/.test(haystack)) key = "mini_tape";
  else if (/\btape/.test(haystack)) key = "tape";
  else if (/\bbonding|keratin|microring|nano[\s-]?ring/.test(haystack)) key = "bonding";
  else if (/\btresse|weft/.test(haystack)) key = "tresse";
  else if (/\bclip[\s-]?in|\bclip\b/.test(haystack)) key = "clip";

  return { category: key, ...CATEGORIES[key] };
}

/**
 * Erkennt das Pack-Gewicht (25/50/100/150/225g) aus dem variant- oder
 * product-Titel. Default 25 wenn nichts gefunden wird (sicherer Default
 * fuer Tape/Bonding).
 */
export function detectPackGrams(opts: {
  productTitle: string;
  variantTitle?: string | null;
}): number {
  const haystack = `${opts.productTitle} ${opts.variantTitle ?? ""}`.toLowerCase();
  const m = haystack.match(/(\d{2,3})\s*g\b/);
  if (m) {
    const n = parseInt(m[1], 10);
    if ([25, 50, 100, 150, 225].includes(n)) return n;
  }
  // Fallback: Clip-In hat meist >= 100g, Tresse 50g, Tape/Bonding 25g
  return 25;
}

/**
 * Gramm aus Stueckzahl bei angebrochenen Packs.
 * Returns null wenn Kategorie nicht teilbar ist.
 */
export function piecesToGrams(category: SalonCategory, pieces: number): number | null {
  const info = CATEGORIES[category];
  if (info.gramsPerPiece == null) return null;
  return Math.round(info.gramsPerPiece * pieces * 10) / 10; // 1 Nachkommastelle
}
