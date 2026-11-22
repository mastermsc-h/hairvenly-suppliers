"use client";

import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Building2 } from "lucide-react";
import { kstSatz, rechtsformVergleich } from "@/lib/finanzen/steuertipps";
import { eur, eurK, Karte } from "./ui";

const FARBEN: Record<string, string> = {
  "Einkommensteuer + Soli": "#ef4444",
  "ESt auf GF-Gehalt": "#f87171",
  "Körperschaftsteuer + Soli": "#8b5cf6",
  Gewerbesteuer: "#f59e0b",
  "Abgeltungsteuer Ausschüttung": "#0ea5e9",
  "Holding (5 % steuerpflichtig)": "#14b8a6",
};

export default function Rechtsformen({ gewinn, hebesatz, freibetrag, jahr }: { gewinn: number; hebesatz: number; freibetrag: number; jahr: number }) {
  const [gfGehalt, setGfGehalt] = useState(120_000);
  const [quote, setQuote] = useState(30);
  const [vergleichsJahr, setVergleichsJahr] = useState(jahr);

  const erg = useMemo(
    () => rechtsformVergleich({ gewinn, gfGehalt, ausschuettungsQuote: quote / 100, hebesatz, freibetrag, jahr: vergleichsJahr }),
    [gewinn, gfGehalt, quote, hebesatz, freibetrag, vergleichsJahr]
  );
  const labels = [...new Set(erg.flatMap((e) => e.teile.map((t) => t.label)))];
  const daten = erg.map((e) => ({ name: e.titel, ...Object.fromEntries(e.teile.map((t) => [t.label, Math.round(t.betrag)])) }));
  const eu = erg[0];

  return (
    <Karte titel="Rechtsform: Einzelunternehmen vs. GmbH vs. GmbH + Holding" ton="sky" icon={<Building2 size={16} />}>
      <div className="flex flex-wrap gap-4 mb-4 items-end">
        <label className="flex flex-col gap-1 text-xs font-medium text-neutral-600 min-w-[220px]">
          Geschäftsführer-Gehalt (du), pro Jahr: <b className="text-neutral-900 tabular-nums">{eur(gfGehalt)}</b>
          <input type="range" min={0} max={250_000} step={5_000} value={gfGehalt} onChange={(e) => setGfGehalt(Number(e.target.value))} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-neutral-600 min-w-[220px]">
          Davon zusätzlich privat ausgeschüttet: <b className="text-neutral-900 tabular-nums">{quote} % des Rest-Gewinns</b>
          <input type="range" min={0} max={100} step={5} value={quote} onChange={(e) => setQuote(Number(e.target.value))} />
        </label>
        <label className="flex flex-col gap-1 text-xs font-medium text-neutral-600">
          Steuerjahr (KSt {Math.round(kstSatz(vergleichsJahr) * 100)} %)
          <select value={vergleichsJahr} onChange={(e) => setVergleichsJahr(Number(e.target.value))} className="rounded-lg border border-neutral-300 px-2 py-1 text-sm bg-white">
            {[jahr, 2028, 2030, 2032].filter((v, i, a) => a.indexOf(v) === i).map((j) => (
              <option key={j} value={j}>{j}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="grid lg:grid-cols-[1fr_340px] gap-6">
        <div className="h-72">
          <ResponsiveContainer>
            <BarChart data={daten} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e5e5e5" />
              <XAxis dataKey="name" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={(v) => eurK(v)} tick={{ fontSize: 11 }} width={56} />
              <Tooltip formatter={(v, n) => [eur(Number(v)), n]} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {labels.map((l, i) => (
                <Bar key={l} dataKey={l} stackId="s" fill={FARBEN[l] ?? "#a3a3a3"} radius={i === labels.length - 1 ? [6, 6, 0, 0] : undefined} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="space-y-2">
          {erg.map((e) => {
            const diff = e.sofort - eu.sofort;
            return (
              <div key={e.key} className={`rounded-xl border p-3 ${e.key === "eu" ? "border-neutral-300 bg-neutral-50" : diff < 0 ? "border-emerald-200 bg-emerald-50" : "border-red-200 bg-red-50"}`}>
                <div className="flex justify-between items-baseline">
                  <span className="text-sm font-bold">{e.titel}</span>
                  <span className="text-sm font-bold tabular-nums">{eur(e.sofort)}</span>
                </div>
                <div className="text-xs text-neutral-600 mt-0.5">
                  Steuerquote {((e.sofort / Math.max(1, gewinn)) * 100).toFixed(1)} %
                  {e.key !== "eu" && <> · <b className={diff < 0 ? "text-emerald-700" : "text-red-700"}>{diff < 0 ? "−" : "+"}{eur(Math.abs(diff))}</b> ggü. heute</>}
                </div>
                <div className="text-xs text-neutral-600">
                  Privat verfügbar {eur(e.privat)}{e.key !== "eu" && <> · bleibt in {e.key === "holding" ? "GmbH/Holding" : "der GmbH"} {eur(e.netto - e.privat)}</>}
                </div>
                {e.key !== "eu" && (
                  <div className="text-[11px] text-neutral-500 mt-0.5">Wenn später alles privat entnommen wird: {eur(e.gesamtBeiVollausschuettung)} Steuer gesamt</div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-4 mt-5 text-sm">
        <div className="rounded-xl border border-neutral-200 p-4">
          <div className="font-bold mb-1">Einzelunternehmen (heute)</div>
          <ul className="list-disc pl-5 space-y-1 text-neutral-700">
            <li>Gewinn wird voll mit bis zu 45 % + Soli besteuert — egal ob entnommen oder im Lager gebunden.</li>
            <li>Gewerbesteuer wird bis 4 × Messbetrag mit der ESt verrechnet.</li>
            <li>Einfach, wenig Kosten, aber volle persönliche Haftung.</li>
            <li>Option: <b>§ 34a Thesaurierung</b> — nicht entnommener Gewinn nur 28,25 % + Soli (ab 2028 sinkend bis 25 %), bei späterer Entnahme 25 % + Soli nach. Lohnt nur bei langfristig gebundenem Gewinn (Lager).</li>
          </ul>
        </div>
        <div className="rounded-xl border border-violet-200 bg-violet-50/40 p-4">
          <div className="font-bold mb-1">GmbH</div>
          <ul className="list-disc pl-5 space-y-1 text-neutral-700">
            <li>Gewinn in der GmbH: ~{(((kstSatz(vergleichsJahr) * 1.055) + 0.035 * hebesatz / 100) * 100).toFixed(1)} % (KSt + Soli + GewSt). Ab 2028 sinkt die KSt jedes Jahr um 1 Punkt bis 10 % (2032).</li>
            <li>Dein Gehalt als Geschäftsführer ist Betriebsausgabe; du zahlst ESt darauf.</li>
            <li>Ausschüttungen privat: 25 % Abgeltungsteuer + Soli zusätzlich.</li>
            <li>Ideal, wenn viel Gewinn im Unternehmen bleibt (Lager, Wachstum, Schulden tilgen). Haftung auf die GmbH begrenzt.</li>
            <li>Kosten: 25.000 € Stammkapital, Notar/Gründung ~2–5k €, Bilanz + Jahresabschluss jährlich ~5–15k € mehr.</li>
          </ul>
        </div>
        <div className="rounded-xl border border-teal-200 bg-teal-50/40 p-4">
          <div className="font-bold mb-1">GmbH + Holding</div>
          <ul className="list-disc pl-5 space-y-1 text-neutral-700">
            <li>Du hältst die Holding-GmbH, die hält die Hairvenly-GmbH.</li>
            <li>Gewinne an die Holding: zu 95 % steuerfrei (§ 8b KStG) → nur ~1,6 % Steuer.</li>
            <li>In der Holding: Geld für Immobilien, Beteiligungen, neue Firmen — fast ohne zweite Steuer.</li>
            <li>Später Verkauf der Hairvenly-GmbH durch die Holding: ebenfalls zu 95 % steuerfrei.</li>
            <li>Lohnt sich erst, wenn regelmäßig Geld übrig bleibt, das nicht privat gebraucht wird. Doppelte Abschlusskosten.</li>
          </ul>
        </div>
      </div>
      <p className="text-xs text-neutral-500 mt-3">
        Vereinfachte Rechnung: ledig, ohne Kirchensteuer und Sonderausgaben, Gesellschafter-Geschäftsführer ohne Sozialversicherung, keine Pensionszusage.
        Umwandlung Einzelunternehmen → GmbH geht steuerneutral zum Buchwert (§ 20 UmwStG; 7 Jahre Sperrfrist für einen Anteilsverkauf), braucht aber Vorlauf (Gründung, Verträge, Bank, Shopify, Zoll-EORI,
        Mitarbeiterverträge). Sinnvoll meist zum 1. Januar — mit dem Steuerberater planen.
      </p>
    </Karte>
  );
}
