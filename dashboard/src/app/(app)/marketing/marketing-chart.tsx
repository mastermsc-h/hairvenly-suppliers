"use client";

import { Bar, CartesianGrid, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { MktTag } from "@/lib/marketing-extern";

// Umsatz = Balken (Indigo, linke Achse), Werbekosten = Linie (Rose, rechte Achse — Größenordnung ~1 %)
const FARBE = { umsatz: "#6366f1", werbung: "#e11d48" };
const eur = (n: number) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);

export default function MarketingChart({ tage }: { tage: MktTag[] }) {
  const daten = tage.map((t) => ({
    label: `${t.datum.slice(8, 10)}.${t.datum.slice(5, 7)}.`,
    umsatz: Math.round(t.umsatz),
    werbung: Math.round((t.meta_kosten + t.google_kosten) * 100) / 100,
  }));
  return (
    <div className="h-72">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={daten} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" vertical={false} />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#737373" }} interval="preserveStartEnd" />
          <YAxis yAxisId="eur" tick={{ fontSize: 11, fill: "#737373" }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} width={40} />
          <YAxis yAxisId="werbung" orientation="right" tick={{ fontSize: 11, fill: "#737373" }} tickFormatter={(v) => `${Math.round(v)} €`} width={48} />
          <Tooltip
            formatter={(v) => eur(Number(v))}
            contentStyle={{ borderRadius: 8, fontSize: 12 }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar yAxisId="eur" dataKey="umsatz" name="Umsatz" fill={FARBE.umsatz} radius={[3, 3, 0, 0]} />
          <Line yAxisId="werbung" dataKey="werbung" name="Werbekosten" stroke={FARBE.werbung} strokeWidth={2} dot={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
