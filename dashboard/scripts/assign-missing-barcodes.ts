/**
 * Findet ALLE Shopify-Varianten ohne Barcode und vergibt welche.
 *
 * Warum: Ohne EAN wird ein Produkt in der Etiketten-Druckansicht
 * stillschweigend übersprungen ("X Produkt(e) ohne EAN übersprungen").
 * Das Produkt ist dann faktisch unsichtbar für den Etikettendruck.
 *
 * - Barcode: 8-stellig numerisch (Shop-Schema), kollisionsfrei gegen ALLE
 *   bestehenden Barcodes.
 * - SKU: nur gesetzt wenn leer. Extensions haben ihre SKU aus dem
 *   Katalog-Backfill; für Zubehör wird ZUB-<KERN>[-<VARIANTE>] erzeugt.
 *
 * Lauf:
 *   npx tsx scripts/assign-missing-barcodes.ts           # dry-run
 *   npx tsx scripts/assign-missing-barcodes.ts --apply   # live
 */

import { config } from "dotenv";

config({ path: ".env.local" });

const DRY_RUN = !process.argv.includes("--apply");
const SHOP_DOMAIN = process.env.SHOPIFY_SHOP_DOMAIN!;
const ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN!;

if (!SHOP_DOMAIN || !ACCESS_TOKEN) {
  console.error("ERROR: SHOPIFY_SHOP_DOMAIN / SHOPIFY_ACCESS_TOKEN fehlen in .env.local");
  process.exit(1);
}

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

// ── SKU-Hilfen für Zubehör ───────────────────────────────────────

const ZUB_FILLER = new Set([
  "HAIRVENLY", "ZUBEHOR", "PREMIUM", "MIT", "FUR", "UND", "DER", "DIE", "DAS",
  "STUCK", "SET", "PRO", "PACK",
]);

function normalizeWord(s: string): string {
  return s
    .toUpperCase()
    .replace(/[ÜÚ]/g, "U").replace(/[ÖÓ]/g, "O").replace(/[ÄÁ]/g, "A")
    .replace(/ß/g, "SS").replace(/[ÉÈ]/g, "E")
    .replace(/[^A-Z0-9]/g, "");
}

/** ZUB-<erstes signifikantes Wort, 6 Zeichen>[-<Variante, 6 Zeichen>] */
function accessorySku(productTitle: string, variantTitle: string | null): string {
  // Alles hinter dem ersten " - " ist meist "Hairvenly Zubehör" → abschneiden
  const core = productTitle.split(/\s[-–]\s/)[0];
  const words = core.split(/[\s,:/]+/).map(normalizeWord).filter(Boolean);
  const significant = words.filter((w) => !ZUB_FILLER.has(w) && !/^\d+$/.test(w));
  const kern = (significant[0] ?? words[0] ?? "X").slice(0, 6);
  const variant = variantTitle && variantTitle !== "Default Title"
    ? normalizeWord(variantTitle).slice(0, 6)
    : "";
  return variant ? `ZUB-${kern}-${variant}` : `ZUB-${kern}`;
}

function randomBarcode(): string {
  return String(Math.floor(10000000 + Math.random() * 90000000));
}

// ── Shop laden ───────────────────────────────────────────────────

interface VariantNode {
  id: string;
  title: string | null;
  barcode: string | null;
  sku: string | null;
}
interface ProductNode {
  id: string;
  title: string;
  collections: { edges: { node: { handle: string } }[] };
  variants: { edges: { node: VariantNode }[] };
}

// Zubehör-Erkennung: die frühere Kollektion "extensions-zubehoer" existiert
// nicht mehr, deshalb per Titel ("… Zubehör") plus den beiden Pflege-
// Kollektionen. Extensions erkennt man am Methoden-Stichwort im Titel —
// die bekommen NIE eine erfundene SKU (ihre kommt aus dem Katalog).
const ACCESSORY_HANDLES = new Set(["blessed-haarpflege", "sonstige-haarpflege"]);
const EXTENSION_TITLE = /\b(TAPE|BONDING|TRESSE|WEFT|CLIP[\s-]?IN|PONYTAIL|KERATIN)/i;

function looksLikeAccessory(title: string, handles: string[]): boolean {
  // "Zubehör" im Titel ist das stärkste Signal — schlägt Methoden-Stichwörter,
  // sonst würde "Wärmezange für Bonding Extensions" als Extension gelten.
  if (/zubeh(ö|oe)r/i.test(title)) return true;
  if (handles.some((h) => ACCESSORY_HANDLES.has(h))) return !EXTENSION_TITLE.test(title);
  return false;
}

