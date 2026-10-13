"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { t, type Locale } from "@/lib/i18n";
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Loader2, Plus, Trash2, Users } from "lucide-react";
import type { FinanzInput, FinanzMitarbeiter, FinanzMonatsdaten, SteuerArt, SteuerPosten } from "@/lib/types";
import { fetchFinanzJahr, saveFinanzMonat } from "@/lib/actions/finanzen";
import { fetchSteuerPosten, upsertSteuerIst } from "@/lib/actions/steuer";

// Gespeichert wird Netto; eingegeben wird (wie im Sheet) der Brutto-Rechnungsbetrag.
function fromBrutto(label: string, brutto: number, ustRate: number) {
  return { label, netto: brutto / (1 + ustRate / 100), ustRate };
}

// ---- Standardwerte für neue Monate (bisherige Demo-Werte als Startpunkt) ----
const DEFAULTS: FinanzInput = {
  salonBrutto: 58_000,
  salonMaterialRate: 30,
  shopBrutto: 182_000,
  shopMaterialRate: 60,
  shopFeeRate: 4,
  ustRate: 19,
  // Mitarbeiter kommen aus dem Mitarbeiter-Bereich (staff_members/staff_salary_changes),
  // nicht aus dem Code — echte Gehälter gehören nicht ins Client-Bundle.
  employees: [],
  agRate: 25,
  shopifyPlan: 105,
  shopifyPos: 79,
  shopifyApps: 80,
  shippingCount: 900,
  shippingPrice: 3.9,
  otherExpenses: [
    fromBrutto("Marketing", 3_500, 0),
    fromBrutto("Miete", 3_500, 19),
    fromBrutto("SWB (Strom)", 550, 0),
    fromBrutto("Amazon Bestellungen", 1_000, 19),
    fromBrutto("Steuerberater", 1_200, 19),
    fromBrutto("Extra Material", 1_700, 19),
    fromBrutto("Handyverträge", 150, 19),
    fromBrutto("Lagerkosten", 180, 19),
    fromBrutto("Wasserspender, Cafe etc.", 250, 19),
    fromBrutto("Obstkorb", 120, 7),
    // Versicherungsbeiträge sind umsatzsteuerfrei (§ 4 Nr. 10 UStG); die enthaltene
    // Versicherungsteuer ist keine abziehbare Vorsteuer.
    fromBrutto("Versicherungen Arag + VHV", 250, 0),
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
function safeDiv(a: number, b: number) {
  return b === 0 ? 0 : a / b;
}

const LOCALE_TAG: Record<Locale, string> = { de: "de-DE", en: "en-US", tr: "tr-TR" };
function monthName(locale: Locale, monat: number) {
  return new Date(2000, monat - 1, 1).toLocaleDateString(LOCALE_TAG[locale], { month: "long" });
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

// GewSt + ESt-Kette auf einen Jahresgewinn (für Monats-Hochrechnung UND echte Jahres-Summe).
function taxChain(gewinnJahr: number, hebesatz: number, freibetrag: number) {
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
function compute(d: FinanzInput) {
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

const keyOf = (jahr: number, monat: number) => `${jahr}-${monat}`;

type Props = {
  locale: Locale;
  initialJahr: number;
  initialMonat: number;
  initialRows: FinanzMonatsdaten[];
  initialSteuerPosten: SteuerPosten[];
  staffEmployees: FinanzMitarbeiter[];
};

export default function FinanceOverview({ locale, initialJahr, initialMonat, initialRows, initialSteuerPosten, staffEmployees }: Props) {
  const [jahr, setJahr] = useState(initialJahr);
  const [monat, setMonat] = useState(initialMonat);
  const [view, setView] = useState<"month" | "year">("month");
  const [saved, setSaved] = useState<Record<string, FinanzInput>>(() =>
    Object.fromEntries(initialRows.map((r) => [keyOf(r.jahr, r.monat), r.daten]))
  );
  const [loadedYears, setLoadedYears] = useState<number[]>([initialJahr]);
  const [steuerPosten, setSteuerPosten] = useState<Record<number, SteuerPosten[]>>({
    [initialJahr]: initialSteuerPosten,
  });
  const [edits, setEdits] = useState<Record<string, FinanzInput>>({});
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [yearLoading, startYearLoad] = useTransition();

  const dirtyCount = Object.keys(edits).length;

  // Ungespeicherte Änderungen nicht stillschweigend verlieren
  useEffect(() => {
    if (dirtyCount === 0) return;
    const handler = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirtyCount]);

  function changeYear(next: number) {
    setJahr(next);
    if (!loadedYears.includes(next)) {
      startYearLoad(async () => {
        const [rows, posten] = await Promise.all([fetchFinanzJahr(next), fetchSteuerPosten(next)]);
        setSaved((prev) => ({
          ...prev,
          ...Object.fromEntries(rows.map((r) => [keyOf(r.jahr, r.monat), r.daten])),
        }));
        setSteuerPosten((prev) => ({ ...prev, [next]: posten }));
        setLoadedYears((prev) => [...prev, next]);
      });
    }
  }

  // Effektive Eingaben eines Monats: lokale Edits > gespeichert > nichts
  const effective = (j: number, m: number): FinanzInput | null =>
    edits[keyOf(j, m)] ?? saved[keyOf(j, m)] ?? null;

  // Vorbefüllung für einen leeren Monat: letzter erfasster Monat davor, sonst Vorjahres-Dezember,
  // sonst Defaults mit den aktuellen Gehältern aus dem Mitarbeiter-Bereich
  function prefillFor(j: number, m: number): FinanzInput {
    for (let p = m - 1; p >= 1; p--) {
      const hit = effective(j, p);
      if (hit) return hit;
    }
    return effective(j - 1, 12) ?? { ...DEFAULTS, employees: staffEmployees };
  }

  const k = keyOf(jahr, monat);
  const isSaved = k in saved && !(k in edits);
  const isEdited = k in edits;
  const current: FinanzInput = edits[k] ?? saved[k] ?? prefillFor(jahr, monat);
  const isPrefilled = !isSaved && !isEdited;

  const c = useMemo(() => compute(current), [current]);

  function update(patch: Partial<FinanzInput>) {
    setEdits((prev) => ({ ...prev, [k]: { ...current, ...patch } }));
    setSavedFlash(false);
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    // Edits speichern; wenn keine da sind, den aktuell angezeigten (vorbefüllten) Monat anlegen
    const toSave: Array<[string, FinanzInput]> =
      dirtyCount > 0 ? Object.entries(edits) : [[k, current]];
    for (const [kk, input] of toSave) {
      const [j, m] = kk.split("-").map(Number);
      const res = await saveFinanzMonat(j, m, input);
      if (!res.ok) {
        setSaveError(res.error ?? "Fehler");
        setSaving(false);
        return;
      }
      setSaved((prev) => ({ ...prev, [kk]: input }));
      setEdits((prev) => {
        const next = { ...prev };
        delete next[kk];
        return next;
      });
    }
    setSaving(false);
    setSavedFlash(true);
  }

  // ---- Jahresansicht: echte Summen über erfasste Monate ----
  const yearMonths = useMemo(
    () =>
      Array.from({ length: 12 }, (_, i) => {
        const m = i + 1;
        const input = effective(jahr, m);
        return { monat: m, input, calc: input ? compute(input) : null };
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [jahr, saved, edits]
  );
  const recorded = yearMonths.filter((r) => r.calc);
  const yrNetto = recorded.reduce((s, r) => s + r.calc!.totalNetto, 0);
  const yrAusgaben = recorded.reduce((s, r) => s + r.calc!.totalExpensesNetto, 0);
  const yrUst = recorded.reduce((s, r) => s + r.calc!.ustZahllast, 0);
  const yrGewinn = recorded.reduce((s, r) => s + r.calc!.gewinnVorSteuern, 0);
  const lastRecorded = recorded.length ? recorded[recorded.length - 1].input! : DEFAULTS;
  const yrTax = taxChain(yrGewinn, lastRecorded.gewstHebesatz, lastRecorded.gewstFreibetrag);
  const yrNettoGewinn = yrGewinn - yrTax.steuerGesamt;

  // Finanzamt-Ist des Jahres (aus dem Steuer-Ledger): Zahlungen minus Erstattungen.
  // Lohnsteuer und EUSt laufen separat: die Lohnsteuer steckt im Bruttolohn (Personalkosten),
  // die EUSt im Material-Brutto (wird über die USt-VA als Vorsteuer verrechnet). Im Vergleich
  // mit der berechneten Steuerlast würden beide eine falsche Abweichung erzeugen.
  const jahrPosten = steuerPosten[jahr] ?? [];
  const signedIst = (p: SteuerPosten) => (p.richtung === "erstattung" ? -1 : 1) * (Number(p.ist_betrag) || 0);
  const istJahr = jahrPosten
    .filter((p) => p.art !== "lst_anmeldung" && p.art !== "eust")
    .reduce((s, p) => s + signedIst(p), 0);
  const lstJahr = jahrPosten.filter((p) => p.art === "lst_anmeldung").reduce((s, p) => s + signedIst(p), 0);
  const eustJahr = jahrPosten.filter((p) => p.art === "eust").reduce((s, p) => s + signedIst(p), 0);

  function updatePosten(j: number, p: SteuerPosten) {
    setSteuerPosten((prev) => {
      const list = prev[j] ?? [];
      const exists = list.some((x) => x.id === p.id);
      return { ...prev, [j]: exists ? list.map((x) => (x.id === p.id ? p : x)) : [...list, p] };
    });
  }

  const inputCls =
    "rounded-lg border border-neutral-300 px-2 py-1 text-sm text-right tabular-nums focus:ring-2 focus:ring-neutral-900 focus:outline-none bg-white";

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">
      {/* Header + Steuerung */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">{t(locale, "finance.title")}</h1>
          <p className="text-sm text-neutral-500 mt-1">
            {view === "month" ? `${monthName(locale, monat)} ${jahr}` : jahr} — Bremen (Einzelunternehmen)
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Jahr */}
          <div className="flex items-center rounded-lg border border-neutral-300 bg-white">
            <button onClick={() => changeYear(jahr - 1)} className="px-2 py-1.5 text-neutral-500 hover:text-neutral-900" aria-label="prev">
              <ChevronLeft size={16} />
            </button>
            <span className="px-1 text-sm font-semibold tabular-nums">
              {yearLoading ? <Loader2 size={14} className="animate-spin inline" /> : jahr}
            </span>
            <button onClick={() => changeYear(jahr + 1)} className="px-2 py-1.5 text-neutral-500 hover:text-neutral-900" aria-label="next">
              <ChevronRight size={16} />
            </button>
          </div>
          {/* Monat */}
          {view === "month" && (
            <select
              value={monat}
              onChange={(e) => setMonat(Number(e.target.value))}
              className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm bg-white focus:ring-2 focus:ring-neutral-900 focus:outline-none"
            >
              {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => {
                const kk = keyOf(jahr, m);
                const marker = kk in edits ? " ✎" : kk in saved ? " ●" : "";
                return (
                  <option key={m} value={m}>
                    {monthName(locale, m)}{marker}
                  </option>
                );
              })}
            </select>
          )}
          {/* Ansicht */}
          <div className="flex rounded-lg border border-neutral-300 overflow-hidden text-sm">
            <button
              onClick={() => setView("month")}
              className={`px-3 py-1.5 ${view === "month" ? "bg-neutral-900 text-white" : "bg-white text-neutral-600"}`}
            >
              {t(locale, "finance.month")}
            </button>
            <button
              onClick={() => setView("year")}
              className={`px-3 py-1.5 ${view === "year" ? "bg-neutral-900 text-white" : "bg-white text-neutral-600"}`}
            >
              {t(locale, "finance.year")}
            </button>
          </div>
          {/* Speichern */}
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-1.5 bg-neutral-900 text-white font-medium rounded-lg px-4 py-1.5 text-sm disabled:opacity-50"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : savedFlash && dirtyCount === 0 ? <Check size={14} /> : null}
            {saving
              ? t(locale, "finance.saving")
              : dirtyCount > 1
                ? `${t(locale, "finance.save")} (${dirtyCount})`
                : t(locale, "finance.save")}
          </button>
        </div>
      </div>

      {/* Status */}
      {saveError && (
        <div className="bg-red-50 text-red-700 text-xs rounded-lg px-3 py-2 border border-red-200">{saveError}</div>
      )}
      {view === "month" && isPrefilled && (
        <div className="flex items-start gap-2 bg-amber-50 text-amber-800 text-xs rounded-lg px-3 py-2 border border-amber-200">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          {t(locale, "finance.month.prefilled")}
        </div>
      )}
      {view === "month" && isEdited && (
        <div className="bg-amber-50 text-amber-800 text-xs rounded-lg px-3 py-2 border border-amber-200">
          ✎ {t(locale, "finance.unsaved")}
        </div>
      )}

      {view === "year" ? (
        <YearView
          locale={locale}
          jahr={jahr}
          months={yearMonths}
          sums={{ yrNetto, yrAusgaben, yrUst, yrGewinn, yrNettoGewinn }}
          istJahr={istJahr}
          lstJahr={lstJahr}
          eustJahr={eustJahr}
          tax={yrTax}
          hebesatz={lastRecorded.gewstHebesatz}
          freibetrag={lastRecorded.gewstFreibetrag}
          recordedCount={recorded.length}
          onOpenMonth={(m) => {
            setMonat(m);
            setView("month");
          }}
        />
      ) : (
        <div key={k} className="space-y-6">
          {/* EINNAHMEN */}
          <SectionCard title={t(locale, "finance.revenue")} color="blue">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200">
                  <Th>{""}</Th>
                  <Th right>{t(locale, "finance.revenue.brutto")}</Th>
                  <Th right>{t(locale, "finance.revenue.netto")}</Th>
                  <Th right>{t(locale, "finance.revenue.ust")}</Th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-neutral-100">
                  <td className="py-1.5 text-neutral-700">{t(locale, "finance.revenue.salon")}</td>
                  <td className="py-1.5 text-right">
                    <NumField value={current.salonBrutto} onCommit={(v) => update({ salonBrutto: v })} className={`${inputCls} w-28`} />
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{fmt(c.salonNetto)}</td>
                  <td className="py-1.5 text-right tabular-nums">{fmt(c.salonUst)}</td>
                </tr>
                <tr className="border-b border-neutral-100">
                  <td className="py-1.5 text-neutral-700">{t(locale, "finance.revenue.shop")}</td>
                  <td className="py-1.5 text-right">
                    <NumField value={current.shopBrutto} onCommit={(v) => update({ shopBrutto: v })} className={`${inputCls} w-28`} />
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{fmt(c.shopNetto)}</td>
                  <td className="py-1.5 text-right tabular-nums">{fmt(c.shopUst)}</td>
                </tr>
                <tr className="bg-green-50 font-semibold text-green-800">
                  <td className="py-2">{t(locale, "finance.revenue.total")}</td>
                  <td className="py-2 text-right tabular-nums">{fmt(c.totalBrutto)}</td>
                  <td className="py-2 text-right tabular-nums">{fmt(c.totalNetto)}</td>
                  <td className="py-2 text-right tabular-nums">{fmt(c.totalUstEinnahmen)}</td>
                </tr>
              </tbody>
            </table>
          </SectionCard>

          {/* AUSGABEN */}
          <SectionCard title={t(locale, "finance.expenses")} color="orange">
            {/* A. Personalkosten */}
            <SubSection
              title={t(locale, "finance.expenses.personnel")}
              right={
                <span className="flex items-center gap-3">
                  {staffEmployees.length > 0 && (
                    <button
                      onClick={() => update({ employees: staffEmployees })}
                      className="flex items-center gap-1 text-xs font-medium text-neutral-600 hover:text-neutral-900 border border-neutral-300 rounded-lg px-2 py-1 bg-white"
                      title={`Aktuelle Gehälter aller aktiven Mitarbeiter aus dem Mitarbeiter-Bereich übernehmen (${staffEmployees.length})`}
                    >
                      <Users size={13} /> Aus Mitarbeiter-Bereich übernehmen
                    </button>
                  )}
                  <span className="flex items-center gap-1 text-xs text-neutral-500">
                    {t(locale, "finance.expenses.personnel.ag2")}
                    <NumField value={current.agRate} onCommit={(v) => update({ agRate: v })} className={`${inputCls} w-14`} />%
                  </span>
                </span>
              }
            >
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-200">
                    <Th>{t(locale, "finance.expenses.personnel.employee")}</Th>
                    <Th right>{t(locale, "finance.expenses.personnel.brutto")}</Th>
                    <Th right>{`${t(locale, "finance.expenses.personnel.ag2")} (${current.agRate}%)`}</Th>
                    <Th right>{t(locale, "finance.expenses.personnel.total")}</Th>
                    <Th right>{""}</Th>
                  </tr>
                </thead>
                <tbody>
                  {c.personnelRows.map((r, i) => (
                    <tr key={i} className="border-b border-neutral-100">
                      <td className="py-1.5">
                        <input
                          type="text"
                          value={r.name}
                          onChange={(e) => {
                            const employees = current.employees.map((emp, j) => (j === i ? { ...emp, name: e.target.value } : emp));
                            update({ employees });
                          }}
                          className="rounded-lg border border-neutral-300 px-2 py-1 text-sm w-full max-w-[180px] focus:ring-2 focus:ring-neutral-900 focus:outline-none bg-white"
                        />
                      </td>
                      <td className="py-1.5 text-right">
                        <NumField
                          value={r.brutto}
                          onCommit={(v) => {
                            const employees = current.employees.map((emp, j) => (j === i ? { ...emp, brutto: v } : emp));
                            update({ employees });
                          }}
                          className={`${inputCls} w-24`}
                        />
                      </td>
                      <td className="py-1.5 text-right text-neutral-500 tabular-nums">{fmt(r.ag)}</td>
                      <td className="py-1.5 text-right text-neutral-700 tabular-nums">{fmt(r.total)}</td>
                      <td className="py-1.5 text-right">
                        <button
                          onClick={() => update({ employees: current.employees.filter((_, j) => j !== i) })}
                          className="text-neutral-400 hover:text-red-600"
                          title={t(locale, "finance.remove")}
                        >
                          <Trash2 size={14} />
                        </button>
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-yellow-50 font-semibold text-yellow-800">
                    <td className="py-2">{t(locale, "finance.expenses.personnel.sum")}</td>
                    <td className="py-2 text-right tabular-nums">{fmt(c.personnelBrutto)}</td>
                    <td className="py-2 text-right tabular-nums">{fmt(c.personnelAg)}</td>
                    <td className="py-2 text-right tabular-nums">{fmt(c.personnelTotal)}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
              <button
                onClick={() => update({ employees: [...current.employees, { name: "", brutto: 0 }] })}
                className="mt-2 flex items-center gap-1 text-xs font-medium text-neutral-600 hover:text-neutral-900"
              >
                <Plus size={14} /> {t(locale, "finance.add_employee")}
              </button>
              <p className="mt-2 text-xs text-neutral-400">
                Im Bruttolohn stecken Lohnsteuer und Arbeitnehmer-Sozialversicherung — beides wird einbehalten und abgeführt,
                ist also kein Zusatzaufwand. Die Lohnsteuer-Zahlung wird unten im Finanzamt-Abgleich erfasst.
              </p>
            </SubSection>

            {/* B. Materialkosten */}
            <SubSection title={t(locale, "finance.expenses.material")}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-200">
                    <Th>{""}</Th>
                    <Th right>{t(locale, "finance.param.of_revenue")}</Th>
                    <Th right>{t(locale, "finance.expenses.material.brutto")}</Th>
                    <Th right>{t(locale, "finance.expenses.material.netto")}</Th>
                    <Th right>{t(locale, "finance.expenses.material.vorsteuer")}</Th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-neutral-100">
                    <td className="py-1.5 text-neutral-700">{t(locale, "finance.expenses.material.salon2")}</td>
                    <td className="py-1.5 text-right">
                      <NumField value={current.salonMaterialRate} onCommit={(v) => update({ salonMaterialRate: v })} className={`${inputCls} w-16`} />
                      <span className="text-neutral-500 ml-1">%</span>
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{fmt(c.matSalonBrutto)}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmt(c.matSalonNetto)}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmt(c.matSalonVst)}</td>
                  </tr>
                  <tr className="border-b border-neutral-100">
                    <td className="py-1.5 text-neutral-700">{t(locale, "finance.expenses.material.shop2")}</td>
                    <td className="py-1.5 text-right">
                      <NumField value={current.shopMaterialRate} onCommit={(v) => update({ shopMaterialRate: v })} className={`${inputCls} w-16`} />
                      <span className="text-neutral-500 ml-1">%</span>
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{fmt(c.matShopBrutto)}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmt(c.matShopNetto)}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmt(c.matShopVst)}</td>
                  </tr>
                  <tr className="bg-yellow-50 font-semibold text-yellow-800">
                    <td className="py-2">{t(locale, "finance.expenses.material.sum")}</td>
                    <td />
                    <td className="py-2 text-right tabular-nums">{fmt(c.matTotalBrutto)}</td>
                    <td className="py-2 text-right tabular-nums">{fmt(c.matTotalNetto)}</td>
                    <td className="py-2 text-right tabular-nums">{fmt(c.matTotalVst)}</td>
                  </tr>
                </tbody>
              </table>
            </SubSection>

            {/* C. Shopify-Kosten */}
            <SubSection title={t(locale, "finance.expenses.shopify")}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-200">
                    <Th>{""}</Th>
                    <Th right>Betrag/Basis</Th>
                    <Th right>Netto</Th>
                  </tr>
                </thead>
                <tbody>
                  {(
                    [
                      ["finance.expenses.shopify.plan", "shopifyPlan"],
                      ["finance.expenses.shopify.pos", "shopifyPos"],
                      ["finance.expenses.shopify.apps", "shopifyApps"],
                    ] as const
                  ).map(([label, field]) => (
                    <tr key={field} className="border-b border-neutral-100">
                      <td className="py-1.5 text-neutral-700">{t(locale, label)}</td>
                      <td className="py-1.5 text-right">
                        <NumField value={current[field]} onCommit={(v) => update({ [field]: v })} className={`${inputCls} w-24`} />
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{fmt(current[field])}</td>
                    </tr>
                  ))}
                  <tr className="border-b border-neutral-100">
                    <td className="py-1.5 text-neutral-700">
                      {t(locale, "finance.expenses.shopify.fees2")}{" "}
                      <span className="whitespace-nowrap">
                        <NumField value={current.shopFeeRate} onCommit={(v) => update({ shopFeeRate: v })} className={`${inputCls} w-14`} />
                        <span className="text-neutral-500 ml-1 text-xs">{t(locale, "finance.param.of_net")}</span>
                      </span>
                    </td>
                    <td className="py-1.5 text-right tabular-nums">{fmt(c.shopNetto)}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmt(c.shopifyFees)}</td>
                  </tr>
                  <tr className="bg-yellow-50 font-semibold">
                    <td className="py-2 text-neutral-900">{t(locale, "finance.expenses.shopify.sum")}</td>
                    <td className="py-2 text-right text-yellow-700 text-xs font-semibold">keine USt!</td>
                    <td className="py-2 text-right tabular-nums text-yellow-700">{fmt(c.shopifyTotal)}</td>
                  </tr>
                </tbody>
              </table>
            </SubSection>

            {/* D. Versandkosten */}
            <SubSection title={t(locale, "finance.expenses.shipping")}>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-neutral-200">
                    <Th>{""}</Th>
                    <Th right>Anzahl/Preis</Th>
                    <Th right>Netto</Th>
                    <Th right>{t(locale, "finance.expenses.material.vorsteuer")}</Th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-neutral-100">
                    <td className="py-1.5 text-neutral-700">{t(locale, "finance.expenses.shipping.count")}</td>
                    <td className="py-1.5 text-right">
                      <NumField value={current.shippingCount} onCommit={(v) => update({ shippingCount: v })} className={`${inputCls} w-24`} />
                    </td>
                    <td className="py-1.5" />
                    <td className="py-1.5" />
                  </tr>
                  <tr className="border-b border-neutral-100">
                    <td className="py-1.5 text-neutral-700">{t(locale, "finance.expenses.shipping.price")}</td>
                    <td className="py-1.5 text-right">
                      <NumField value={current.shippingPrice} onCommit={(v) => update({ shippingPrice: v })} className={`${inputCls} w-24`} />
                    </td>
                    <td className="py-1.5" />
                    <td className="py-1.5" />
                  </tr>
                  <tr className="bg-yellow-50 font-semibold">
                    <td className="py-2 text-neutral-900">{t(locale, "finance.expenses.shipping.total")}</td>
                    <td className="py-2 text-right tabular-nums">{fmt(c.shippingBrutto)}</td>
                    <td className="py-2 text-right tabular-nums text-yellow-700">{fmt(c.shippingNetto)}</td>
                    <td className="py-2 text-right tabular-nums text-green-700">{fmt(c.shippingVst)}</td>
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
                    <Th right>Brutto</Th>
                    <Th right>USt %</Th>
                    <Th right>Netto</Th>
                    <Th right>{t(locale, "finance.expenses.material.vorsteuer")}</Th>
                    <Th right>{""}</Th>
                  </tr>
                </thead>
                <tbody>
                  {current.otherExpenses.map((e, i) => {
                    const brutto = e.netto * (1 + e.ustRate / 100);
                    const vst = e.netto * (e.ustRate / 100);
                    const setExpense = (patch: Partial<typeof e>) =>
                      update({ otherExpenses: current.otherExpenses.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
                    return (
                      <tr key={i} className="border-b border-neutral-100">
                        <td className="py-1.5">
                          <input
                            type="text"
                            value={e.label}
                            onChange={(ev) => setExpense({ label: ev.target.value })}
                            className="rounded-lg border border-neutral-300 px-2 py-1 text-sm w-full max-w-[200px] focus:ring-2 focus:ring-neutral-900 focus:outline-none bg-white"
                          />
                        </td>
                        <td className="py-1.5 text-right">
                          <NumField
                            value={brutto}
                            onCommit={(v) => setExpense({ netto: v / (1 + e.ustRate / 100) })}
                            className={`${inputCls} w-24`}
                          />
                        </td>
                        <td className="py-1.5 text-right">
                          <select
                            value={e.ustRate}
                            onChange={(ev) => {
                              // Brutto (Rechnungsbetrag) bleibt fest, Netto/Vorsteuer werden neu aufgeteilt
                              const rate = Number(ev.target.value);
                              setExpense({ ustRate: rate, netto: brutto / (1 + rate / 100) });
                            }}
                            className="rounded-lg border border-neutral-300 px-2 py-1 text-sm bg-white focus:ring-2 focus:ring-neutral-900 focus:outline-none"
                          >
                            <option value={0}>0%</option>
                            <option value={7}>7%</option>
                            <option value={19}>19%</option>
                          </select>
                        </td>
                        <td className="py-1.5 text-right tabular-nums">{fmt(e.netto)}</td>
                        <td className="py-1.5 text-right tabular-nums">{fmt(vst)}</td>
                        <td className="py-1.5 text-right">
                          <button
                            onClick={() => update({ otherExpenses: current.otherExpenses.filter((_, j) => j !== i) })}
                            className="text-neutral-400 hover:text-red-600"
                            title={t(locale, "finance.remove")}
                          >
                            <Trash2 size={14} />
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                  <tr className="bg-yellow-50 font-semibold text-yellow-800">
                    <td className="py-2">{t(locale, "finance.expenses.other.sum")}</td>
                    <td className="py-2 text-right tabular-nums">{fmt(c.otherBrutto)}</td>
                    <td />
                    <td className="py-2 text-right tabular-nums">{fmt(c.otherTotal)}</td>
                    <td className="py-2 text-right tabular-nums">{fmt(c.otherVst)}</td>
                    <td />
                  </tr>
                </tbody>
              </table>
              <button
                onClick={() => update({ otherExpenses: [...current.otherExpenses, { label: "", netto: 0, ustRate: 19 }] })}
                className="mt-2 flex items-center gap-1 text-xs font-medium text-neutral-600 hover:text-neutral-900"
              >
                <Plus size={14} /> {t(locale, "finance.add_expense")}
              </button>
            </SubSection>

            {/* Summen */}
            <div className="mt-4 space-y-2">
              <div className="flex justify-between items-center bg-neutral-100 rounded-lg px-4 py-2 font-semibold text-sm">
                <span>{t(locale, "finance.expenses.total")}</span>
                <span className="tabular-nums">{fmt(c.totalExpensesNetto)}</span>
              </div>
              <div className="flex justify-between items-center bg-green-50 rounded-lg px-4 py-2 font-semibold text-sm text-green-800">
                <span>{t(locale, "finance.expenses.vorsteuer_total")}</span>
                <span className="tabular-nums">{fmt(c.totalVorsteuer)}</span>
              </div>
            </div>
          </SectionCard>

          {/* UMSATZSTEUER */}
          <SectionCard title={t(locale, "finance.vat")} color="red">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span className="text-neutral-600">{t(locale, "finance.vat.from_revenue")}</span>
                <span className="tabular-nums">{fmt(c.totalUstEinnahmen)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral-600">{t(locale, "finance.vat.input_tax")}</span>
                <span className="tabular-nums text-red-600">-{fmt(c.totalVorsteuer)}</span>
              </div>
              <div className="flex justify-between items-center bg-red-50 rounded-lg px-4 py-2 font-bold text-red-800">
                <span>{t(locale, "finance.vat.liability")}</span>
                <div className="text-right">
                  <div className="tabular-nums">{fmt(c.ustZahllast)}</div>
                  <div className="text-xs font-normal text-red-600 tabular-nums">{fmt(c.ustZahllast * 12)} / Jahr</div>
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
                  <Th>{""}</Th>
                  <Th right>{t(locale, "finance.pnl.monthly")}</Th>
                  <Th right>{t(locale, "finance.pnl.annual")}</Th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-neutral-100">
                  <td className="py-1.5 text-neutral-700">{t(locale, "finance.pnl.revenue")}</td>
                  <td className="py-1.5 text-right tabular-nums">{fmt(c.totalNetto)}</td>
                  <td className="py-1.5 text-right tabular-nums">{fmt(c.totalNetto * 12)}</td>
                </tr>
                <tr className="border-b border-neutral-100">
                  <td className="py-1.5 text-neutral-700">{t(locale, "finance.pnl.expenses")}</td>
                  <td className="py-1.5 text-right tabular-nums text-red-600">-{fmt(c.totalExpensesNetto)}</td>
                  <td className="py-1.5 text-right tabular-nums text-red-600">-{fmt(c.totalExpensesNetto * 12)}</td>
                </tr>
                <tr className="bg-green-50 font-bold text-green-800">
                  <td className="py-2">{t(locale, "finance.pnl.profit")}</td>
                  <td className="py-2 text-right tabular-nums">{fmt(c.gewinnVorSteuern)}</td>
                  <td className="py-2 text-right tabular-nums">{fmt(c.gewinnJahr)}</td>
                </tr>
              </tbody>
            </table>
          </SectionCard>

          {/* STEUERN */}
          <SectionCard title={t(locale, "finance.tax")} color="red">
            <SubSection title={t(locale, "finance.tax.gewst")}>
              <div className="grid grid-cols-3 gap-y-1 text-sm items-center">
                <span className="text-neutral-600">{t(locale, "finance.tax.gewst.profit")}</span>
                <span className="text-right tabular-nums">{fmt(c.gewinnJahr)}</span>
                <span />
                <span className="text-neutral-600">{t(locale, "finance.tax.gewst.freibetrag")}</span>
                <span className="text-right">
                  <NumField value={current.gewstFreibetrag} onCommit={(v) => update({ gewstFreibetrag: v })} className={`${inputCls} w-24`} />
                </span>
                <span className="text-xs text-neutral-400 pl-2">Einzelunternehmen</span>
                <span className="text-neutral-600">{t(locale, "finance.tax.gewst.basis")}</span>
                <span className="text-right tabular-nums font-medium">{fmt(c.tax.gewstBasis)}</span>
                <span />
                <span className="text-neutral-600">{t(locale, "finance.tax.gewst.messbetrag")}</span>
                <span className="text-right tabular-nums">{fmt(c.tax.gewstMessbetrag)}</span>
                <span />
                <span className="text-neutral-600">{t(locale, "finance.tax.gewst.hebesatz")}</span>
                <span className="text-right">
                  <NumField value={current.gewstHebesatz} onCommit={(v) => update({ gewstHebesatz: v })} className={`${inputCls} w-20`} />
                </span>
                <span className="text-xs text-neutral-400 pl-2">Bremen: 460</span>
                <span className="font-semibold text-neutral-900">{t(locale, "finance.tax.gewst.amount2")}</span>
                <span className="text-right tabular-nums font-semibold">{fmt(c.tax.gewstJahr)}</span>
                <span className="text-right tabular-nums text-neutral-500">{fmt(c.gewstMonat)}/m</span>
              </div>
            </SubSection>

            <SubSection title={t(locale, "finance.tax.est")}>
              <div className="grid grid-cols-3 gap-y-1 text-sm">
                <span className="text-neutral-600">{t(locale, "finance.tax.est.after_gewst")}</span>
                <span className="text-right tabular-nums">{fmt(c.tax.gewinnNachGewSt)}</span>
                <span />
                <span className="text-neutral-600">{t(locale, "finance.tax.est.tariff")}</span>
                <span className="text-right tabular-nums">{fmt(c.tax.estRoh)}</span>
                <span className="text-xs text-neutral-400 pl-2">Nach deutschem ESt-Tarif</span>
                <span className="text-neutral-600">{t(locale, "finance.tax.est.anrechnung")}</span>
                <span className="text-right tabular-nums text-red-600">-{fmt(c.tax.gewstAnrechnung)}</span>
                <span className="text-xs text-neutral-400 pl-2">3,8% vom Gewerbeertrag</span>
                <span className="text-neutral-600">{t(locale, "finance.tax.est.reduced")}</span>
                <span className="text-right tabular-nums">{fmt(c.tax.estGekuerzt)}</span>
                <span className="text-xs text-neutral-400 pl-2">Nach Anrechnung</span>
                <span className="text-neutral-600">{t(locale, "finance.tax.est.soli")}</span>
                <span className="text-right tabular-nums">{fmt(c.tax.soli)}</span>
                <span className="text-xs text-neutral-400 pl-2">5,5% auf ESt</span>
                <span className="font-semibold text-neutral-900">{t(locale, "finance.tax.est.total")}</span>
                <span className="text-right tabular-nums font-semibold">{fmt(c.tax.estGesamt)}</span>
                <span />
              </div>
            </SubSection>

            <div className="flex justify-between items-center bg-red-50 rounded-lg px-4 py-3 font-bold text-red-800 mt-2">
              <span>{t(locale, "finance.tax.total")}</span>
              <div className="text-right">
                <div className="tabular-nums">{fmt(c.tax.steuerGesamt)}</div>
                <div className="text-xs font-normal text-red-600 tabular-nums">{fmt(c.steuerMonat)} / Monat</div>
              </div>
            </div>
          </SectionCard>

          {/* FINANZAMT SOLL/IST */}
          <FinanzamtAbgleich
            locale={locale}
            jahr={jahr}
            monat={monat}
            posten={jahrPosten}
            ustBerechnet={c.ustZahllast}
            personnelBrutto={c.personnelBrutto}
            onPostenSaved={(p) => updatePosten(jahr, p)}
          />

          {/* NETTOGEWINN */}
          <SectionCard title={t(locale, "finance.net_profit")} color="green">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200">
                  <Th>{""}</Th>
                  <Th right>{t(locale, "finance.pnl.monthly")}</Th>
                  <Th right>{t(locale, "finance.pnl.annual")}</Th>
                </tr>
              </thead>
              <tbody>
                <tr className="border-b border-neutral-100">
                  <td className="py-1.5 text-neutral-700">{t(locale, "finance.net_profit.before_tax")}</td>
                  <td className="py-1.5 text-right tabular-nums">{fmt(c.gewinnVorSteuern)}</td>
                  <td className="py-1.5 text-right tabular-nums">{fmt(c.gewinnJahr)}</td>
                </tr>
                <tr className="border-b border-neutral-100">
                  <td className="py-1.5 text-neutral-700">{t(locale, "finance.net_profit.taxes")}</td>
                  <td className="py-1.5 text-right tabular-nums text-red-600">-{fmt(c.steuerMonat)}</td>
                  <td className="py-1.5 text-right tabular-nums text-red-600">-{fmt(c.tax.steuerGesamt)}</td>
                </tr>
                <tr className="bg-green-100 font-bold text-green-900">
                  <td className="py-2">
                    <span className="flex items-center gap-2">
                      {t(locale, "finance.net_profit.amount")}
                      <span className="text-xs font-normal text-green-700">{t(locale, "finance.net_profit.after_all")}</span>
                    </span>
                  </td>
                  <td className="py-2 text-right tabular-nums text-lg">{fmt(c.nettoGewinnMonat)}</td>
                  <td className="py-2 text-right tabular-nums text-lg">{fmt(c.nettoGewinnJahr)}</td>
                </tr>
              </tbody>
            </table>
          </SectionCard>

          {/* KENNZAHLEN */}
          <SectionCard title={t(locale, "finance.kpi")} color="blue">
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              <KpiCard label={t(locale, "finance.kpi.gross_margin")} value={pct(c.bruttoMarge)} desc="Gewinn vor Steuern / Umsatz" />
              <KpiCard label={t(locale, "finance.kpi.net_margin")} value={pct(c.nettoMarge)} desc="Nettogewinn / Umsatz" />
              <KpiCard label={t(locale, "finance.kpi.personnel_ratio")} value={pct(c.personalQuote)} desc="Personalkosten / Umsatz" />
              <KpiCard label={t(locale, "finance.kpi.material_ratio")} value={pct(c.materialQuote)} desc="Materialkosten / Umsatz" />
              <KpiCard label={t(locale, "finance.kpi.effective_tax_rate")} value={pct(c.effSteuersatz)} desc="Steuern / Gewinn vor Steuern" />
            </div>
          </SectionCard>

          {/* RÜCKLAGE: für Steuern beiseitelegen */}
          <RuecklageBox
            monatLabel={`${monthName(locale, monat)} ${jahr}`}
            ust={c.ustZahllast}
            est={c.estMonat}
            gewst={c.gewstMonat}
            lst={lstFor(jahrPosten, `${jahr}-${String(monat).padStart(2, "0")}`)}
          />
        </div>
      )}
    </div>
  );
}

// ---- Jahresansicht ----
function YearView({
  locale,
  jahr,
  months,
  sums,
  istJahr,
  lstJahr,
  eustJahr,
  tax,
  hebesatz,
  freibetrag,
  recordedCount,
  onOpenMonth,
}: {
  locale: Locale;
  jahr: number;
  months: Array<{ monat: number; input: FinanzInput | null; calc: ReturnType<typeof compute> | null }>;
  sums: { yrNetto: number; yrAusgaben: number; yrUst: number; yrGewinn: number; yrNettoGewinn: number };
  istJahr: number;
  lstJahr: number;
  eustJahr: number;
  tax: ReturnType<typeof taxChain>;
  hebesatz: number;
  freibetrag: number;
  recordedCount: number;
  onOpenMonth: (m: number) => void;
}) {
  return (
    <div className="space-y-6">
      {/* Steuern Jahr: zu zahlen / bezahlt / offen */}
      <JahresSteuerBox
        jahr={jahr}
        berechnet={sums.yrUst + tax.steuerGesamt}
        bezahlt={istJahr}
        recordedCount={recordedCount}
      />

      {/* KPI-Kacheln Jahr */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KpiCard label={t(locale, "finance.pnl.revenue")} value={fmt(sums.yrNetto)} desc={`${jahr}`} />
        <KpiCard label={t(locale, "finance.pnl.expenses")} value={fmt(sums.yrAusgaben)} desc={`${jahr}`} />
        <KpiCard label={t(locale, "finance.pnl.profit")} value={fmt(sums.yrGewinn)} desc={`${jahr}`} />
        <KpiCard label={t(locale, "finance.net_profit.amount")} value={fmt(sums.yrNettoGewinn)} desc={t(locale, "finance.net_profit.after_all")} />
      </div>

      {/* Monats-Tabelle */}
      <SectionCard title={`${t(locale, "finance.year.overview")} ${jahr}`} color="blue">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200">
              <Th>{t(locale, "finance.month")}</Th>
              <Th right>{t(locale, "finance.pnl.revenue")}</Th>
              <Th right>{t(locale, "finance.pnl.expenses")}</Th>
              <Th right>{t(locale, "finance.year.ust")}</Th>
              <Th right>{t(locale, "finance.pnl.profit")}</Th>
            </tr>
          </thead>
          <tbody>
            {months.map(({ monat, calc }) => (
              <tr
                key={monat}
                onClick={() => onOpenMonth(monat)}
                className="border-b border-neutral-100 cursor-pointer hover:bg-neutral-50"
                title={monthName(locale, monat)}
              >
                <td className="py-1.5 text-neutral-700">{monthName(locale, monat)}</td>
                {calc ? (
                  <>
                    <td className="py-1.5 text-right tabular-nums">{fmt(calc.totalNetto)}</td>
                    <td className="py-1.5 text-right tabular-nums text-red-600">-{fmt(calc.totalExpensesNetto)}</td>
                    <td className="py-1.5 text-right tabular-nums">{fmt(calc.ustZahllast)}</td>
                    <td className={`py-1.5 text-right tabular-nums font-medium ${calc.gewinnVorSteuern >= 0 ? "text-green-700" : "text-red-600"}`}>
                      {fmt(calc.gewinnVorSteuern)}
                    </td>
                  </>
                ) : (
                  <td colSpan={4} className="py-1.5 text-right text-xs text-neutral-400">
                    {t(locale, "finance.year.no_data")}
                  </td>
                )}
              </tr>
            ))}
            <tr className="bg-green-50 font-bold text-green-800">
              <td className="py-2">
                {t(locale, "finance.year.sum")}{" "}
                <span className="text-xs font-normal">
                  ({recordedCount} {t(locale, "finance.year.months_recorded")})
                </span>
              </td>
              <td className="py-2 text-right tabular-nums">{fmt(sums.yrNetto)}</td>
              <td className="py-2 text-right tabular-nums">-{fmt(sums.yrAusgaben)}</td>
              <td className="py-2 text-right tabular-nums">{fmt(sums.yrUst)}</td>
              <td className="py-2 text-right tabular-nums">{fmt(sums.yrGewinn)}</td>
            </tr>
          </tbody>
        </table>
      </SectionCard>

      {/* Steuern auf die echte Jahres-Summe */}
      <SectionCard title={t(locale, "finance.tax")} color="red">
        <p className="text-xs text-neutral-500 mb-3">{t(locale, "finance.year.taxes_hint")}</p>
        <div className="grid grid-cols-3 gap-y-1 text-sm">
          <span className="text-neutral-600">{t(locale, "finance.year.profit_sum")}</span>
          <span className="text-right tabular-nums font-medium">{fmt(sums.yrGewinn)}</span>
          <span />
          <span className="text-neutral-600">{t(locale, "finance.tax.gewst.freibetrag")}</span>
          <span className="text-right tabular-nums text-red-600">-{fmt(freibetrag)}</span>
          <span />
          <span className="text-neutral-600">{`${t(locale, "finance.tax.gewst.amount2")} (${hebesatz}%)`}</span>
          <span className="text-right tabular-nums">{fmt(tax.gewstJahr)}</span>
          <span />
          <span className="text-neutral-600">{t(locale, "finance.tax.est.total")}</span>
          <span className="text-right tabular-nums">{fmt(tax.estGesamt)}</span>
          <span className="text-xs text-neutral-400 pl-2">inkl. Soli</span>
        </div>
        <div className="flex justify-between items-center bg-red-50 rounded-lg px-4 py-3 font-bold text-red-800 mt-3">
          <span>{t(locale, "finance.tax.total")}</span>
          <span className="tabular-nums">{fmt(tax.steuerGesamt)}</span>
        </div>
        {/* Berechnet vs. tatsächlich ans Finanzamt gezahlt (Ist aus dem Steuer-Ledger) */}
        <div className="mt-3 space-y-1 text-sm border-t border-neutral-100 pt-3">
          <div className="flex justify-between">
            <span className="text-neutral-600">{t(locale, "finance.fa.year_calc")}</span>
            <span className="tabular-nums">{fmt(sums.yrUst + tax.steuerGesamt)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-600">{t(locale, "finance.fa.year_ist")}</span>
            <span className="tabular-nums">{fmt(istJahr)}</span>
          </div>
          <div className="flex justify-between font-semibold">
            <span className="text-neutral-700">{t(locale, "finance.fa.diff")}</span>
            <span className={`tabular-nums ${Math.abs(istJahr - (sums.yrUst + tax.steuerGesamt)) > 100 ? "text-amber-600" : "text-neutral-700"}`}>
              {fmt(istJahr - (sums.yrUst + tax.steuerGesamt))}
            </span>
          </div>
        </div>
        {/* Separat abgeführt — nicht Teil der Abweichung oben */}
        <div className="mt-3 space-y-1 text-sm border-t border-neutral-100 pt-3">
          <div className="text-xs font-medium text-neutral-500 uppercase tracking-wide mb-1">
            Zusätzlich ans Finanzamt / den Zoll abgeführt
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-600">
              Lohnsteuer <span className="text-xs text-neutral-400">(im Bruttolohn enthalten, kein Zusatzaufwand)</span>
            </span>
            <span className="tabular-nums">{fmt(lstJahr)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-neutral-600">
              Einfuhrumsatzsteuer <span className="text-xs text-neutral-400">(im Material-Brutto enthalten, wird als Vorsteuer verrechnet)</span>
            </span>
            <span className="tabular-nums">{fmt(eustJahr)}</span>
          </div>
          <div className="flex justify-between font-semibold border-t border-neutral-100 pt-1">
            <span className="text-neutral-700">Gesamt tatsächlich abgeführt</span>
            <span className="tabular-nums">{fmt(istJahr + lstJahr + eustJahr)}</span>
          </div>
        </div>
        <div className="flex justify-between items-center bg-green-100 rounded-lg px-4 py-3 font-bold text-green-900 mt-2">
          <span>
            {t(locale, "finance.net_profit.amount")}{" "}
            <span className="text-xs font-normal text-green-700">{t(locale, "finance.net_profit.after_all")}</span>
          </span>
          <span className="tabular-nums text-lg">{fmt(sums.yrNettoGewinn)}</span>
        </div>
      </SectionCard>
    </div>
  );
}

// ---- Rücklage: was diesen Monat für Steuern beiseitegelegt werden muss ----
type LstInfo = { amount: number; source: "ist" | "soll" | null };

// Lohnsteuer wird nicht berechnet — Ist aus der Lohnabrechnung, sonst Soll, sonst unbekannt.
function lstFor(posten: SteuerPosten[], zeitraum: string): LstInfo {
  const row = posten.find((p) => p.art === "lst_anmeldung" && p.zeitraum === zeitraum);
  const ist = Number(row?.ist_betrag) || 0;
  if (ist > 0) return { amount: ist, source: "ist" };
  const soll = Number(row?.soll_betrag) || 0;
  if (soll > 0) return { amount: soll, source: "soll" };
  return { amount: 0, source: null };
}

function RuecklageBox({
  monatLabel,
  ust,
  est,
  gewst,
  lst,
}: {
  monatLabel: string;
  ust: number;
  est: number;
  gewst: number;
  lst: LstInfo;
}) {
  const gesamt = Math.max(0, ust + est + gewst + lst.amount);
  const lines: Array<{ label: string; hint: string; value: number | null }> = [
    { label: "Umsatzsteuer-Zahllast", hint: "USt-VA, fällig am 10. des Folgemonats", value: ust },
    { label: "Einkommensteuer inkl. Soli", hint: "Monatsanteil (Hochrechnung aufs Jahr)", value: est },
    { label: "Gewerbesteuer", hint: "Monatsanteil (Hochrechnung aufs Jahr)", value: gewst },
    {
      label: "Lohnsteuer",
      hint:
        lst.source === "ist"
          ? "laut Lohnabrechnung, im Bruttolohn enthalten"
          : lst.source === "soll"
            ? "Soll-Betrag, im Bruttolohn enthalten"
            : "noch nicht erfasst — Betrag aus der Lohnabrechnung im Finanzamt-Abgleich eintragen",
      value: lst.source ? lst.amount : null,
    },
  ];

  return (
    <div className="rounded-2xl border-2 border-red-300 bg-red-50 shadow-sm overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 md:px-6 py-4">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-600 text-white">
            <AlertTriangle size={22} />
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-red-700">
              Für Steuern beiseitelegen — {monatLabel}
            </div>
            <div className="text-xs text-red-600/80">Dieses Geld gehört dem Finanzamt, nicht dem Gewinn.</div>
          </div>
        </div>
        <div className="text-3xl font-bold tabular-nums text-red-800">{fmt(gesamt)}</div>
      </div>
      <div className="border-t border-red-200 bg-white/60 px-4 md:px-6 py-3">
        <div className="space-y-1 text-sm">
          {lines.map((l) => (
            <div key={l.label} className="flex items-baseline justify-between gap-3">
              <span className="text-neutral-700">
                {l.label} <span className="text-xs text-neutral-400">({l.hint})</span>
              </span>
              <span className={`tabular-nums ${l.value === null ? "text-amber-600 text-xs font-medium" : "text-neutral-900"}`}>
                {l.value === null ? "fehlt" : fmt(l.value)}
              </span>
            </div>
          ))}
        </div>
        {ust < 0 && (
          <p className="mt-2 text-xs text-blue-700">
            Die USt-Zahllast ist negativ — das Finanzamt erstattet {fmt(-ust)}; das mindert die Rücklage.
          </p>
        )}
      </div>
    </div>
  );
}

function JahresSteuerBox({
  jahr,
  berechnet,
  bezahlt,
  recordedCount,
}: {
  jahr: number;
  berechnet: number;
  bezahlt: number;
  recordedCount: number;
}) {
  const offen = berechnet - bezahlt;
  return (
    <div className="rounded-2xl border-2 border-red-300 bg-red-50 shadow-sm px-4 md:px-6 py-4">
      <div className="flex items-center gap-3 mb-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-red-600 text-white">
          <AlertTriangle size={22} />
        </div>
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-red-700">Steuern {jahr} — noch offen</div>
          <div className="text-xs text-red-600/80">
            USt + ESt + GewSt auf {recordedCount} erfasste Monate, abzüglich der im Finanzamt-Abgleich erfassten Zahlungen
            (ohne Lohnsteuer/EUSt)
          </div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3 text-center">
        <div className="rounded-xl bg-white/70 p-3">
          <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">Zu zahlen</div>
          <div className="text-lg font-bold tabular-nums text-neutral-900">{fmt(berechnet)}</div>
        </div>
        <div className="rounded-xl bg-white/70 p-3">
          <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">Bezahlt</div>
          <div className="text-lg font-bold tabular-nums text-emerald-700">{fmt(bezahlt)}</div>
        </div>
        <div className="rounded-xl bg-white p-3 ring-2 ring-red-300">
          <div className="text-xs font-semibold uppercase tracking-wide text-red-700">
            {offen >= 0 ? "Noch offen" : "Zu viel gezahlt"}
          </div>
          <div className={`text-2xl font-bold tabular-nums ${offen >= 0 ? "text-red-800" : "text-blue-700"}`}>{fmt(Math.abs(offen))}</div>
        </div>
      </div>
    </div>
  );
}

// ---- Finanzamt Soll/Ist-Abgleich (Monat) ----
// Monatliche Steuerarten werden ihrem Zeitraum zugeordnet, nicht dem Fälligkeitsmonat.
const MONTHLY_ARTS: SteuerArt[] = ["ust_va", "eust", "lst_anmeldung"];

// Fälligkeit Lohnsteuer-Anmeldung: 10. des Folgemonats, Wochenende → nächster Montag.
function lstDueDate(jahr: number, monat: number): string {
  const d = new Date(Date.UTC(monat === 12 ? jahr + 1 : jahr, monat === 12 ? 0 : monat, 10));
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function fmtDate(iso: string | null) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

function FinanzamtAbgleich({
  locale,
  jahr,
  monat,
  posten,
  ustBerechnet,
  personnelBrutto,
  onPostenSaved,
}: {
  locale: Locale;
  jahr: number;
  monat: number;
  posten: SteuerPosten[];
  ustBerechnet: number;
  personnelBrutto: number;
  onPostenSaved: (p: SteuerPosten) => void;
}) {
  const zeitraum = `${jahr}-${String(monat).padStart(2, "0")}`;
  const artLabel = (a: SteuerArt) => t(locale, `finance.tax_ledger.art.${a}`);

  const ustRow = posten.find((p) => p.art === "ust_va" && p.zeitraum === zeitraum) ?? null;
  const eustRow = posten.find((p) => p.art === "eust" && p.zeitraum === zeitraum) ?? null;
  const lstRow = posten.find((p) => p.art === "lst_anmeldung" && p.zeitraum === zeitraum) ?? null;

  // Weitere Posten, die in diesem Monat fällig sind (ESt-VZ, GewSt-VZ, Nachzahlungen, …).
  // Monatliche Arten stehen nur in ihrem eigenen Zeitraum — sonst erschiene z.B. die
  // USt-VA/Lohnsteuer des Vormonats (fällig am 10.) hier ein zweites Mal.
  const monthStart = `${zeitraum}-01`;
  const monthEnd = `${jahr}-${String(monat).padStart(2, "0")}-31`;
  const dueRows = posten.filter(
    (p) =>
      !MONTHLY_ARTS.includes(p.art) &&
      p.faellig_am &&
      p.faellig_am >= monthStart &&
      p.faellig_am <= monthEnd
  );

  // ---- Hinweise (Abweichungen & Auffälligkeiten) ----
  const hints: Array<{ tone: "warn" | "info"; text: string }> = [];
  const ustIst = Number(ustRow?.ist_betrag) || 0;
  if (ustIst > 0 && Math.abs(ustIst - ustBerechnet) > Math.max(50, Math.abs(ustBerechnet) * 0.05)) {
    hints.push({
      tone: "warn",
      text: `${t(locale, "finance.fa.ust_diff_warn")} (${t(locale, "finance.fa.calculated")}: ${fmt(ustBerechnet)}, ${t(locale, "finance.fa.ist")}: ${fmt(ustIst)}, ${t(locale, "finance.fa.diff")}: ${fmt(ustIst - ustBerechnet)})`,
    });
  }
  const now = new Date();
  const currentYm = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  if (zeitraum < currentYm && (!eustRow || (Number(eustRow.ist_betrag) || 0) <= 0)) {
    hints.push({ tone: "info", text: t(locale, "finance.fa.eust_missing") });
  }

  // Lohnsteuer: fehlt sie nach Fälligkeit, obwohl Löhne gezahlt wurden? Quote plausibel?
  const lstIst = Number(lstRow?.ist_betrag) || 0;
  const lstDue = lstRow?.faellig_am ?? lstDueDate(jahr, monat);
  const todayIso = now.toISOString().slice(0, 10);
  if (personnelBrutto > 0 && lstIst <= 0 && lstDue < todayIso) {
    hints.push({ tone: "warn", text: `Lohnsteuer für ${zeitraum} ist seit ${fmtDate(lstDue)} fällig, aber noch nicht erfasst — Betrag aus der Lohnabrechnung eintragen.` });
  }
  if (lstIst > 0 && personnelBrutto > 0) {
    const quote = lstIst / personnelBrutto;
    if (quote > 0.35) {
      hints.push({ tone: "warn", text: `Lohnsteuer ungewöhnlich hoch: ${pct(quote)} der Bruttolöhne (${fmt(personnelBrutto)}). Üblich sind ca. 5–25 % — Betrag oder Mitarbeiterliste prüfen.` });
    } else if (quote < 0.02) {
      hints.push({ tone: "info", text: `Lohnsteuer sehr niedrig: ${pct(quote)} der Bruttolöhne (${fmt(personnelBrutto)}). Plausibel nur bei vielen Minijobs/Azubis — sonst prüfen.` });
    }
  }

  for (const p of [ustRow, eustRow, lstRow, ...dueRows]) {
    if (!p) continue;
    if (p.bezahlt_am && p.faellig_am) {
      const late = (new Date(p.bezahlt_am).getTime() - new Date(p.faellig_am).getTime()) / 86_400_000;
      if (late > 14) {
        hints.push({
          tone: "warn",
          text: `${artLabel(p.art)} ${p.zeitraum}: ${t(locale, "finance.fa.late")} (fällig ${fmtDate(p.faellig_am)}, gezahlt ${fmtDate(p.bezahlt_am)})`,
        });
      }
    }
    if (p.richtung === "erstattung" && Number(p.soll_betrag) > 0 && (Number(p.ist_betrag) || 0) <= 0) {
      hints.push({ tone: "info", text: `${artLabel(p.art)} ${p.zeitraum}: ${t(locale, "finance.fa.refund_open")} (${fmt(Number(p.soll_betrag))})` });
    }
  }

  const rows: Array<{
    key: string;
    label: string;
    row: SteuerPosten | null;
    art: SteuerArt;
    zeitraum: string;
    berechnet: number | null;
  }> = [
    { key: "ust", label: artLabel("ust_va"), row: ustRow, art: "ust_va", zeitraum, berechnet: ustBerechnet },
    { key: "eust", label: artLabel("eust"), row: eustRow, art: "eust", zeitraum, berechnet: null },
    { key: "lst", label: artLabel("lst_anmeldung"), row: lstRow, art: "lst_anmeldung", zeitraum, berechnet: null },
    ...dueRows.map((p) => ({
      key: p.id,
      label: `${artLabel(p.art)} (${p.zeitraum})`,
      row: p as SteuerPosten | null,
      art: p.art,
      zeitraum: p.zeitraum,
      berechnet: null,
    })),
  ];

  return (
    <SectionCard title={t(locale, "finance.fa.title")} color="red">
      <p className="text-xs text-neutral-500 mb-3">{t(locale, "finance.fa.subtitle")}</p>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-neutral-200">
            <Th>{t(locale, "finance.fa.posten")}</Th>
            <Th right>{t(locale, "finance.fa.calculated")}</Th>
            <Th right>{t(locale, "finance.fa.soll")}</Th>
            <Th right>{t(locale, "finance.fa.ist")}</Th>
            <Th right>{t(locale, "finance.fa.diff")}</Th>
            <Th right>Bezahlt am</Th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ key, label, row, art, zeitraum: zr, berechnet }) => {
            const ist = Number(row?.ist_betrag) || 0;
            const vergleich = berechnet ?? (Number(row?.soll_betrag) || 0);
            const diff = ist > 0 && vergleich !== 0 ? ist - vergleich : null;
            const diffWarn = diff !== null && Math.abs(diff) > Math.max(50, Math.abs(vergleich) * 0.05);
            return (
              <tr key={key} className="border-b border-neutral-100">
                <td className="py-1.5 text-neutral-700">{label}</td>
                <td className="py-1.5 text-right tabular-nums">{berechnet !== null ? fmt(berechnet) : "—"}</td>
                <td className="py-1.5 text-right tabular-nums text-neutral-500">
                  {row && Number(row.soll_betrag) !== 0 ? fmt(Number(row.soll_betrag)) : "—"}
                </td>
                <td className="py-1.5 text-right">
                  <IstField
                    row={row}
                    art={art}
                    zeitraum={zr}
                    jahr={jahr}
                    onSaved={onPostenSaved}
                  />
                </td>
                <td className={`py-1.5 text-right tabular-nums ${diff === null ? "text-neutral-400" : diffWarn ? "text-amber-600 font-semibold" : "text-neutral-600"}`}>
                  {diff !== null ? fmt(diff) : "—"}
                </td>
                <td className="py-1.5 text-right tabular-nums text-neutral-500 text-xs">{fmtDate(row?.bezahlt_am ?? null)}</td>
              </tr>
            );
          })}
          {dueRows.length === 0 && (
            <tr>
              <td colSpan={6} className="py-2 text-xs text-neutral-400">{t(locale, "finance.fa.none")}</td>
            </tr>
          )}
        </tbody>
      </table>
      {hints.length > 0 && (
        <div className="mt-3 space-y-1.5">
          {hints.map((h, i) => (
            <div
              key={i}
              className={`flex items-start gap-2 text-xs rounded-lg px-3 py-2 ${h.tone === "warn" ? "bg-amber-50 text-amber-800" : "bg-blue-50 text-blue-800"}`}
            >
              <AlertTriangle size={14} className="shrink-0 mt-0.5" />
              {h.text}
            </div>
          ))}
        </div>
      )}
      <p className="text-xs text-neutral-400 mt-3">{t(locale, "finance.fa.ledger_hint")}</p>
    </SectionCard>
  );
}

// Ist-Betrag-Feld: speichert beim Verlassen direkt in den Steuer-Ledger (steuer_posten)
function IstField({
  row,
  art,
  zeitraum,
  jahr,
  onSaved,
}: {
  row: SteuerPosten | null;
  art: SteuerArt;
  zeitraum: string;
  jahr: number;
  onSaved: (p: SteuerPosten) => void;
}) {
  const value = Number(row?.ist_betrag) || 0;
  const [text, setText] = useState(() => fmtEdit(value));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(false);
  useEffect(() => {
    setText(fmtEdit(Number(row?.ist_betrag) || 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.id, row?.ist_betrag]);

  async function commit() {
    const n = parseNum(text);
    setText(fmtEdit(n));
    if (n === value) return;
    setBusy(true);
    setErr(false);
    const res = await upsertSteuerIst({ id: row?.id ?? null, art, zeitraum, jahr, ist_betrag: n });
    setBusy(false);
    if (res.ok && res.posten) onSaved(res.posten);
    else setErr(true);
  }

  return (
    <span className="inline-flex items-center gap-1">
      {busy && <Loader2 size={12} className="animate-spin text-neutral-400" />}
      <input
        type="text"
        inputMode="decimal"
        value={text}
        disabled={busy}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className={`rounded-lg border px-2 py-1 text-sm text-right tabular-nums w-24 focus:ring-2 focus:ring-neutral-900 focus:outline-none bg-white ${err ? "border-red-400" : "border-neutral-300"}`}
      />
    </span>
  );
}

// ---- Editierbares Zahlenfeld (deutsches Format: Komma als Dezimaltrenner) ----
function parseNum(s: string): number {
  const v = s.trim();
  if (!v) return 0;
  const norm = v.includes(",") ? v.replace(/\./g, "").replace(",", ".") : v;
  const x = Number(norm);
  return Number.isFinite(x) ? x : 0;
}
function fmtEdit(n: number): string {
  return String(Math.round(n * 100) / 100).replace(".", ",");
}

function NumField({ value, onCommit, className }: { value: number; onCommit: (n: number) => void; className?: string }) {
  const [text, setText] = useState(() => fmtEdit(value));
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setText(fmtEdit(value));
  }, [value, focused]);
  return (
    <input
      type="text"
      inputMode="decimal"
      value={text}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        setText(fmtEdit(parseNum(text)));
      }}
      onChange={(e) => {
        setText(e.target.value);
        onCommit(parseNum(e.target.value));
      }}
      className={className}
    />
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

function SubSection({ title, right, children }: { title: string; right?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="mb-6 last:mb-0">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-neutral-800">{title}</h3>
        {right}
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

function KpiCard({ label, value, desc }: { label: string; value: string; desc: string }) {
  return (
    <div className="bg-neutral-50 rounded-xl p-3 text-center">
      <div className="text-xs font-medium text-neutral-500 uppercase tracking-wide">{label}</div>
      <div className="text-lg font-bold text-neutral-900 mt-1 tabular-nums">{value}</div>
      <div className="text-xs text-neutral-400 mt-0.5">{desc}</div>
    </div>
  );
}
