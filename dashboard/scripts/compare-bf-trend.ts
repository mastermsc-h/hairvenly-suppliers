/**
 * Trend-Vergleich: Black Friday 2025 vs. letzte 3 Monate (Mai–Jul 2026).
 *
 * Frage: kann man für BF 2026 stumpf die BF-2025-Liste bestellen, oder
 * hat sich der Mix verschoben?
 *
 * Matching NICHT über rohe Titel (Shopify-Renames!), sondern über
 * farbToken|methode|länge|qualität — gleiche Logik wie enrichAlertsWithTier.
 *
 * Output:
 *  1. Methoden-Mix beider Perioden (Anteil %)
 *  2. Auf-/Absteiger auf Produktebene (Anteils-Faktor)
 *  3. Neue Produkte (BF25 = 0, jetzt relevant)
 *  4. Empfehlung: BF-2026-Menge je Produkt = 140kg × aktueller Anteil
 *     (gegen BF-2025-Menge gestellt)
 *
 * Lauf: npx tsx scripts/compare-bf-trend.ts
 */
import { config } from "dotenv";
import { mkdirSync, writeFileSync } from "fs";
config({ path: ".env.local" });

const SHOP_DOMAIN = process.env.SHOPIFY_SHOP_DOMAIN!;
const ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN!;
const EXPECTED_BF_2026_KG = 140; // aus analyze-black-friday.ts (BF25 × Wachstum)

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

// ── Klassifikation + robuster Produkt-Key ────────────────────────
function classify(title: string, variantTitle: string | null): {
  isHair: boolean; quality: "wellig" | "glatt"; method: string; gramsPerUnit: number;
} {
  const u = title.toUpperCase();
  const isAccessory =
    /ZUBEH|KLEBER|LÖSER|LOSER|REMOVER|BÜRSTE|BUERSTE|ENTFERNER|KAMM|KLAMMER|MICRORING|ZANGE|SCHABLONE|FADEN|SHAMPOO|CONDITIONER|MASKE|SPRAY|PFLEGE|FARBRING|TESTSTRÄHNE|FARBMUSTER|THERMOBÜRSTE|GUTSCHEIN|GIFT|MORFOSE|GLYNT|TREATMENT/.test(u);
  if (isAccessory) return { isHair: false, quality: "glatt", method: "Zubehör", gramsPerUnit: 0 };

  const quality: "wellig" | "glatt" = /BUTTERFLY/.test(u) ? "wellig" : /CLIP/.test(u) ? "glatt" : /PONYTAIL/.test(u) ? "wellig" : /RUSSISCH|RU\s|GLATT/.test(u) ? "glatt" : "wellig";
  const variantGrams = (() => {
    const m = (variantTitle ?? "").match(/(\d{2,3})\s*G/i);
    return m ? parseInt(m[1]) : 0;
  })();

  if (/CLIP/.test(u)) return { isHair: true, quality, method: "Clip-ins", gramsPerUnit: variantGrams || 150 };
  if (/PONYTAIL/.test(u)) return { isHair: true, quality, method: "Ponytail", gramsPerUnit: variantGrams || 130 };
  if (/MINI\s*TAPE/.test(u)) return { isHair: true, quality, method: "Minitapes", gramsPerUnit: 50 };
  if (/TAPE/.test(u)) return { isHair: true, quality, method: "Tapes", gramsPerUnit: 25 };
  if (/BONDING/.test(u)) return { isHair: true, quality, method: "Bondings", gramsPerUnit: 25 };
  if (/GENIUS/.test(u)) return { isHair: true, quality, method: "Genius Weft", gramsPerUnit: 50 };
  if (/BUTTERFLY/.test(u)) return { isHair: true, quality, method: "Butterfly Weft", gramsPerUnit: 50 };
  if (/INVISIBLE/.test(u)) return { isHair: true, quality, method: "Invisible Weft", gramsPerUnit: 50 };
  if (/CLASSIC/.test(u)) return { isHair: true, quality, method: "Classic Weft", gramsPerUnit: 50 };
  if (/TRESSE|WEFT/.test(u)) return { isHair: true, quality, method: "Weft", gramsPerUnit: 50 };
  return { isHair: false, quality, method: "Sonstiges", gramsPerUnit: 0 };
}

