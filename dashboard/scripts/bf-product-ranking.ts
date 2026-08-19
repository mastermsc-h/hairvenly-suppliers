/**
 * Komplette Produkt-Rangliste der Black-Friday-Zeiträume 2025
 * (14.–20.11. + 27.–30.11. kombiniert). Gerankt nach kg, Zubehör
 * (ohne Haargewicht) am Ende nach Stück.
 *
 * Schreibt zusätzlich eine CSV: scripts/output/bf-2025-ranking.csv
 *
 * Lauf: npx tsx scripts/bf-product-ranking.ts
 */
import { config } from "dotenv";
import { mkdirSync, writeFileSync } from "fs";
config({ path: ".env.local" });

const SHOP_DOMAIN = process.env.SHOPIFY_SHOP_DOMAIN!;
const ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN!;

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

interface Row { title: string; variantTitle: string | null; quantity: number; total: number }

async function fetchLineItems(from: string, to: string): Promise<Row[]> {
  const out: Row[] = [];
  let cursor: string | null = null;
  const q = `created_at:>=${from}T00:00:00+01:00 created_at:<=${to}T23:59:59+01:00`;
  while (true) {
    const d: {
      orders: {
        edges: { node: {
          cancelledAt: string | null;
          lineItems: { edges: { node: { title: string; variantTitle: string | null; quantity: number; originalTotalSet: { shopMoney: { amount: string } } } }[] };
        } }[];
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    } = await gql(
      `query($q: String!, $cursor: String) {
        orders(first: 100, after: $cursor, query: $q) {
          edges { node {
            cancelledAt
            lineItems(first: 60) { edges { node { title variantTitle quantity originalTotalSet { shopMoney { amount } } } } }
          } }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { q, cursor },
    );
    for (const e of d.orders.edges) {
      if (e.node.cancelledAt) continue;
      for (const le of e.node.lineItems.edges) {
        out.push({
          title: le.node.title,
          variantTitle: le.node.variantTitle,
          quantity: le.node.quantity,
          total: parseFloat(le.node.originalTotalSet.shopMoney.amount),
        });
      }
    }
    if (!d.orders.pageInfo.hasNextPage) break;
    cursor = d.orders.pageInfo.endCursor;
  }
  return out;
}

function gramsPerUnit(title: string, variantTitle: string | null): number {
  const u = title.toUpperCase();
  const isAccessory =
    /ZUBEH|KLEBER|LÖSER|LOSER|REMOVER|BÜRSTE|BUERSTE|ENTFERNER|KAMM|KLAMMER|MICRORING|ZANGE|SCHABLONE|FADEN|SHAMPOO|CONDITIONER|MASKE|SPRAY|PFLEGE|FARBRING|TESTSTRÄHNE|FARBMUSTER|THERMOBÜRSTE|GUTSCHEIN|GIFT/.test(u);
  if (isAccessory) return 0;
  const variantGrams = (() => {
    const m = (variantTitle ?? "").match(/(\d{2,3})\s*G/i);
    return m ? parseInt(m[1]) : 0;
  })();
  if (/CLIP/.test(u)) return variantGrams || 150;
  if (/PONYTAIL/.test(u)) return variantGrams || 130;
  if (/MINI\s*TAPE/.test(u)) return 50;
  if (/TAPE/.test(u)) return 25;
  if (/BONDING/.test(u)) return 25;
  if (/GENIUS|INVISIBLE|BUTTERFLY|CLASSIC|TRESSE|WEFT/.test(u)) return 50;
  return 0;
}

async function main() {
  console.log("Lade Orders beider Aktionsfenster …");
  const [w1, w2] = await Promise.all([
    fetchLineItems("2025-11-14", "2025-11-20"),
    fetchLineItems("2025-11-27", "2025-11-30"),
  ]);

  type Agg = { pieces: number; kg: number; revenue: number; a1Pieces: number; a2Pieces: number };
  const byProduct = new Map<string, Agg>();
  const add = (rows: Row[], which: 1 | 2) => {
    for (const r of rows) {
      // Clip-Varianten getrennt ausweisen (100g/150g/225g sind eigene Artikel)
      const isVariant = /CLIP|PONYTAIL/i.test(r.title) && r.variantTitle && r.variantTitle !== "Default Title";
      const key = isVariant ? `${r.title} › ${r.variantTitle}` : r.title;
      const g = byProduct.get(key) ?? { pieces: 0, kg: 0, revenue: 0, a1Pieces: 0, a2Pieces: 0 };
      g.pieces += r.quantity;
      g.kg += (r.quantity * gramsPerUnit(r.title, r.variantTitle)) / 1000;
      g.revenue += r.total;
      if (which === 1) g.a1Pieces += r.quantity; else g.a2Pieces += r.quantity;
      byProduct.set(key, g);
    }
  };
  add(w1, 1);
  add(w2, 2);

  const all = [...byProduct.entries()];
  const hair = all.filter(([, v]) => v.kg > 0).sort((a, b) => b[1].kg - a[1].kg);
  const accessories = all.filter(([, v]) => v.kg === 0).sort((a, b) => b[1].pieces - a[1].pieces);

  const csv: string[] = ["Rang;Produkt;Gramm;Stück;Umsatz EUR;Stück Aktion1;Stück Aktion2"];

  console.log(`\n══════ GESAMTRANKING BLACK FRIDAY 2025 (beide Aktionen, ${hair.length} Haar-Produkte) ══════\n`);
  console.log("Rang   Gramm   Stk   Umsatz   A1/A2   Produkt");
  console.log("─".repeat(110));
  hair.forEach(([title, v], i) => {
    const grams = Math.round(v.kg * 1000);
    const line = `${String(i + 1).padStart(3)}. ${String(grams).padStart(6)}g ${String(v.pieces).padStart(4)} Stk ${v.revenue.toFixed(0).padStart(6)}€  ${String(v.a1Pieces).padStart(3)}/${String(v.a2Pieces).padEnd(3)}  ${title.slice(0, 70)}`;
    console.log(line);
    csv.push(`${i + 1};"${title}";${grams};${v.pieces};${v.revenue.toFixed(0)};${v.a1Pieces};${v.a2Pieces}`);
  });

  console.log(`\n══════ ZUBEHÖR / SONSTIGES (${accessories.length} Produkte, nach Stück) ══════\n`);
  accessories.forEach(([title, v], i) => {
    console.log(`${String(i + 1).padStart(3)}. ${String(v.pieces).padStart(4)} Stk  ${v.revenue.toFixed(0).padStart(6)}€  ${title.slice(0, 70)}`);
    csv.push(`Z${i + 1};"${title}";0;${v.pieces};${v.revenue.toFixed(0)};;`);
  });

  mkdirSync("scripts/output", { recursive: true });
  writeFileSync("scripts/output/bf-2025-ranking.csv", csv.join("\n"), "utf-8");
  console.log(`\n✓ CSV geschrieben: scripts/output/bf-2025-ranking.csv`);
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
