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

export const ACCESSORY_CODE_VALUE = "HV-ZUBEHOR";

/**
 * Erkennt den universellen Zubehör-Code tolerant: Groß/Klein egal,
 * Bindestriche/Leerzeichen egal, plus ein paar Aliase.
 */
export function isAccessoryCode(text: string): boolean {
  const t = text.trim().toUpperCase().replace(/[\s-]/g, "");
  return (
    t === "HVZUBEHOR" ||
    t === "HVZUBEHÖR" ||
    t === "HVACCESSORY" ||
    t === "HVACC" ||
    t === "ZUBEHOR"
  );
}
