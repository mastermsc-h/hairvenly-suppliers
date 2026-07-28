// Sync shopify_collection_sales for a date range — exact mirror of
// fetchMonthlyCollectionSales + upsert logic in src/lib (net of tax,
// cancelled orders excluded, refineCollection applied).
//
// Usage: node scripts/sync-collection-sales.mjs --from 2026-06-01

import fs from "fs";
import { createClient } from "@supabase/supabase-js";

const env = fs.readFileSync(".env.local", "utf8").split("\n").reduce((a, l) => {
  const m = l.match(/^([A-Z_]+)=(.*)$/);
  if (m) a[m[1]] = m[2];
  return a;
}, {});
const SHOP = env.SHOPIFY_SHOP_DOMAIN;
const TOK = env.SHOPIFY_ACCESS_TOKEN;
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY);

const args = process.argv.slice(2);
const from = args.includes("--from") ? args[args.indexOf("--from") + 1] : "2026-06-01";
console.log(`Syncing collection sales from ${from}`);

async function gql(query, variables) {
  for (let attempts = 0; attempts < 5; attempts++) {
    const res = await fetch(`https://${SHOP}/admin/api/2025-01/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": TOK },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 429) {
      await new Promise((r) => setTimeout(r, parseFloat(res.headers.get("Retry-After") ?? "2") * 1000));
      continue;
    }
    if (!res.ok) throw new Error(`Shopify ${res.status}: ${await res.text()}`);
    return res.json();
  }
  throw new Error("rate limit");
}

// Collection picker (mirror of shopify.ts)
const IGNORED = new Set(["alle produkte", "alle", "best seller", "bestseller", "best selling products", "sale", "new", "neu", "newest", "newest products", "neuste produkte", "angebote", "home", "startseite", "all", "homepage", "unassigned"]);
const PREFERRED = new Set(["standard tapes russisch", "russische tapes (glatt)", "mini tapes glatt", "russische bondings (glatt)", "russische classic tressen (glatt)", "russische genius tressen (glatt)", "russische invisible tressen (glatt)", "russische invisible tressen / butterfly weft", "clip in extensions echthaar", "tapes wellig 45cm", "tapes wellig 55cm", "tapes wellig 65cm", "tapes wellig 85cm", "bondings wellig 65cm", "bondings wellig 85cm", "usbekische classic tressen (wellig)", "usbekische genius tressen (wellig)", "ponytail extensions", "ponytail extensions kaufen", "accessoires", "extensions zubehör"]);
const PARENT = new Set(["usbekische tapes (wellig)", "russische tapes (glatt)", "usbekische bondings (wellig)", "bondings", "tressen extensions", "usbekische tressen (wellig)", "russische tressen (glatt)"]);
function pickPrimary(cs) {
  if (!cs || !cs.length) return null;
  const norm = (c) => c.title.toLowerCase().trim();
  const el = cs.filter((c) => !IGNORED.has(norm(c)));
  if (!el.length) return cs[0];
  const p = el.find((c) => PREFERRED.has(norm(c)));
  if (p) return p;
  const np = el.find((c) => !PARENT.has(norm(c)));
  return np ?? el[0];
}
function refineCollection(coll, product) {
  const c = (coll ?? "").toLowerCase().trim();
  const up = (product ?? "").toUpperCase();
  if (!up) return coll ?? null;
  const hasLen = (n) => new RegExp(`\\b${n}\\s*CM\\b`).test(up);
  const isMini = /MINI\s*TAPE/.test(up);
  const isR = /RUSSISCH|\bGLATT\b|\bRU\s+GLATT\b|STANDARD\s+RUSS/.test(up);
  const isU = /USBEKISCH|\bWELLIG|\bUS\s+WELLIG/.test(up);
  if (c === "usbekische bondings (wellig)") {
    if (hasLen(65)) return "Bondings wellig 65cm";
    if (hasLen(85)) return "Bondings wellig 85cm";
    return "Usbekische Bondings (Wellig)";
  }
  if (c === "usbekische tapes (wellig)") {
    if (hasLen(45)) return "Tapes Wellig 45cm";
    if (hasLen(55)) return "Tapes Wellig 55cm";
    if (hasLen(65)) return "Tapes Wellig 65cm";
    if (hasLen(85)) return "Tapes Wellig 85cm";
    return "Usbekische Tapes (Wellig)";
  }
  if (c === "russische tressen (glatt)") {
    if (/GENIUS/.test(up)) return "Russische Genius Tressen (Glatt)";
    if (/INVISIBLE/.test(up)) return "Russische Invisible Tressen (Glatt)";
    if (/CLASSIC/.test(up)) return "Russische Classic Tressen (Glatt)";
    return "Russische Tressen (Glatt)";
  }
  if (c === "usbekische tressen (wellig)") {
    if (/GENIUS/.test(up)) return "Usbekische Genius Tressen (Wellig)";
    if (/CLASSIC/.test(up)) return "Usbekische Classic Tressen (Wellig)";
    return "Usbekische Tressen (Wellig)";
  }
  if (c === "tressen extensions") {
    if (isR) {
      if (/GENIUS/.test(up)) return "Russische Genius Tressen (Glatt)";
      if (/INVISIBLE/.test(up)) return "Russische Invisible Tressen (Glatt)";
      if (/CLASSIC/.test(up)) return "Russische Classic Tressen (Glatt)";
    } else if (isU) {
      if (/GENIUS/.test(up)) return "Usbekische Genius Tressen (Wellig)";
      if (/CLASSIC/.test(up)) return "Usbekische Classic Tressen (Wellig)";
    }
    return null;
  }
  if (c === "best selling products" || c === "unassigned" || c === "haarpflegeprodukte" || c === "") {
    if (/KLEBER|REMOVER|BÜRSTE|BUERSTE|SHAMPOO|CONDITIONER|FARBRING|SPRAY|TREATMENT|MASK|PFLEGE/.test(up)) return "Extensions Zubehör";
    if (isR) {
      if (isMini) return "Mini Tapes Glatt";
      if (/STANDARD.*TAPE|TAPE.*STANDARD|\bTAPE\b/.test(up) && !/MINI/.test(up)) return "Standard Tapes Russisch";
      if (/BONDING/.test(up)) return "Russische Bondings (Glatt)";
      if (/GENIUS.*TRESS|TRESS.*GENIUS/.test(up)) return "Russische Genius Tressen (Glatt)";
      if (/INVISIBLE/.test(up)) return "Russische Invisible Tressen (Glatt)";
      if (/CLASSIC/.test(up)) return "Russische Classic Tressen (Glatt)";
      if (/TRESS|WEFT/.test(up)) return "Russische Genius Tressen (Glatt)";
      if (/CLIP/.test(up)) return "Clip In Extensions Echthaar";
    }
    if (isU || /\bUS\s+/.test(up)) {
      if (/\bTAPE/.test(up) && !/MINI/.test(up)) {
        if (hasLen(45)) return "Tapes Wellig 45cm";
        if (hasLen(55)) return "Tapes Wellig 55cm";
        if (hasLen(65)) return "Tapes Wellig 65cm";
        if (hasLen(85)) return "Tapes Wellig 85cm";
      }
      if (/BONDING/.test(up)) {
        if (hasLen(65)) return "Bondings wellig 65cm";
        if (hasLen(85)) return "Bondings wellig 85cm";
      }
      if (/GENIUS/.test(up)) return "Usbekische Genius Tressen (Wellig)";
      if (/CLASSIC/.test(up)) return "Usbekische Classic Tressen (Wellig)";
    }
    if (/PONYTAIL/.test(up)) return "Ponytail Extensions";
    if (/CLIP/.test(up)) return "Clip In Extensions Echthaar";
    return null;
  }
  return coll ?? null;
}

const Q = `
  query monthlyCollectionSales($q: String!, $first: Int!, $after: String) {
    orders(first: $first, after: $after, query: $q, sortKey: CREATED_AT, reverse: true) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          createdAt
          cancelledAt
          lineItems(first: 50) {
            edges {
              node {
                title
                quantity
                originalTotalSet { shopMoney { amount } }
                taxLines { priceSet { shopMoney { amount } } }
                product { title collections(first: 10) { edges { node { title handle } } } }
              }
            }
          }
        }
      }
    }
  }
