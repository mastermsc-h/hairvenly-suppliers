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

  // Normalisierungs-Helfer: Vergleich case+whitespace-insensitive
  const norm = (s: string) => s.toUpperCase().replace(/\s+/g, " ").replace(/[♡♥]/g, "").trim();

  // Catalog: Set aller name_shopify (normalisiert)
  const catalogShopifyNames = new Map<string, CatalogRow>();
  for (const c of catalog) {
    if (c.name_shopify) catalogShopifyNames.set(norm(c.name_shopify), c);
  }

  // Stock-Produkte mit Match-Status
  const allStock = [...rus.rows, ...usb.rows];
  const matched: { stock_title: string; catalog_kurzname: string | null }[] = [];
  const unmatched: string[] = [];
  for (const row of allStock) {
    const normalized = norm(row.product);
    const cat = catalogShopifyNames.get(normalized);
    if (cat) {
      matched.push({ stock_title: row.product, catalog_kurzname: cat.name_hairvenly });
    } else {
      unmatched.push(row.product);
    }
  }

  // Catalog-Einträge die im Stock NICHT vorkommen (= womöglich veraltet)
  const stockNormSet = new Set(allStock.map(r => norm(r.product)));
  const orphanCatalog: CatalogRow[] = [];
  for (const c of catalog) {
    if (c.name_shopify && !stockNormSet.has(norm(c.name_shopify))) {
      orphanCatalog.push(c);
    }
  }

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
      stock_total: allStock.length,
      matched_count: matched.length,
      unmatched_count: unmatched.length,
      match_rate_pct: Math.round(100 * matched.length / allStock.length),
      orphan_catalog_count: orphanCatalog.length,
      // Liste der Stock-Produkte ohne Catalog-Match
      stock_missing_in_catalog: unmatched.sort().slice(0, 100),
      // Catalog-Einträge ohne Stock-Match (eventuell auslaufende Produkte)
      catalog_orphans_sample: orphanCatalog.slice(0, 30).map(c => ({
        kurz: c.name_hairvenly,
        shopify: c.name_shopify,
      })),
    },
  });
}
