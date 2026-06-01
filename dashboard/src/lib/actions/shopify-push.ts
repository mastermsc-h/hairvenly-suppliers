"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import {
  searchProductsByTitle,
  adjustShopifyInventoryByItemId,
  shopifyGraphQL,
  type ShopifyProduct,
  type ShopifyVariant,
} from "@/lib/shopify";

export type PushItemStatus =
  | "ok"
  | "no_mapping"
  | "missing_conversion"
  | "product_not_found"
  | "variant_not_found"
  | "ambiguous_product"
  | "error";

export interface PushItemResult {
  item_id: string;
  display: string; // human-readable line: "Tape · 50cm · #1B"
  grams: number;
  pieces: number | null;
  grams_per_piece: number | null;
  status: PushItemStatus;
  shopify_product?: string;
  shopify_variant?: string;
  shopify_url?: string | null;
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
 * Gramm pro Stück je Methode (vom User vorgegeben).
 *
 *   Bondings:       25 g/Strand
 *   Standard Tapes: 25 g/Tape
 *   Minitapes:      50 g/Tape
 *   Classic Weft:   50 g/Tresse
 *   Invisible Weft: 50 g/Tresse
 *   Clip-Ins:       length_value = Packungsgröße (100g/150g/225g) → 1 Stück = length_value
 *   Tapes (Aria):   25 g/Tape  (analog Standard Tapes)
 *
 * Gibt null zurück, wenn keine Umrechnung hinterlegt — Position wird dann
 * als 'missing_conversion' markiert und NICHT gepusht.
 */
function gramsPerPiece(methodName: string | null, lengthValue: string | null): number | null {
  if (!methodName) return null;
  const m = methodName.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (m === "bondings") return 25;
  if (m === "standardtapes" || m === "tapes") return 25;
  if (m === "minitapes") return 50;
  if (m === "classicweft" || m === "invisibleweft") return 50;
  if (m === "clipins") {
    if (!lengthValue) return null;
    const match = String(lengthValue).match(/(\d+)\s*g/i);
    if (!match) return null;
    const n = Number(match[1]);
    return Number.isFinite(n) && n > 0 ? n : null;
  }
  return null;
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

/**
 * Map our supplier-internal method names to the keyword(s) used in Shopify
 * product titles. Bei Mehrfach-Match (z.B. Tressen) müssen ALLE Keywords im
 * Titel vorkommen, damit der Fallback nicht versehentlich Standard-Tapes für
 * Mini-Tapes erwischt.
 */
function shopifyKeywordsForMethod(methodName: string | null): string[] {
  if (!methodName) return [];
  const m = methodName.toLowerCase().replace(/[^a-z0-9]+/g, "");
  if (m === "bondings") return ["BONDINGS"];
  if (m === "standardtapes") return ["STANDARD", "TAPE"];
  if (m === "tapes") return ["TAPE"];
  if (m === "minitapes") return ["MINI TAPE"];
  if (m === "classicweft") return ["CLASSIC WEFT"];
  if (m === "invisibleweft") return ["INVISIBLE"]; // Invisible Butterfly / Invisible Tressen
  if (m === "clipins") return ["CLIP"];
  return [];
}

/**
 * Token-basierter Fallback wenn die exakte Wildcard-Suche nichts findet
 * (z.B. weil der Katalog "BALAYAGE" enthält das im echten Shopify-Titel
 * fehlt). Sucht über `color_name AND method_keyword` und filtert nachher
 * sicher: ALLE method-keywords müssen im Titel vorkommen.
 */
async function fallbackSearchByTokens(
  cleanColor: string | null,
  methodName: string | null,
): Promise<ShopifyProduct[]> {
  if (!cleanColor) return [];
  const kws = shopifyKeywordsForMethod(methodName);
  const firstKw = kws[0] ?? "";
  const q = firstKw ? `title:*${cleanColor}* AND title:*${firstKw}*` : `title:*${cleanColor}*`;
  const query = `
    query searchProducts($q: String!) {
      products(first: 10, query: $q) {
        edges { node { id title handle variants(first: 50) { edges { node { id title inventoryPolicy inventoryItem { id } } } } } }
      }
    }
  `;
  const res = await shopifyGraphQL<{
    products: { edges: { node: ShopifyProduct }[] };
  }>(query, { q });
  const products = res.data?.products.edges.map((e) => e.node) ?? [];
  // Sicherheits-Filter: ALLE method-keywords müssen im Titel vorkommen.
  // Verhindert false positives wie "STANDARD TAPE" für eine "MINI TAPE"-Position.
  if (kws.length === 0) return products;
  return products.filter((p) => {
    const t = p.title.toUpperCase();
    return kws.every((kw) => t.includes(kw.toUpperCase()));
  });
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
  product_colors:
    | { name_shopify: string | null; shopify_url: string | null }
    | { name_shopify: string | null; shopify_url: string | null }[]
    | null;
}

function formatDisplay(it: DbItem): string {
  const parts: string[] = [];
  if (it.method_name) parts.push(it.method_name);
  if (it.length_value) parts.push(it.length_value);
  if (it.color_name) parts.push(it.color_name);
  return parts.join(" · ") || "—";
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
  itemIds?: string[],
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

    // Load items + their Shopify name + url mapping.
    let q = supabase
      .from("order_items")
      .select(
        "id, order_id, color_id, method_name, length_value, color_name, quantity, unit, pushed_to_shopify_at, shopify_push_qty, shipment_id, product_colors:color_id ( name_shopify, shopify_url )",
      )
      .eq("order_id", orderId);
    if (shipmentId) {
      q = q.eq("shipment_id", shipmentId);
    } else {
      q = q.is("shipment_id", null);
    }
    // Optional explicit allowlist of item IDs (Checkbox-Auswahl im Modal).
    // Verhindert versehentliches Doppel-Einpflegen: nur ausgewählte Items
    // werden tatsächlich gepusht.
    if (itemIds && itemIds.length > 0) {
      q = q.in("id", itemIds);
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

    // Fallback-Lookup für Items ohne color_id (z.B. Wizard hat nicht gematched):
    // Versuche per Methode+Länge+Farbname die richtige product_colors-Zeile zu finden.
    // Verhindert dass solche Items mit "kein Mapping" stehen bleiben obwohl der
    // Katalog die passende Farbe längst kennt.
    const orphanItems = items.filter((it) => !it.color_id);
    const fallbackMapping = new Map<string, { name_shopify: string | null; shopify_url: string | null }>();
    if (orphanItems.length > 0) {
      const { data: catalogRows } = await supabase
        .from("product_colors")
        .select("name_hairvenly, name_supplier, name_shopify, shopify_url, length_id, product_lengths!inner(value, method_id, product_methods!inner(name))");
      type CatalogRow = {
        name_hairvenly: string | null;
        name_supplier: string | null;
        name_shopify: string | null;
        shopify_url: string | null;
        product_lengths: { value: string; product_methods: { name: string } };
      };
      const rows = (catalogRows ?? []) as unknown as CatalogRow[];
      const normalize = (s: string | null) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
      for (const it of orphanItems) {
        if (!it.method_name || !it.color_name) continue;
        const mNorm = normalize(it.method_name);
        const lNorm = normalize(it.length_value);
        const cNorm = normalize(it.color_name);
        // Search: exact method+length match, then color contains (catalog name in item name OR vice versa)
        for (const row of rows) {
          if (normalize(row.product_lengths?.product_methods?.name) !== mNorm) continue;
          if (normalize(row.product_lengths?.value) !== lNorm) continue;
          const hv = normalize(row.name_hairvenly);
          const sup = normalize(row.name_supplier);
          if (!hv && !sup) continue;
          if (
            (hv && (cNorm.startsWith(hv) || hv.startsWith(cNorm) || cNorm.includes(hv))) ||
            (sup && (cNorm.startsWith(sup) || sup.startsWith(cNorm) || cNorm.includes(sup)))
          ) {
            fallbackMapping.set(it.id, { name_shopify: row.name_shopify, shopify_url: row.shopify_url });
            break;
          }
        }
      }
    }

    const results: PushItemResult[] = [];

    // Hole product_colors für die Suche nach sauberen Farbnamen für den
    // Token-Fallback (z.B. wenn name_shopify im Katalog "BALAYAGE" extra hat).
    const colorIdsNeeded = items.map((it) => it.color_id).filter((x): x is string => !!x);
    const cleanNamesByColorId = new Map<string, string>();
    if (colorIdsNeeded.length > 0) {
      const { data: pcRows } = await supabase
        .from("product_colors")
        .select("id, name_hairvenly")
        .in("id", colorIdsNeeded);
      for (const row of (pcRows ?? []) as { id: string; name_hairvenly: string | null }[]) {
        if (row.name_hairvenly) cleanNamesByColorId.set(row.id, row.name_hairvenly);
      }
    }

    for (const it of items) {
      let pc: { name_shopify: string | null; shopify_url: string | null } | null = Array.isArray(it.product_colors) ? it.product_colors[0] : it.product_colors;
      if (!pc?.name_shopify && fallbackMapping.has(it.id)) {
        pc = fallbackMapping.get(it.id)!;
      }
      const nameShopify = pc?.name_shopify ?? null;
      const shopifyUrl = pc?.shopify_url ?? null;
      const cleanColor = it.color_id ? cleanNamesByColorId.get(it.color_id) ?? null : null;
      const display = formatDisplay(it);
      const grams = Number(it.quantity || 0);
      const gPerPiece = gramsPerPiece(it.method_name, it.length_value);
      const pieces = gPerPiece && grams > 0 ? Math.round(grams / gPerPiece) : null;

      const base = {
        item_id: it.id,
        display,
        grams,
        pieces,
        grams_per_piece: gPerPiece,
        shopify_url: shopifyUrl,
        already_pushed_at: it.pushed_to_shopify_at,
        already_pushed_qty: it.shopify_push_qty,
      };

      if (!nameShopify) {
        results.push({ ...base, status: "no_mapping" });
        continue;
      }
      if (grams <= 0) {
        results.push({ ...base, status: "error", error: "Menge ≤ 0" });
        continue;
      }
      if (!gPerPiece || !pieces || pieces <= 0) {
        results.push({ ...base, status: "missing_conversion" });
        continue;
      }

      // Search Shopify by title.
      let products: ShopifyProduct[] = [];
      try {
        products = await searchProductsByTitle(nameShopify);
        // Token-Fallback: wenn die exakte Wildcard-Suche nichts findet
        // (z.B. Katalog hat "BALAYAGE" extra, oder Shopify-Titel hat sich
        // geändert seit Katalog-Pflege), versuche es mit (Farbe + Methode).
        if (products.length === 0 && cleanColor) {
          products = await fallbackSearchByTokens(cleanColor, it.method_name);
        }
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
          status: product.variants.edges.length > 1 ? "ambiguous_product" : "variant_not_found",
          shopify_product: product.title,
        });
        continue;
      }

      // Adjust inventory by piece count. Wareneingang → name="available"
      // mit reason="received": Shopify bumpt dabei automatisch on_hand UND
      // available um denselben Delta, validiert via Live-Test. name="on_hand"
      // ist bei inventoryAdjustQuantities NICHT erlaubt (Shopify erlaubt nur
      // available/damaged/incoming/quality_control/reserved/safety_stock).
      const res = await adjustShopifyInventoryByItemId(
        variant.inventoryItem.id,
        pieces,
        "received",
        "available",
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

      // Stamp the item (we record the PIECE count that was pushed).
      const nowIso = new Date().toISOString();
      await supabase
        .from("order_items")
        .update({ pushed_to_shopify_at: nowIso, shopify_push_qty: pieces })
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
    const skipped = results.filter((r) =>
      r.status === "no_mapping" || r.status === "missing_conversion",
    ).length;

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
        "id, order_id, color_id, method_name, length_value, color_name, quantity, unit, pushed_to_shopify_at, shopify_push_qty, shipment_id, product_colors:color_id ( name_shopify, shopify_url )",
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

    // Gleicher Fallback wie im echten Push — sonst zeigt das Modal "kein Mapping"
    // obwohl der Push tatsächlich klappen würde.
    const orphanItems = items.filter((it) => !it.color_id);
    const fallbackMapping = new Map<string, { name_shopify: string | null; shopify_url: string | null }>();
    if (orphanItems.length > 0) {
      const { data: catalogRows } = await supabase
        .from("product_colors")
        .select("name_hairvenly, name_supplier, name_shopify, shopify_url, length_id, product_lengths!inner(value, method_id, product_methods!inner(name))");
      type CatalogRow = {
        name_hairvenly: string | null; name_supplier: string | null; name_shopify: string | null; shopify_url: string | null;
        product_lengths: { value: string; product_methods: { name: string } };
      };
      const rows = (catalogRows ?? []) as unknown as CatalogRow[];
      const normalize = (s: string | null) => (s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "");
      for (const it of orphanItems) {
        if (!it.method_name || !it.color_name) continue;
        const mN = normalize(it.method_name), lN = normalize(it.length_value), cN = normalize(it.color_name);
        for (const row of rows) {
          if (normalize(row.product_lengths?.product_methods?.name) !== mN) continue;
          if (normalize(row.product_lengths?.value) !== lN) continue;
          const hv = normalize(row.name_hairvenly), sup = normalize(row.name_supplier);
          if ((hv && (cN.startsWith(hv) || hv.startsWith(cN) || cN.includes(hv))) ||
              (sup && (cN.startsWith(sup) || sup.startsWith(cN) || cN.includes(sup)))) {
            fallbackMapping.set(it.id, { name_shopify: row.name_shopify, shopify_url: row.shopify_url });
            break;
          }
        }
      }
    }

    return {
      items: items.map((it) => {
        let pc: { name_shopify: string | null; shopify_url: string | null } | null = Array.isArray(it.product_colors) ? it.product_colors[0] : it.product_colors;
        if (!pc?.name_shopify && fallbackMapping.has(it.id)) pc = fallbackMapping.get(it.id)!;
        const nameShopify = pc?.name_shopify ?? null;
        const grams = Number(it.quantity || 0);
        const gPerPiece = gramsPerPiece(it.method_name, it.length_value);
        const pieces = gPerPiece && grams > 0 ? Math.round(grams / gPerPiece) : null;
        const status: PushItemStatus = !nameShopify
          ? "no_mapping"
          : !gPerPiece || !pieces
            ? "missing_conversion"
            : "ok";
        return {
          item_id: it.id,
          display: formatDisplay(it),
          grams,
          pieces,
          grams_per_piece: gPerPiece,
          status,
          shopify_url: pc?.shopify_url ?? null,
          already_pushed_at: it.pushed_to_shopify_at,
          already_pushed_qty: it.shopify_push_qty,
        };
      }),
    };
  } catch (e) {
    return { items: [], error: e instanceof Error ? e.message : String(e) };
  }
}
