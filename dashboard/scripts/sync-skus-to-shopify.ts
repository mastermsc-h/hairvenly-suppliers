/**
 * Push SKUs aus product_colors zu Shopify variant.sku.
 *
 * Lauf mit:
 *   npx tsx scripts/sync-skus-to-shopify.ts             # dry-run (zeigt was passieren würde)
 *   npx tsx scripts/sync-skus-to-shopify.ts --apply     # tatsächlich pushen
 *
 * Vorgehen:
 *   1. Lade alle product_colors mit sku + name_shopify
 *   2. Match jede Farbe gegen Shopify-Produkt via name_shopify (normalisiert)
 *   3. Pro Variante des Shopify-Produkts:
 *        - Non-Clip-Ins (1 variante): sku = base sku
 *        - Clip-Ins (3 varianten): sku = base sku + variant suffix (-100G/-150G/-225G)
 *   4. productVariantUpdate via Shopify Admin GraphQL API
 *   5. Berichte zähle erfolg/fehler/skipped
 */

import { config } from "dotenv";
import { Client } from "pg";

config({ path: ".env.local" });

const DRY_RUN = !process.argv.includes("--apply");
const SHOP_DOMAIN = process.env.SHOPIFY_SHOP_DOMAIN!;
const ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN!;
const DB_URL = "postgresql://postgres.xzisnlkqiomvmbslwhvg:yPa1PNWr0KozQlPP@aws-1-eu-central-1.pooler.supabase.com:5432/postgres";

if (!SHOP_DOMAIN || !ACCESS_TOKEN) {
  console.error("ERROR: SHOPIFY_SHOP_DOMAIN and SHOPIFY_ACCESS_TOKEN must be set in .env.local");
  process.exit(1);
}

interface ColorRow {
  color_id: string;
  sku: string;
  name_hairvenly: string;
  name_shopify: string | null;
  method_name: string;
  length_value: string;
}

interface ShopifyVariant {
  id: string;          // gid://shopify/ProductVariant/...
  title: string | null;
  sku: string | null;
}

interface ShopifyProduct {
  id: string;        // gid://shopify/Product/...
  title: string;
  variants: { edges: { node: ShopifyVariant }[] };
}

function normalize(s: string): string {
  return s.toUpperCase().replace(/\s+/g, " ").replace(/[♡]/g, "").trim();
}

async function graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://${SHOP_DOMAIN}/admin/api/2025-01/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": ACCESS_TOKEN,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors && json.errors.length > 0 && !json.data) {
    throw new Error(`GraphQL: ${json.errors.map((e) => e.message).join("; ")}`);
  }
  return json.data!;
}