async function main() {
  console.log(DRY_RUN ? "DRY-RUN (nichts wird geschrieben)\n" : "APPLY-Modus\n");

  const products: ProductNode[] = [];
  let cursor: string | null = null;
  while (true) {
    const d: { products: { edges: { node: ProductNode }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } } } =
      await gql(
        `query($c: String) {
          products(first: 250, after: $c) {
            edges { node {
              id title
              collections(first: 10) { edges { node { handle } } }
              variants(first: 50) { edges { node { id title barcode sku } } }
            } }
            pageInfo { hasNextPage endCursor }
          }
        }`,
        { c: cursor },
      );
    products.push(...d.products.edges.map((e) => e.node));
    if (!d.products.pageInfo.hasNextPage) break;
    cursor = d.products.pageInfo.endCursor;
  }

  const usedBarcodes = new Set<string>();
  const usedSkus = new Set<string>();
  for (const p of products) {
    for (const ve of p.variants.edges) {
      if (ve.node.barcode?.trim()) usedBarcodes.add(ve.node.barcode.trim());
      if (ve.node.sku?.trim()) usedSkus.add(ve.node.sku.trim());
    }
  }
  console.log(`${products.length} Produkte geladen · ${usedBarcodes.size} Barcodes / ${usedSkus.size} SKUs bereits vergeben.\n`);

  type Plan = { productId: string; variantId: string; label: string; barcode: string; sku: string | null };
  const byProduct = new Map<string, Plan[]>();
  let count = 0;

  for (const p of products) {
    const handles = p.collections.edges.map((c) => c.node.handle);
    const isAccessory = looksLikeAccessory(p.title, handles);
    for (const ve of p.variants.edges) {
      const v = ve.node;
      if (v.barcode?.trim()) continue;

      let bc = randomBarcode();
      while (usedBarcodes.has(bc)) bc = randomBarcode();
      usedBarcodes.add(bc);

      // SKU nur wenn leer. Extensions bekommen ihre SKU aus dem
      // Katalog-Backfill — hier nichts erfinden.
      let sku: string | null = null;
      if (!v.sku?.trim() && isAccessory) {
        const base = accessorySku(p.title, v.title);
        sku = base;
        let n = 2;
        while (usedSkus.has(sku)) sku = `${base}-${n++}`;
        usedSkus.add(sku);
      }

      const label = p.title.slice(0, 55) + (v.title && v.title !== "Default Title" ? ` › ${v.title}` : "");
      const arr = byProduct.get(p.id) ?? [];
      arr.push({ productId: p.id, variantId: v.id, label, barcode: bc, sku });
      byProduct.set(p.id, arr);
      count++;
    }
  }

  if (count === 0) {
    console.log("✓ Alle Varianten haben bereits einen Barcode.");
    return;
  }

  console.log(`${count} Varianten ohne Barcode:\n`);
  for (const plans of byProduct.values()) {
    for (const p of plans) {
      console.log(`  EAN=${p.barcode}  SKU=${(p.sku ?? "(bleibt)").padEnd(20)} ${p.label}`);
    }
  }

  if (DRY_RUN) {
    console.log(`\n→ DRY-RUN — mit --apply ausführen.`);
    return;
  }

  console.log("\n--- Schreibe nach Shopify ---");
  let ok = 0, fail = 0;
  for (const [productId, plans] of byProduct) {
    try {
      const res: { productVariantsBulkUpdate: { userErrors: { message: string }[] } } = await gql(
        `mutation($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
          productVariantsBulkUpdate(productId: $productId, variants: $variants) {
            productVariants { id }
            userErrors { message }
          }
        }`,
        {
          productId,
          variants: plans.map((p) => ({
            id: p.variantId,
            barcode: p.barcode,
            ...(p.sku ? { inventoryItem: { sku: p.sku } } : {}),
          })),
        },
      );
      const errs = res.productVariantsBulkUpdate?.userErrors ?? [];
      if (errs.length > 0) {
        fail += plans.length;
        console.error(`  ✗ ${plans[0].label}: ${errs.map((e) => e.message).join("; ")}`);
      } else {
        ok += plans.length;
      }
    } catch (e) {
      fail += plans.length;
      console.error(`  ✗ ${plans[0].label}:`, (e as Error).message);
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  console.log(`\n--- Ergebnis: ${ok} Varianten aktualisiert, ${fail} fehlgeschlagen.`);
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
