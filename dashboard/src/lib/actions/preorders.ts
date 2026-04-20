"use server";

import { requireAdmin } from "@/lib/auth";
import { readDashboardAlerts, type AlertProduct } from "@/lib/stock-sheets";
import { loadCatalogLookup, extractShopifyColorKey, type CatalogEntry } from "@/lib/catalog-lookup";
import {
  searchProductsByTitle,
  setProductMetafields,
  updateVariantInventoryPolicy,
  fetchOrdersByTag,
  ensureMetafieldDefinitions,
} from "@/lib/shopify";

// ── Types ─────────────────────────────────────────────────────

export interface PreorderOrder {
  name: string;
  ankunft: string;
  menge: number;
}

export interface PreorderCandidate {
  product: string;
  variant: string | null; // e.g. "225" for 225g clip-in
  collection: string;
  shopifyName: string | null;
  sheetKey: "wellig" | "glatt";
  unterwegsG: number;
  eta: string; // earliest arrival date (DD.MM.YYYY) — this is what gets pushed to Shopify
  orders: PreorderOrder[];
}

export interface ShopifyPreorder {
  id: string;
  name: string;
  createdAt: string;
  customer: string;
  total: string;
  currency: string;
  items: { title: string; quantity: number; variant: string }[];
}

// ── Load pre-order candidates ─────────────────────────────────

export async function loadPreorderCandidates(): Promise<PreorderCandidate[]> {
  const [alerts, catalog] = await Promise.all([
    readDashboardAlerts(),
    loadCatalogLookup(),
  ]);

  // Only nullbestand products with something unterwegs
  const zeroWithTransit = alerts.nullbestand.filter((a) => a.unterwegsG > 0 && a.perOrder.length > 0);

  const candidates: PreorderCandidate[] = [];

  for (const item of zeroWithTransit) {
    const shopifyName = resolveShopifyName(item, catalog.byShopify);

    // Find earliest ETA from perOrder
    const eta = extractEarliestEta(item.perOrder);

    // Extract just the color name from the full product name
    const colorName = extractShopifyColorKey(item.product);

    candidates.push({
      product: colorName,
      variant: item.variant, // e.g. "225" for [225g] clip-in variants
      collection: item.collection,
      shopifyName,
      sheetKey: item.sheetKey,
      unterwegsG: item.unterwegsG,
      eta,
      orders: item.perOrder.map((o) => ({
        name: o.name,
        ankunft: extractDateFromAnkunft(o.ankunft),
        menge: o.menge,
      })),
    });
  }

  return candidates;
}

/**
 * Try to match an AlertProduct to a Shopify product name via the catalog.
 * The product field from Sheets is a color name like "#BITTER CACAO".
 * We normalize it and look up in the catalog's byShopify map.
 */
function resolveShopifyName(
  item: AlertProduct,
  byShopify: Map<string, { shopifyName: string | null }[]>,
): string | null {
  // The AlertProduct.product is the color name, try to find a matching catalog entry
  const colorKey = item.product.toUpperCase().trim();

  // Try direct lookup via the byShopify map (reverse: iterate and match)
  for (const [shopifyKey, entries] of byShopify) {
    for (const entry of entries) {
      if (!entry.shopifyName) continue;
      const extracted = extractShopifyColorKey(entry.shopifyName);
      if (extracted === colorKey || entry.shopifyName.toUpperCase().includes(colorKey)) {
        return entry.shopifyName;
      }
    }
  }

  // Fallback: try matching by the color key directly
  const directMatch = byShopify.get(colorKey);
  if (directMatch && directMatch.length > 0 && directMatch[0].shopifyName) {
    return directMatch[0].shopifyName;
  }

  return null;
}

/**
 * Extract the earliest arrival date from perOrder entries.
 * The ankunft field looks like "ca. Ankunft: 15.05.2026" or similar.
 */
function extractEarliestEta(perOrder: { ankunft: string }[]): string {
  let earliest = "";
  let earliestDate: Date | null = null;

  for (const o of perOrder) {
    // Extract date pattern DD.MM.YYYY from the ankunft string
    const match = o.ankunft.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
    if (match) {
      const d = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
      if (!earliestDate || d < earliestDate) {
        earliestDate = d;
        earliest = `${match[1].padStart(2, "0")}.${match[2].padStart(2, "0")}.${match[3]}`;
      }
    }
  }

  return earliest || perOrder[0]?.ankunft || "Unbekannt";
}

