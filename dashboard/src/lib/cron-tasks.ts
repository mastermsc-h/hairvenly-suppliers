// Headless versions of the sync tasks for cron-driven refreshes.
// Each function takes a supabase service-role client and runs without
// auth context. The user-facing server actions in actions/returns.ts
// keep their own bodies + auth checks; this module is a parallel path
// for scheduled execution.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchOrdersWithRefunds,
  fetchMonthlyCollectionSales,
  fetchMonthlyRevenue,
  pickPrimaryCollection,
  refineCollection,
  shopifyGraphQL,
} from "@/lib/shopify";

// ── Collection sales ──────────────────────────────────────────
export async function cronCollectionSync(
  supabase: SupabaseClient,
): Promise<{ synced: number; error?: string }> {
  try {
    const now = new Date();
    const twelveAgo = new Date(now);
    twelveAgo.setMonth(twelveAgo.getMonth() - 12);
    const fromDate = `${twelveAgo.getFullYear()}-${String(twelveAgo.getMonth() + 1).padStart(2, "0")}-01`;
    const toDate = now.toISOString().slice(0, 10);

    const rows = await fetchMonthlyCollectionSales(fromDate, toDate);
    if (rows.length === 0) return { synced: 0 };

    const syncedAt = new Date().toISOString();
    const payload = rows.map((r) => ({
      month: r.month,
      collection_title: r.collection,
      gross_revenue: r.revenue,
      order_count: r.orderCount,
      item_count: r.itemCount,
      synced_at: syncedAt,
    }));
    for (let i = 0; i < payload.length; i += 500) {
      const { error } = await supabase
        .from("shopify_collection_sales")
        .upsert(payload.slice(i, i + 500), { onConflict: "month,collection_title" });
      if (error) throw error;
    }
    const months = Array.from(new Set(rows.map((r) => r.month)));
    await supabase
      .from("shopify_collection_sales")
      .delete()
      .in("month", months)
      .lt("synced_at", syncedAt);
    return { synced: rows.length };
  } catch (e) {
    return { synced: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Monthly revenue ───────────────────────────────────────────
export async function cronRevenueSync(
  supabase: SupabaseClient,
): Promise<{ synced: number; error?: string }> {
  try {
    const rows = await fetchMonthlyRevenue(12);
    if (rows.length === 0) return { synced: 0 };
    const syncedAt = new Date().toISOString();
    const payload = rows.map((r) => ({
      month: r.month,
      gross_revenue: r.revenue,
      order_count: r.orderCount,
      synced_at: syncedAt,
    }));
    for (let i = 0; i < payload.length; i += 500) {
      const { error } = await supabase
        .from("shopify_monthly_revenue")
        .upsert(payload.slice(i, i + 500), { onConflict: "month" });
      if (error) throw error;
    }
    return { synced: rows.length };
  } catch (e) {
    return { synced: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Refund sync (last 90 days, new refunds only) ──────────────
function toBerlinDate(iso: string | null | undefined): string {
  if (!iso) return new Date().toISOString().slice(0, 10);
  const date = new Date(iso);
  const berlinFmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
  return berlinFmt; // YYYY-MM-DD
}

export async function cronRefundsSync(
  supabase: SupabaseClient,
): Promise<{ synced: number; skipped: number; error?: string }> {
  try {
    const ninety = new Date();
    ninety.setDate(ninety.getDate() - 90);
    const sinceDate = ninety.toISOString().slice(0, 10);
    const refundedOrders = await fetchOrdersWithRefunds(sinceDate);

    let synced = 0;
    let skipped = 0;

    for (const { order, refunds } of refundedOrders) {
      for (const refund of refunds) {
        const { data: existing } = await supabase
          .from("returns")
          .select("id")
          .eq("shopify_refund_id", refund.id)
          .maybeSingle();
        if (existing) { skipped++; continue; }

        const refundTotal = parseFloat(refund.totalRefundedSet?.shopMoney?.amount ?? "0") || 0;
        const initiatedAt = toBerlinDate(refund.createdAt);
        const customerNameFromShopify = (() => {
          const o = order as unknown as {
            customer?: { firstName?: string | null; lastName?: string | null; displayName?: string | null } | null;
            shippingAddress?: { name?: string | null; firstName?: string | null; lastName?: string | null } | null;
            billingAddress?: { name?: string | null; firstName?: string | null; lastName?: string | null } | null;
          };
          const c = o.customer;
          if (c?.displayName) return c.displayName;
          if (c?.firstName || c?.lastName) return [c.firstName, c.lastName].filter(Boolean).join(" ");
          const sa = o.shippingAddress;
          if (sa?.name) return sa.name;
          if (sa?.firstName || sa?.lastName) return [sa.firstName, sa.lastName].filter(Boolean).join(" ");
          return order.name ?? "Shopify-Kunde";
        })();
        const customerEmail = (order as unknown as { customer?: { email?: string | null; id?: string | null } }).customer?.email ?? null;
        const customerId = (order as unknown as { customer?: { email?: string | null; id?: string | null } }).customer?.id ?? null;

        const { data: newReturn } = await supabase
          .from("returns")
          .insert({
            shopify_refund_id: refund.id,
            shopify_order_id: order.id,
            order_number: order.name,
            customer_name: customerNameFromShopify,
            customer_email: customerEmail,
            customer_id: customerId,
            return_type: "return",
            reason: "ohne_grundangabe",
            status: "resolved",
            refund_amount: refundTotal,
            initiated_at: initiatedAt,
            resolved_at: refund.createdAt ?? new Date().toISOString(),
          })
          .select("id")
          .single();
        if (!newReturn) continue;

        for (const edge of refund.refundLineItems.edges) {
          const li = edge.node;
          const collections = li.lineItem.product?.collections?.edges?.map((e) => e.node);
          const primary = pickPrimaryCollection(collections);
          const refined = refineCollection(primary?.title ?? null, li.lineItem.title);
          const subtotalGross = parseFloat(li.subtotalSet?.shopMoney?.amount ?? li.priceSet?.shopMoney?.amount ?? "0") || 0;
          const tax = parseFloat(li.totalTaxSet?.shopMoney?.amount ?? "0") || 0;
          const subtotal = Math.max(0, subtotalGross - tax);
          await supabase.from("return_items").insert({
            return_id: newReturn.id,
            product_type: li.lineItem.title,
            color: li.lineItem.variant?.title ?? null,
            quantity: li.quantity ?? 1,
            refund_amount: subtotal,
            collection_title: refined ?? primary?.title ?? null,
          });
        }
        synced++;
      }
    }
    return { synced, skipped };
  } catch (e) {
    return { synced: 0, skipped: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Repurchase compute (60 days, weekly TTL) ──────────────────
export async function cronRepurchaseCompute(
  supabase: SupabaseClient,
  windowDays = 60,
  ttlDays = 7,
): Promise<{ exchange: number; newOrder: number; lost: number; pending: number; skipped: number; error?: string }> {
  try {
    type Row = { id: string; shopify_order_id: string | null; customer_email: string | null; customer_id: string | null; return_type: string | null; initiated_at: string | null; repurchase_status: string | null; repurchase_check_at: string | null };
    async function fetchAll(): Promise<Row[]> {
      const all: Row[] = [];
      let from = 0;
      while (true) {
        const { data } = await supabase
          .from("returns")
          .select("id, shopify_order_id, customer_email, customer_id, return_type, initiated_at, repurchase_status, repurchase_check_at")
          .range(from, from + 999);
        if (!data || data.length === 0) break;
        all.push(...(data as Row[]));
        if (data.length < 1000) break;
        from += 1000;
      }
      return all;
    }

    // Step 1: backfill missing customer email/id for rows with shopify_order_id
    const returns = await fetchAll();
    const ordersToFetch = new Map<string, string[]>();
    for (const r of returns) {
      if (!r.shopify_order_id) continue;
      if (r.customer_email && r.customer_id) continue;
      const arr = ordersToFetch.get(r.shopify_order_id) ?? [];
      arr.push(r.id);
      ordersToFetch.set(r.shopify_order_id, arr);
    }
    const orderIds = Array.from(ordersToFetch.keys());
    for (let i = 0; i < orderIds.length; i += 50) {
      const batch = orderIds.slice(i, i + 50);
      const aliases = batch.map((id, idx) => `o${idx}: order(id: "${id}") { id customer { id email } }`).join("\n");
      const res = await shopifyGraphQL<Record<string, { id: string; customer: { id: string | null; email: string | null } | null }>>(`query { ${aliases} }`, {});
      if (!res.data) continue;
      for (let idx = 0; idx < batch.length; idx++) {
        const o = res.data[`o${idx}`];
        if (!o?.customer) continue;
        const email = o.customer.email ?? null;
        const cid = o.customer.id ?? null;
        if (!email && !cid) continue;
        for (const rid of ordersToFetch.get(batch[idx]) ?? []) {
          await supabase.from("returns").update({ customer_email: email, customer_id: cid }).eq("id", rid);
        }
      }
    }

    // Step 2: compute repurchase status
    const fresh = await fetchAll();
    const byCustomer = new Map<string, Row[]>();
    for (const r of fresh) {
      if (!r.customer_id) continue;
      const arr = byCustomer.get(r.customer_id) ?? [];
      arr.push(r);
      byCustomer.set(r.customer_id, arr);
    }
    const now = new Date();
    const windowMs = windowDays * 86400000;
    const ttlMs = ttlDays * 86400000;
    let exchange = 0, newOrder = 0, lost = 0, pending = 0, skipped = 0;

    for (const [customerId, rows] of byCustomer) {
      const minDate = rows.reduce((a, r) => (r.initiated_at && r.initiated_at < a ? r.initiated_at : a), "9999-12-31");
      const customerNumeric = customerId.replace("gid://shopify/Customer/", "");
      const q = `customer_id:${customerNumeric} created_at:>=${minDate}`;
      const orders: { id: string; createdAt: string }[] = [];
      let after: string | null = null;
      for (let p = 0; p < 5; p++) {
        const res: { data?: { orders: { pageInfo: { hasNextPage: boolean; endCursor: string }; edges: { node: { id: string; createdAt: string } }[] } } } =
          await shopifyGraphQL(`query($q:String!,$after:String){orders(first:50,after:$after,query:$q,sortKey:CREATED_AT){pageInfo{hasNextPage endCursor}edges{node{id createdAt}}}}`, { q, after });
        orders.push(...(res.data?.orders?.edges ?? []).map((e) => e.node));
        if (!res.data?.orders?.pageInfo?.hasNextPage) break;
        after = res.data.orders.pageInfo.endCursor;
      }

      for (const r of rows) {
        if (r.repurchase_check_at && now.getTime() - new Date(r.repurchase_check_at).getTime() < ttlMs) {
          skipped++;
          continue;
        }
        let status: string;
        let repurchaseOrderId: string | null = null;
        let repurchaseAt: string | null = null;
        if (r.return_type === "exchange") {
          status = "exchange";
          exchange++;
        } else {
          const initDate = r.initiated_at ? new Date(r.initiated_at).getTime() : 0;
          const windowEnd = initDate + windowMs;
          const recovery = orders.find((o) => {
            const t = new Date(o.createdAt).getTime();
            return t > initDate && t <= windowEnd;
          });
          if (recovery) {
            status = "new_order";
            repurchaseOrderId = recovery.id;
            repurchaseAt = recovery.createdAt;
            newOrder++;
          } else if (now.getTime() - initDate > windowMs) {
            status = "lost";
            lost++;
          } else {
            status = "pending";
            pending++;
          }
        }
        await supabase.from("returns").update({
          repurchase_status: status,
          repurchase_order_id: repurchaseOrderId,
          repurchase_order_at: repurchaseAt,
          repurchase_check_at: now.toISOString(),
        }).eq("id", r.id);
      }
    }

    return { exchange, newOrder, lost, pending, skipped };
  } catch (e) {
    return { exchange: 0, newOrder: 0, lost: 0, pending: 0, skipped: 0, error: e instanceof Error ? e.message : String(e) };
  }
}
