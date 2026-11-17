// Gewinn- und Steuerrechnung der Finanzübersicht (rein, ohne React) — genutzt von
// /finances/overview und vom Startbildschirm (Steuerkasse: Nachzahlung ESt/GewSt).
import type { FinanzInput } from "@/lib/types";

export function nettoFromBrutto(brutto: number, ustRate: number) {
  return brutto / (1 + ustRate / 100);
}
export function ust(brutto: number, ustRate: number) {
  return brutto - nettoFromBrutto(brutto, ustRate);
}

export function safeDiv(a: number, b: number) {
  return b === 0 ? 0 : a / b;
}

// ---- ESt-Tarif (Grundtarif, § 32a EStG) je Jahr ----
// Werte laut Gesetz; für spätere Jahre gilt der neueste bekannte Tarif.
type Tarif = { gfb: number; z2: number; a2: number; z3: number; a3: number; c3: number; z4: number; c4: number; c5: number; soliFreigrenze: number };
const TARIFE: Record<number, Tarif> = {
  2024: { gfb: 11_784, z2: 17_005, a2: 954.8, z3: 66_760, a3: 181.19, c3: 991.21, z4: 277_825, c4: 10_636.31, c5: 18_971.06, soliFreigrenze: 18_130 },
  2025: { gfb: 12_096, z2: 17_443, a2: 932.3, z3: 68_480, a3: 176.64, c3: 1_015.13, z4: 277_825, c4: 10_911.92, c5: 19_246.67, soliFreigrenze: 19_950 },
  2026: { gfb: 12_348, z2: 17_799, a2: 914.51, z3: 69_878, a3: 173.1, c3: 1_034.87, z4: 277_825, c4: 11_135.63, c5: 19_470.38, soliFreigrenze: 20_350 },
};
const NEUESTES_TARIFJAHR = 2026;
function tarif(jahr: number): Tarif {
  const j = Math.min(Math.max(jahr, 2024), NEUESTES_TARIFJAHR);
  return TARIFE[j];
}

export function calcESt(zvE: number, jahr: number = NEUESTES_TARIFJAHR): number {
  const t = tarif(jahr);
  const x = Math.floor(Math.max(0, zvE));
  let est: number;
  if (x <= t.gfb) est = 0;
  else if (x <= t.z2) {
    const y = (x - t.gfb) / 10_000;
    est = (t.a2 * y + 1_400) * y;
  } else if (x <= t.z3) {
    const z = (x - t.z2) / 10_000;
    est = (t.a3 * z + 2_397) * z + t.c3;
  } else if (x <= t.z4) est = 0.42 * x - t.c4;
  else est = 0.45 * x - t.c5;
  return Math.floor(est);
}

// Soli: 5,5 % mit Freigrenze und Milderungszone (11,9 % des übersteigenden Betrags).
export function calcSoli(est: number, jahr: number = NEUESTES_TARIFJAHR): number {
  const fg = tarif(jahr).soliFreigrenze;
  if (est <= fg) return 0;
  return Math.min(est * 0.055, (est - fg) * 0.119);
}

// GewSt + ESt-Kette auf einen Jahresgewinn (Einzelunternehmen, ledig, ohne weitere Einkünfte
// und ohne Sonderausgaben — also eine Obergrenze für die private Steuer).
// - Gewerbeertrag auf volle 100 € abgerundet, minus Freibetrag, × 3,5 % = Messbetrag.
// - Die Gewerbesteuer ist KEINE Betriebsausgabe (§ 4 Abs. 5b EStG) → zvE = Gewinn.
// - Anrechnung auf die ESt: 4,0 × Messbetrag (§ 35 EStG), höchstens die gezahlte GewSt.
export function taxChain(gewinnJahr: number, hebesatz: number, freibetrag: number, jahr: number = NEUESTES_TARIFJAHR) {
  const gewerbeertrag = Math.floor(Math.max(0, gewinnJahr) / 100) * 100;
  const gewstBasis = Math.max(0, gewerbeertrag - freibetrag);
  const gewstMessbetrag = gewstBasis * 0.035;
  const gewstJahr = gewstMessbetrag * (hebesatz / 100);
  const zvE = Math.max(0, gewinnJahr);
  const estRoh = calcESt(zvE, jahr);
  const gewstAnrechnung = Math.min(estRoh, gewstJahr, gewstMessbetrag * 4);
  const estGekuerzt = estRoh - gewstAnrechnung;
  const soli = calcSoli(estGekuerzt, jahr);
  const estGesamt = estGekuerzt + soli;
  return {
    gewstBasis,
    gewstMessbetrag,
    gewstJahr,
    zvE,
    estRoh,
    gewstAnrechnung,
    estGekuerzt,
    soli,
    estGesamt,
    steuerGesamt: gewstJahr + estGesamt,
  };
}