// ── Push to Shopify ───────────────────────────────────────────

export async function pushToShopify(
  _prev: unknown,
  formData: FormData,
): Promise<{ success: string[]; errors: string[] }> {
  await requireAdmin();

  const selectedJson = formData.get("selected") as string;
  const selected: { shopifyName: string; eta: string }[] = JSON.parse(selectedJson || "[]");

  if (selected.length === 0) return { success: [], errors: ["Keine Produkte ausgewählt"] };

  // Ensure metafield definitions exist (idempotent)
  await ensureMetafieldDefinitions();

  const success: string[] = [];
  const errors: string[] = [];

  for (const item of selected) {
    try {
      // Search for the Shopify product
      const products = await searchProductsByTitle(item.shopifyName);
      if (products.length === 0) {
        errors.push(`${item.shopifyName}: Produkt nicht gefunden`);
        continue;
      }

      const product = products[0];

      // Convert DD.MM.YYYY to YYYY-MM-DD for Shopify date metafield
      const etaIso = convertDateToIso(item.eta);

      // Set metafields
      await setProductMetafields(product.id, [
        { namespace: "custom", key: "restock_date", type: "date", value: etaIso },
        { namespace: "custom", key: "preorder_enabled", type: "boolean", value: "true" },
      ]);

      // Enable "Continue selling when out of stock" on all variants
      for (const edge of product.variants.edges) {
        if (edge.node.inventoryPolicy !== "CONTINUE") {
          await updateVariantInventoryPolicy(edge.node.id, "CONTINUE");
        }
      }

      success.push(item.shopifyName);
    } catch (err) {
      errors.push(`${item.shopifyName}: ${err instanceof Error ? err.message : "Unbekannter Fehler"}`);
    }
  }

  return { success, errors };
}

// ── Remove from Shopify ───────────────────────────────────────

export async function removeFromShopify(
  _prev: unknown,
  formData: FormData,
): Promise<{ success: string[]; errors: string[] }> {
  await requireAdmin();

  const selectedJson = formData.get("selected") as string;
  const selected: { shopifyName: string }[] = JSON.parse(selectedJson || "[]");

  if (selected.length === 0) return { success: [], errors: ["Keine Produkte ausgewählt"] };

  const success: string[] = [];
  const errors: string[] = [];

  for (const item of selected) {
    try {
      const products = await searchProductsByTitle(item.shopifyName);
      if (products.length === 0) {
        errors.push(`${item.shopifyName}: Produkt nicht gefunden`);
        continue;
      }

      const product = products[0];

      await setProductMetafields(product.id, [
        { namespace: "custom", key: "preorder_enabled", type: "boolean", value: "false" },
      ]);

      for (const edge of product.variants.edges) {
        if (edge.node.inventoryPolicy !== "DENY") {
          await updateVariantInventoryPolicy(edge.node.id, "DENY");
        }
      }

      success.push(item.shopifyName);
    } catch (err) {
      errors.push(`${item.shopifyName}: ${err instanceof Error ? err.message : "Unbekannter Fehler"}`);
    }
  }

  return { success, errors };
}

// ── Load Shopify pre-orders ───────────────────────────────────

export async function loadShopifyPreorders(): Promise<ShopifyPreorder[]> {
  try {
    const orders = await fetchOrdersByTag("preorder", 50);

    return orders.map((o) => ({
      id: o.id,
      name: o.name,
      createdAt: o.createdAt,
      customer: o.customer
        ? `${o.customer.firstName ?? ""} ${o.customer.lastName ?? ""}`.trim() || o.customer.email
        : "Unbekannt",
      total: o.totalPriceSet.shopMoney.amount,
      currency: o.totalPriceSet.shopMoney.currencyCode,
      items: o.lineItems.edges.map((e) => ({
        title: e.node.title,
        quantity: e.node.quantity,
        variant: e.node.variant?.title ?? "",
      })),
    }));
  } catch {
    // If Shopify API is not configured or fails, return empty
    return [];
  }
}

// ── Helpers ───────────────────────────────────────────────────

function extractDateFromAnkunft(ankunft: string): string {
  const match = ankunft.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (match) return `${match[1].padStart(2, "0")}.${match[2].padStart(2, "0")}.${match[3]}`;
  return ankunft;
}

function convertDateToIso(dateStr: string): string {
  const match = dateStr.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (match) {
    return `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`;
  }
  // Fallback: return as-is (might already be ISO)
  return dateStr;
}