function colorToken(title: string): string {
  const m = title.toUpperCase().match(/#[A-ZÄÖÜ0-9]+(?:[\s/-][A-ZÄÖÜ0-9]+)?/);
  if (!m) return title.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 14);
  // "#SOFT BLOND" → "#SOFT-BLOND", "#1A SCHWARZE" → "#1A" (zweites Wort nur
  // behalten wenn erstes kein numerischer Code ist)
  const parts = m[0].replace(/[/-]/g, " ").split(/\s+/);
  if (/^#[A-Z0-9]*\d/.test(parts[0])) return parts[0];
  return parts.slice(0, 2).join("-");
}

function lengthOf(title: string): string {
  const m = title.toUpperCase().match(/(\d{2,3})\s*CM/);
  return m ? `${m[1]}` : "";
}

function productKey(title: string, variantTitle: string | null): string {
  const c = classify(title, variantTitle);
  const variant = /CLIP|PONYTAIL/i.test(title) && variantTitle && variantTitle !== "Default Title"
    ? `|${(variantTitle.match(/\d{2,3}/) ?? [""])[0]}g` : "";
  return `${colorToken(title)}|${c.method}|${lengthOf(title)}|${c.quality}${variant}`;
}

interface Agg { grams: number; pieces: number; revenue: number; displayTitle: string }

function aggregate(rows: Row[]): { byKey: Map<string, Agg>; totalKg: number; byMethod: Map<string, number> } {
  const byKey = new Map<string, Agg>();
  const byMethod = new Map<string, number>();
  let totalKg = 0;
  for (const r of rows) {
    const c = classify(r.title, r.variantTitle);
    if (!c.isHair) continue;
    const grams = r.quantity * c.gramsPerUnit;
    totalKg += grams / 1000;
    const mKey = `${c.method} (${c.quality})`;
    byMethod.set(mKey, (byMethod.get(mKey) ?? 0) + grams / 1000);
    const key = productKey(r.title, r.variantTitle);
    const g = byKey.get(key) ?? { grams: 0, pieces: 0, revenue: 0, displayTitle: r.title };
    g.grams += grams;
    g.pieces += r.quantity;
    g.revenue += r.total;
    g.displayTitle = r.title; // letzter gewinnt = aktuellster Titel
    byKey.set(key, g);
  }
  return { byKey, totalKg, byMethod };
}

async function main() {
  console.log("Lade Orders: BF 2025 + letzte 3 Monate (Mai–Jul 2026) …");
  const [bf1, bf2, recent] = await Promise.all([
    fetchLineItems("2025-11-14", "2025-11-20"),
    fetchLineItems("2025-11-27", "2025-11-30"),
    fetchLineItems("2026-05-01", "2026-07-31"),
  ]);

  const bf = aggregate([...bf1, ...bf2]);
  const now = aggregate(recent);

  // ── 1. Methoden-Mix ──
  console.log(`\n══════ METHODEN-MIX: BF 2025 vs. Mai–Jul 2026 ══════`);
  console.log(`(BF gesamt ${bf.totalKg.toFixed(1)} kg · letzte 3M ${now.totalKg.toFixed(1)} kg)\n`);
  console.log("Methode                        BF25-Anteil   3M-Anteil   Trend");
  const methods = new Set([...bf.byMethod.keys(), ...now.byMethod.keys()]);
  const rows: { m: string; bfPct: number; nowPct: number }[] = [];
  for (const m of methods) {
    const bfPct = ((bf.byMethod.get(m) ?? 0) / bf.totalKg) * 100;
    const nowPct = ((now.byMethod.get(m) ?? 0) / now.totalKg) * 100;
    rows.push({ m, bfPct, nowPct });
  }
  rows.sort((a, b) => b.nowPct - a.nowPct);
  for (const r of rows) {
    const trend = r.bfPct === 0 ? "★ NEU" : r.nowPct === 0 ? "✝ weg" :
      r.nowPct / r.bfPct > 1.25 ? `↑ ×${(r.nowPct / r.bfPct).toFixed(2)}` :
      r.nowPct / r.bfPct < 0.75 ? `↓ ×${(r.nowPct / r.bfPct).toFixed(2)}` : "→ stabil";
    console.log(`${r.m.padEnd(30)} ${r.bfPct.toFixed(1).padStart(8)}%  ${r.nowPct.toFixed(1).padStart(8)}%   ${trend}`);
  }

  // ── 2.-4. Produkt-Ebene ──
  const allKeys = new Set([...bf.byKey.keys(), ...now.byKey.keys()]);
  type Cmp = {
    key: string; title: string;
    bfGrams: number; nowGrams: number;
    bfShare: number; nowShare: number;
    factor: number | null; // nowShare/bfShare
    recoGrams: number;     // 140kg × nowShare
  };
  const cmps: Cmp[] = [];
  for (const k of allKeys) {
    const b = bf.byKey.get(k);
    const n = now.byKey.get(k);
    const bfShare = (b?.grams ?? 0) / (bf.totalKg * 1000);
    const nowShare = (n?.grams ?? 0) / (now.totalKg * 1000);
    cmps.push({
      key: k,
      title: (n?.displayTitle ?? b?.displayTitle ?? k),
      bfGrams: b?.grams ?? 0,
      nowGrams: n?.grams ?? 0,
      bfShare, nowShare,
      factor: bfShare > 0 ? nowShare / bfShare : null,
      recoGrams: Math.round((EXPECTED_BF_2026_KG * 1000 * nowShare) / 25) * 25,
    });
  }

  const relevant = cmps.filter((c) => c.bfShare >= 0.003 || c.nowShare >= 0.003);

  console.log(`\n══════ AUFSTEIGER (Anteil ≥ +50% vs. BF25, min. Relevanz) ══════`);
  for (const c of relevant.filter((c) => c.factor !== null && c.factor > 1.5).sort((a, b) => b.nowShare - a.nowShare).slice(0, 15)) {
    console.log(`  ×${c.factor!.toFixed(1).padStart(4)}  3M: ${String(c.nowGrams).padStart(5)}g · BF25: ${String(c.bfGrams).padStart(5)}g → Empf. ${String(c.recoGrams).padStart(5)}g  ${c.title.slice(0, 55)}`);
  }

  console.log(`\n══════ ★ NEUE PRODUKTE (gab es beim BF25 nicht) ══════`);
  for (const c of relevant.filter((c) => c.bfGrams === 0 && c.nowGrams > 0).sort((a, b) => b.nowGrams - a.nowGrams).slice(0, 15)) {
    console.log(`  3M: ${String(c.nowGrams).padStart(5)}g → Empf. ${String(c.recoGrams).padStart(5)}g  ${c.title.slice(0, 60)}`);
  }

  console.log(`\n══════ ABSTEIGER (Anteil ≤ −50%) ══════`);
  for (const c of relevant.filter((c) => c.factor !== null && c.factor < 0.5).sort((a, b) => b.bfShare - a.bfShare).slice(0, 15)) {
    console.log(`  ×${c.factor!.toFixed(1).padStart(4)}  BF25: ${String(c.bfGrams).padStart(5)}g · 3M: ${String(c.nowGrams).padStart(5)}g → Empf. ${String(c.recoGrams).padStart(5)}g  ${c.title.slice(0, 55)}`);
  }

  // ── CSV: komplette Empfehlungsliste ──
  const csv = ["Produkt;BF25 Gramm;3M Gramm;Trend-Faktor;Empfehlung BF26 Gramm"];
  for (const c of cmps.filter((c) => c.recoGrams > 0 || c.bfGrams > 0).sort((a, b) => b.recoGrams - a.recoGrams)) {
    csv.push(`"${c.title}";${c.bfGrams};${c.nowGrams};${c.factor !== null ? c.factor.toFixed(2) : "NEU"};${c.recoGrams}`);
  }
  mkdirSync("scripts/output", { recursive: true });
  writeFileSync("scripts/output/bf-2026-empfehlung.csv", csv.join("\n"), "utf-8");
  console.log(`\n✓ Komplette Empfehlungsliste: scripts/output/bf-2026-empfehlung.csv`);
  console.log(`  (Empfehlung = ${EXPECTED_BF_2026_KG}kg Gesamt-BF-Erwartung × aktueller 3M-Anteil, auf 25g gerundet)`);
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
