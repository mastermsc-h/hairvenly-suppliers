// Import refunds that exist in Shopify but are MISSING in the DB (matched by
// shopify_refund_id). Inserts returns + return_items with net amounts —
// mirrors cronRefundsSync in src/lib/cron-tasks.ts.
//
// Usage: node scripts/backfill-missing-refunds.mjs --since 2026-06-25 [--dry]

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
  console.error("Missing env vars.");
  process.exit(1);
}

const args = process.argv.slice(2);
const since = args.includes("--since") ? args[args.indexOf("--since") + 1] : "2026-06-25";
const dry = args.includes("--dry");
console.log(`Backfilling missing refunds since ${since}${dry ? " (DRY RUN)" : ""}`);

const sb = createClient(SB_URL, SB_KEY);

async function gql(query, variables) {
  for (let attempts = 0; attempts < 3; attempts++) {
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

function toBerlinDate(iso) {
  if (!iso) return new Date().toISOString().slice(0, 10);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date(iso));
}

const ORDER_Q = `
  query ordersRefunds($q: String!, $first: Int!, $after: String) {
    orders(first: $first, after: $after, query: $q, sortKey: UPDATED_AT, reverse: true) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id
          name
          customer { id email displayName firstName lastName }
          shippingAddress { name firstName lastName }
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
                    product { collections(first: 10) { edges { node { title handle } } } }
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

function customerName(order) {
  const c = order.customer;
  if (c?.displayName) return c.displayName;
  if (c?.firstName || c?.lastName) return [c.firstName, c.lastName].filter(Boolean).join(" ");
  const sa = order.shippingAddress;
  if (sa?.name) return sa.name;
  if (sa?.firstName || sa?.lastName) return [sa.firstName, sa.lastName].filter(Boolean).join(" ");
  return order.name ?? "Shopify-Kunde";
}

const stats = { seen: 0, existing: 0, inserted: 0, items: 0 };
let cursor = null;
const q = `financial_status:refunded OR financial_status:partially_refunded`;

outer: for (let page = 0; page < 200; page++) {
  const res = await gql(ORDER_Q, { q, first: 50, after: cursor });
  if (res.errors) throw new Error(JSON.stringify(res.errors));
  const edges = res.data?.orders.edges ?? [];
  let allRefundsOld = edges.length > 0;
  for (const e of edges) {
    const order = e.node;
    for (const refund of order.refunds ?? []) {
      if (!refund.createdAt) continue;
      if (refund.createdAt >= since) allRefundsOld = false;
      else continue;
      stats.seen++;

      const { data: existing } = await sb
        .from("returns").select("id").eq("shopify_refund_id", refund.id).maybeSingle();
      if (existing) { stats.existing++; continue; }

      const refundTotal = parseFloat(refund.totalRefundedSet?.shopMoney?.amount ?? "0") || 0;
      const items = [];
      let netTotal = 0;
      for (const edge of refund.refundLineItems.edges) {
        const li = edge.node;
        const subtotalGross = parseFloat(li.subtotalSet?.shopMoney?.amount ?? li.priceSet?.shopMoney?.amount ?? "0") || 0;
        const tax = parseFloat(li.totalTaxSet?.shopMoney?.amount ?? "0") || 0;
        const net = Math.max(0, subtotalGross - tax);
        const colls = li.lineItem.product?.collections?.edges?.map((x) => x.node);
        const primary = pickPrimary(colls);
        const refined = refineCollection(primary?.title ?? null, li.lineItem.title);
        items.push({
          product_type: li.lineItem.title,
          color: li.lineItem.variant?.title ?? null,
          quantity: li.quantity ?? 1,
          refund_amount: Number(net.toFixed(2)),
          collection_title: refined ?? primary?.title ?? null,
        });
        netTotal += net;
      }

      if (dry) {
        console.log(`[dry] would insert ${order.name} refund=${refund.id} total=${refundTotal} items=${items.length}`);
        stats.inserted++;
        continue;
      }

      const { data: newReturn, error: insErr } = await sb
        .from("returns")
        .insert({
          shopify_refund_id: refund.id,
          shopify_order_id: order.id,
          order_number: order.name,
          customer_name: customerName(order),
          customer_email: order.customer?.email ?? null,
          customer_id: order.customer?.id ?? null,
          return_type: "return",
          reason: "ohne_grundangabe",
          status: "resolved",
          refund_amount: refundTotal,
          initiated_at: toBerlinDate(refund.createdAt),
          resolved_at: refund.createdAt,
        })
        .select("id").single();
      if (insErr || !newReturn) { console.error("insert failed", order.name, insErr); continue; }
      if (items.length > 0) {
        const { error: itemErr } = await sb
          .from("return_items")
          .insert(items.map((it) => ({ ...it, return_id: newReturn.id })));
        if (itemErr) console.error("items failed", order.name, itemErr);
        else stats.items += items.length;
      }
      stats.inserted++;
      console.log(`+ ${order.name} ${toBerlinDate(refund.createdAt)} ${refundTotal}€ (${items.length} items)`);
    }
  }
  // Orders are sorted by UPDATED_AT desc; once a full page contains only
  // refunds older than the cutoff we can stop paging.
  if (allRefundsOld && page > 2) break outer;
  if (!res.data?.orders.pageInfo.hasNextPage || edges.length === 0) break;
  cursor = res.data.orders.pageInfo.endCursor;
}

console.log("\nDone.", stats);
process.exit(0);
