"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin, requireProfile } from "@/lib/auth";
import { fetchReturns, fetchOrdersWithRefunds, fetchMonthlyRevenue, fetchMonthlyCollectionSales, pickPrimaryCollection, refineCollection, type ShopifyOrder } from "@/lib/shopify";
import { readRetourenSheet, type SheetRow } from "@/lib/returns-sheet";

// Convert a UTC ISO timestamp to YYYY-MM-DD in Europe/Berlin timezone.
// Shopify timestamps are UTC, but refunds/orders happening at e.g. 00:30 local time
// would be the previous UTC day if we just split on "T". This matches Shopify's UI.
function toBerlinDate(iso: string | null | undefined): string {
  if (!iso) return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
  return new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
}

function extractCustomerName(order: ShopifyOrder): string {
  // 1. Customer displayName (best)
  if (order.customer?.displayName?.trim()) return order.customer.displayName.trim();
  // 2. Customer first + last
  if (order.customer) {
    const full = `${order.customer.firstName ?? ""} ${order.customer.lastName ?? ""}`.trim();
    if (full) return full;
  }
  // 3. Shipping address name
  if (order.shippingAddress?.name?.trim()) return order.shippingAddress.name.trim();
  if (order.shippingAddress) {
    const full = `${order.shippingAddress.firstName ?? ""} ${order.shippingAddress.lastName ?? ""}`.trim();
    if (full) return full;
  }
  // 4. Billing address name
  if (order.billingAddress?.name?.trim()) return order.billingAddress.name.trim();
  if (order.billingAddress) {
    const full = `${order.billingAddress.firstName ?? ""} ${order.billingAddress.lastName ?? ""}`.trim();
    if (full) return full;
  }
  // 5. Last resort: generic placeholder
  return "Gast";
}

const str = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  return s || null;
};
const num = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};

async function logReturnEvent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  returnId: string,
  actorId: string | null,
  eventType: string,
  message: string,
) {
  await supabase
    .from("return_events")
    .insert({ return_id: returnId, event_type: eventType, message, actor_id: actorId });
}

// ── Create ─────────────────────────────────────────────────────

export async function createReturn(_prev: unknown, formData: FormData) {
  const profile = await requireAdmin();
  const supabase = await createClient();

  const customerName = str(formData.get("customer_name"));
  if (!customerName) return { error: "Kundenname ist erforderlich" };

  const returnType = str(formData.get("return_type")) ?? "return";
  const reason = str(formData.get("reason"));
  const handler = str(formData.get("handler"));
  const orderNumber = str(formData.get("order_number"));
  const notes = str(formData.get("notes"));
  const initiatedAt = str(formData.get("initiated_at"));
  const refundAmount = num(formData.get("refund_amount"));
  const status = str(formData.get("status")) ?? "open";

  // Reklamation-specific fields
  const resolution = str(formData.get("resolution"));
  const resolutionResult = str(formData.get("resolution_result"));

  const { data, error } = await supabase
    .from("returns")
    .insert({
      customer_name: customerName,
      return_type: returnType,
      reason,
      handler,
      order_number: orderNumber,
      notes,
      initiated_at: initiatedAt,
      refund_amount: refundAmount,
      status,
      resolution,
      resolution_result: resolutionResult,
      created_by: profile.id,
    })
    .select("id")
    .single();

  if (error) return { error: error.message };

  // Parse items from form (dynamic rows: item_0_product_type, item_1_product_type, ...)
  let i = 0;
  while (formData.has(`item_${i}_product_type`) || formData.has(`item_${i}_color`)) {
    const productType = str(formData.get(`item_${i}_product_type`));
    const color = str(formData.get(`item_${i}_color`));
    const length = str(formData.get(`item_${i}_length`));
    const origin = str(formData.get(`item_${i}_origin`));
    const weight = str(formData.get(`item_${i}_weight`));
    const quality = str(formData.get(`item_${i}_quality`));
    const exchangeProduct = str(formData.get(`item_${i}_exchange_product`));
    const exchangeWeight = str(formData.get(`item_${i}_exchange_weight`));
    const exchangeTracking = str(formData.get(`item_${i}_exchange_tracking`));

    if (productType || color) {
      await supabase.from("return_items").insert({
        return_id: data.id,
        product_type: productType,
        color,
        length,
        origin,
        weight,
        quality,
        exchange_product: exchangeProduct,
        exchange_weight: exchangeWeight,
        exchange_tracking: exchangeTracking,
      });
    }
    i++;
  }

  await logReturnEvent(supabase, data.id, profile.id, "created", `Retoure erstellt (${returnType})`);
  revalidatePath("/returns");
  return { ok: true, id: data.id };
}

