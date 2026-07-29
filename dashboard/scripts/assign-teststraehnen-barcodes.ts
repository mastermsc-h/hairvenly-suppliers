/**
 * Einmalig: vergibt Barcodes + SKUs für die 41 Teststrähnen-Varianten
 * (Produkt 12117166850312, "Farbmuster Teststrähne Echthaar, usbekisch (2 g)").
 *
 * - Barcode: 8-stellig numerisch (konsistent mit bestehendem Shop-Schema),
 *   kollisionsfrei gegen ALLE existierenden Barcodes im Shop.
 * - SKU: US-TSTR-<farbcode> (konsistent mit dem SKU-System).
 *
 * Lauf:
 *   npx tsx scripts/assign-teststraehnen-barcodes.ts           # dry-run
 *   npx tsx scripts/assign-teststraehnen-barcodes.ts --apply   # live
 */

import { config } from "dotenv";
import { colorCode } from "../src/lib/sku-generator";

config({ path: ".env.local" });

const DRY_RUN = !process.argv.includes("--apply");
const SHOP_DOMAIN = process.env.SHOPIFY_SHOP_DOMAIN!;
const ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN!;
const PRODUCT_GID = "gid://shopify/Product/12117166850312";

async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://${SHOP_DOMAIN}/admin/api/2025-01/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": ACCESS_TOKEN },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as { data?: T; errors?: { message: string }[] };
  if (json.errors?.length && !json.data) throw new Error(json.errors.map((e) => e.message).join("; "));
  return json.data!;
}

async function fetchAllBarcodes(): Promise<Set<string>> {
  const out = new Set<string>();
  let cursor: string | null = null;
  while (true) {
    const d: {
      productVariants: { edges: { node: { barcode: string | null } }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
    } = await gql(
      `query($cursor: String) { productVariants(first: 250, after: $cursor) {
        edges { node { barcode } } pageInfo { hasNextPage endCursor } } }`,
      { cursor },
    );
    for (const e of d.productVariants.edges) {
      if (e.node.barcode?.trim()) out.add(e.node.barcode.trim());
    }
    if (!d.productVariants.pageInfo.hasNextPage) break;
    cursor = d.productVariants.pageInfo.endCursor;
  }
  return out;
}

/** Deterministisch-zufälliger 8-stelliger Code ohne führende Null. */
function randomBarcode(): string {
  return String(Math.floor(10000000 + Math.random() * 90000000));
}

async function main() {
  console.log(DRY_RUN ? "DRY-RUN (nichts wird geschrieben)" : "APPLY-Modus");

  const existing = await fetchAllBarcodes();
  console.log(`${existing.size} existierende Barcodes im Shop geladen.`);

  const d: {
    product: {
      title: string;
      variants: { edges: { node: { id: string; title: string; barcode: string | null; sku: string | null } }[] };
    };
  } = await gql(
    `query { product(id: "${PRODUCT_GID}") {
      title
      variants(first: 50) { edges { node { id title barcode sku } } }
    } }`,
  );

  const variants = d.product.variants.edges.map((e) => e.node);
  console.log(`Produkt: ${d.product.title} — ${variants.length} Varianten\n`);

  const usedSkus = new Set<string>();
  const plans: { id: string; title: string; barcode: string; sku: string }[] = [];

  for (const v of variants) {
    if (v.barcode?.trim()) {
      console.log(`  skip (hat schon Barcode): ${v.title}`);
      continue;
    }
    let bc = randomBarcode();
    while (existing.has(bc)) bc = randomBarcode();
    existing.add(bc);

    // SKU: US-TSTR-<farbcode> — Farbe aus Variant-Titel (z.B. "#1A Schwarze")
    const base = `US-TSTR-${colorCode(v.title)}`;
    let sku = base;
    let n = 2;
    while (usedSkus.has(sku)) sku = `${base}-${n++}`;
    usedSkus.add(sku);

    plans.push({ id: v.id, title: v.title, barcode: bc, sku });
  }

  console.log(`\n${plans.length} Varianten zu befüllen:`);
  for (const p of plans) {
    console.log(`  ${p.title.padEnd(32)} barcode=${p.barcode}  sku=${p.sku}`);
  }

  if (DRY_RUN) {
    console.log(`\n→ DRY-RUN — mit --apply ausführen.`);
    return;
  }
  if (plans.length === 0) {
    console.log("Nichts zu tun.");
    return;
  }

  const res: {
    productVariantsBulkUpdate: { productVariants: { id: string }[] | null; userErrors: { message: string }[] };
  } = await gql(
    `mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
      productVariantsBulkUpdate(productId: $productId, variants: $variants) {
        productVariants { id }
        userErrors { message }
      }
    }`,
    {
      productId: PRODUCT_GID,
      variants: plans.map((p) => ({ id: p.id, barcode: p.barcode, inventoryItem: { sku: p.sku } })),
    },
  );
  const errs = res.productVariantsBulkUpdate?.userErrors ?? [];
  if (errs.length > 0) {
    console.error("FEHLER:", errs.map((e) => e.message).join("; "));
    process.exit(1);
  }
  console.log(`\n✓ ${res.productVariantsBulkUpdate?.productVariants?.length ?? 0} Varianten aktualisiert.`);
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