async function fetchAllShopifyProducts(): Promise<ShopifyProduct[]> {
  const out: ShopifyProduct[] = [];
  let cursor: string | null = null;
  console.log("Fetching all Shopify products...");
  let pageNum = 0;
  while (true) {
    pageNum++;
    const data = await graphql<{
      products: { edges: { node: ShopifyProduct }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
    }>(
      `query($cursor: String) {
        products(first: 250, after: $cursor) {
          edges { node { id title variants(first: 50) { edges { node { id title sku } } } } }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { cursor },
    );
    for (const e of data.products.edges) out.push(e.node);
    process.stdout.write(`  page ${pageNum}: ${out.length} loaded\r`);
    if (!data.products.pageInfo.hasNextPage) break;
    cursor = data.products.pageInfo.endCursor;
  }
  console.log(`\n  ✓ ${out.length} Shopify products loaded.`);
  return out;
}

function variantSuffix(variantTitle: string | null): string | null {
  // Sucht "100g", "150g", "225g" o.ä. im variant-titel
  if (!variantTitle) return null;
  const m = variantTitle.match(/(\d{2,4})\s*g/i);
  if (!m) return null;
  return m[1] + "G";
}

async function main() {
  console.log(DRY_RUN ? "DRY-RUN mode (no changes)" : "APPLY mode (will push to Shopify)");
  console.log("");

  // 1) Load colors from DB
  const db = new Client({ connectionString: DB_URL });
  await db.connect();
  const { rows } = await db.query<ColorRow>(`
    SELECT pc.id AS color_id, pc.sku, pc.name_hairvenly, pc.name_shopify,
           pm.name AS method_name, pl.value AS length_value
    FROM product_colors pc
    JOIN product_lengths pl ON pl.id = pc.length_id
    JOIN product_methods pm ON pm.id = pl.method_id
    WHERE pc.sku IS NOT NULL AND pc.name_shopify IS NOT NULL AND pc.name_shopify <> ''
    ORDER BY pm.name, pl.value, pc.name_hairvenly
  `);
  await db.end();
  console.log(`Loaded ${rows.length} colors with SKU + name_shopify from DB.`);

  // 2) Load all Shopify products + variants
  const products = await fetchAllShopifyProducts();

  // 3) Build product index by normalized title
  const byTitle = new Map<string, ShopifyProduct>();
  for (const p of products) byTitle.set(normalize(p.title), p);

  // 4) Match each color to a product and figure out target SKUs per variant.
  //    Gruppiert nach productId, weil Shopify Bulk-Update pro produkt arbeitet.
  type Plan = { variantId: string; currentSku: string | null; newSku: string; productTitle: string; reason: string };
  const plansByProductId = new Map<string, Plan[]>();
  let noMatch = 0;
  let alreadyOk = 0;

  for (const c of rows) {
    const product = byTitle.get(normalize(c.name_shopify!));
    if (!product) {
      noMatch++;
      continue;
    }
    const isClipIn = /clip[\s-]*in/i.test(c.method_name);
    const variants = product.variants.edges.map((e) => e.node);
    const productPlans = plansByProductId.get(product.id) ?? [];

    if (!isClipIn) {
      for (const v of variants) {
        if (v.sku === c.sku) {
          alreadyOk++;
          continue;
        }
        productPlans.push({
          variantId: v.id,
          currentSku: v.sku,
          newSku: c.sku,
          productTitle: product.title,
          reason: "non-clipin",
        });
      }
    } else {
      // Clip-Ins: DB hat eine row PRO Gewichts-Variante (100g/150g/225g),
      // also pro DB-row NUR die passende Shopify-Variant updaten — nicht
      // alle Variants des produkts (sonst gibt's 'duplicated input' wenn
      // 3 DB-rows alle 3 Shopify-Variants treffen wollen).
      const dbWeight = (c.length_value.match(/\d+/) ?? [""])[0];
      const matchingVariant = variants.find((v) => {
        const w = variantSuffix(v.title);
        return w === `${dbWeight}G`;
      }) ?? variants[0];
      if (!matchingVariant) continue;
      if (matchingVariant.sku === c.sku) {
        alreadyOk++;
      } else {
        productPlans.push({
          variantId: matchingVariant.id,
          currentSku: matchingVariant.sku,
          newSku: c.sku,
          productTitle: product.title,
          reason: `clipin-${dbWeight}g`,
        });
      }
    }

    if (productPlans.length > 0) plansByProductId.set(product.id, productPlans);
  }

  // Flache liste der plans NUR fuer Berichts-Zwecke (Anzahl, Beispiele)
  const plans = Array.from(plansByProductId.values()).flat();

  console.log(`\n--- Summary ---`);
  console.log(`  Plans to apply: ${plans.length}`);
  console.log(`  Already in sync: ${alreadyOk}`);
  console.log(`  No Shopify match (skipped): ${noMatch}`);

  if (plans.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  console.log("\n--- First 20 planned updates: ---");
  for (const p of plans.slice(0, 20)) {
    console.log(`  [${p.reason.padEnd(15)}] ${(p.currentSku ?? "(empty)").padEnd(28)} → ${p.newSku.padEnd(28)} (${p.productTitle.slice(0, 50)})`);
  }

  if (DRY_RUN) {
    console.log(`\n→ DRY-RUN — re-run with --apply to push these ${plans.length} changes.`);
    return;
  }

  // 5) Apply via productVariantsBulkUpdate (gruppiert pro produkt)
  console.log("\n--- Applying changes ---");
  let ok = 0;
  let fail = 0;
  const productEntries = Array.from(plansByProductId.entries());
  for (let i = 0; i < productEntries.length; i++) {
    const [productId, productPlans] = productEntries[i];
    try {
      const data = await graphql<{
        productVariantsBulkUpdate: {
          productVariants: { id: string; sku: string }[] | null;
          userErrors: { field: string[]; message: string }[];
        };
      }>(
        `mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkUpdate(productId: $productId, variants: $variants) {
            productVariants { id sku }
            userErrors { field message }
          }
        }`,
        {
          productId,
          variants: productPlans.map((p) => ({ id: p.variantId, inventoryItem: { sku: p.newSku } })),
        },
      );
      const errs = data.productVariantsBulkUpdate?.userErrors ?? [];
      if (errs.length > 0) {
        fail += productPlans.length;
        console.error(`  ✗ ${productPlans[0].productTitle.slice(0, 50)}: ${errs.map((e) => e.message).join("; ")}`);
      } else {
        ok += productPlans.length;
        if (i % 10 === 0) process.stdout.write(`  ${i + 1}/${productEntries.length} products (${ok} variants)\r`);
      }
    } catch (e) {
      fail += productPlans.length;
      console.error(`  ✗ ${productPlans[0]?.productTitle?.slice(0, 50) ?? productId}:`, (e as Error).message);
    }
    // Mini-throttle: Shopify allows 2 calls/sec on standard
    await new Promise((r) => setTimeout(r, 250));
  }
  console.log(`\n--- Result: ${ok} variants updated, ${fail} failed.`);
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