// ── Update ─────────────────────────────────────────────────────

export async function updateReturn(returnId: string, formData: FormData) {
  const profile = await requireAdmin();
  const supabase = await createClient();

  const updates: Record<string, unknown> = {};
  const fields = [
    "customer_name", "return_type", "reason", "status", "handler",
    "order_number", "notes", "resolution", "resolution_result", "initiated_at",
  ];

  for (const f of fields) {
    if (formData.has(f)) updates[f] = str(formData.get(f));
  }
  if (formData.has("refund_amount")) updates.refund_amount = num(formData.get("refund_amount"));

  const oldStatus = str(formData.get("_old_status"));
  const newStatus = str(formData.get("status"));

  if (newStatus === "resolved" && !updates.resolved_at) {
    updates.resolved_at = new Date().toISOString();
  }

  const { error } = await supabase.from("returns").update(updates).eq("id", returnId);
  if (error) return { error: error.message };

  if (oldStatus && newStatus && oldStatus !== newStatus) {
    await logReturnEvent(supabase, returnId, profile.id, "status_change", `Status: ${oldStatus} → ${newStatus}`);
  }

  revalidatePath("/returns");
  return { ok: true };
}

// ── Delete ─────────────────────────────────────────────────────

export async function deleteReturn(returnId: string) {
  await requireAdmin();
  const supabase = await createClient();

  // Cascade deletes items and events
  const { error } = await supabase.from("returns").delete().eq("id", returnId);
  if (error) return { error: error.message };

  revalidatePath("/returns");
  return { ok: true };
}

// ── Add / Remove Items ─────────────────────────────────────────

export async function addReturnItem(returnId: string, formData: FormData) {
  await requireAdmin();
  const supabase = await createClient();

  const { error } = await supabase.from("return_items").insert({
    return_id: returnId,
    product_type: str(formData.get("product_type")),
    color: str(formData.get("color")),
    length: str(formData.get("length")),
    origin: str(formData.get("origin")),
    weight: str(formData.get("weight")),
    quality: str(formData.get("quality")),
    exchange_product: str(formData.get("exchange_product")),
    exchange_weight: str(formData.get("exchange_weight")),
    exchange_tracking: str(formData.get("exchange_tracking")),
  });

  if (error) return { error: error.message };
  revalidatePath("/returns");
  return { ok: true };
}

export async function removeReturnItem(itemId: string) {
  await requireAdmin();
  const supabase = await createClient();

  const { error } = await supabase.from("return_items").delete().eq("id", itemId);
  if (error) return { error: error.message };
  revalidatePath("/returns");
  return { ok: true };
}

// ── Shopify Sync ───────────────────────────────────────────────

const SHOPIFY_REASON_MAP: Record<string, string> = {
  COLOR: "farbe_nicht_gepasst",
  DEFECTIVE: "sonstiges",
  NOT_AS_DESCRIBED: "falsche_farbe",
  WRONG_ITEM: "falsche_farbe",
  STYLE: "nicht_mehr_gefallen",
  OTHER: "sonstiges",
  UNKNOWN: "ohne_grundangabe",
  SIZE_TOO_LARGE: "sonstiges",
  SIZE_TOO_SMALL: "sonstiges",
};

export interface SyncReport {
  ok?: boolean;
  error?: string;
  synced: number;
  skipped: number;
  updated?: number;
  shopifyReturnsFound: number;
  refundedOrdersFound: number;
  totalRefundAmount: number;
}

