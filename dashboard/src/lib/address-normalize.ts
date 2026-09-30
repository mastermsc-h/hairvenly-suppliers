/**
 * Normalisierung deutscher Straßenadressen für DHL-Leitcodierung.
 *
 * Problem: Kunden tippen "Schwebelstr.22" / "Hauptstraße5" / "Hindenburg Str.10"
 * — ohne Leerzeichen vor der Hausnummer. Die DHL-Shopify-App kann daraus keine
 * Hausnummer extrahieren → "Adresse nicht leitcodierbar", Label-Erstellung
 * blockiert.
 *
 * Fix: fehlendes Leerzeichen zwischen Straßenname und Hausnummer einfügen.
 * Konservativ: nur wenn das Muster eindeutig ist, sonst null (= nicht anfassen).
 */

/**
 * @returns korrigierte address1 oder null wenn kein Fix nötig/sicher möglich.
 *
 * Beispiele:
 *   "Schwebelstr.22"      → "Schwebelstr. 22"
 *   "Dorfstr.40a"         → "Dorfstr. 40a"
 *   "Hindenburg Str.10"   → "Hindenburg Str. 10"
 *   "Hauptstraße5"        → "Hauptstraße 5"
 *   "Bahnhofstr.12-14"    → "Bahnhofstr. 12-14"
 *   "Schwebelstr. 22"     → null (bereits korrekt)
 *   "Im Winkel 3"         → null (bereits korrekt)
 *   "Straße des 17. Juni 135" → null (bereits korrekt)
 */
export function normalizeGermanStreet(address1: string | null | undefined): string | null {
  const s = String(address1 ?? "").trim();
  if (s.length < 5) return null; // zu kurz für Straße+Nummer — nicht anfassen

  // Muster: <Straßenname endet auf Buchstabe oder Punkt, KEIN Leerzeichen>
  //         direkt gefolgt von <Hausnummer: 1-4 Ziffern + optional Buchstabe
  //         + optional Bereich wie -14 oder /2>
  const m = s.match(/^(.{2,}?[^\s\d])(\d{1,4}[a-zA-Z]?(?:\s?[-/]\s?\d{1,4}[a-zA-Z]?)?)$/);
  if (!m) return null;

  const street = m[1];
  const number = m[2];

  // Bereits korrekt (Leerzeichen vor Nummer) → Regex kann hier nicht matchen,
  // aber doppelte Absicherung falls sich das Pattern ändert:
  if (/\s$/.test(street)) return null;

  // Straßenname muss mindestens einen Buchstaben enthalten (nicht nur Zeichen)
  if (!/[a-zA-ZäöüÄÖÜß]/.test(street)) return null;

  const fixed = `${street} ${number}`;
  return fixed === s ? null : fixed;
}
