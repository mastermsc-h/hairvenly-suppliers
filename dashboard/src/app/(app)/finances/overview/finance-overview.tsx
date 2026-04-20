"use client";

import { t, type Locale } from "@/lib/i18n";
import { TrendingUp, TrendingDown, AlertTriangle } from "lucide-react";

// ---- Demo data (Oktober 2025) ----
const DEMO = {
  month: "Oktober 2025",
  salon: { brutto: 58_000, ustRate: 19, materialRate: 30, hint: "Material: 30%" },
  shop: { brutto: 182_000, ustRate: 19, materialRate: 60, feeRate: 4, hint: "Material: 60%, Gebühren: 4%" },
  employees: [
    { name: "Thao", brutto: 3_000 },
    { name: "Ailar", brutto: 2_000 },
    { name: "Tanja", brutto: 2_350 },
    { name: "Larissa", brutto: 2_600 },
    { name: "Mustafa", brutto: 2_500 },
    { name: "Dana", brutto: 3_100 },
    { name: "Aylin", brutto: 3_000 },
    { name: "Ahmet", brutto: 570 },
    { name: "Yonca (Azubi)", brutto: 900 },
    { name: "Amira (Azubi)", brutto: 900 },
    { name: "Alina", brutto: 3_000 },
    { name: "Rasul", brutto: 3_300 },
    { name: "Liah (Azubi)", brutto: 700 },
    { name: "Tuana", brutto: 1_500 },
    { name: "Berat (Azubi)", brutto: 680 },
    { name: "Aleyna", brutto: 2_600 },
    { name: "Mehmet", brutto: 4_800 },
    { name: "Mariam", brutto: 2_160 },
    { name: "Ibo", brutto: 2_300 },
  ],
  agRate: 25,
  shopify: { plan: 105, pos: 79, apps: 80 },
  shipping: { count: 900, pricePerOrder: 3.9 },
  otherExpenses: [
    { label: "Marketing", netto: 3_500, ustRate: 0 },
    { label: "Miete", netto: 2_941.18, ustRate: 19 },
    { label: "SWB (Strom)", netto: 550, ustRate: 0 },
    { label: "Amazon Bestellungen", netto: 840.34, ustRate: 19 },
    { label: "Steuerberater", netto: 1_008.40, ustRate: 19 },
    { label: "Extra Material", netto: 1_428.57, ustRate: 19 },
  ],
  gewstHebesatz: 460,
  gewstFreibetrag: 24_500,
};

// ---- Helper ----
function nettoFromBrutto(brutto: number, ustRate: number) {
  return brutto / (1 + ustRate / 100);
}
function ust(brutto: number, ustRate: number) {
  return brutto - nettoFromBrutto(brutto, ustRate);
}
function fmt(n: number) {
  return n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}
function pct(n: number) {
  return (n * 100).toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + "%";
}

