/**
 * Black-Friday-Analyse 2025 → Bestellplanung 2026.
 *
 * Fenster:
 *   Aktion 1: 14.–20.11.2025 (7 Tage)
 *   Aktion 2: 27.–30.11.2025 (4 Tage)
 *   Baseline: 14.10.–13.11.2025 (31 Tage Normalgeschäft davor)
 *   YoY:      Jun+Jul 2025 vs Jun+Jul 2026 (Wachstumsfaktor)
 *
 * Gramm-Logik = COLL_MAP des Apps Scripts: Tapes 25g/Stk, Minitapes 50g,
 * Bondings 25g, Wefts/Tressen 50g, Clip-ins/Ponytail aus Variant-Titel.
 *
 * Lauf: npx tsx scripts/analyze-black-friday.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

const SHOP_DOMAIN = process.env.SHOPIFY_SHOP_DOMAIN!;
const ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN!;

interface LineItem {
  title: string;
  variantTitle: string | null;
  quantity: number;
  originalTotal: number;
}
interface Order {
  createdAt: string;
  cancelledAt: string | null;
  total: number;
  discountCodes: string[];
  lineItems: LineItem[];
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

async function fetchOrders(from: string, to: string): Promise<Order[]> {
  const out: Order[] = [];
  let cursor: string | null = null;
  const q = `created_at:>=${from}T00:00:00+01:00 created_at:<=${to}T23:59:59+01:00`;
  while (true) {
    const d: {
      orders: {
        edges: { node: {
          createdAt: string; cancelledAt: string | null;
          currentTotalPriceSet: { shopMoney: { amount: string } };
          discountCodes: string[];
          lineItems: { edges: { node: {
            title: string; variantTitle: string | null; quantity: number;
            originalTotalSet: { shopMoney: { amount: string } };
          } }[] };
        } }[];
        pageInfo: { hasNextPage: boolean; endCursor: string | null };
      };
    } = await gql(
      `query($q: String!, $cursor: String) {
        orders(first: 100, after: $cursor, query: $q) {
          edges { node {
            createdAt cancelledAt
            currentTotalPriceSet { shopMoney { amount } }
            discountCodes
            lineItems(first: 60) { edges { node {
              title variantTitle quantity
              originalTotalSet { shopMoney { amount } }
            } } }
          } }
          pageInfo { hasNextPage endCursor }
        }
      }`,
      { q, cursor },
    );
    for (const e of d.orders.edges) {
      const n = e.node;
      out.push({
        createdAt: n.createdAt,
        cancelledAt: n.cancelledAt,
        total: parseFloat(n.currentTotalPriceSet.shopMoney.amount),
        discountCodes: n.discountCodes,
        lineItems: n.lineItems.edges.map((le) => ({
          title: le.node.title,
          variantTitle: le.node.variantTitle,
          quantity: le.node.quantity,
          originalTotal: parseFloat(le.node.originalTotalSet.shopMoney.amount),
        })),
      });
    }
    if (!d.orders.pageInfo.hasNextPage) break;
    cursor = d.orders.pageInfo.endCursor;
  }
  return out.filter((o) => !o.cancelledAt);
}

// ── Klassifikation (Titel-basiert, Reihenfolge wichtig: CLIP vor INVISIBLE) ──
function classify(title: string, variantTitle: string | null): {
  quality: "wellig" | "glatt" | "zubehoer";
  method: string;
  gramsPerUnit: number;
} {
  const u = title.toUpperCase();
  const isAccessory =
    /ZUBEH|KLEBER|BÜRSTE|BUERSTE|ENTFERNER|KAMM|KLAMMER|MICRORING|ZANGE|SCHABLONE|FADEN|SHAMPOO|CONDITIONER|MASKE|SPRAY|PFLEGE|FARBRING|TESTSTRÄHNE|FARBMUSTER|THERMOBÜRSTE|GUTSCHEIN|GIFT/.test(u);
  if (isAccessory) return { quality: "zubehoer", method: "Zubehör", gramsPerUnit: 0 };

  const quality: "wellig" | "glatt" =
    /WELLIG|USBEKISCH|BUTTERFLY/.test(u) ? "wellig" : "glatt";

  const variantGrams = (() => {
    const m = (variantTitle ?? "").match(/(\d{2,3})\s*G/i);
    return m ? parseInt(m[1]) : 0;
  })();

  if (/CLIP/.test(u)) return { quality, method: "Clip-ins", gramsPerUnit: variantGrams || 150 };
  if (/PONYTAIL/.test(u)) return { quality, method: "Ponytail", gramsPerUnit: variantGrams || 130 };
  if (/MINI\s*TAPE/.test(u)) return { quality, method: "Minitapes", gramsPerUnit: 50 };
  if (/TAPE/.test(u)) return { quality, method: quality === "glatt" ? "Standard Tapes" : "Tapes", gramsPerUnit: 25 };
  if (/BONDING/.test(u)) return { quality, method: "Bondings", gramsPerUnit: 25 };
  if (/GENIUS/.test(u)) return { quality, method: "Genius Weft", gramsPerUnit: 50 };
  if (/INVISIBLE|BUTTERFLY/.test(u)) return { quality, method: "Invisible Weft", gramsPerUnit: 50 };
  if (/CLASSIC/.test(u)) return { quality, method: "Classic Weft", gramsPerUnit: 50 };
  if (/TRESSE|WEFT/.test(u)) return { quality, method: "Weft (sonstige)", gramsPerUnit: 50 };
  return { quality: "zubehoer", method: "Sonstiges", gramsPerUnit: 0 };
}

function lengthOf(title: string): string {
  const m = title.toUpperCase().match(/(\d{2,3})\s*CM/);
  return m ? `${m[1]}cm` : "";
}

interface WindowStats {
  label: string;
  days: number;
  orders: number;
  revenue: number;
  hairKg: number;
  welligKg: number;
  glattKg: number;
  byMethod: Map<string, { kg: number; pieces: number }>;
  byProduct: Map<string, { kg: number; pieces: number; revenue: number }>;
  discountOrders: number;
}

function analyzeWindow(label: string, days: number, orders: Order[]): WindowStats {
  const s: WindowStats = {
    label, days, orders: orders.length, revenue: 0, hairKg: 0, welligKg: 0, glattKg: 0,
    byMethod: new Map(), byProduct: new Map(), discountOrders: 0,
  };
  for (const o of orders) {
    s.revenue += o.total;
    if (o.discountCodes.length > 0) s.discountOrders++;
    for (const li of o.lineItems) {
      const c = classify(li.title, li.variantTitle);
      if (c.quality === "zubehoer") continue;
      const grams = li.quantity * c.gramsPerUnit;
      s.hairKg += grams / 1000;
      if (c.quality === "wellig") s.welligKg += grams / 1000;
      else s.glattKg += grams / 1000;

      const methodKey = `${c.method} ${lengthOf(li.title)} (${c.quality})`.replace(/\s+/g, " ").trim();
      const m = s.byMethod.get(methodKey) ?? { kg: 0, pieces: 0 };
      m.kg += grams / 1000; m.pieces += li.quantity;
      s.byMethod.set(methodKey, m);

      const p = s.byProduct.get(li.title) ?? { kg: 0, pieces: 0, revenue: 0 };
      p.kg += grams / 1000; p.pieces += li.quantity; p.revenue += li.originalTotal;
      s.byProduct.set(li.title, p);
    }
  }
  return s;
}

function printWindow(s: WindowStats, baselinePerDayKg?: number) {
  console.log(`\n════ ${s.label} (${s.days} Tage) ════`);
  console.log(`  Orders: ${s.orders} · Umsatz: ${s.revenue.toFixed(0)}€ · davon mit Rabattcode: ${s.discountOrders}`);
  console.log(`  Haar verkauft: ${s.hairKg.toFixed(1)} kg  (Wellig ${s.welligKg.toFixed(1)} / Glatt ${s.glattKg.toFixed(1)})`);
  console.log(`  Ø pro Tag: ${(s.hairKg / s.days).toFixed(2)} kg/Tag`);
  if (baselinePerDayKg) {
    console.log(`  → Uplift vs. Baseline: ×${((s.hairKg / s.days) / baselinePerDayKg).toFixed(2)}`);
  }
  console.log(`  Nach Methode:`);
  for (const [k, v] of [...s.byMethod.entries()].sort((a, b) => b[1].kg - a[1].kg)) {
    console.log(`    ${k.padEnd(38)} ${v.kg.toFixed(1).padStart(6)} kg  (${v.pieces} Stk)`);
  }
  console.log(`  Top 12 Produkte nach kg:`);
  for (const [k, v] of [...s.byProduct.entries()].sort((a, b) => b[1].kg - a[1].kg).slice(0, 12)) {
    console.log(`    ${v.kg.toFixed(1).padStart(5)} kg · ${String(v.pieces).padStart(3)} Stk · ${v.revenue.toFixed(0).padStart(5)}€ · ${k.slice(0, 60)}`);
  }
}

async function main() {
  console.log("Lade Shopify-Orders …");
  const [bf1, bf2, baseline, yoY25, yoY26] = await Promise.all([
    fetchOrders("2025-11-14", "2025-11-20"),
    fetchOrders("2025-11-27", "2025-11-30"),
    fetchOrders("2025-10-14", "2025-11-13"),
    fetchOrders("2025-06-01", "2025-07-31"),
    fetchOrders("2026-06-01", "2026-07-31"),
  ]);

  const sBase = analyzeWindow("BASELINE Normalgeschäft 14.10.–13.11.2025", 31, baseline);
  const basePerDay = sBase.hairKg / sBase.days;
  const s1 = analyzeWindow("BLACK FRIDAY AKTION 1 · 14.–20.11.2025", 7, bf1);
  const s2 = analyzeWindow("BLACK FRIDAY AKTION 2 · 27.–30.11.2025", 4, bf2);
  const y25 = analyzeWindow("Jun+Jul 2025", 61, yoY25);
  const y26 = analyzeWindow("Jun+Jul 2026", 61, yoY26);

  console.log(`\n──── Baseline ────`);
  console.log(`  ${sBase.hairKg.toFixed(1)} kg in 31 Tagen = ${basePerDay.toFixed(2)} kg/Tag (Wellig ${(sBase.welligKg / 31).toFixed(2)} / Glatt ${(sBase.glattKg / 31).toFixed(2)})`);

  printWindow(s1, basePerDay);
  printWindow(s2, basePerDay);

  const growth = y26.hairKg / y25.hairKg;
  const growthRevenue = y26.revenue / y25.revenue;
  console.log(`\n════ YoY-Wachstum (Jun+Jul) ════`);
  console.log(`  2025: ${y25.hairKg.toFixed(1)} kg · ${y25.revenue.toFixed(0)}€`);
  console.log(`  2026: ${y26.hairKg.toFixed(1)} kg · ${y26.revenue.toFixed(0)}€`);
  console.log(`  Faktor: ×${growth.toFixed(2)} (kg) · ×${growthRevenue.toFixed(2)} (Umsatz)`);

  // ── Bestellempfehlung 2026 ──
  const bfDays = s1.days + s2.days;
  const bfTotalKg = s1.hairKg + s2.hairKg;
  const normalKgSameDays = basePerDay * bfDays;
  const extraKg2025 = bfTotalKg - normalKgSameDays;
  const expectedBfKg2026 = bfTotalKg * growth;
  const extraKg2026 = extraKg2025 * growth;
  const withBuffer = extraKg2026 * 1.2;
  const welligShare = (s1.welligKg + s2.welligKg) / bfTotalKg;

  console.log(`\n════ BESTELLEMPFEHLUNG BLACK FRIDAY 2026 ════`);
  console.log(`  BF 2025 gesamt (11 Aktionstage): ${bfTotalKg.toFixed(1)} kg`);
  console.log(`  Normalgeschäft gleiche Tage:     ${normalKgSameDays.toFixed(1)} kg`);
  console.log(`  → BF-MEHRverkauf 2025:           ${extraKg2025.toFixed(1)} kg`);
  console.log(`  × Wachstum ${growth.toFixed(2)}:                ${extraKg2026.toFixed(1)} kg Mehrbedarf 2026`);
  console.log(`  + 20% Sicherheitspuffer:         ${withBuffer.toFixed(1)} kg ZUSÄTZLICH bestellen`);
  console.log(`  Erwarteter BF-Gesamtabsatz 2026: ${expectedBfKg2026.toFixed(1)} kg (in den Aktionstagen)`);
  console.log(`  Aufteilung nach 2025-Mix: Wellig ${(withBuffer * welligShare).toFixed(1)} kg · Glatt ${(withBuffer * (1 - welligShare)).toFixed(1)} kg`);
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
