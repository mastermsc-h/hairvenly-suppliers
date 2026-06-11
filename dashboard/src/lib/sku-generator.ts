/**
 * SKU-Generator für Hairvenly-Produktvarianten.
 *
 * Format: {LIEFERANT}-{METHODE}-{LÄNGE}-{FARBE}
 *   z.B. RU-TAPE-45-1A, US-BOND-85-PW, RU-CLIP-50-NKB
 *
 * Bei Kollisionen wird ein numerisches Suffix angehängt:
 *   RU-TAPE-45-BB, RU-TAPE-45-BB-2, RU-TAPE-45-BB-3, …
 *
 * Variant-Suffix (z.B. -100G / -150G / -225G für Clip-Ins) wird beim
 * Anzeigen/Bestellen angehängt, NICHT in der Basis-SKU gespeichert.
 */

const SUPPLIER_CODES: Array<[RegExp, string]> = [
  [/amanda/i,     "RU"],   // Amanda = Russisch Glatt
  [/eyfel|ebru/i, "US"],   // Eyfel Ebru = Usbekisch Wellig
  [/aria/i,       "ARI"],
];

const METHOD_CODES: Array<[RegExp, string]> = [
  [/mini\s*tape|minitape/i,      "MTAP"],
  [/standard\s*tape|^tapes?$/i,  "TAPE"],
  [/tape/i,                       "TAPE"],
  [/bonding/i,                    "BOND"],
  [/classic\s+(weft|tresse)/i,   "CWFT"],
  [/invisible\s+(weft|tresse)/i, "IWFT"],
  [/genius\s+(weft|tresse)/i,    "GWFT"],
  [/clip[\s-]*ins?/i,             "CLIP"],
  [/ponytail/i,                   "PNTL"],
  [/keratin/i,                    "KERT"],
];

const NAME_SKIP_WORDS = new Set(["DER", "DIE", "DAS", "VON", "UND", "MIT", "OHNE", "EIN", "EINE"]);

function normalizeUmlauts(s: string): string {
  return s
    .replace(/[ÜüÚú]/g, "U")
    .replace(/[ÖöÓó]/g, "O")
    .replace(/[ÄäÁá]/g, "A")
    .replace(/[ß]/g, "SS")
    .replace(/[Éé]/g, "E");
}

function clean(s: string): string {
  return normalizeUmlauts(s.toUpperCase()).replace(/[^A-Z0-9]/g, "");
}

export function supplierCode(supplierName: string): string {
  for (const [re, code] of SUPPLIER_CODES) {
    if (re.test(supplierName)) return code;
  }
  // Fallback: first 3 chars of cleaned name
  return clean(supplierName).slice(0, 3) || "XXX";
}

export function methodCode(methodName: string): string {
  for (const [re, code] of METHOD_CODES) {
    if (re.test(methodName)) return code;
  }
  // Fallback: first 4 chars
  return clean(methodName).slice(0, 4) || "XXXX";
}

export function lengthCode(lengthValue: string): string {
  // Nur die Zahlen rausziehen (45cm → 45, "85" → 85)
  const m = String(lengthValue).match(/\d+/);
  return m ? m[0] : clean(lengthValue);
}

/**
 * Farb-Code aus dem hairvenly-Farbnamen:
 * - Numerische Color-Codes wie 1A, 5P18A, 3T8A, 60, 27 bleiben as-is
 *   (das sind etablierte Hair-Industry-Standard-Codes)
 * - Benannte Farben: erste Buchstaben jedes signifikanten Wortes
 *   (max 5 Zeichen, Umlaute normalisiert, Filler-Wörter rausgefiltert)
 *
 * Beispiele:
 *   "1A"                        → "1A"
 *   "1A SCHWARZE"               → "1A"     (numerischer Prefix dominant)
 *   "5P18A 45CM"                → "5P18A"
 *   "BERGEN BLOND"              → "BB"
 *   "PEARL WHITE"               → "PW"
 *   "NORVEGIAN KÜHLES BLOND"    → "NKB"
 *   "SOFT BLOND BALAYAGE"       → "SBB"
 *   "MOCHA MELT BRAUN"          → "MMB"
 *   "KÜHLES MITTELBLOND"        → "KM"
 */
export function colorCode(hairvenlyName: string): string {
  const cleaned = hairvenlyName.replace(/^#/, "").trim();
  if (!cleaned) return "X";

  const words = cleaned.split(/\s+/);
  const first = words[0];

  // Numerischer Farb-Code (Ziffer am Anfang)
  if (/^\d/.test(first)) {
    return clean(first);
  }

  // Signifikante Wörter sammeln (ohne Filler + Länge-Suffixe)
  const significant: string[] = [];
  for (const w of words) {
    const c = clean(w);
    if (!c || NAME_SKIP_WORDS.has(c)) continue;
    if (/^\d+CM$/.test(c)) continue;
    significant.push(c);
  }
  if (significant.length === 0) return "X";

  // Single-word colors → erste 4 chars (CAPPUCCINO → CAPP, CHAMPAGNE → CHAM)
  // Damit weniger kollisionen + lesbarer als nur "C".
  if (significant.length === 1) {
    return significant[0].slice(0, 4);
  }

  // Multi-word colors → erste Buchstaben der Wörter (BERGEN BLOND → BB)
  return significant.map((w) => w[0]).slice(0, 5).join("");
}

/**
 * Variant-Code für Clip-Ins (100g/150g/225g) und ähnliche.
 * Gibt leer-string zurück wenn keine Variante.
 */
export function variantCode(variant?: string | null): string {
  if (!variant) return "";
  return clean(variant);
}

/**
 * Baut die Basis-SKU (ohne Variant-Suffix, ohne Kollisions-Suffix).
 */
export function buildBaseSku(
  supplier: string,
  method: string,
  length: string,
  colorName: string,
): string {
  return [
    supplierCode(supplier),
    methodCode(method),
    lengthCode(length),
    colorCode(colorName),
  ].filter(Boolean).join("-");
}

/**
 * Generiert eine eindeutige SKU. Wenn die Basis-SKU bereits vergeben ist,
 * wird ein numerisches Suffix angehängt (-2, -3, …) bis Eindeutigkeit
 * erreicht ist. Die Set `existingSkus` wird in-place erweitert.
 */
export function generateUniqueSku(
  supplier: string,
  method: string,
  length: string,
  colorName: string,
  existingSkus: Set<string>,
): string {
  const base = buildBaseSku(supplier, method, length, colorName);
  if (!existingSkus.has(base)) {
    existingSkus.add(base);
    return base;
  }
  let n = 2;
  while (existingSkus.has(`${base}-${n}`)) n++;
  const sku = `${base}-${n}`;
  existingSkus.add(sku);
  return sku;
}

/**
 * Variant-SKU für Anzeige/Bestellung (z.B. auf Etiketten, in Bestelllisten).
 * Hängt Variant-Suffix an die Basis-SKU.
 */
export function applyVariantToSku(baseSku: string, variant?: string | null): string {
  const v = variantCode(variant);
  return v ? `${baseSku}-${v}` : baseSku;
}
