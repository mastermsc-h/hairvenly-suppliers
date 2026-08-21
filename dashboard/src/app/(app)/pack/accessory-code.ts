// Universeller "Zubehör"-Scan-Code für den Pack-Flow.
//
// Idee: Extensions behalten ihren echten Barcode (Farbe/Länge/Methode müssen
// verifiziert werden), aber ALLES ANDERE — Zubehör, Pflege, Schulungen — wird
// mit EINEM einzigen universellen Code bestätigt, statt jeweils "manuell
// bestätigen" zu tippen. Ein Scan = die nächste offene Nicht-Extension-Position
// komplett abgehakt → schnell weiter zum nächsten Produkt.
//
// Genutzt von:
//   - pack-mode.tsx (submitBarcode) → Interception + Bestätigung
//   - pack/zubehoer-code (druckbare QR- + Code-128-Karte)
//
// WICHTIG — layout-sicherer Wert (nur Ziffern):
// Ein USB-Handscanner tippt den Code als HID-Tastatureingabe. Auf deutscher
// Tastatur (QWERTZ) wird dabei Z↔Y vertauscht und "-" → "ß". Ein Buchstaben-
// Code wie "HV-ZUBEHOR" kam so als "HVßYUBEHOR" an, wurde NICHT erkannt und
// fiel als "falscher Artikel" durch. Ziffern kommen auf QWERTZ/QWERTY
// identisch an → der Code ist jetzt rein numerisch. Die alten Buchstaben-
// Aliase (inkl. deutsch-verwürfelter Form) bleiben als Fallback erhalten,
// damit bereits gedruckte QR-Codes (per Kamera) weiter funktionieren.

export const ACCESSORY_CODE_VALUE = "9900000000";

const LETTER_TOKENS = new Set([
  "HVZUBEHOR",
  "HVZUBEHÖR",
  "HVACCESSORY",
  "HVACC",
  "ZUBEHOR",
]);

/**
 * Erkennt den universellen Zubehör-Code robust:
 *  - exakter numerischer Wert (layout-sicher, Handscanner)
 *  - Buchstaben-Aliase (per Kamera gescannte QR — dort keine Verwürfelung)
 *  - deutsch-verwürfelte Buchstaben-Form zurückgedreht (Y→Z, ß/SS entfernt),
 *    damit auch der ALTE gedruckte Code am QWERTZ-Handscanner erkannt wird.
 */
export function isAccessoryCode(text: string): boolean {
  const raw = text.trim();
  if (raw === ACCESSORY_CODE_VALUE) return true;

  const t = raw.toUpperCase().replace(/[\s-]/g, "");
  if (LETTER_TOKENS.has(t)) return true;

  // QWERTZ-Rückabbildung: "-"→"ß"→"SS" (entfernen) und Z→Y (zurück zu Z).
  const deMangled = t.replace(/SS/g, "").replace(/Y/g, "Z");
  return LETTER_TOKENS.has(deMangled);
}
