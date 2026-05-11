// Heuristische Extraktion von Laenge + Farbe aus Shopify-Titeln.

const LENGTH_RE = /(\d{2,3})\s*cm\b/i;

export type SalonQuality = "russisch" | "usbekisch" | null;

export function parseQuality(opts: {
  productTitle: string;
  variantTitle?: string | null;
  collectionTitles?: string[];
  collectionHandles?: string[];
}): SalonQuality {
  const haystack = [
    opts.productTitle,
    opts.variantTitle ?? "",
    ...(opts.collectionTitles ?? []),
    ...(opts.collectionHandles ?? []),
  ]
    .join(" ")
    .toLowerCase();
  if (/\brussisch|russian\b/.test(haystack)) return "russisch";
  if (/\busbekisch|uzbek/.test(haystack)) return "usbekisch";
  return null;
}

export function parseLength(opts: {
  productTitle: string;
  variantTitle?: string | null;
}): number | null {
  const candidates = [opts.variantTitle ?? "", opts.productTitle];
  for (const s of candidates) {
    const m = s.match(LENGTH_RE);
    if (m) {
      const n = parseInt(m[1], 10);
      // Plausibilitaet: 30-90cm fuer Tape/Bonding, 100+ ist eher Pack-Gewicht
      if (n >= 30 && n <= 95) return n;
    }
  }
  return null;
}

/**
 * Farb-Extraktion: nimmt zuerst die variant_title (ohne cm-Teil & ohne Pack-Gewicht),
 * fallback letzter sinnvoller Token aus product_title.
 *
 * Beispiele die funktionieren:
 *   variant "45cm / Schwarz" -> "Schwarz"
 *   variant "Schwarz / 45cm" -> "Schwarz"
 *   variant "100g / Naturschwarz" -> "Naturschwarz"
 *   product "Tape Extensions 45cm Naturblond" -> "Naturblond"
 */
export function parseColor(opts: {
  productTitle: string;
  variantTitle?: string | null;
}): string | null {
  const stripParts = (raw: string): string => {
    return raw
      .replace(/\d{2,3}\s*cm\b/gi, "")
      .replace(/\d{2,3}\s*g\b/gi, "")
      .replace(/[/|·•]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  };

  // 1) variant_title bereinigen
  if (opts.variantTitle) {
    const cleaned = stripParts(opts.variantTitle);
    if (cleaned && cleaned.toLowerCase() !== "default title") {
      return cleaned;
    }
  }

  // 2) Fallback: letztes Wort/Phrase im product_title (oft die Farbe)
  // Strategie: alles vor dem letzten "cm" entfernen → Rest ist meist Farbe.
  const t = opts.productTitle;
  const cmMatch = t.match(/cm\b/i);
  if (cmMatch && cmMatch.index != null) {
    const after = t.slice(cmMatch.index + cmMatch[0].length).trim();
    const cleaned = stripParts(after);
    if (cleaned) return cleaned;
  }

  return null;
}
