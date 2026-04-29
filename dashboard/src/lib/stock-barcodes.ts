import { fetchAllVariantsForBarcodes, type BarcodeVariant } from "./shopify";
import type { InventoryRow } from "./stock-sheets";

function normalize(s: string): string {
  return s
    .toUpperCase()
    .replace(/\s+/g, " ")
    .replace(/[♡]/g, "")
    .trim();
}

/**
 * Reichert InventoryRow[] um die EAN-Barcodes aus Shopify an.
 *
 * Matching:
 *  - Default: nach productTitle (normalisiert)
 *  - Bei Clip-ins (mehrere Gewicht-Varianten pro Produkt): zusätzlich nach unitWeight
 *    aus dem variantTitle herausgelesen (z.B. "100g", "150g", "225g").
 */
export async function enrichInventoryWithBarcodes<T extends InventoryRow>(
  rows: T[],
): Promise<T[]> {
  let variants: BarcodeVariant[];
  try {
    variants = await fetchAllVariantsForBarcodes();
  } catch {
    // Wenn Shopify-Call fehlschlägt: einfach ohne Barcodes weitermachen,
    // Stock-Page bleibt funktional.
    return rows;
  }

  // Map: normalisierter Produkt-Titel → Liste von Varianten
  const byProduct = new Map<string, BarcodeVariant[]>();
  for (const v of variants) {
    const key = normalize(v.productTitle);
    if (!byProduct.has(key)) byProduct.set(key, []);
    byProduct.get(key)!.push(v);
  }

  return rows.map((row) => {
    const list = byProduct.get(normalize(row.product));
    if (!list || list.length === 0) return row;
    if (list.length === 1) return { ...row, barcode: list[0].barcode };

    // Mehrere Varianten — versuche per unitWeight zu disambiguieren
    if (row.unitWeight > 0) {
      const target = `${row.unitWeight}G`;
      const match = list.find((v) =>
        v.variantTitle ? normalize(v.variantTitle).includes(target) : false,
      );
      if (match) return { ...row, barcode: match.barcode };
    }

    // Fallback: erste Variante
    return { ...row, barcode: list[0].barcode };
  });
}
