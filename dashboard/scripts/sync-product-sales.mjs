// Backfill/refresh shopify_product_sales for the last N months.
// Usage: node scripts/sync-product-sales.mjs [months]
// Run from the dashboard/ directory so module resolution + .env work.

import { config } from "dotenv";
import pg from "pg";

config({ path: ".env.local" });
config({ path: ".env" });

const MONTHS = Number(process.argv[2] ?? 12);
const SHOP = process.env.SHOPIFY_SHOP_DOMAIN;
const TOKEN = process.env.SHOPIFY_ACCESS_TOKEN;
const DB = process.env.SUPABASE_DB_URL
  ?? "postgresql://postgres.xzisnlkqiomvmbslwhvg:yPa1PNWr0KozQlPP@aws-1-eu-central-1.pooler.supabase.com:5432/postgres";

if (!SHOP || !TOKEN) {
  console.error("SHOPIFY_SHOP_DOMAIN und SHOPIFY_ACCESS_TOKEN müssen gesetzt sein.");
  process.exit(1);
}

async function shopifyGraphQL(query, variables) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(`https://${SHOP}/admin/api/2025-01/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": TOKEN },
      body: JSON.stringify({ query, variables }),
    });
    if (res.status === 429 || res.status >= 500) {
      await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
      continue;
    }
    const json = await res.json();
    if (json.errors) throw new Error(JSON.stringify(json.errors));
    return json;
  }
  throw new Error("Shopify GraphQL: zu viele Fehlversuche");
}

// Mirrors pickPrimaryCollection/refineCollection intent: prefer the most
// specific non-generic collection, then refine by product title.
const GENERIC = new Set([
  "Newest Products", "Newest", "Neuste Produkte", "Best Selling Products",
  "Home page", "Frontpage", "All", "Alle Produkte",
]);

function pickPrimary(collections) {
  if (!collections || collections.length === 0) return null;
  const specific = collections.filter((c) => !GENERIC.has(c.title));
  return (specific[0] ?? collections[0]) ?? null;
}

function refine(collectionTitle, productTitle) {
  const up = (productTitle ?? "").toUpperCase();
  const len = up.match(/(\d{2})\s*CM/)?.[1];
  const wavy = /WELLIG|USBEKISCH/.test(up);
  const straight = /GLATT|RUSSISCH/.test(up);
  if (/GENIUS/.test(up)) return wavy ? "Usbekische Genius Tressen (Wellig)" : "Russische Genius Tressen (Glatt)";
  if (/INVISIBLE|BUTTERFLY/.test(up)) return "Russische Invisible Tressen (Glatt) | Butterfly Weft";
  if (/CLASSIC.*TRESS|TRESS.*CLASSIC/.test(up)) return wavy ? "Usbekische Classic Tressen (Wellig)" : "Russische Classic Tressen (Glatt)";
  if (/MINI\s*TAPE/.test(up)) return wavy ? "Mini Tapes Wellig" : "Mini Tapes Glatt";
  if (/TAPE/.test(up)) {
    if (wavy && len) return `Tapes Wellig ${len}cm`;
    if (straight) return "Standard Tapes Russisch";
  }
  if (/BONDING/.test(up)) {
    if (wavy && len) return `Bondings wellig ${len}cm`;
    if (straight) return "Russische Bondings (Glatt)";
  }
  if (/CLIP/.test(up)) return "Clip In Extensions Echthaar";
  if (/PONYTAIL/.test(up)) return "Ponytail Extensions kaufen";
  return collectionTitle ?? null;
}

const QUERY = `
  query productSales($q: String!, $first: Int!, $after: String) {
    orders(first: $first, after: $after, query: $q, sortKey: CREATED_AT, reverse: true) {
      pageInfo { hasNextPage endCursor }
      edges {
        node {
          id createdAt cancelledAt
          lineItems(first: 50) {
            edges {
              node {
                title quantity
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

async function main() {
  const start = new Date();
  start.setMonth(start.getMonth() - MONTHS);
  const startStr = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-01`;
  console.log(`Lade Produktverkäufe ab ${startStr} …`);

  const agg = new Map(); // month -> key -> stats
  let cursor = null;
  let orders = 0;

  for (let page = 0; page < 300; page++) {
    const res = await shopifyGraphQL(QUERY, { q: `created_at:>=${startStr}`, first: 100, after: cursor });
    const edges = res.data?.orders?.edges ?? [];
    if (edges.length === 0) break;

    for (const e of edges) {
      const order = e.node;
      if (order.cancelledAt) continue;
      orders++;
      const month = order.createdAt.slice(0, 7) + "-01";
      const monthMap = agg.get(month) ?? new Map();

      for (const liEdge of order.lineItems.edges) {
        const li = liEdge.node;
        const productTitle = li.title || li.product?.title || "";
        if (!productTitle) continue;
        const colls = li.product?.collections?.edges?.map((c) => c.node) ?? [];
        const primary = pickPrimary(colls);
        const collName = refine(primary?.title ?? null, li.product?.title || productTitle) ?? "Unassigned";

        const grossWithTax = parseFloat(li.originalTotalSet?.shopMoney?.amount ?? "0") || 0;
        const tax = (li.taxLines ?? []).reduce((s, tl) => s + (parseFloat(tl.priceSet?.shopMoney?.amount ?? "0") || 0), 0);
        const amount = Math.max(0, grossWithTax - tax);

        // Key by product title ALONE — the DB primary key is
        // (month, product_title). A product can appear under more than one
        // collection; keying by both would emit two rows that collide on
        // upsert ("cannot affect row a second time").
        const entry = monthMap.get(productTitle) ?? { collection: collName, revenue: 0, orders: new Set(), items: 0 };
        entry.revenue += amount;
        entry.orders.add(order.id);
        entry.items += li.quantity ?? 0;
        monthMap.set(productTitle, entry);
      }
      agg.set(month, monthMap);
    }

    if (page % 10 === 0) console.log(`  … ${orders} Bestellungen verarbeitet`);
    if (!res.data.orders.pageInfo.hasNextPage) break;
    cursor = res.data.orders.pageInfo.endCursor;
  }

  const rows = [];
  for (const [month, products] of agg) {
    for (const [productTitle, stats] of products) {
      rows.push([month, productTitle, stats.collection, stats.revenue.toFixed(2), stats.orders.size, stats.items]);
    }
  }
  console.log(`${orders} Bestellungen → ${rows.length} Produkt-Monats-Zeilen`);

  const c = new pg.Client({ connectionString: DB });
  await c.connect();
  const syncedAt = new Date().toISOString();
  let written = 0;
  for (let i = 0; i < rows.length; i += 500) {
    const chunk = rows.slice(i, i + 500);
    const values = chunk.map((r, idx) => {
      const b = idx * 7;
      return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7})`;
    }).join(",");
    const params = chunk.flatMap((r) => [...r, syncedAt]);
    await c.query(
      `insert into shopify_product_sales
         (month, product_title, collection_title, gross_revenue, order_count, item_count, synced_at)
       values ${values}
       on conflict (month, product_title) do update set
         collection_title = excluded.collection_title,
         gross_revenue = excluded.gross_revenue,
         order_count = excluded.order_count,
         item_count = excluded.item_count,
         synced_at = excluded.synced_at`,
      params,
    );
    written += chunk.length;
  }
  // Remove rows for covered months that no longer appear in Shopify
  const months = Array.from(agg.keys());
  if (months.length > 0) {
    await c.query(
      `delete from shopify_product_sales where month = any($1::date[]) and synced_at < $2`,
      [months, syncedAt],
    );
  }
  console.log(`✓ ${written} Zeilen geschrieben`);
  await c.end();
}

main().catch((e) => { console.error("FEHLER:", e.message); process.exit(1); });
