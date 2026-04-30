/**
 * Barcode-Audit-Logik für die Etiketten-/Shopify-Daten.
 *
 * Erkennt:
 * - Duplikate: gleicher Barcode auf mehreren Produkten/Varianten
 * - Missing: Produkt-Variante ohne Barcode
 * - Invalid: Barcode mit Zeichen-Müll oder falscher Länge
 * - Checksum-Fehler: EAN-8/EAN-13/UPC-A/GTIN-14 mit ungültiger Prüfziffer
 * - Suspicious: Placeholder-Werte (alle Nullen, "1234567890123" etc.)
 */

import type { AuditVariant } from "./shopify";

export interface BarcodeIssue {
  variant: AuditVariant;
  reason: string;
}

export interface DuplicateGroup {
  barcode: string;
  variants: AuditVariant[];
}

export interface AuditReport {
  totalVariants: number;
  totalWithBarcode: number;
  duplicates: DuplicateGroup[];
  missing: AuditVariant[];
  invalidFormat: BarcodeIssue[];
  invalidChecksum: BarcodeIssue[];
  suspicious: BarcodeIssue[];
}

const SUSPICIOUS_PATTERNS = [
  /^0+$/,                  // alles Nullen
  /^(\d)\1{7,}$/,          // alle gleiche Ziffer (z.B. "1111111111111")
  /^123456789012?3?$/,     // Standard-Test-Sequenz
  /^9{8,}$/,               // alles Neunen
];

/**
 * EAN/UPC/GTIN-Checksum-Validierung.
 * Akzeptiert Längen 8, 12, 13, 14 (Standard-GS1-Formate).
 * Modulo-10-Prüfziffer: gewichteter Quersummen-Algorithmus.
 */
export function validateGtinChecksum(code: string): boolean {
  if (!/^\d+$/.test(code)) return false;
  const len = code.length;
  if (len !== 8 && len !== 12 && len !== 13 && len !== 14) return false;

  // Right-aligned: letzte Ziffer = Checksum, davor abwechselnd ×3 und ×1
  // (von rechts nach links, beginnend mit ×3 für die zweite Ziffer von rechts)
  const digits = code.split("").map(Number);
  const checksum = digits[digits.length - 1];
  let sum = 0;
  for (let i = 0; i < digits.length - 1; i++) {
    // Position vom Ende: 0=letzte (=checksum), 1=zweite-von-rechts → ×3
    const posFromEnd = digits.length - 1 - i;
    const weight = posFromEnd % 2 === 1 ? 3 : 1;
    sum += digits[i] * weight;
  }
  const expected = (10 - (sum % 10)) % 10;
  return checksum === expected;
}

export function isValidBarcode(barcode: string): { valid: boolean; reason?: string } {
  const trimmed = barcode.trim();
  if (!trimmed) return { valid: false, reason: "leer" };

  // Mit Whitespace innerhalb? Darf nicht.
  if (/\s/.test(trimmed)) return { valid: false, reason: "enthält Leerzeichen" };

  // Andere Sonderzeichen? Akzeptiert sind: nur Ziffern (für EAN/UPC/GTIN).
  // CODE128 wäre alphanumerisch, aber die Praxis bei Hairvenly ist EAN-13.
  if (!/^\d+$/.test(trimmed)) return { valid: false, reason: "enthält nicht-numerische Zeichen" };

  const len = trimmed.length;
  if (len !== 8 && len !== 12 && len !== 13 && len !== 14) {
    return { valid: false, reason: `ungewöhnliche Länge ${len} (erwartet 8/12/13/14)` };
  }

  return { valid: true };
}

export function auditBarcodes(variants: AuditVariant[]): AuditReport {
  const duplicatesMap = new Map<string, AuditVariant[]>();
  const missing: AuditVariant[] = [];
  const invalidFormat: BarcodeIssue[] = [];
  const invalidChecksum: BarcodeIssue[] = [];
  const suspicious: BarcodeIssue[] = [];

  let withBarcode = 0;

  for (const v of variants) {
    if (!v.hasBarcode || !v.barcode || !v.barcode.trim()) {
      missing.push(v);
      continue;
    }
    withBarcode++;

    const trimmed = v.barcode.trim();

    // Format-Check
    const fmt = isValidBarcode(trimmed);
    if (!fmt.valid) {
      invalidFormat.push({ variant: v, reason: fmt.reason ?? "ungültig" });
      // Trotzdem in Duplikat-Map aufnehmen — könnte ein doppelter Müll-Wert sein
    }

    // Suspicious-Check
    if (SUSPICIOUS_PATTERNS.some((p) => p.test(trimmed))) {
      suspicious.push({ variant: v, reason: "Placeholder-Muster" });
    }

    // Checksum-Check (nur wenn Format OK)
    if (fmt.valid && !validateGtinChecksum(trimmed)) {
      invalidChecksum.push({ variant: v, reason: "Prüfziffer falsch" });
    }

    // Duplikat-Sammlung
    if (!duplicatesMap.has(trimmed)) duplicatesMap.set(trimmed, []);
    duplicatesMap.get(trimmed)!.push(v);
  }

  const duplicates: DuplicateGroup[] = [];
  for (const [barcode, list] of duplicatesMap) {
    if (list.length > 1) duplicates.push({ barcode, variants: list });
  }
  duplicates.sort((a, b) => b.variants.length - a.variants.length);

  return {
    totalVariants: variants.length,
    totalWithBarcode: withBarcode,
    duplicates,
    missing,
    invalidFormat,
    invalidChecksum,
    suspicious,
  };
}