export async function syncReturnsFromShopify(fromDate?: string, toDate?: string): Promise<SyncReport> {
  const profile = await requireAdmin();
  const supabase = await createClient();

  const report: SyncReport = {
    synced: 0,
    skipped: 0,
    shopifyReturnsFound: 0,
    refundedOrdersFound: 0,
    totalRefundAmount: 0,
  };

  // Default: last 3 months
  const defaultFrom = new Date();
  defaultFrom.setMonth(defaultFrom.getMonth() - 3);
  const sinceDate = fromDate || defaultFrom.toISOString().split("T")[0];

  try {
    // 1. Sync Shopify Returns API
    const shopifyReturns = await fetchReturns(100);
    report.shopifyReturnsFound = shopifyReturns.length;

    for (const sr of shopifyReturns) {
      const shopifyReturnId = sr.id;
      const orderName = sr.order?.name ?? null;

      // Check if already exists
      const { data: existing } = await supabase
        .from("returns")
        .select("id")
        .eq("shopify_return_id", shopifyReturnId)
        .maybeSingle();

      if (existing) { report.skipped++; continue; }

      const lineItems = sr.returnLineItems.edges.map((e) => e.node);
      const firstReason = lineItems[0]?.returnReason;
      const reason = firstReason ? (SHOPIFY_REASON_MAP[firstReason] ?? "sonstiges") : null;

      const { data: newReturn } = await supabase
        .from("returns")
        .insert({
          shopify_return_id: shopifyReturnId,
          shopify_order_id: sr.order?.id ?? null,
          order_number: orderName,
          customer_name: orderName ?? "Shopify-Kunde",
          return_type: "return",
          reason,
          status: sr.status === "CLOSED" ? "resolved" : "open",
          initiated_at: toBerlinDate(new Date().toISOString()),
          created_by: profile.id,
        })
        .select("id")
        .single();

      if (newReturn) {
        for (const li of lineItems) {
          const lineItem = li.fulfillmentLineItem?.lineItem;
          const title = lineItem?.title ?? "";
          const variantTitle = lineItem?.variant?.title ?? "";
          const qty = li.quantity ?? 1;
          // Returns API gives unit price × qty. originalUnitPriceSet is tax-inclusive
          // in DE stores, so we divide by 1.19 to get net (to match Gross Sales basis).
          const unitPrice = parseFloat(lineItem?.originalUnitPriceSet?.shopMoney?.amount ?? "0") || 0;
          const grossSubtotal = Number(((unitPrice * qty) / 1.19).toFixed(2));
          const collections = lineItem?.product?.collections?.edges?.map((e) => e.node);
          const primary = pickPrimaryCollection(collections);
          const refined = refineCollection(primary?.title ?? null, title);
          await supabase.from("return_items").insert({
            return_id: newReturn.id,
            product_type: title,
            color: variantTitle,
            quantity: qty,
            refund_amount: grossSubtotal,
            collection_title: refined ?? primary?.title ?? null,
          });
        }
        await logReturnEvent(supabase, newReturn.id, profile.id, "shopify_sync", `Importiert von Shopify (${shopifyReturnId})`);
        report.synced++;
      }
    }

    // 2. Sync refunded orders — per-refund now (not per-order) so partial refunds
    //    on the same order create separate return rows.
    const refundedOrders = await fetchOrdersWithRefunds(sinceDate, toDate);
    report.refundedOrdersFound = refundedOrders.length;

    for (const { order, refunds } of refundedOrders) {
      if (refunds.length === 0) continue;

      const customerNameFromShopify = extractCustomerName(order);

      // Find all existing returns for this order (to update missing fields + handle legacy
      // returns that lack shopify_refund_id)
      const { data: existingForOrder } = await supabase
        .from("returns")
        .select("id, customer_name, shopify_order_id, shopify_refund_id, order_number")
        .or(`shopify_order_id.eq.${order.id},order_number.eq.${order.name ?? ""}`);
      const existingList = existingForOrder ?? [];

      // Legacy returns (no refund_id yet) get claimed by the first refund to avoid duplication
      const unclaimed = existingList.filter((r) => !r.shopify_refund_id);

      // Sort refunds by createdAt ASC so oldest refund claims legacy rows first
      const sortedRefunds = [...refunds].sort((a, b) => (a.createdAt ?? "").localeCompare(b.createdAt ?? ""));

      for (const refund of sortedRefunds) {
        // Skip if this exact refund already imported
        const matchedByRefund = existingList.find((r) => r.shopify_refund_id === refund.id);
        if (matchedByRefund) {
          report.skipped++;
          continue;
        }

        const refundTotal = parseFloat(refund.totalRefundedSet?.shopMoney?.amount ?? "0") || 0;
        report.totalRefundAmount += refundTotal;
        const initiatedAt = toBerlinDate(refund.createdAt);

        // If we have an unclaimed legacy return row, claim it instead of inserting a new one
        const legacyRow = unclaimed.shift();
        let returnId: string | null = null;

        if (legacyRow) {
          const updates: Record<string, unknown> = {
            shopify_refund_id: refund.id,
            shopify_order_id: order.id,
            order_number: order.name,
          };
          // Only overwrite customer name if legacy was placeholder
          const cur = legacyRow.customer_name;
          if ((cur === order.name || cur === "Shopify-Kunde" || cur === "Gast" || !cur)
              && customerNameFromShopify && customerNameFromShopify !== "Gast") {
            updates.customer_name = customerNameFromShopify;
          }
          await supabase.from("returns").update(updates).eq("id", legacyRow.id);
          returnId = legacyRow.id;
          report.updated = (report.updated ?? 0) + 1;
        } else {
          const { data: newReturn } = await supabase
            .from("returns")
            .insert({
              shopify_refund_id: refund.id,
              shopify_order_id: order.id,
              order_number: order.name,
              customer_name: customerNameFromShopify || "Shopify-Kunde",
              return_type: "return",
              reason: "ohne_grundangabe",
              status: "resolved",
              refund_amount: refundTotal,
              initiated_at: initiatedAt,
              resolved_at: refund.createdAt ?? new Date().toISOString(),
              created_by: profile.id,
            })
            .select("id")
            .single();
          if (!newReturn) continue;
          returnId = newReturn.id;
          report.synced++;
        }

        // Insert line items for THIS refund (replace items if we claimed a legacy row so we
        // don't accumulate stale data from the previous aggregation logic)
        if (legacyRow) {
          await supabase.from("return_items").delete().eq("return_id", returnId);
        }
        for (const edge of refund.refundLineItems.edges) {
          const li = edge.node;
          const collections = li.lineItem.product?.collections?.edges?.map((e) => e.node);
          const primary = pickPrimaryCollection(collections);
          const refined = refineCollection(primary?.title ?? null, li.lineItem.title);
          // subtotalSet is TAX-INCLUSIVE in DE stores. Subtract totalTaxSet to get
          // the net refund amount that matches Shopify's gross_sales report basis.
          const subtotalGross = parseFloat(li.subtotalSet?.shopMoney?.amount ?? li.priceSet?.shopMoney?.amount ?? "0") || 0;
          const tax = parseFloat(li.totalTaxSet?.shopMoney?.amount ?? "0") || 0;
          const subtotal = Math.max(0, subtotalGross - tax);
          await supabase.from("return_items").insert({
            return_id: returnId,
            product_type: li.lineItem.title,
            color: li.lineItem.variant?.title ?? null,
            quantity: li.quantity ?? 1,
            refund_amount: subtotal,
            collection_title: refined ?? primary?.title ?? null,
          });
        }
        if (returnId) await logReturnEvent(supabase, returnId, profile.id, "shopify_sync", `Refund ${refund.id} importiert von Shopify (${order.name})`);
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unbekannter Fehler";
    report.error = `Shopify Sync fehlgeschlagen: ${msg}`;
    return report;
  }

  // Also refresh monthly revenue + collection sales using the SAME sync range
  // so the rate denominator aligns with the returns numerator.
  const revenueFrom = fromDate ?? sinceDate;
  const revenueTo = toDate ?? new Date().toISOString().slice(0, 10);
  // Align to first of month
  const revenueFromMonth = revenueFrom.slice(0, 7) + "-01";

  try {
    const monthly = await fetchMonthlyRevenue(revenueFromMonth, revenueTo);
    // Clear stale rows in this window first
    if (monthly.length > 0) {
      const uniqueMonths = Array.from(new Set(monthly.map((r) => r.month)));
      await supabase.from("shopify_monthly_revenue").delete().in("month", uniqueMonths);
    }
    for (const row of monthly) {
      await supabase
        .from("shopify_monthly_revenue")
        .upsert(
          {
            month: row.month,
            gross_revenue: row.revenue,
            order_count: row.orderCount,
            synced_at: new Date().toISOString(),
          },
          { onConflict: "month" },
        );
    }
  } catch {
    // ignore - revenue is non-critical
  }

  // Collection sales (more expensive — fetches line items) with same window.
  // Upsert + cleanup pattern: if the fetch or chunk fails mid-flight, the
  // previous good rows stay intact instead of being deleted.
  try {
    const syncStartedAt = new Date().toISOString();
    const collRows = await fetchMonthlyCollectionSales(revenueFromMonth, revenueTo);
    if (collRows.length > 0) {
      const payload = collRows.map((r) => ({
        month: r.month,
        collection_title: r.collection,
        gross_revenue: r.revenue,
        order_count: r.orderCount,
        item_count: r.itemCount,
        synced_at: syncStartedAt,
      }));
      const chunkSize = 500;
      for (let i = 0; i < payload.length; i += chunkSize) {
        const chunk = payload.slice(i, i + chunkSize);
        const { error } = await supabase
          .from("shopify_collection_sales")
          .upsert(chunk, { onConflict: "month,collection_title" });
        if (error) throw error;
      }
      const uniqueMonths = Array.from(new Set(collRows.map((r) => r.month)));
      await supabase
        .from("shopify_collection_sales")
        .delete()
        .in("month", uniqueMonths)
        .lt("synced_at", syncStartedAt);
    }
  } catch {
    // ignore - collection sales is non-critical
  }

  revalidatePath("/returns");
  revalidatePath("/returns/analytics");
  report.ok = true;
  return report;
}

// ── Sync monthly collection sales from Shopify ────────────────

export async function syncShopifyCollectionSales(
  fromDate?: string,
  toDate?: string,
): Promise<{ synced: number; error?: string; fromDate: string; toDate: string }> {
  await requireAdmin();
  const supabase = await createClient();

  // Default: align with earliest return in DB so rate denominator matches numerator window
  let effectiveFrom = fromDate;
  if (!effectiveFrom) {
    const { data: oldest } = await supabase
      .from("returns")
      .select("initiated_at")
      .not("initiated_at", "is", null)
      .order("initiated_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (oldest?.initiated_at) {
      // Normalize to first day of that month
      effectiveFrom = String(oldest.initiated_at).slice(0, 7) + "-01";
    } else {
      // Fallback: 12 months back from today
      const d = new Date();
      d.setMonth(d.getMonth() - 12);
      effectiveFrom = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
    }
  }
  const effectiveTo = toDate ?? new Date().toISOString().slice(0, 10);

  const syncStartedAt = new Date().toISOString();

  try {
    // 1. Fetch EVERYTHING into memory first. If the Shopify fetch fails
    //    (timeout, rate limit) we bail out without touching existing rows.
    const rows = await fetchMonthlyCollectionSales(effectiveFrom, effectiveTo);
    if (rows.length === 0) {
      return { synced: 0, fromDate: effectiveFrom, toDate: effectiveTo };
    }

    // 2. Upsert instead of delete+insert. Primary key (month, collection_title)
    //    makes this safe to retry. If the insert chunk aborts mid-flight,
    //    previously upserted rows remain current and the still-old rows keep
    //    their older synced_at — no data loss.
    const payload = rows.map((r) => ({
      month: r.month,
      collection_title: r.collection,
      gross_revenue: r.revenue,
      order_count: r.orderCount,
      item_count: r.itemCount,
      synced_at: syncStartedAt,
    }));
    const chunkSize = 500;
    for (let i = 0; i < payload.length; i += chunkSize) {
      const chunk = payload.slice(i, i + chunkSize);
      const { error } = await supabase
        .from("shopify_collection_sales")
        .upsert(chunk, { onConflict: "month,collection_title" });
      if (error) throw error;
    }

    // 3. Only after ALL chunks succeeded, clean up stale rows (collections
    //    that no longer appear in the period). These would have a synced_at
    //    older than this run.
    const uniqueMonths = Array.from(new Set(rows.map((r) => r.month)));
    await supabase
      .from("shopify_collection_sales")
      .delete()
      .in("month", uniqueMonths)
      .lt("synced_at", syncStartedAt);

    revalidatePath("/returns");
    revalidatePath("/returns/analytics");
    return { synced: rows.length, fromDate: effectiveFrom, toDate: effectiveTo };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unbekannter Fehler";
    return { synced: 0, error: msg, fromDate: effectiveFrom, toDate: effectiveTo };
  }
}

// ── Sync monthly revenue from Shopify ─────────────────────────

export async function syncShopifyRevenue(months = 12): Promise<{ synced: number; error?: string }> {
  await requireAdmin();
  const supabase = await createClient();

  try {
    const monthly = await fetchMonthlyRevenue(months);

    for (const row of monthly) {
      await supabase
        .from("shopify_monthly_revenue")
        .upsert(
          {
            month: row.month,
            gross_revenue: row.revenue,
            order_count: row.orderCount,
            synced_at: new Date().toISOString(),
          },
          { onConflict: "month" },
        );
    }

    revalidatePath("/returns");
    revalidatePath("/returns/analytics");
    return { synced: monthly.length };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unbekannter Fehler";
    return { synced: 0, error: msg };
  }
}

// ── Refine collection_title using product_type (no Shopify call) ──

export async function refineStoredCollections(): Promise<{ updatedReturns: number; updatedSales: number; error?: string }> {
  await requireAdmin();
  const supabase = await createClient();

  let updatedReturns = 0;
  let updatedSales = 0;

  try {
    // 1. Refine return_items based on their product_type
    let from = 0;
    const pageSize = 1000;
    while (from < 100000) {
      const { data } = await supabase
        .from("return_items")
        .select("id, product_type, collection_title")
        .not("product_type", "is", null)
        .range(from, from + pageSize - 1);
      if (!data || data.length === 0) break;

      for (const row of data) {
        const refined = refineCollection(row.collection_title, row.product_type);
        if (refined && refined !== row.collection_title) {
          await supabase.from("return_items").update({ collection_title: refined }).eq("id", row.id);
          updatedReturns++;
        }
      }
      if (data.length < pageSize) break;
      from += pageSize;
    }

    // 2. Re-aggregate shopify_collection_sales: we can't easily refine without
    //    product_title, which isn't stored per sales row. So we'd need to re-sync.
    //    Mark that sales re-sync is needed.

    revalidatePath("/returns");
    revalidatePath("/returns/analytics");
    return { updatedReturns, updatedSales };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unbekannter Fehler";
    return { updatedReturns, updatedSales, error: msg };
  }
}

// ── Backfill collection_title for existing return_items ───────

export async function backfillReturnCollections(): Promise<{ updated: number; error?: string }> {
  await requireAdmin();
  const supabase = await createClient();

  try {
    // 1. Get all orders referenced by returns (with shopify_order_id) that have at least one return_item missing collection_title
    const { data: candidateReturns } = await supabase
      .from("returns")
      .select("id, shopify_order_id")
      .not("shopify_order_id", "is", null)
      .limit(5000);

    if (!candidateReturns || candidateReturns.length === 0) return { updated: 0 };

    // 2. Re-fetch from Shopify covering full span
    const { data: oldest } = await supabase
      .from("returns")
      .select("initiated_at")
      .not("shopify_order_id", "is", null)
      .order("initiated_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    if (!oldest?.initiated_at) return { updated: 0 };

    const orders = await fetchOrdersWithRefunds(oldest.initiated_at);

    // Build map: shopify_order_id -> line items with collection info
    const orderCollections = new Map<string, { title: string; variant: string | null; collection: string | null }[]>();
    for (const { order, refunds } of orders) {
      const items: { title: string; variant: string | null; collection: string | null }[] = [];
      for (const refund of refunds) {
        for (const edge of refund.refundLineItems.edges) {
          const li = edge.node;
          const collections = li.lineItem.product?.collections?.edges?.map((e) => e.node);
          const primary = pickPrimaryCollection(collections);
          items.push({
            title: li.lineItem.title,
            variant: li.lineItem.variant?.title ?? null,
            collection: primary?.title ?? null,
          });
        }
      }
      orderCollections.set(order.id, items);
    }

    let updated = 0;
    for (const ret of candidateReturns) {
      if (!ret.shopify_order_id) continue;
      const shopifyItems = orderCollections.get(ret.shopify_order_id);
      if (!shopifyItems || shopifyItems.length === 0) continue;

      const { data: dbItems } = await supabase
        .from("return_items")
        .select("id, product_type, collection_title")
        .eq("return_id", ret.id);

      if (!dbItems) continue;
      for (const dbItem of dbItems) {
        if (dbItem.collection_title) continue; // skip already set
        // Match by product title
        const match = shopifyItems.find((s) => s.title === dbItem.product_type);
        if (match?.collection) {
          await supabase
            .from("return_items")
            .update({ collection_title: match.collection })
            .eq("id", dbItem.id);
          updated++;
        }
      }
    }

    revalidatePath("/returns");
    revalidatePath("/returns/analytics");
    return { updated };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unbekannter Fehler";
    return { updated: 0, error: msg };
  }
}

// ── Backfill customer names from Shopify ─────────────────────

export async function backfillCustomerNames(): Promise<{ updated: number; error?: string }> {
  await requireAdmin();
  const supabase = await createClient();

  // Find returns where customer_name equals order_number (clearly wrong)
  const { data: candidates } = await supabase
    .from("returns")
    .select("id, order_number, shopify_order_id, customer_name")
    .not("shopify_order_id", "is", null)
    .limit(500);

  if (!candidates || candidates.length === 0) return { updated: 0 };

  let updated = 0;

  try {
    // Re-fetch from Shopify using date range that covers all imports
    const { data: oldest } = await supabase
      .from("returns")
      .select("initiated_at")
      .not("shopify_order_id", "is", null)
      .order("initiated_at", { ascending: true })
      .limit(1)
      .maybeSingle();

    if (!oldest?.initiated_at) return { updated: 0 };

    const orders = await fetchOrdersWithRefunds(oldest.initiated_at);

    // Build map: order_gid -> Shopify order
    const orderByGid = new Map<string, ShopifyOrder>();
    for (const { order } of orders) {
      orderByGid.set(order.id, order);
    }

    for (const c of candidates) {
      if (!c.shopify_order_id) continue;
      // Only update if current name looks wrong (is just the order number or "Shopify-Kunde" or "Gast")
      const looksWrong =
        c.customer_name === c.order_number ||
        c.customer_name === "Shopify-Kunde" ||
        c.customer_name === "Gast";
      if (!looksWrong) continue;

      const shopifyOrder = orderByGid.get(c.shopify_order_id);
      if (!shopifyOrder) continue;

      const name = extractCustomerName(shopifyOrder);
      if (name && name !== "Gast" && name !== c.customer_name) {
        await supabase.from("returns").update({ customer_name: name }).eq("id", c.id);
        updated++;
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unbekannter Fehler";
    return { updated, error: msg };
  }

  revalidatePath("/returns");
  return { updated };
}

// ── Import from Retouren Google Sheet ─────────────────────────

export interface SheetImportReport {
  ok?: boolean;
  error?: string;
  rowsRead: number;
  inserted: number;
  updated: number;
  skipped: number;
  byType: { return: number; exchange: number; complaint: number };
}

function sheetRowIsEmpty(r: SheetRow): boolean {
  return !r.orderNumber && !r.customerName && !r.reason && !r.products;
}

export async function importFromRetourenSheet(): Promise<SheetImportReport> {
  const profile = await requireAdmin();
  const supabase = await createClient();

  const report: SheetImportReport = {
    rowsRead: 0,
    inserted: 0,
    updated: 0,
    skipped: 0,
    byType: { return: 0, exchange: 0, complaint: 0 },
  };

  const result = await readRetourenSheet();
  if ("error" in result) {
    report.error = result.error;
    return report;
  }

  const rows = result.rows.filter((r) => !sheetRowIsEmpty(r));
  report.rowsRead = rows.length;

  // Pre-load existing returns to speed up matching
  // Paginate to get ALL existing returns
  const existingByOrder = new Map<string, { id: string; customer_name: string | null; handler: string | null; reason: string | null; notes: string | null; return_type: string; resolution: string | null; resolution_result: string | null; status: string }>();
  {
    let from = 0;
    const pageSize = 1000;
    while (from < 50000) {
      const { data, error } = await supabase
        .from("returns")
        .select("id, order_number, customer_name, handler, reason, notes, return_type, resolution, resolution_result, status")
        .not("order_number", "is", null)
        .range(from, from + pageSize - 1);
      if (error || !data || data.length === 0) break;
      for (const r of data) {
        if (r.order_number) existingByOrder.set(r.order_number, { id: r.id, customer_name: r.customer_name, handler: r.handler, reason: r.reason, notes: r.notes, return_type: r.return_type, resolution: r.resolution, resolution_result: r.resolution_result, status: r.status });
      }
      if (data.length < pageSize) break;
      from += pageSize;
    }
  }

  for (const row of rows) {
    report.byType[row.type]++;

    const existing = row.orderNumber ? existingByOrder.get(row.orderNumber) : undefined;

    if (existing) {
      // Build update — only overwrite fields that are currently empty or clearly wrong.
      const updates: Record<string, unknown> = {};

      // Reason — always prefer sheet's normalized reason over Shopify's generic
      if (row.reasonCode && row.reasonCode !== existing.reason) {
        updates.reason = row.reasonCode;
      }
      // Handler
      if (row.handler && !existing.handler) {
        updates.handler = row.handler;
      }
      // Customer name (replace placeholder)
      if (row.customerName && (!existing.customer_name || existing.customer_name === row.orderNumber || existing.customer_name === "Gast" || existing.customer_name === "Shopify-Kunde")) {
        updates.customer_name = row.customerName;
      }
      // Type upgrade: if sheet says exchange/complaint, override
      if (row.type !== "return" && existing.return_type === "return") {
        updates.return_type = row.type;
      }
      // Notes
      if (row.notes && !existing.notes) {
        updates.notes = row.notes;
      }
      // Complaint resolution fields
      if (row.type === "complaint") {
        if (row.resolution && !existing.resolution) updates.resolution = row.resolution;
        if (row.resolutionResult && !existing.resolution_result) updates.resolution_result = row.resolutionResult;
      }
      // Status
      if (row.status && existing.status === "open") {
        updates.status = row.status;
      }

      if (Object.keys(updates).length > 0) {
        await supabase.from("returns").update(updates).eq("id", existing.id);
        report.updated++;
      } else {
        report.skipped++;
      }

      // For exchanges: add exchange info to existing items if empty
      if (row.type === "exchange" && (row.exchangeProduct || row.exchangeTracking)) {
        const { data: items } = await supabase
          .from("return_items")
          .select("id, exchange_product, exchange_tracking")
          .eq("return_id", existing.id)
          .limit(1);
        if (items && items[0]) {
          const item = items[0];
          const itemUpdates: Record<string, unknown> = {};
          if (row.exchangeProduct && !item.exchange_product) itemUpdates.exchange_product = row.exchangeProduct;
          if (row.exchangeWeight) itemUpdates.exchange_weight = row.exchangeWeight;
          if (row.exchangeTracking && !item.exchange_tracking) itemUpdates.exchange_tracking = row.exchangeTracking;
          if (Object.keys(itemUpdates).length > 0) {
            await supabase.from("return_items").update(itemUpdates).eq("id", item.id);
          }
        }
      }
    } else {
      // Insert new return
      const initiatedAt = row.date ?? `${row.year}-${String(row.month).padStart(2, "0")}-01`;
      const { data: newReturn } = await supabase
        .from("returns")
        .insert({
          order_number: row.orderNumber,
          customer_name: row.customerName ?? "Gast",
          return_type: row.type,
          reason: row.reasonCode,
          status: row.status ?? "resolved", // sheet rows are mostly completed
          handler: row.handler,
          notes: row.notes,
          resolution: row.resolution,
          resolution_result: row.resolutionResult,
          initiated_at: initiatedAt,
          resolved_at: row.status === "resolved" ? new Date(initiatedAt).toISOString() : null,
          created_by: profile.id,
        })
        .select("id")
        .single();

      if (newReturn) {
        await supabase.from("return_items").insert({
          return_id: newReturn.id,
          product_type: row.productType,
          color: row.products,
          length: row.length,
          origin: row.origin,
          weight: row.weight,
          quality: row.quality,
          exchange_product: row.exchangeProduct,
          exchange_weight: row.exchangeWeight,
          exchange_tracking: row.exchangeTracking,
        });
        if (row.orderNumber) {
          existingByOrder.set(row.orderNumber, { id: newReturn.id, customer_name: row.customerName, handler: row.handler, reason: row.reasonCode, notes: row.notes, return_type: row.type, resolution: row.resolution, resolution_result: row.resolutionResult, status: row.status ?? "resolved" });
        }
        report.inserted++;
      }
    }
  }

  revalidatePath("/returns");
  revalidatePath("/returns/analytics");
  report.ok = true;
  return report;
}