`;

// month -> collection -> stats
const agg = new Map();
let cursor = null;
for (let page = 0; page < 300; page++) {
  const res = await gql(Q, { q: `created_at:>=${from}`, first: 100, after: cursor });
  if (res.errors) throw new Error(JSON.stringify(res.errors));
  const edges = res.data?.orders.edges ?? [];
  if (edges.length === 0) break;
  for (const e of edges) {
    const order = e.node;
    if (order.cancelledAt) continue;
    const month = order.createdAt.slice(0, 7) + "-01";
    const monthMap = agg.get(month) ?? new Map();
    for (const liEdge of order.lineItems.edges) {
      const li = liEdge.node;
      const collections = li.product?.collections?.edges?.map((c) => c.node);
      const primary = pickPrimary(collections);
      const productTitle = li.product?.title || li.title || "";
      const refined = refineCollection(primary?.title ?? null, productTitle);
      const collName = refined ?? primary?.title ?? "Unassigned";
      const grossWithTax = parseFloat(li.originalTotalSet?.shopMoney?.amount ?? "0") || 0;
      const tax = (li.taxLines ?? []).reduce((s, tl) => s + (parseFloat(tl.priceSet?.shopMoney?.amount ?? "0") || 0), 0);
      const amount = Math.max(0, grossWithTax - tax);
      const entry = monthMap.get(collName) ?? { revenue: 0, orders: new Set(), items: 0 };
      entry.revenue += amount;
      entry.orders.add(order.id);
      entry.items += li.quantity ?? 0;
      monthMap.set(collName, entry);
    }
    agg.set(month, monthMap);
  }
  process.stdout.write(`\r  page ${page + 1}…`);
  if (!res.data?.orders.pageInfo.hasNextPage) break;
  cursor = res.data.orders.pageInfo.endCursor;
}
process.stdout.write("\n");

const syncedAt = new Date().toISOString();
const payload = [];
for (const [month, colls] of agg) {
  for (const [collection, s] of colls) {
    payload.push({
      month,
      collection_title: collection,
      gross_revenue: Number(s.revenue.toFixed(2)),
      order_count: s.orders.size,
      item_count: s.items,
      synced_at: syncedAt,
    });
  }
}
console.log(`Upserting ${payload.length} rows…`);
for (let i = 0; i < payload.length; i += 500) {
  const { error } = await sb.from("shopify_collection_sales")
    .upsert(payload.slice(i, i + 500), { onConflict: "month,collection_title" });
  if (error) throw error;
}
const months = Array.from(new Set(payload.map((r) => r.month)));
await sb.from("shopify_collection_sales").delete().in("month", months).lt("synced_at", syncedAt);
console.log("Done. Months:", months.join(", "));
process.exit(0);
