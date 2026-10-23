"use client";

import { Bar, CartesianGrid, ComposedChart, LabelList, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { HealthMonat } from "@/lib/health";

// Validierte Palette (dataviz validate_palette, light): Lager / Konten / Schulden; Kennzahl = Tinte
const FARBE = { lager: "#6366f1", konten: "#0d9488", schulden: "#e11d48", score: "#171717" };

const MONATE = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const monatLabel = (m: string) => `${MONATE[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
const num1 = (n: number) => new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 }).format(n);
const eur = (n: number) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

interface Punkt {
  label: string;
  lager: number | null;
  konten: number;
  schulden: number;
  score: number | null;
  m: HealthMonat;
}

export default function HealthChart({ monate }: { monate: HealthMonat[] }) {
  const daten: Punkt[] = monate.map((m) => ({
    label: m.live ? `${monatLabel(m.monat)} · heute` : monatLabel(m.monat),
    lager: m.kg,
    konten: Math.round(m.kontenEur / 100) / 10,
    schulden: -Math.round(m.schuldenEur / 100) / 10,
    score: m.score,
    m,
  }));
  const ohnePaypal = monate.filter((m) => m.paypalEur == null).map((m) => monatLabel(m.monat));

  return (
    <section className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
        <h2 className="text-sm font-medium text-neutral-700">Kennzahl pro Monat</h2>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-neutral-600">
          <Legende farbe={FARBE.lager} text="Lager (kg)" />
          <Legende farbe={FARBE.konten} text="Konten (T€)" />
          <Legende farbe={FARBE.schulden} text="Schulden (T€)" />
          <span className="inline-flex items-center gap-1.5">
            <svg width="18" height="10" aria-hidden><line x1="0" y1="5" x2="18" y2="5" stroke={FARBE.score} strokeWidth="2" /><circle cx="9" cy="5" r="3.5" fill={FARBE.score} stroke="#fff" strokeWidth="1.5" /></svg>
            Kennzahl
          </span>
        </div>
      </div>
      <p className="text-[11px] text-neutral-400 mb-3">
        Werte zum Monatsende, laufender Monat live. Balken über null: Lager + Konten, unter null: Schulden — die Linie ist die Summe.
      </p>

      <div className="h-72">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={daten} stackOffset="sign" margin={{ top: 22, right: 8, bottom: 0, left: -8 }} barCategoryGap="28%">
            <CartesianGrid vertical={false} stroke="#f0f0f0" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#737373" }} />
            <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "#a3a3a3" }} tickFormatter={(v: number) => num1(v)} width={48} />
            <ReferenceLine y={0} stroke="#d4d4d4" />
            <Tooltip content={<Tipp />} cursor={{ fill: "#f5f5f5" }} />
            <Bar dataKey="lager" stackId="a" fill={FARBE.lager} stroke="#fff" strokeWidth={2} maxBarSize={56} />
            <Bar dataKey="konten" stackId="a" fill={FARBE.konten} stroke="#fff" strokeWidth={2} radius={[4, 4, 0, 0]} maxBarSize={56} />
            <Bar dataKey="schulden" stackId="a" fill={FARBE.schulden} stroke="#fff" strokeWidth={2} radius={[0, 0, 4, 4]} maxBarSize={56} />
            <Line dataKey="score" stroke={FARBE.score} strokeWidth={2} dot={{ r: 4, fill: FARBE.score, stroke: "#fff", strokeWidth: 2 }} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false}>
              <LabelList dataKey="score" position="top" offset={10} formatter={(v: unknown) => (typeof v === "number" ? num1(v) : "")} style={{ fontSize: 11, fontWeight: 600, fill: "#171717" }} />
            </Line>
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-3 text-[11px] text-neutral-400 space-y-0.5">
        <div>Lager-Historie gibt es erst ab {monate[0] ? monatLabel(monate[0].monat) : "—"} — der Verlauf wächst ab jetzt jeden Monat automatisch.</div>
        {ohnePaypal.length > 0 && (
          <div>PayPal-Stand für {ohnePaypal.join(", ")} unbekannt (nur Bankkonten) — ab jetzt wird er täglich mitgespeichert.</div>
        )}
      </div>

      <details className="mt-3 text-xs">
        <summary className="cursor-pointer text-neutral-500 hover:text-neutral-700">Als Tabelle</summary>
        <div className="overflow-x-auto mt-2">
          <table className="w-full">
            <thead className="text-left text-neutral-500">
              <tr className="border-b border-neutral-100">
                <th className="py-1.5 pr-3 font-medium">Monat</th>
                <th className="py-1.5 pr-3 font-medium text-right">Lager kg</th>
                <th className="py-1.5 pr-3 font-medium text-right">Konten</th>
                <th className="py-1.5 pr-3 font-medium text-right">Lieferanten</th>
                <th className="py-1.5 pr-3 font-medium text-right">Steuern</th>
                <th className="py-1.5 pr-3 font-medium text-right">Ergänzungen</th>
                <th className="py-1.5 font-medium text-right">Kennzahl</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-50 text-neutral-700 tabular-nums">
              {monate.map((m) => (
                <tr key={m.monat}>
                  <td className="py-1.5 pr-3 whitespace-nowrap">{monatLabel(m.monat)}{m.live ? " (heute)" : ""}</td>
                  <td className="py-1.5 pr-3 text-right">{m.kg != null ? num1(m.kg) : "—"}</td>
                  <td className="py-1.5 pr-3 text-right">{eur(m.kontenEur)}{m.paypalEur == null ? "*" : ""}</td>
                  <td className="py-1.5 pr-3 text-right">{eur(m.lieferantenEur)}</td>
                  <td className="py-1.5 pr-3 text-right">{eur(m.steuernEur)}</td>
                  <td className="py-1.5 pr-3 text-right">{eur(m.ergaenzungenEur)}</td>
                  <td className="py-1.5 text-right font-semibold">{m.score != null ? num1(m.score) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {ohnePaypal.length > 0 && <div className="text-[11px] text-neutral-400 mt-1">* ohne PayPal</div>}
        </div>
      </details>
    </section>
  );
}

function Legende({ farbe, text }: { farbe: string; text: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: farbe }} />
      {text}
    </span>
  );
}

function Tipp({ active, payload }: { active?: boolean; payload?: Array<{ payload: Punkt }> }) {
  if (!active || !payload?.length) return null;
  const { m, label } = payload[0].payload;
  const zeile = (farbe: string | null, text: string, wert: string, fett = false) => (
    <div className={`flex items-center justify-between gap-4 ${fett ? "font-semibold text-neutral-900" : "text-neutral-600"}`}>
      <span className="inline-flex items-center gap-1.5">
        {farbe ? <span className="inline-block w-2 h-2 rounded-sm" style={{ background: farbe }} /> : <span className="inline-block w-2" />}
        {text}
      </span>
      <span className="tabular-nums">{wert}</span>
    </div>
  );
  return (
    <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs shadow-sm space-y-0.5 min-w-[220px]">
      <div className="font-medium text-neutral-800 mb-1">
        {label} <span className="font-normal text-neutral-400">· Stand {new Date(`${m.stichtag}T12:00:00Z`).toLocaleDateString("de-DE")}</span>
      </div>
      {zeile(FARBE.lager, "Lager", m.kg != null ? `${num1(m.kg)} kg` : "unbekannt")}
      {zeile(FARBE.konten, m.paypalEur == null ? "Konten (ohne PayPal)" : "Konten", eur(m.kontenEur))}
      {zeile(FARBE.schulden, "Schulden", eur(m.schuldenEur))}
      {zeile(null, "· Lieferanten fällig", eur(m.lieferantenEur))}
      {zeile(null, "· Steuern offen", eur(m.steuernEur))}
      {m.ergaenzungenEur !== 0 && zeile(null, "· Ergänzungen", eur(m.ergaenzungenEur))}
      <div className="border-t border-neutral-100 mt-1 pt-1">{zeile(null, "Kennzahl", m.score != null ? num1(m.score) : "—", true)}</div>
    </div>
  );
}