// ---- ESt Tarif 2025 (Grundtarif) ----
function calcESt(zvE: number): number {
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

export default function FinanceOverview({ locale }: { locale: Locale }) {
  const d = DEMO;

  // Revenue
  const salonNetto = nettoFromBrutto(d.salon.brutto, d.salon.ustRate);
  const salonUst = ust(d.salon.brutto, d.salon.ustRate);
  const shopNetto = nettoFromBrutto(d.shop.brutto, d.shop.ustRate);
  const shopUst = ust(d.shop.brutto, d.shop.ustRate);
  const totalBrutto = d.salon.brutto + d.shop.brutto;
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
  const matSalonBrutto = d.salon.brutto * (d.salon.materialRate / 100);
  const matSalonNetto = nettoFromBrutto(matSalonBrutto, 19);
  const matSalonVst = ust(matSalonBrutto, 19);
  const matShopBrutto = d.shop.brutto * (d.shop.materialRate / 100);
  const matShopNetto = nettoFromBrutto(matShopBrutto, 19);
  const matShopVst = ust(matShopBrutto, 19);
  const matTotalBrutto = matSalonBrutto + matShopBrutto;
  const matTotalNetto = matSalonNetto + matShopNetto;
  const matTotalVst = matSalonVst + matShopVst;

  // C. Shopify
  const shopifyFees = shopNetto * (d.shop.feeRate / 100);
  const shopifyTotal = d.shopify.plan + d.shopify.pos + d.shopify.apps + shopifyFees;

  // D. Shipping
  const shippingBrutto = d.shipping.count * d.shipping.pricePerOrder;
  const shippingNetto = nettoFromBrutto(shippingBrutto, 19);
  const shippingVst = ust(shippingBrutto, 19);

  // E. Other
  const otherTotal = d.otherExpenses.reduce((s, e) => s + e.netto, 0);
  const otherVst = d.otherExpenses.reduce((s, e) => s + e.netto * (e.ustRate / 100), 0);
  const otherBrutto = d.otherExpenses.reduce((s, e) => s + e.netto * (1 + e.ustRate / 100), 0);

  // Totals
  const totalExpensesNetto = personnelTotal + matTotalNetto + shopifyTotal + shippingNetto + otherTotal;
  const totalVorsteuer = matTotalVst + shippingVst + otherVst;

  // USt
  const ustZahllast = totalUstEinnahmen - totalVorsteuer;

  // P&L
  const gewinnVorSteuern = totalNetto - totalExpensesNetto;
  const gewinnJahr = gewinnVorSteuern * 12;

  // GewSt
  const gewstBasis = Math.max(0, gewinnJahr - d.gewstFreibetrag);
  const gewstMessbetrag = gewstBasis * 0.035;
  const gewstJahr = gewstMessbetrag * (d.gewstHebesatz / 100);
  const gewstMonat = gewstJahr / 12;

  // ESt
  const gewinnNachGewSt = gewinnJahr - gewstJahr;
  const estRoh = calcESt(gewinnNachGewSt);
  const gewstAnrechnung = Math.min(estRoh, gewinnJahr * 0.038);
  const estGekuerzt = estRoh - gewstAnrechnung;
  const soli = estGekuerzt * 0.055;
  const estGesamt = estGekuerzt + soli;
  const estMonat = estGesamt / 12;

  // Total tax
  const steuerGesamt = gewstJahr + estGesamt;
  const steuerMonat = steuerGesamt / 12;

  // Net profit
  const nettoGewinnMonat = gewinnVorSteuern - steuerMonat;
  const nettoGewinnJahr = gewinnJahr - steuerGesamt;

  // KPIs
  const bruttoMarge = gewinnVorSteuern / totalNetto;
  const nettoMarge = nettoGewinnMonat / totalNetto;
  const personalQuote = personnelTotal / totalNetto;
  const materialQuote = matTotalNetto / totalNetto;
  const effSteuersatz = steuerGesamt / gewinnJahr;

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">{t(locale, "finance.title")}</h1>
          <p className="text-sm text-neutral-500 mt-1">{d.month} — Bremen (Einzelunternehmen)</p>
        </div>
        <div className="bg-amber-50 text-amber-700 text-xs font-medium px-3 py-1.5 rounded-lg border border-amber-200">
          Demo-Daten
        </div>
      </div>

      {/* EINNAHMEN */}
      <SectionCard title={t(locale, "finance.revenue")} color="blue">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200">
              <Th>{t(locale, "finance.revenue.hint")}</Th>
              <Th right>{t(locale, "finance.revenue.brutto")}</Th>
              <Th right>{t(locale, "finance.revenue.netto")}</Th>
              <Th right>{t(locale, "finance.revenue.ust")}</Th>
              <Th>{t(locale, "finance.revenue.hint")}</Th>
            </tr>
          </thead>
          <tbody>
            <Row cells={[d.salon.hint, fmt(d.salon.brutto), fmt(salonNetto), fmt(salonUst), d.salon.hint]} label={t(locale, "finance.revenue.salon")} />
            <Row cells={[d.shop.hint, fmt(d.shop.brutto), fmt(shopNetto), fmt(shopUst), d.shop.hint]} label={t(locale, "finance.revenue.shop")} />
            <SumRow cells={[fmt(totalBrutto), fmt(totalNetto), fmt(totalUstEinnahmen), ""]} label={t(locale, "finance.revenue.total")} color="green" />
          </tbody>
        </table>
      </SectionCard>

      {/* AUSGABEN */}
      <SectionCard title={t(locale, "finance.expenses")} color="orange">
        {/* A. Personalkosten */}
        <SubSection title={t(locale, "finance.expenses.personnel")} subtitle={t(locale, "finance.expenses.personnel.subtitle")}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200">
                <Th>{t(locale, "finance.expenses.personnel.employee")}</Th>
                <Th right>{t(locale, "finance.expenses.personnel.brutto")}</Th>
                <Th right>{t(locale, "finance.expenses.personnel.ag")}</Th>
                <Th right>{t(locale, "finance.expenses.personnel.total")}</Th>
              </tr>
            </thead>
            <tbody>
              {personnelRows.map((r) => (
                <tr key={r.name} className="border-b border-neutral-100">
                  <td className="py-1.5 text-neutral-700">{r.name}</td>
                  <td className="py-1.5 text-right text-neutral-700 tabular-nums">{fmt(r.brutto)}</td>
                  <td className="py-1.5 text-right text-neutral-500 tabular-nums">{fmt(r.ag)}</td>
                  <td className="py-1.5 text-right text-neutral-700 tabular-nums">{fmt(r.total)}</td>
                </tr>
              ))}
              <SumRow4 label={t(locale, "finance.expenses.personnel.sum")} cells={[fmt(personnelBrutto), fmt(personnelAg), fmt(personnelTotal)]} />
            </tbody>
          </table>
        </SubSection>

        {/* B. Materialkosten */}
        <SubSection title={t(locale, "finance.expenses.material")}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200">
                <Th>Kategorie</Th>
                <Th right>{t(locale, "finance.expenses.material.brutto")}</Th>
                <Th right>{t(locale, "finance.expenses.material.netto")}</Th>
                <Th right>{t(locale, "finance.expenses.material.vorsteuer")}</Th>
                <Th>Berechnung</Th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-neutral-100">
                <td className="py-1.5 text-neutral-700">{t(locale, "finance.expenses.material.salon")}</td>
                <td className="py-1.5 text-right tabular-nums">{fmt(matSalonBrutto)}</td>
                <td className="py-1.5 text-right tabular-nums">{fmt(matSalonNetto)}</td>
                <td className="py-1.5 text-right tabular-nums">{fmt(matSalonVst)}</td>
                <td className="py-1.5 text-neutral-500 text-xs">30% vom Salon-Umsatz</td>
              </tr>
              <tr className="border-b border-neutral-100">
                <td className="py-1.5 text-neutral-700">{t(locale, "finance.expenses.material.shop")}</td>
                <td className="py-1.5 text-right tabular-nums">{fmt(matShopBrutto)}</td>
                <td className="py-1.5 text-right tabular-nums">{fmt(matShopNetto)}</td>
                <td className="py-1.5 text-right tabular-nums">{fmt(matShopVst)}</td>
                <td className="py-1.5 text-neutral-500 text-xs">60% vom Shop-Umsatz (40% Marge)</td>
              </tr>
              <SumRow cells={[fmt(matTotalBrutto), fmt(matTotalNetto), fmt(matTotalVst), ""]} label={t(locale, "finance.expenses.material.sum")} color="yellow" />
            </tbody>
          </table>
        </SubSection>

        {/* C. Shopify-Kosten */}
        <SubSection title={t(locale, "finance.expenses.shopify")}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200">
                <Th>Kategorie</Th>
                <Th right>Betrag/Basis</Th>
                <Th right>Netto</Th>
                <Th>{t(locale, "finance.revenue.hint")}</Th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-neutral-100">
                <td className="py-1.5 text-neutral-700">{t(locale, "finance.expenses.shopify.plan")}</td>
                <td className="py-1.5 text-right tabular-nums">{fmt(d.shopify.plan)}</td>
                <td className="py-1.5 text-right tabular-nums">{fmt(d.shopify.plan)}</td>
                <td className="py-1.5 text-neutral-500 text-xs">Monatliche Gebühr (Netto)</td>
              </tr>
              <tr className="border-b border-neutral-100">
                <td className="py-1.5 text-neutral-700">{t(locale, "finance.expenses.shopify.pos")}</td>
                <td className="py-1.5 text-right tabular-nums">{fmt(d.shopify.pos)}</td>
                <td className="py-1.5 text-right tabular-nums">{fmt(d.shopify.pos)}</td>
                <td className="py-1.5 text-neutral-500 text-xs">Monatliche Gebühr (Netto)</td>
              </tr>
              <tr className="border-b border-neutral-100">
                <td className="py-1.5 text-neutral-700">{t(locale, "finance.expenses.shopify.apps")}</td>
                <td className="py-1.5 text-right tabular-nums">{fmt(d.shopify.apps)}</td>
                <td className="py-1.5 text-right tabular-nums">{fmt(d.shopify.apps)}</td>
                <td className="py-1.5 text-neutral-500 text-xs">Monatliche Gebühr (Netto)</td>
              </tr>
              <tr className="border-b border-neutral-100">
                <td className="py-1.5 text-neutral-700">{t(locale, "finance.expenses.shopify.fees")}</td>
                <td className="py-1.5 text-right tabular-nums">{fmt(shopNetto)}</td>
                <td className="py-1.5 text-right tabular-nums">{fmt(shopifyFees)}</td>
                <td className="py-1.5 text-neutral-500 text-xs">4% vom Netto-Umsatz</td>
              </tr>
              <tr className="bg-yellow-50 font-semibold">
                <td className="py-2 text-neutral-900">{t(locale, "finance.expenses.shopify.sum")}</td>
                <td className="py-2 text-right" />
                <td className="py-2 text-right tabular-nums text-yellow-700">{fmt(shopifyTotal)}</td>
                <td className="py-2 text-yellow-700 text-xs font-semibold">keine USt!</td>
              </tr>
            </tbody>
          </table>
        </SubSection>

        {/* D. Versandkosten */}
        <SubSection title={t(locale, "finance.expenses.shipping")}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200">
                <Th>Kategorie</Th>
                <Th right>Anzahl/Preis</Th>
                <Th right>Netto</Th>
                <Th right>{t(locale, "finance.expenses.material.vorsteuer")}</Th>
                <Th>Berechnung</Th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-b border-neutral-100">
                <td className="py-1.5 text-neutral-700">{t(locale, "finance.expenses.shipping.count")}</td>
                <td className="py-1.5 text-right tabular-nums">{d.shipping.count}</td>
                <td className="py-1.5" />
                <td className="py-1.5" />
                <td className="py-1.5 text-neutral-500 text-xs">Eingabe</td>
              </tr>
              <tr className="border-b border-neutral-100">
                <td className="py-1.5 text-neutral-700">{t(locale, "finance.expenses.shipping.price")}</td>
                <td className="py-1.5 text-right tabular-nums">{fmt(d.shipping.pricePerOrder)}</td>
                <td className="py-1.5" />
                <td className="py-1.5" />
                <td className="py-1.5 text-neutral-500 text-xs">Brutto mit 19% USt</td>
              </tr>
              <tr className="bg-yellow-50 font-semibold">
                <td className="py-2 text-neutral-900">{t(locale, "finance.expenses.shipping.total")}</td>
                <td className="py-2 text-right tabular-nums">{fmt(shippingBrutto)}</td>
                <td className="py-2 text-right tabular-nums text-yellow-700">{fmt(shippingNetto)}</td>
                <td className="py-2 text-right tabular-nums text-green-700">{fmt(shippingVst)}</td>
                <td className="py-2 text-neutral-500 text-xs">Automatisch berechnet</td>
              </tr>
            </tbody>
          </table>
        </SubSection>

        {/* E. Sonstige */}
        <SubSection title={t(locale, "finance.expenses.other")}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200">
                <Th>Kategorie</Th>
                <Th right>Brutto/Gesamt</Th>
                <Th right>Netto</Th>
                <Th right>{t(locale, "finance.expenses.material.vorsteuer")}</Th>
                <Th>{t(locale, "finance.revenue.hint")}</Th>
              </tr>
            </thead>
            <tbody>
              {d.otherExpenses.map((e) => {
                const brutto = e.netto * (1 + e.ustRate / 100);
                const vst = e.netto * (e.ustRate / 100);
                return (
                  <tr key={e.label} className="border-b border-neutral-100">
                    <td className="py-1.5 text-neutral-700">{e.label}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmt(brutto)}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmt(e.netto)}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmt(vst)}</td>
                    <td className="py-1.5 text-neutral-500 text-xs">{e.ustRate === 0 ? "Netto, keine Vorsteuer" : `Brutto mit ${e.ustRate}% USt`}</td>
                  </tr>
                );
              })}
              <SumRow cells={[fmt(otherBrutto), fmt(otherTotal), fmt(otherVst), ""]} label={t(locale, "finance.expenses.other.sum")} color="yellow" />
            </tbody>
          </table>
        </SubSection>

        {/* Summen */}
        <div className="mt-4 space-y-2">
          <div className="flex justify-between items-center bg-neutral-100 rounded-lg px-4 py-2 font-semibold text-sm">
            <span>{t(locale, "finance.expenses.total")}</span>
            <span className="tabular-nums">{fmt(totalExpensesNetto)}</span>
          </div>
          <div className="flex justify-between items-center bg-green-50 rounded-lg px-4 py-2 font-semibold text-sm text-green-800">
            <span>{t(locale, "finance.expenses.vorsteuer_total")}</span>
            <span className="tabular-nums">{fmt(totalVorsteuer)}</span>
          </div>
        </div>
      </SectionCard>

      {/* UMSATZSTEUER */}
      <SectionCard title={t(locale, "finance.vat")} color="red">
        <div className="space-y-2 text-sm">
          <div className="flex justify-between">
            <span className="text-neutral-600">{t(locale, "finance.vat.from_revenue")}</span>
            <span className="tabular-nums">{fmt(totalUstEinnahmen)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-600">{t(locale, "finance.vat.input_tax")}</span>
            <span className="tabular-nums text-red-600">-{fmt(totalVorsteuer)}</span>
          </div>
          <div className="flex justify-between items-center bg-red-50 rounded-lg px-4 py-2 font-bold text-red-800">
            <span>{t(locale, "finance.vat.liability")}</span>
            <div className="text-right">
              <div className="tabular-nums">{fmt(ustZahllast)}</div>
              <div className="text-xs font-normal text-red-600 tabular-nums">{fmt(ustZahllast * 12)} / Jahr</div>
            </div>
          </div>
        </div>
        <div className="mt-3 flex items-start gap-2 bg-amber-50 text-amber-800 text-xs rounded-lg px-3 py-2">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          {t(locale, "finance.vat.warning")}
        </div>
      </SectionCard>

      {/* GEWINN & VERLUST */}
      <SectionCard title={t(locale, "finance.pnl")} color="blue">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200">
              <Th>Berechnung</Th>
              <Th right>{t(locale, "finance.pnl.monthly")}</Th>
              <Th right>{t(locale, "finance.pnl.annual")}</Th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-neutral-100">
              <td className="py-1.5 text-neutral-700">{t(locale, "finance.pnl.revenue")}</td>
              <td className="py-1.5 text-right tabular-nums">{fmt(totalNetto)}</td>
              <td className="py-1.5 text-right tabular-nums">{fmt(totalNetto * 12)}</td>
            </tr>
            <tr className="border-b border-neutral-100">
              <td className="py-1.5 text-neutral-700">{t(locale, "finance.pnl.expenses")}</td>
              <td className="py-1.5 text-right tabular-nums text-red-600">-{fmt(totalExpensesNetto)}</td>
              <td className="py-1.5 text-right tabular-nums text-red-600">-{fmt(totalExpensesNetto * 12)}</td>
            </tr>
            <tr className="bg-green-50 font-bold text-green-800">
              <td className="py-2">{t(locale, "finance.pnl.profit")}</td>
              <td className="py-2 text-right tabular-nums">{fmt(gewinnVorSteuern)}</td>
              <td className="py-2 text-right tabular-nums">{fmt(gewinnJahr)}</td>
            </tr>
          </tbody>
        </table>
      </SectionCard>

      {/* STEUERN */}
      <SectionCard title={t(locale, "finance.tax")} color="red">
        {/* Gewerbesteuer */}
        <SubSection title={t(locale, "finance.tax.gewst")}>
          <div className="grid grid-cols-3 gap-y-1 text-sm">
            <span className="text-neutral-600">{t(locale, "finance.tax.gewst.profit")}</span>
            <span className="text-right tabular-nums">{fmt(gewinnJahr)}</span>
            <span />
            <span className="text-neutral-600">{t(locale, "finance.tax.gewst.freibetrag")}</span>
            <span className="text-right tabular-nums text-red-600">-{fmt(d.gewstFreibetrag)}</span>
            <span className="text-xs text-neutral-400 pl-2">Einzelunternehmen</span>
            <span className="text-neutral-600">{t(locale, "finance.tax.gewst.basis")}</span>
            <span className="text-right tabular-nums font-medium">{fmt(gewstBasis)}</span>
            <span />
            <span className="text-neutral-600">{t(locale, "finance.tax.gewst.messbetrag")}</span>
            <span className="text-right tabular-nums">{fmt(gewstMessbetrag)}</span>
            <span />
            <span className="font-semibold text-neutral-900">{t(locale, "finance.tax.gewst.amount")}</span>
            <span className="text-right tabular-nums font-semibold">{fmt(gewstJahr)}</span>
            <span className="text-right tabular-nums text-neutral-500">{fmt(gewstMonat)}/m</span>
          </div>
        </SubSection>

        {/* Einkommensteuer */}
        <SubSection title={t(locale, "finance.tax.est")}>
          <div className="grid grid-cols-3 gap-y-1 text-sm">
            <span className="text-neutral-600">{t(locale, "finance.tax.est.after_gewst")}</span>
            <span className="text-right tabular-nums">{fmt(gewinnNachGewSt)}</span>
            <span />
            <span className="text-neutral-600">{t(locale, "finance.tax.est.tariff")}</span>
            <span className="text-right tabular-nums">{fmt(estRoh)}</span>
            <span className="text-xs text-neutral-400 pl-2">Nach deutschem ESt-Tarif</span>
            <span className="text-neutral-600">{t(locale, "finance.tax.est.anrechnung")}</span>
            <span className="text-right tabular-nums text-red-600">-{fmt(gewstAnrechnung)}</span>
            <span className="text-xs text-neutral-400 pl-2">3,8% vom Gewerbeertrag</span>
            <span className="text-neutral-600">{t(locale, "finance.tax.est.reduced")}</span>
            <span className="text-right tabular-nums">{fmt(estGekuerzt)}</span>
            <span className="text-xs text-neutral-400 pl-2">Nach Anrechnung</span>
            <span className="text-neutral-600">{t(locale, "finance.tax.est.soli")}</span>
            <span className="text-right tabular-nums">{fmt(soli)}</span>
            <span className="text-xs text-neutral-400 pl-2">5,5% auf ESt</span>
            <span className="font-semibold text-neutral-900">{t(locale, "finance.tax.est.total")}</span>
            <span className="text-right tabular-nums font-semibold">{fmt(estGesamt)}</span>
            <span />
          </div>
        </SubSection>

        <div className="flex justify-between items-center bg-red-50 rounded-lg px-4 py-3 font-bold text-red-800 mt-2">
          <span>{t(locale, "finance.tax.total")}</span>
          <div className="text-right">
            <div className="tabular-nums">{fmt(steuerGesamt)}</div>
            <div className="text-xs font-normal text-red-600 tabular-nums">{fmt(steuerMonat)} / Monat</div>
          </div>
        </div>
      </SectionCard>

      {/* NETTOGEWINN */}
      <SectionCard title={t(locale, "finance.net_profit")} color="green">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200">
              <Th>Berechnung</Th>
              <Th right>{t(locale, "finance.pnl.monthly")}</Th>
              <Th right>{t(locale, "finance.pnl.annual")}</Th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-neutral-100">
              <td className="py-1.5 text-neutral-700">{t(locale, "finance.net_profit.before_tax")}</td>
              <td className="py-1.5 text-right tabular-nums">{fmt(gewinnVorSteuern)}</td>
              <td className="py-1.5 text-right tabular-nums">{fmt(gewinnJahr)}</td>
            </tr>
            <tr className="border-b border-neutral-100">
              <td className="py-1.5 text-neutral-700">{t(locale, "finance.net_profit.taxes")}</td>
              <td className="py-1.5 text-right tabular-nums text-red-600">-{fmt(steuerMonat)}</td>
              <td className="py-1.5 text-right tabular-nums text-red-600">-{fmt(steuerGesamt)}</td>
            </tr>
            <tr className="bg-green-100 font-bold text-green-900">
              <td className="py-2">
                <span className="flex items-center gap-2">
                  {t(locale, "finance.net_profit.amount")}
                  <span className="text-xs font-normal text-green-700">{t(locale, "finance.net_profit.after_all")}</span>
                </span>
              </td>
              <td className="py-2 text-right tabular-nums text-lg">{fmt(nettoGewinnMonat)}</td>
              <td className="py-2 text-right tabular-nums text-lg">{fmt(nettoGewinnJahr)}</td>
            </tr>
          </tbody>
        </table>
      </SectionCard>

      {/* KENNZAHLEN */}
      <SectionCard title={t(locale, "finance.kpi")} color="blue">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <KpiCard label={t(locale, "finance.kpi.gross_margin")} value={pct(bruttoMarge)} desc="Gewinn vor Steuern / Umsatz" />
          <KpiCard label={t(locale, "finance.kpi.net_margin")} value={pct(nettoMarge)} desc="Nettogewinn / Umsatz" />
          <KpiCard label={t(locale, "finance.kpi.personnel_ratio")} value={pct(personalQuote)} desc="Personalkosten / Umsatz" />
          <KpiCard label={t(locale, "finance.kpi.material_ratio")} value={pct(materialQuote)} desc="Materialkosten / Umsatz" />
          <KpiCard label={t(locale, "finance.kpi.effective_tax_rate")} value={pct(effSteuersatz)} desc="Steuern / Gewinn vor Steuern" />
        </div>
      </SectionCard>
    </div>
  );
}

