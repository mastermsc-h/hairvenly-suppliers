"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import {
  searchProductsByTitle,
  adjustShopifyInventoryByItemId,
  type ShopifyProduct,
  type ShopifyVariant,
} from "@/lib/shopify";

export type PushItemStatus =
  | "ok"
  | "no_mapping"
  | "product_not_found"
  | "variant_not_found"
  | "ambiguous_product"
  | "error";

export interface PushItemResult {
  item_id: string;
  display: string; // human-readable line: "Tape · 50cm · #1B (50 g)"
  qty: number;
  status: PushItemStatus;
  shopify_product?: string;
  shopify_variant?: string;
  error?: string;
  already_pushed_at?: string | null;
  already_pushed_qty?: number | null;
}

export interface PushReport {
  ok: boolean;
  results: PushItemResult[];
  summary: {
    total: number;
    succeeded: number;
    failed: number;
    skipped: number;
  };
  error?: string;
}

/**
 * Normalize a string for token-based variant matching:
 * lowercase, strip non-alphanumerics, collapse whitespace.
 */
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * Pick the best variant of a Shopify product for an order_item.
 *
 * Strategy:
 *   1. If the product has exactly 1 variant → use it.
 *   2. Try to match by method_name (e.g. "Tape", "Bond", "Clip-In") in variant.title.
 *   3. If that's still ambiguous, additionally constrain by length_value.
 *   4. Else return null (caller flags as ambiguous).
 */
function pickVariant(
  product: ShopifyProduct,
  methodName: string | null,
  lengthValue: string | null,
): ShopifyVariant | null {
  const variants = product.variants.edges.map((e) => e.node);
  if (variants.length === 0) return null;
  if (variants.length === 1) return variants[0];

  const m = methodName ? norm(methodName) : "";
  const l = lengthValue ? norm(lengthValue) : "";

  let candidates = variants;
  if (m) {
    const byMethod = variants.filter((v) => norm(v.title).includes(m));
    if (byMethod.length > 0) candidates = byMethod;
  }
  if (candidates.length > 1 && l) {
    const byLen = candidates.filter((v) => norm(v.title).includes(l));
    if (byLen.length > 0) candidates = byLen;
  }
  if (candidates.length === 1) return candidates[0];
  return null;
}

/**
 * Pick best matching product from a search result. searchProductsByTitle does
 * a wildcard title search, so we may get multiple hits — prefer exact title
 * match, else the first result.
 */
function pickProduct(products: ShopifyProduct[], nameShopify: string): ShopifyProduct | null {
  if (products.length === 0) return null;
  const target = norm(nameShopify);
  const exact = products.find((p) => norm(p.title) === target);
  if (exact) return exact;
  // Prefer longest common-prefix-ish — fall back to first.
  return products[0];
}

interface DbItem {
  id: string;
  order_id: string;
  color_id: string | null;
  method_name: string | null;
  length_value: string | null;
  color_name: string | null;
  quantity: number;
  unit: string | null;
  pushed_to_shopify_at: string | null;
  shopify_push_qty: number | null;
  shipment_id: string | null;
  product_colors: { name_shopify: string | null } | { name_shopify: string | null }[] | null;
}

function formatDisplay(it: DbItem): string {
  const parts: string[] = [];
  if (it.method_name) parts.push(it.method_name);
  if (it.length_value) parts.push(it.length_value);
  if (it.color_name) parts.push(it.color_name);
  const head = parts.join(" · ") || "—";
  const unit = (it.unit || "").trim() || "Stk";
  return `${head} (${it.quantity} ${unit})`;
}

/**
 * Push selected order_items' quantities to Shopify as positive inventory deltas.
 * If shipmentId is given, only items belonging to that Teillieferung are pushed.
 * Otherwise items WITHOUT a shipment_id are pushed (i.e. "der Rest").
 *
 * Returns a per-item report; UI shows it in a modal.
 */
