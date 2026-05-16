/**
 * Diagnose: Vergleicht Stock-Sheet (echtes Sortiment) mit Catalog (Kurznamen)
 * Zeigt welche Produkte/Farben im Sheet stehen aber NICHT im Catalog (und umgekehrt).
 */
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { readInventorySheet } from "@/lib/stock-sheets";

export async function GET() {
  const [rus, usb] = await Promise.all([
    readInventorySheet("Russisch - GLATT"),
    readInventorySheet("Usbekisch - WELLIG"),
  ]);

  const svc = createServiceClient();
  // Lade Catalog: methods + lengths + colors (mit name_hairvenly + name_shopify)
  const { data: rawCatalog } = await svc.from("product_colors").select(`
    name_hairvenly, name_shopify,
    length:product_lengths!product_colors_length_id_fkey(value, unit,
      method:product_methods!product_lengths_method_id_fkey(name,
        supplier:suppliers!product_methods_supplier_id_fkey(name)))
  `);

  type CatalogRow = {
    name_hairvenly: string | null;
    name_shopify: string | null;
    length?: { value?: number; unit?: string; method?: { name?: string; supplier?: { name?: string } | null } | null } | null;
  };
  const catalog = (rawCatalog as unknown as CatalogRow[]) || [];

  // Extrahiere Kurznamen aus Stock-Produkten
  const extractKurzname = (title: string): string | null => {
    const m = title.match(/^#?\s*([\w\s\-/]+?)(?:\s+(?:RU|US|RUSSISCH|USBEKISCH|WELLIG|GLATT|KERATIN|INVISIBLE|TAPE|BONDING|TRESSEN|CLIP|PONYTAIL|MINITAPE|MINI)|\s+\d|♡|$)/i);
    return m ? m[1].trim().toUpperCase() : null;
  };

  // Sammle Kurznamen aus Stock-Sheets
  const stockKurznames = new Set<string>();
  for (const row of [...rus.rows, ...usb.rows]) {
    const k = extractKurzname(row.product);
    if (k) stockKurznames.add(k);
  }

  // Catalog-Kurznamen
  const catalogKurznames = new Set(catalog.map(c => (c.name_hairvenly || "").toUpperCase().trim()).filter(Boolean));

  const inStockNotInCatalog = Array.from(stockKurznames).filter(k => !catalogKurznames.has(k));
  const inCatalogNotInStock = Array.from(catalogKurznames).filter(k => !stockKurznames.has(k));

  return NextResponse.json({
    stock_sheets: {
      russisch_count: rus.rows.length,
      usbekisch_count: usb.rows.length,
      russisch_collections: Array.from(new Set(rus.rows.map(r => r.collection))).slice(0, 30),
      usbekisch_collections: Array.from(new Set(usb.rows.map(r => r.collection))).slice(0, 30),
      russisch_sample: rus.rows.slice(0, 8),
      usbekisch_sample: usb.rows.slice(0, 8),
    },
    catalog: {
      total: catalog.length,
      with_kurzname: catalog.filter(c => c.name_hairvenly).length,
      with_shopify: catalog.filter(c => c.name_shopify).length,
      sample: catalog.slice(0, 5),
      methods: Array.from(new Set(catalog.map(c => c.length?.method?.name).filter(Boolean))),
    },
    matching: {
      stock_kurznames_count: stockKurznames.size,
      catalog_kurznames_count: catalogKurznames.size,
      in_stock_not_in_catalog: inStockNotInCatalog.sort().slice(0, 50),
      in_catalog_not_in_stock: inCatalogNotInStock.sort().slice(0, 50),
    },
  });
}
