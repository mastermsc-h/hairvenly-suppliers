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

// ---- ESt Tarif 2025 (Grundtarif) ----
export function calcESt(zvE: number): number {
  if (zvE <= 12_084) return 0;
  if (zvE <= 17_005) {
    const y = (zvE - 12_084) / 10_000;
    return (922.98 * y + 1_400) * y;
  }
  if (zvE <= 66_760) {
    const z = (zvE - 17_005) / 10_000;
    return (181.19 * z + 2_397) * z + 1_025.38;
  }
  if (zvE <= 277_825) {
    return 0.42 * zvE - 10_602.13;
  }
  return 0.45 * zvE - 18_936.88;
}

// GewSt + ESt-Kette auf einen Jahresgewinn (für Monats-Hochrechnung UND echte Jahres-Summe).
export function taxChain(gewinnJahr: number, hebesatz: number, freibetrag: number) {
  const gewstBasis = Math.max(0, gewinnJahr - freibetrag);
  const gewstMessbetrag = gewstBasis * 0.035;
  const gewstJahr = gewstMessbetrag * (hebesatz / 100);
  const gewinnNachGewSt = gewinnJahr - gewstJahr;
  const estRoh = calcESt(gewinnNachGewSt);
  const gewstAnrechnung = Math.min(estRoh, Math.max(0, gewinnJahr) * 0.038);
  const estGekuerzt = estRoh - gewstAnrechnung;
  const soli = estGekuerzt * 0.055;
  const estGesamt = estGekuerzt + soli;
  return {
    gewstBasis,
    gewstMessbetrag,
    gewstJahr,
    gewinnNachGewSt,
    estRoh,
    gewstAnrechnung,
    estGekuerzt,
    soli,
    estGesamt,
    steuerGesamt: gewstJahr + estGesamt,
  };
}

// ---- Komplette Monats-Kalkulation (pure, reagiert auf jede Eingabe) ----
export function compute(d: FinanzInput) {
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
  const tax = taxChain(gewinnJahr, d.gewstHebesatz, d.gewstFreibetrag);
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