export async function pushOrderItemsToShopify(
  orderId: string,
  shipmentId: string | null,
): Promise<PushReport> {
  try {
    const profile = await requireProfile();
    const supabase = await createClient();

    // Verify access to this order. RLS will already block suppliers from other
    // orders, but we read first so we can return a clean error.
    const { data: order, error: ordErr } = await supabase
      .from("orders")
      .select("id, label")
      .eq("id", orderId)
      .single();
    if (ordErr || !order) {
      return {
        ok: false,
        results: [],
        summary: { total: 0, succeeded: 0, failed: 0, skipped: 0 },
        error: "Bestellung nicht gefunden",
      };
    }

    // Load items + their Shopify name mapping.
    let q = supabase
      .from("order_items")
      .select(
        "id, order_id, color_id, method_name, length_value, color_name, quantity, unit, pushed_to_shopify_at, shopify_push_qty, shipment_id, product_colors:color_id ( name_shopify )",
      )
      .eq("order_id", orderId);
    if (shipmentId) {
      q = q.eq("shipment_id", shipmentId);
    } else {
      q = q.is("shipment_id", null);
    }
    const { data: itemsRaw, error: itemsErr } = await q;
    if (itemsErr) {
      return {
        ok: false,
        results: [],
        summary: { total: 0, succeeded: 0, failed: 0, skipped: 0 },
        error: itemsErr.message,
      };
    }
    const items = (itemsRaw ?? []) as DbItem[];

    const results: PushItemResult[] = [];

    for (const it of items) {
      const pc = Array.isArray(it.product_colors) ? it.product_colors[0] : it.product_colors;
      const nameShopify = pc?.name_shopify ?? null;
      const display = formatDisplay(it);
      const qty = Number(it.quantity || 0);

      const base = {
        item_id: it.id,
        display,
        qty,
        already_pushed_at: it.pushed_to_shopify_at,
        already_pushed_qty: it.shopify_push_qty,
      };

      if (!nameShopify) {
        results.push({ ...base, status: "no_mapping" });
        continue;
      }
      if (qty <= 0) {
        results.push({ ...base, status: "error", error: "Menge ≤ 0" });
        continue;
      }

      // Search Shopify by title.
      let products: ShopifyProduct[] = [];
      try {
        products = await searchProductsByTitle(nameShopify);
      } catch (e) {
        results.push({
          ...base,
          status: "error",
          error: e instanceof Error ? e.message : String(e),
        });
        continue;
      }

      const product = pickProduct(products, nameShopify);
      if (!product) {
        results.push({ ...base, status: "product_not_found" });
        continue;
      }

      const variant = pickVariant(product, it.method_name, it.length_value);
      if (!variant) {
        results.push({
          ...base,
          status: variant === null && product.variants.edges.length > 1 ? "ambiguous_product" : "variant_not_found",
          shopify_product: product.title,
        });
        continue;
      }

      // Adjust inventory.
      const res = await adjustShopifyInventoryByItemId(
        variant.inventoryItem.id,
        qty,
        "received",
      );
      if (!res.ok) {
        results.push({
          ...base,
          status: "error",
          shopify_product: product.title,
          shopify_variant: variant.title,
          error: res.error,
        });
        continue;
      }

      // Stamp the item.
      const nowIso = new Date().toISOString();
      await supabase
        .from("order_items")
        .update({ pushed_to_shopify_at: nowIso, shopify_push_qty: qty })
        .eq("id", it.id);

      results.push({
        ...base,
        status: "ok",
        shopify_product: product.title,
        shopify_variant: variant.title,
      });
    }

    const succeeded = results.filter((r) => r.status === "ok").length;
    const failed = results.filter((r) =>
      ["error", "product_not_found", "variant_not_found", "ambiguous_product"].includes(r.status),
    ).length;
    const skipped = results.filter((r) => r.status === "no_mapping").length;

    // Audit-log to order_events.
    await supabase.from("order_events").insert({
      order_id: orderId,
      event_type: "shopify_push",
      message: shipmentId
        ? `Teillieferung in Shopify eingepflegt: ${succeeded}/${results.length} ok, ${failed} fehlgeschlagen, ${skipped} ohne Mapping`
        : `Bestellung in Shopify eingepflegt: ${succeeded}/${results.length} ok, ${failed} fehlgeschlagen, ${skipped} ohne Mapping`,
      actor_id: profile.id,
    });

    revalidatePath(`/orders/${orderId}`);

    return {
      ok: failed === 0,
      results,
      summary: { total: results.length, succeeded, failed, skipped },
    };
  } catch (e) {
    return {
      ok: false,
      results: [],
      summary: { total: 0, succeeded: 0, failed: 0, skipped: 0 },
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

/**
 * Preview: returns the items that WOULD be pushed (with their already-pushed
 * status) so the UI confirmation modal can show a clear table before the user
 * commits. No Shopify calls — DB-only.
 */
export async function previewShopifyPush(
  orderId: string,
  shipmentId: string | null,
): Promise<{ items: PushItemResult[]; error?: string }> {
  try {
    await requireProfile();
    const supabase = await createClient();
    let q = supabase
      .from("order_items")
      .select(
        "id, order_id, color_id, method_name, length_value, color_name, quantity, unit, pushed_to_shopify_at, shopify_push_qty, shipment_id, product_colors:color_id ( name_shopify )",
      )
      .eq("order_id", orderId);
    if (shipmentId) {
      q = q.eq("shipment_id", shipmentId);
    } else {
      q = q.is("shipment_id", null);
    }
    const { data, error } = await q;
    if (error) return { items: [], error: error.message };
    const items = (data ?? []) as DbItem[];
    return {
      items: items.map((it) => {
        const pc = Array.isArray(it.product_colors) ? it.product_colors[0] : it.product_colors;
        return {
          item_id: it.id,
          display: formatDisplay(it),
          qty: Number(it.quantity || 0),
          status: pc?.name_shopify ? "ok" : "no_mapping",
          already_pushed_at: it.pushed_to_shopify_at,
          already_pushed_qty: it.shopify_push_qty,
        };
      }),
    };
  } catch (e) {
    return { items: [], error: e instanceof Error ? e.message : String(e) };
  }
}
