// Backfill customer_email / customer_id on returns and compute repurchase_status
// (exchange | new_order | lost | pending) for each return within a 60-day window.
//
// Usage: node scripts/compute-repurchase.mjs [--window 60] [--force]
//   --force   re-checks even rows with a recent repurchase_check_at

import fs from "fs";
import { createClient } from "@supabase/supabase-js";

const env = fs.readFileSync(".env.local", "utf8").split("\n").reduce((a, l) => {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m) a[m[1]] = m[2];
  return a;
}, {});

const SHOP = env.SHOPIFY_SHOP_DOMAIN;
const TOK = env.SHOPIFY_ACCESS_TOKEN;
const SB_URL = env.NEXT_PUBLIC_SUPABASE_URL;
const SB_KEY = env.SUPABASE_SERVICE_ROLE_KEY;

const args = process.argv.slice(2);
const windowDays = Number(args.find((a) => a.startsWith("--window="))?.split("=")[1] ?? 60);
const force = args.includes("--force");

console.log(`Window: ${windowDays} days · force=${force}`);

const sb = createClient(SB_URL, SB_KEY);

async function gql(query, variables) {
  let attempts = 0;
  while (attempts < 4) {
    const res = await fetch(`https://${SHOP}/admin/api/2025-01/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": TOK },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 429) {
      const retry = parseFloat(res.headers.get("Retry-After") ?? "2");
      await new Promise((r) => setTimeout(r, retry * 1000));
      attempts++;
      continue;
    }
    if (!res.ok) throw new Error(`Shopify ${res.status}: ${await res.text()}`);
    return res.json();
  }
  throw new Error("rate limit");
}

// ── Step 1: Backfill customer_email / customer_id ───────────────
console.log("\nStep 1 — Backfilling customer email/id from Shopify orders…");

async function fetchAllReturns() {
  const all = [];
  let from = 0;
  while (true) {
    const { data } = await sb.from("returns")
      .select("id, shopify_order_id, customer_email, customer_id, return_type, initiated_at, repurchase_status, repurchase_check_at")
      .range(from, from + 999);
    if (!data || data.length === 0) break;
    all.push(...data);
    if (data.length < 1000) break;
    from += 1000;
  }
  return all;
}

const returns = await fetchAllReturns();
console.log("Total returns:", returns.length);

// Group returns by shopify_order_id so we make ONE Shopify call per unique order
const ordersToFetch = new Map(); // order_id → [return_id, ...]
for (const r of returns) {
  if (!r.shopify_order_id) continue;
  if (r.customer_email && r.customer_id && !force) continue;
  const arr = ordersToFetch.get(r.shopify_order_id) ?? [];
  arr.push(r.id);
  ordersToFetch.set(r.shopify_order_id, arr);
}
console.log("Unique orders to fetch customer for:", ordersToFetch.size);

let backfilled = 0;
const orderIds = Array.from(ordersToFetch.keys());
for (let i = 0; i < orderIds.length; i += 50) {
  const batch = orderIds.slice(i, i + 50);
  const aliases = batch.map((id, idx) => `o${idx}: order(id: "${id}") { id customer { id email } }`).join("\n");
  const res = await gql(`query { ${aliases} }`, {});
  if (res.errors) { console.error("err", res.errors); continue; }
  const updates = [];
  for (let idx = 0; idx < batch.length; idx++) {
    const o = res.data?.[`o${idx}`];
    if (!o?.customer) continue;
    const email = o.customer.email ?? null;
    const cid = o.customer.id ?? null;
    if (!email && !cid) continue;
    for (const rid of ordersToFetch.get(batch[idx]) ?? []) {
      updates.push({ rid, email, cid });
    }
  }
  for (const u of updates) {
    await sb.from("returns").update({ customer_email: u.email, customer_id: u.cid }).eq("id", u.rid);
    backfilled++;
  }
  if (i % 500 === 0) process.stdout.write(`  ${i}/${orderIds.length} batches\n`);
}
console.log(`Backfilled ${backfilled} returns with customer info.`);

// ── Step 2: Compute repurchase_status ────────────────────────────
console.log("\nStep 2 — Computing repurchase_status…");

const fresh = await fetchAllReturns();
const byCustomer = new Map(); // customer_id → [return rows]
for (const r of fresh) {
  if (!r.customer_id) continue;
  const arr = byCustomer.get(r.customer_id) ?? [];
  arr.push(r);
  byCustomer.set(r.customer_id, arr);
}
console.log("Unique customers with returns:", byCustomer.size);

const now = new Date();
const windowMs = windowDays * 86400000;

let exchanges = 0, newOrders = 0, lost = 0, pending = 0, skipped = 0;

for (const [customerId, rows] of byCustomer) {
  // Earliest return date for this customer to bound the Shopify search
  const minDate = rows.reduce((a, r) => r.initiated_at && r.initiated_at < a ? r.initiated_at : a, "9999-12-31");

  // Fetch all orders by this customer since the earliest return date
  const q = `customer_id:${customerId.replace("gid://shopify/Customer/", "")} created_at:>=${minDate}`;
  let orders = [];
  let after = null;
  for (let p = 0; p < 5; p++) {
    const res = await gql(`query($q:String!,$after:String){orders(first:50,after:$after,query:$q,sortKey:CREATED_AT){pageInfo{hasNextPage endCursor}edges{node{id name createdAt}}}}`, { q, after });
    if (res.errors) { console.error("err", res.errors[0]?.message); break; }
    orders.push(...(res.data?.orders?.edges ?? []).map((e) => e.node));
    if (!res.data?.orders?.pageInfo?.hasNextPage) break;
    after = res.data.orders.pageInfo.endCursor;
  }

  for (const r of rows) {
    if (!force && r.repurchase_check_at) {
      // Skip if checked within last 7 days
      const lastCheck = new Date(r.repurchase_check_at).getTime();
      if (now.getTime() - lastCheck < 7 * 86400000) { skipped++; continue; }
    }

    let status, repurchaseOrderId = null, repurchaseAt = null;

    if (r.return_type === "exchange") {
      status = "exchange";
      exchanges++;
    } else {
      const initDate = r.initiated_at ? new Date(r.initiated_at).getTime() : 0;
      const windowEnd = initDate + windowMs;

      // Find first order strictly AFTER initiated_at (skip same-day = original order)
      const recovery = orders.find((o) => {
        const t = new Date(o.createdAt).getTime();
        return t > initDate && t <= windowEnd;
      });

      if (recovery) {
        status = "new_order";
        repurchaseOrderId = recovery.id;
        repurchaseAt = recovery.createdAt;
        newOrders++;
      } else if (now.getTime() - initDate > windowMs) {
        status = "lost";
        lost++;
      } else {
        status = "pending";
        pending++;
      }
    }

    await sb.from("returns").update({
      repurchase_status: status,
      repurchase_order_id: repurchaseOrderId,
      repurchase_order_at: repurchaseAt,
      repurchase_check_at: now.toISOString(),
    }).eq("id", r.id);
  }
}

console.log("\nResults:");
console.table({ exchanges, newOrders, lost, pending, skipped });
const totalDecided = exchanges + newOrders + lost;
const recovered = exchanges + newOrders;
if (totalDecided > 0) {
  console.log(`Wiederkaufsrate (incl. exchange): ${(recovered / totalDecided * 100).toFixed(1)}%`);
  console.log(`Recovery rate (only new_order): ${(newOrders / totalDecided * 100).toFixed(1)}%`);
}