// ---- Komplette Monats-Kalkulation (pure, reagiert auf jede Eingabe) ----
export function compute(d: FinanzInput, jahr?: number) {
  // Revenue
  const salonNetto = nettoFromBrutto(d.salonBrutto, d.ustRate);
  const salonUst = ust(d.salonBrutto, d.ustRate);
  const shopNetto = nettoFromBrutto(d.shopBrutto, d.ustRate);
  const shopUst = ust(d.shopBrutto, d.ustRate);
  const totalBrutto = d.salonBrutto + d.shopBrutto;
  const totalNetto = salonNetto + shopNetto;
  const totalUstEinnahmen = salonUst + shopUst;

  // A. Personnel
  const personnelRows = d.employees.map((e) => ({
    ...e,
    ag: e.brutto * (d.agRate / 100),
    total: e.brutto * (1 + d.agRate / 100),
  }));
  const personnelBrutto = personnelRows.reduce((s, r) => s + r.brutto, 0);
  const personnelAg = personnelRows.reduce((s, r) => s + r.ag, 0);
  const personnelTotal = personnelRows.reduce((s, r) => s + r.total, 0);

  // B. Material
  const matSalonBrutto = d.salonBrutto * (d.salonMaterialRate / 100);
  const matSalonNetto = nettoFromBrutto(matSalonBrutto, 19);
  const matSalonVst = ust(matSalonBrutto, 19);
  const matShopBrutto = d.shopBrutto * (d.shopMaterialRate / 100);
  const matShopNetto = nettoFromBrutto(matShopBrutto, 19);
  const matShopVst = ust(matShopBrutto, 19);
  const matTotalBrutto = matSalonBrutto + matShopBrutto;
  const matTotalNetto = matSalonNetto + matShopNetto;
  const matTotalVst = matSalonVst + matShopVst;

  // C. Shopify
  const shopifyFees = shopNetto * (d.shopFeeRate / 100);
  const shopifyTotal = d.shopifyPlan + d.shopifyPos + d.shopifyApps + shopifyFees;

  // D. Shipping
  const shippingBrutto = d.shippingCount * d.shippingPrice;
  const shippingNetto = nettoFromBrutto(shippingBrutto, 19);
  const shippingVst = ust(shippingBrutto, 19);

  // E. Other
  const otherTotal = d.otherExpenses.reduce((s, e) => s + e.netto, 0);
  const otherVst = d.otherExpenses.reduce((s, e) => s + e.netto * (e.ustRate / 100), 0);
  const otherBrutto = d.otherExpenses.reduce((s, e) => s + e.netto * (1 + e.ustRate / 100), 0);

  // Totals
  const totalExpensesNetto = personnelTotal + matTotalNetto + shopifyTotal + shippingNetto + otherTotal;
  const totalVorsteuer = matTotalVst + shippingVst + otherVst;
  const ustZahllast = totalUstEinnahmen - totalVorsteuer;

  // P&L (Monats-Sicht: Jahr = Hochrechnung ×12)
  const gewinnVorSteuern = totalNetto - totalExpensesNetto;
  const gewinnJahr = gewinnVorSteuern * 12;
  const tax = taxChain(gewinnJahr, d.gewstHebesatz, d.gewstFreibetrag, jahr);
  const gewstMonat = tax.gewstJahr / 12;
  const estMonat = tax.estGesamt / 12;
  const steuerMonat = tax.steuerGesamt / 12;

  const nettoGewinnMonat = gewinnVorSteuern - steuerMonat;
  const nettoGewinnJahr = gewinnJahr - tax.steuerGesamt;

  // KPIs (gegen Division durch 0 abgesichert)
  const bruttoMarge = safeDiv(gewinnVorSteuern, totalNetto);
  const nettoMarge = safeDiv(nettoGewinnMonat, totalNetto);
  const personalQuote = safeDiv(personnelTotal, totalNetto);
  const materialQuote = safeDiv(matTotalNetto, totalNetto);
  const effSteuersatz = safeDiv(tax.steuerGesamt, gewinnJahr);

  return {
    salonNetto, salonUst, shopNetto, shopUst, totalBrutto, totalNetto, totalUstEinnahmen,
    personnelRows, personnelBrutto, personnelAg, personnelTotal,
    matSalonBrutto, matSalonNetto, matSalonVst, matShopBrutto, matShopNetto, matShopVst,
    matTotalBrutto, matTotalNetto, matTotalVst,
    shopifyFees, shopifyTotal,
    shippingBrutto, shippingNetto, shippingVst,
    otherTotal, otherVst, otherBrutto,
    totalExpensesNetto, totalVorsteuer, ustZahllast,
    gewinnVorSteuern, gewinnJahr, tax, gewstMonat, estMonat, steuerMonat,
    nettoGewinnMonat, nettoGewinnJahr,
    bruttoMarge, nettoMarge, personalQuote, materialQuote, effSteuersatz,
  };
}
