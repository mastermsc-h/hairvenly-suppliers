import { createClient } from "@/lib/supabase/server";

export interface CatalogEntry {
  colorId: string;
  hairvenlyName: string;
  supplierName: string | null;
  shopifyName: string | null;
  method: string;
  length: string;
  supplierId: string;
}

/**
 * Load the full catalog from Supabase and build lookup maps.
 * This uses the Farbcodes data (product_methods → product_lengths → product_colors)
 * to create reliable mappings between Shopify names, Hairvenly names, and supplier names.
 */
export async function loadCatalogLookup(): Promise<{
  /** Lookup by Hairvenly color name (uppercase) → entries */
  byHairvenly: Map<string, CatalogEntry[]>;
  /** Lookup by Shopify product name fragment (uppercase) → entries */
  byShopify: Map<string, CatalogEntry[]>;
  /** All entries */
  all: CatalogEntry[];
}> {
  const supabase = await createClient();

  const [{ data: methods }, { data: lengths }, { data: colors }] = await Promise.all([
    supabase.from("product_methods").select("id, name, supplier_id"),
    supabase.from("product_lengths").select("id, method_id, value"),
    supabase.from("product_colors").select("id, length_id, name_hairvenly, name_supplier, name_shopify"),
  ]);

  // Build lookup: length_id → { method, length, supplierId }
  const methodMap = new Map<string, { name: string; supplier_id: string }>();
  for (const m of methods ?? []) methodMap.set(m.id, { name: m.name, supplier_id: m.supplier_id });

  const lengthMap = new Map<string, { method: string; length: string; supplierId: string }>();
  for (const l of lengths ?? []) {
    const m = methodMap.get(l.method_id);
    if (m) lengthMap.set(l.id, { method: m.name, length: l.value, supplierId: m.supplier_id });
  }

  const all: CatalogEntry[] = [];
  const byHairvenly = new Map<string, CatalogEntry[]>();
  const byShopify = new Map<string, CatalogEntry[]>();

  for (const c of colors ?? []) {
    const info = lengthMap.get(c.length_id);
    if (!info) continue;

    const entry: CatalogEntry = {
      colorId: c.id,
      hairvenlyName: c.name_hairvenly,
      supplierName: c.name_supplier,
      shopifyName: c.name_shopify,
      method: info.method,
      length: info.length,
      supplierId: info.supplierId,
    };
    all.push(entry);

    // Index by Hairvenly name
    const hKey = c.name_hairvenly.toUpperCase();
    if (!byHairvenly.has(hKey)) byHairvenly.set(hKey, []);
    byHairvenly.get(hKey)!.push(entry);

    // Index by Shopify name (extract color code from full shopify name)
    if (c.name_shopify) {
      const sKey = extractShopifyColorKey(c.name_shopify);
      if (!byShopify.has(sKey)) byShopify.set(sKey, []);
      byShopify.get(sKey)!.push(entry);
    }
  }

  return { byHairvenly, byShopify, all };
}

/**
 * Extract a normalized color key from a Shopify product name.
 * E.g. "#BITTER CACAO - INVISIBLE CLIP EXTENSIONS" → "#BITTER CACAO"
 */
export function extractShopifyColorKey(shopifyName: string): string {
  const upper = shopifyName.toUpperCase();
  const hashIdx = upper.indexOf("#");
  if (hashIdx < 0) return upper.trim();

  const afterHash = upper.substring(hashIdx + 1).trim();
  const parts = afterHash.split(/[\s\-–]+/);
  const colorParts: string[] = [];

  for (const p of parts) {
    const clean = p.replace(/[♡,.()\[\]]/g, "");
    if (!clean) continue;
    if (STOP_WORDS.has(clean)) break;
    if (/^\d+G?$/.test(clean) && colorParts.length > 0) break;
    colorParts.push(clean);
  }
  return "#" + colorParts.join(" ");
}

const STOP_WORDS = new Set([
  "STANDARD", "RUSSISCH", "RUSSISCHE", "US", "WELLIGE", "WELLIG",
  "TAPE", "TAPES", "BONDING", "BONDINGS", "MINI", "MINITAPE", "MINITAPES",
  "INVISIBLE", "CLASSIC", "GENIUS", "TRESSEN", "WEFT",
  "CLIP", "EXTENSIONS", "KERATIN", "GLATT", "PONYTAIL",
  "45CM", "55CM", "65CM", "85CM", "EXT", "EXTENSION",
]);
