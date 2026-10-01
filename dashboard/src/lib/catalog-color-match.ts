/**
 * Farbnamen-Erkennung aus Shopify-Produkttiteln (pure, ohne Server-Deps —
 * damit Katalog-Sync und Trockenlauf-Skripte exakt dieselbe Logik nutzen).
 *
 * Shopify-Titel existieren in zwei Formaten:
 *   Legacy: "#DUBAI GENIUS WEFT RUSSISCHES GLATTES HAAR 60CM ♡"
 *   Neu (seit Sommer 2026, ~80% aller Produkte):
 *           "#Dubai Warmes Goldbraun | Echthaar Genius Weft Tressen 65 cm | US Wellig ♡"
 *           "#Butterscotch I Warmes Karamellblond Ombré I Echthaar I Standard Tape … ♡"
 *   Im neuen Format steht vor dem ersten Trenner (| oder " I ") die Farbe,
 *   oft gefolgt von freien Beschreibungswörtern ("Warmes Goldbraun").
 *   Wo die Farbe endet, ist aus dem Text allein NICHT eindeutig → deshalb
 *   matchKnownColor(): Abgleich gegen bekannte Farbnamen (Katalog + Bestell-
 *   Sheets), längster Präfix gewinnt.
 */

/** Trenner im neuen Titelformat: "|" oder alleinstehendes großes "I". */
const NEW_FORMAT_SEPARATOR = /\s*\|\s*|\s+I\s+/;

/** true wenn der Titel das neue Format mit Trennern nutzt. */
export function isNewTitleFormat(shopifyName: string): boolean {
  return NEW_FORMAT_SEPARATOR.test(shopifyName);
}

/**
 * Liefert den Farb-Abschnitt eines Shopify-Titels (ohne "#").
 * Neu-Format: Text zwischen "#" und erstem Trenner, z.B. "Dubai Warmes Goldbraun".
 * Legacy: bisherige Heuristik (Code-Kürzel bzw. Text bis Stopwort).
 */
export function extractShopifyColorSegment(shopifyName: string): string {
  const hashIdx = shopifyName.indexOf("#");
  const afterHash = (hashIdx >= 0 ? shopifyName.substring(hashIdx + 1) : shopifyName).trim();

  if (isNewTitleFormat(afterHash)) {
    const segment = afterHash.split(NEW_FORMAT_SEPARATOR)[0] ?? "";
    return segment.replace(/[♡\-–,\s]+$/, "").trim();
  }

  // ── Legacy-Heuristik (unverändert übernommen) ──
  let colorName = afterHash;
  const codeMatch = colorName.match(/^([A-Z0-9][A-Z0-9/]*(?:\s*[A-Z0-9/]+)?)\s+[A-ZÄÖÜ]/);
  if (codeMatch) {
    const code = codeMatch[1].trim();
    if (code.length <= 8 && !code.includes(" ")) colorName = code;
  }
  if (colorName.length > 10) {
    const stopWords = [
      " RUSSISCHE", " RU GLATT", " GLATT", " US WELLIGE", " WELLIGE", " US ",
      " STANDARD ", " MINI TAPE", " BONDINGS", " INVISIBLE", " CLASSIC",
      " GENIUS", " TAPE EXT", " CLIP EXT", " TRESSEN", " WEFT",
      " EXTENSIONS", " - ", " TIEFSCHWARZ", " SCHWARZBRAUN", " DUNKELBRAUN",
      " MITTELBRAUN", " HELLBRAUN", " DUNKELBLOND", " HELLBLOND", " LICHTBLOND",
      " LIGHTBLOND", " PLATINBLOND", " OMBRES ", " BALAYAGE ", " GESTRÄHN",
      " HONIGBLOND", " GOLDBLOND", " SAMTBRAUN", " MOKKA", " ASCHBRAUN",
      " REHBRAUN", " KUPFER", " KIRSCHE", " SANDBLOND", " SCHOKOLAD",
      " KÜHLES ", " HELLES ", " DUNKLE",
    ];
    for (const sw of stopWords) {
      const idx = colorName.toUpperCase().indexOf(sw.toUpperCase());
      if (idx > 0) {
        const candidate = colorName.substring(0, idx).trim();
        if (candidate.length >= 1) { colorName = candidate; break; }
      }
    }
  }
  return colorName.replace(/\s+TRESSEN$/i, "").replace(/[♡\-–,\s]+$/, "").trim();
}

const norm = (s: string) =>
  s.toLowerCase().normalize("NFC").replace(/[-_]/g, " ").replace(/\s+/g, " ").trim();
const compact = (s: string) => norm(s).replace(/[^a-z0-9äöüß/]/g, "");

/** Bekannte Schreibvarianten (gleiche Logik wie applyColorAliases_ im Apps Script). */
function alias(s: string): string {
  return s
    .replace(/\bnorwegian\b/g, "norvegian")
    .replace(/\bcappucino\b/g, "cappuccino")
    .replace(/\bbisquid\b/g, "biscuit")
    .replace(/\bbisquit\b/g, "biscuit");
}

/**
 * Findet den passenden bekannten Farbnamen für einen Farb-Abschnitt.
 * Längster Kandidat gewinnt (→ "Latte Balayage" vor "Latte").
 *   1. Wortgrenzen-Präfix:  "dubai warmes goldbraun" beginnt mit "dubai" + " "
 *   2. Kompakt-Präfix (≥4 Zeichen, ohne Leerzeichen): "MochaMelt Balayage" ↔ "MOCHA MELT"
 * Gibt null zurück wenn kein Kandidat passt.
 */
export function matchKnownColor(segment: string, candidates: Iterable<string>): string | null {
  const seg = alias(norm(segment));
  const segC = compact(seg);
  if (!seg) return null;
  const sorted = [...new Set(candidates)].filter(Boolean).sort((a, b) => b.length - a.length);

  for (const cand of sorted) {
    const c = alias(norm(cand));
    if (!c) continue;
    if (seg === c || seg.startsWith(c + " ")) return cand;
  }
  for (const cand of sorted) {
    const cC = compact(alias(norm(cand)));
    if (cC.length >= 4 && segC.startsWith(cC)) return cand;
  }
  return null;
}

/**
 * Gleiche Farbe? Toleriert Altlast-Katalognamen mit angehängtem Text
 * ("NORVEGIAN KÜHLES BLOND US WELLIGE" ≙ "NORVEGIAN", "3T8A 45CM" ≙ "3T8A")
 * und Schreibvarianten ohne Leerzeichen ("MOCHAMELT" ≙ "MOCHA MELT").
 * Bidirektionaler Wortgrenzen-Präfix — dieselbe Konvention wie matchColor()
 * im Apps Script. "6" ≠ "60", "2" ≠ "2E" (Wortgrenze nötig).
 */
export function isSameColor(a: string, b: string): boolean {
  const x = alias(norm(a)), y = alias(norm(b));
  if (!x || !y) return false;
  if (x === y || compact(x) === compact(y)) return true;
  return x.startsWith(y + " ") || y.startsWith(x + " ");
}

/** Sucht unter bestehenden Katalognamen derselben Länge einen passenden Eintrag. */
export function findExistingColor(color: string, existingNames: Iterable<string>): string | null {
  // Exakte/kompakte Gleichheit zuerst, dann tolerante Präfix-Gleichheit
  const names = [...existingNames];
  return (
    names.find((n) => compact(alias(norm(n))) === compact(alias(norm(color)))) ??
    names.find((n) => isSameColor(n, color)) ??
    null
  );
}
