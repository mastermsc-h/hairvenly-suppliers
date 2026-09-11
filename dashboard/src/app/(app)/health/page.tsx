import { HeartPulse, Package, Landmark, TrendingDown, AlertTriangle } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireFeature } from "@/lib/auth";
import { getTotalStockKg } from "@/lib/stock-sheets";
import type { HealthSnapshot } from "@/lib/actions/health";
import HealthInputForm from "./health-input-form";

export const dynamic = "force-dynamic";

const eur = (n: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
const num1 = (n: number) => new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(n);

export default async function HealthPage() {
  await requireFeature("finances");
  const supabase = await createClient();

  const [stock, { data: snapshotsData }] = await Promise.all([
    getTotalStockKg().catch(() => ({ russianKg: 0, uzbekKg: 0, totalKg: 0, lastUpdated: null, partial: true })),
    supabase
      .from("company_health_snapshots")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const snapshots = (snapshotsData ?? []) as HealthSnapshot[];
  const latest = snapshots[0] ?? null;

  const treatwell = Number(latest?.treatwell_eur ?? 0);
  const shopify = Number(latest?.shopify_eur ?? 0);
  const targobank = Number(latest?.targobank_eur ?? 0);
  const debt = Number(latest?.debt_eur ?? 0);
  const moneySum = treatwell + shopify + targobank;

  // Kennzahl: kg + Geld(T€) − Schulden(T€) — Live-kg, letzte manuelle Geldwerte
  const moneyK = moneySum / 1000;
  const debtK = debt / 1000;
  const score = Math.round((stock.totalKg + moneyK - debtK) * 10) / 10;

  // Vergleich zum vorherigen Snapshot (eingefrorener Score)
  const prevScore = snapshots[1]?.score != null ? Number(snapshots[1].score) : null;
  const delta = prevScore != null ? Math.round((score - prevScore) * 10) / 10 : null;

  return (
    <div className="p-4 md:p-8 max-w-4xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900 inline-flex items-center gap-2">
          <HeartPulse size={22} className="text-rose-500" /> Firmen-Gesundheit
        </h1>
        <p className="text-sm text-neutral-500 mt-1">
          Kennzahl = Lager (kg) + Konten (T€) − Schulden (T€)
        </p>
      </div>

      {/* Score-Karte */}
      <section className="bg-white rounded-2xl border border-neutral-200 p-6 md:p-8 shadow-sm">
        <div className="flex flex-col md:flex-row md:items-center gap-6">
          <div className="text-center md:text-left">
            <div className="text-xs font-medium text-neutral-500 uppercase tracking-wide">Aktuelle Kennzahl</div>
            <div className={`text-6xl font-bold mt-1 ${score >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
              {num1(score)}
            </div>
            {delta != null && (
              <div className={`text-xs mt-1 font-medium ${delta >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                {delta >= 0 ? "▲" : "▼"} {num1(Math.abs(delta))} seit letztem Eintrag
              </div>
            )}
          </div>
          <div className="flex-1 bg-neutral-50 rounded-xl p-4 text-sm text-neutral-700 font-mono">
            {num1(stock.totalKg)} kg
            {" + "}{num1(moneyK)}
            {" − "}{num1(debtK)}
            {" = "}<strong>{num1(score)}</strong>
            <div className="text-[11px] text-neutral-400 mt-1 font-sans">
              Lager (live) + Konten/1000 − Schulden/1000
            </div>
          </div>
        </div>
        {stock.partial && (
          <div className="mt-4 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-xs inline-flex items-center gap-2">
            <AlertTriangle size={13} />
            Lagerdaten unvollständig — mindestens ein Stock-Sheet-Tab war nicht lesbar. kg-Wert kann zu niedrig sein.
          </div>
        )}
      </section>

      {/* Breakdown */}
      <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
          <div className="text-xs font-medium text-neutral-500 uppercase tracking-wide inline-flex items-center gap-1.5">
            <Package size={13} className="text-indigo-500" /> Lagerbestand
          </div>
          <div className="text-2xl font-semibold text-neutral-900 mt-1">{num1(stock.totalKg)} kg</div>
          <div className="text-xs text-neutral-500 mt-1 space-y-0.5">
            <div>Russisch: {num1(stock.russianKg)} kg</div>
            <div>Usbekisch: {num1(stock.uzbekKg)} kg</div>
            {stock.lastUpdated && <div className="text-neutral-400">Stand: {stock.lastUpdated}</div>}
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
          <div className="text-xs font-medium text-neutral-500 uppercase tracking-wide inline-flex items-center gap-1.5">
            <Landmark size={13} className="text-emerald-500" /> Konten
          </div>
          <div className="text-2xl font-semibold text-neutral-900 mt-1">{eur(moneySum)}</div>
          <div className="text-xs text-neutral-500 mt-1 space-y-0.5">
            <div>Treatwell: {eur(treatwell)}</div>
            <div>Shopify: {eur(shopify)}</div>
            <div>Targobank: {eur(targobank)}</div>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
          <div className="text-xs font-medium text-neutral-500 uppercase tracking-wide inline-flex items-center gap-1.5">
            <TrendingDown size={13} className="text-rose-500" /> Schulden
          </div>
          <div className="text-2xl font-semibold text-rose-600 mt-1">{eur(debt)}</div>
          {latest && (
            <div className="text-xs text-neutral-400 mt-1">
              Eingaben vom {new Date(latest.created_at).toLocaleDateString("de-DE")}
            </div>
          )}
        </div>
      </section>

      {/* Eingabe-Formular */}
      <HealthInputForm
        defaults={{
          treatwell_eur: treatwell,
          shopify_eur: shopify,
          targobank_eur: targobank,
          debt_eur: debt,
        }}
      />

      {/* Historie */}
      {snapshots.length > 0 && (
        <section className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm">
          <h2 className="text-sm font-medium text-neutral-700 mb-3">Verlauf</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-left text-neutral-500">
                <tr className="border-b border-neutral-100">
                  <th className="py-1.5 pr-3 font-medium">Datum</th>
                  <th className="py-1.5 pr-3 font-medium text-right">Score</th>
                  <th className="py-1.5 pr-3 font-medium text-right">Lager kg</th>
                  <th className="py-1.5 pr-3 font-medium text-right">Konten</th>
                  <th className="py-1.5 pr-3 font-medium text-right">Schulden</th>
                  <th className="py-1.5 font-medium">Notiz</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-neutral-50">
                {snapshots.map((s) => {
                  const kg = (Number(s.stock_kg_russian ?? 0) + Number(s.stock_kg_uzbek ?? 0));
                  const money = Number(s.treatwell_eur) + Number(s.shopify_eur) + Number(s.targobank_eur);
                  return (
                    <tr key={s.id} className="text-neutral-700">
                      <td className="py-1.5 pr-3 whitespace-nowrap">{new Date(s.created_at).toLocaleString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}</td>
                      <td className="py-1.5 pr-3 text-right font-semibold">{s.score != null ? num1(Number(s.score)) : "—"}</td>
                      <td className="py-1.5 pr-3 text-right">{kg > 0 ? num1(kg) : "—"}</td>
                      <td className="py-1.5 pr-3 text-right">{eur(money)}</td>
                      <td className="py-1.5 pr-3 text-right text-rose-600">{eur(Number(s.debt_eur))}</td>
                      <td className="py-1.5 text-neutral-400 max-w-[200px] truncate">{s.note ?? ""}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