// ---- Sub-components ----

function SectionCard({ title, color, children }: { title: string; color: "blue" | "orange" | "red" | "green"; children: React.ReactNode }) {
  const colorMap = {
    blue: "border-l-blue-500",
    orange: "border-l-amber-500",
    red: "border-l-red-500",
    green: "border-l-emerald-500",
  };
  return (
    <div className={`bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden border-l-4 ${colorMap[color]}`}>
      <div className="px-4 md:px-6 py-3 bg-neutral-50 border-b border-neutral-200">
        <h2 className="text-sm font-semibold text-neutral-900 uppercase tracking-wide">{title}</h2>
      </div>
      <div className="px-4 md:px-6 py-4">{children}</div>
    </div>
  );
}

function SubSection({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="mb-6 last:mb-0">
      <div className="mb-2">
        <h3 className="text-sm font-semibold text-neutral-800">{title}</h3>
        {subtitle && <p className="text-xs text-neutral-500">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={`py-2 text-xs font-medium text-neutral-500 uppercase tracking-wide ${right ? "text-right" : "text-left"}`}>
      {children}
    </th>
  );
}

function Row({ label, cells }: { label: string; cells: string[] }) {
  return (
    <tr className="border-b border-neutral-100">
      <td className="py-1.5 text-neutral-700">{label}</td>
      {cells.map((c, i) => (
        <td key={i} className={`py-1.5 tabular-nums ${i < cells.length - 1 ? "text-right" : "text-neutral-500 text-xs"}`}>
          {c}
        </td>
      ))}
    </tr>
  );
}

function SumRow({ label, cells, color = "yellow" }: { label: string; cells: string[]; color?: "yellow" | "green" }) {
  const bg = color === "green" ? "bg-green-50 text-green-800" : "bg-yellow-50 text-yellow-800";
  return (
    <tr className={`${bg} font-semibold`}>
      <td className="py-2">{label}</td>
      {cells.map((c, i) => (
        <td key={i} className={`py-2 tabular-nums ${i < cells.length - 1 ? "text-right" : "text-xs"}`}>
          {c}
        </td>
      ))}
    </tr>
  );
}

function SumRow4({ label, cells }: { label: string; cells: string[] }) {
  return (
    <tr className="bg-yellow-50 font-semibold text-yellow-800">
      <td className="py-2">{label}</td>
      {cells.map((c, i) => (
        <td key={i} className="py-2 text-right tabular-nums">{c}</td>
      ))}
    </tr>
  );
}

function KpiCard({ label, value, desc }: { label: string; value: string; desc: string }) {
  return (
    <div className="bg-neutral-50 rounded-xl p-3 text-center">
      <div className="text-xs font-medium text-neutral-500 uppercase tracking-wide">{label}</div>
      <div className="text-lg font-bold text-neutral-900 mt-1 tabular-nums">{value}</div>
      <div className="text-xs text-neutral-400 mt-0.5">{desc}</div>
    </div>
  );
}
