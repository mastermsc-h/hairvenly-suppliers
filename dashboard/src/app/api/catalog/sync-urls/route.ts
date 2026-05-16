/**
 * POST /api/catalog/sync-urls
 *
 * Synchronisiert die Shopify-URLs aus den Stock-Sheets in product_colors.
 * Match-Key: name_shopify (normalisiert) → row.product (normalisiert)
 *
 * Antwort: { updated_count, skipped_count, no_url_in_sheet, no_catalog_match }
 */
import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { readInventorySheet } from "@/lib/stock-sheets";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles").select("is_admin").eq("id", user.id).single();
  return profile?.is_admin ? user : null;
}

const norm = (s: string) =>
  s.toUpperCase().replace(/\s+/g, " ").replace(/[♡♥]/g, "").trim();

export async function POST() {
  if (!(await requireAdmin())) {
    return NextResponse.json({ error: "auth" }, { status: 401 });
  }

  // Stock-Sheets lesen
  const [rus, usb] = await Promise.all([
    readInventorySheet("Russisch - GLATT"),
    readInventorySheet("Usbekisch - WELLIG"),
  ]);
  const allStock = [...rus.rows, ...usb.rows];

  // Stock-URL-Index nach normalisiertem Produktnamen
  const urlByName = new Map<string, string>();
  for (const r of allStock) {
    if (r.url) urlByName.set(norm(r.product), r.url);
  }

  // Catalog lesen
  const svc = createServiceClient();
  const { data: catalog, error } = await svc
    .from("product_colors")
    .select("id, name_shopify, shopify_url");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  let updated = 0;
  let skipped = 0;        // schon korrekt eingetragen
  let noUrlInSheet = 0;   // Catalog-Eintrag hat keinen passenden Sheet-URL
  let noShopifyName = 0;  // Catalog-Eintrag hat kein name_shopify

  for (const c of catalog || []) {
    if (!c.name_shopify) { noShopifyName++; continue; }
    const url = urlByName.get(norm(c.name_shopify));
    if (!url) { noUrlInSheet++; continue; }
    if (c.shopify_url === url) { skipped++; continue; }
    await svc.from("product_colors").update({ shopify_url: url }).eq("id", c.id);
    updated++;
  }

  return NextResponse.json({
    catalog_total: (catalog || []).length,
    stock_total: allStock.length,
    stock_with_url: urlByName.size,
    updated,
    skipped_already_set: skipped,
    no_url_in_sheet: noUrlInSheet,
    no_shopify_name: noShopifyName,
  });
}
