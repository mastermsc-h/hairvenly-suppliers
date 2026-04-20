// Re-sync all Shopify refunds from a given cutoff date and recompute net
// refund_amount (subtotalSet - totalTaxSet) for return_items + returns.
//
// Preserves manual enrichment on returns (reason, handler, notes, status,
// resolution, return_type). Only touches refund_amount + return_items rows.
//
// Usage:
//   node scripts/resync-refunds-net.mjs --since 2024-01-01 [--dry]
//
// Requires .env.local with SHOPIFY_SHOP_DOMAIN, SHOPIFY_ACCESS_TOKEN,
// NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

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

if (!SHOP || !TOK || !SB_URL || !SB_KEY) {
  console.error("Missing env vars. Need SHOPIFY_SHOP_DOMAIN, SHOPIFY_ACCESS_TOKEN, NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

const args = process.argv.slice(2);
const since = (args.find((a) => a.startsWith("--since=")) ?? "--since=2024-01-01").split("=")[1]
  || (args.includes("--since") ? args[args.indexOf("--since") + 1] : "2024-01-01");
const dry = args.includes("--dry");

console.log(`Re-syncing refunds since ${since}${dry ? " (DRY RUN)" : ""}`);

const sb = createClient(SB_URL, SB_KEY);

// ── Shopify GraphQL helper ────────────────────────────────────
async function gql(query, variables) {
  let attempts = 0;
  while (attempts < 3) {
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

// ── Collection picker (mirror of shopify.ts) ──────────────────
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

// ── Fetch all refunded orders with refunds since cutoff ───────
const ORDER_Q = `
  query ordersRefunds($q: String!, $first: Int!, $after: String) {
    orders(first: $first, after: $after, query: $q, sortKey: UPDATED_AT, reverse: true) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          name
          refunds {
            id
            createdAt
            totalRefundedSet { shopMoney { amount } }
            refundLineItems(first: 50) {
              edges {
                node {
                  quantity
                  subtotalSet { shopMoney { amount } }
                  priceSet { shopMoney { amount } }
                  totalTaxSet { shopMoney { amount } }
                  lineItem {
                    title
                    variant { title }
                    product {
                      collections(first: 10) { edges { node { title handle } } }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
`;

async function* iterRefunds() {
  let cursor = null;
  const q = "financial_status:refunded OR financial_status:partially_refunded";
  for (let page = 0; page < 500; page++) {
    const res = await gql(ORDER_Q, { q, first: 50, after: cursor });
    if (res.errors) throw new Error(JSON.stringify(res.errors));
    const edges = res.data?.orders.edges ?? [];
    for (const e of edges) {
      for (const refund of e.node.refunds ?? []) {
        if (!refund.createdAt) continue;
        if (refund.createdAt < since) continue;
        yield { order: e.node, refund };
      }
    }
    if (!res.data?.orders.pageInfo.hasNextPage || edges.length === 0) break;
    cursor = res.data.orders.pageInfo.endCursor;
    process.stdout.write(`\r  page ${page + 1}, cursor ${cursor?.slice(0, 12)}…`);
  }
  process.stdout.write("\n");
}

// ── Main ──────────────────────────────────────────────────────
const stats = { seen: 0, matched: 0, skipped_no_match: 0, updated: 0, items_written: 0 };

for await (const { order, refund } of iterRefunds()) {
  stats.seen++;

  // Find return by shopify_refund_id
  const { data: retRow } = await sb
    .from("returns")
    .select("id")
    .eq("shopify_refund_id", refund.id)
    .maybeSingle();

  if (!retRow) {
    stats.skipped_no_match++;
    continue;
  }
  stats.matched++;

  // Build new items (net values)
  const items = [];
  let netTotal = 0;
  for (const edge of refund.refundLineItems.edges) {
    const li = edge.node;
    const subtotalGross = parseFloat(li.subtotalSet?.shopMoney?.amount ?? li.priceSet?.shopMoney?.amount ?? "0") || 0;
    const tax = parseFloat(li.totalTaxSet?.shopMoney?.amount ?? "0") || 0;
    const net = Math.max(0, subtotalGross - tax);
    const colls = li.lineItem.product?.collections?.edges?.map((e) => e.node);
    const primary = pickPrimary(colls);
    const refined = refineCollection(primary?.title ?? null, li.lineItem.title);
    items.push({
      return_id: retRow.id,
      product_type: li.lineItem.title,
      color: li.lineItem.variant?.title ?? null,
      quantity: li.quantity ?? 1,
      refund_amount: Number(net.toFixed(2)),
      collection_title: refined ?? primary?.title ?? null,
    });
    netTotal += net;
  }

  if (dry) {
    if (stats.matched <= 5) {
      console.log(`[dry] ${order.name} refund=${refund.id} items=${items.length} netTotal=${netTotal.toFixed(2)}`);
    }
    continue;
  }

  // Replace items + update return total
  const { error: delErr } = await sb.from("return_items").delete().eq("return_id", retRow.id);
  if (delErr) { console.error("delete failed", retRow.id, delErr); continue; }
  if (items.length > 0) {
    const { error: insErr } = await sb.from("return_items").insert(items);
    if (insErr) { console.error("insert failed", retRow.id, insErr); continue; }
  }
  await sb.from("returns").update({ refund_amount: Number(netTotal.toFixed(2)) }).eq("id", retRow.id);
  stats.updated++;
  stats.items_written += items.length;

  if (stats.updated % 50 === 0) {
    process.stdout.write(`  updated ${stats.updated}/${stats.matched}…\n`);
  }
}

console.log("\nDone.");
console.log(stats);
