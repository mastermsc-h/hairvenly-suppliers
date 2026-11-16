"use client";

// Newsletter-Verlauf: Anmeldungen nach oben (bestätigt kräftig, unbestätigt hell), Abmeldungen nach unten,
// Linie = Abonnenten am Ende des Zeitraums. Umschaltbar Tage (90) / Wochen (26) / Monate (18).
import { useState } from "react";
import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { NewsletterDaten } from "@/lib/cockpit/typen";

const zahl = (n: number) => new Intl.NumberFormat("de-DE").format(Math.round(n));
const MON = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
type Punkt = { label: string; titel: string; neu: number; ausstehend: number; ab: number; abonniert: number | null };

function wochenstart(tag: string) {
  const d = new Date(`${tag}T12:00:00Z`);
  const w = d.getUTCDay();
  d.setUTCDate(d.getUTCDate() + (w === 0 ? -6 : 1 - w));
  return d.toISOString().slice(0, 10);
}

function Tipp({ active, payload }: { active?: boolean; payload?: Array<{ payload: Punkt }> }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs shadow-lg">
      <div className="font-semibold mb-1">{p.titel}</div>
      <div><b className="text-violet-600">+{zahl(p.neu)}</b> bestätigt · <span className="text-violet-400">+{zahl(p.ausstehend)} unbestätigt</span></div>
      <div className="text-rose-600">−{zahl(-p.ab)} abgemeldet</div>
      {p.abonniert != null && <div className="text-neutral-500 mt-1">{zahl(p.abonniert)} Abonnenten</div>}
    </div>
  );
}

export default function NewsletterChart({ d }: { d: NewsletterDaten }) {
  const [art, setArt] = useState<"tag" | "woche" | "monat">("monat");
  const daten: Punkt[] = (() => {
    if (art === "monat") return d.monate.map((m) => ({ label: `${MON[Number(m.monat.slice(5, 7)) - 1]} ${m.monat.slice(2, 4)}`, titel: m.monat, neu: m.neu, ausstehend: m.ausstehend, ab: -m.abmeldungen, abonniert: m.ende }));
    if (art === "tag") return d.tage.slice(-90).map((t) => ({ label: `${Number(t.tag.slice(8, 10))}.${Number(t.tag.slice(5, 7))}.`, titel: new Date(`${t.tag}T12:00:00Z`).toLocaleDateString("de-DE"), neu: t.neu, ausstehend: t.ausstehend, ab: -t.abmeldungen, abonniert: t.abonniert }));
    const m = new Map<string, Punkt>();
    for (const t of d.tage) {
      const w = wochenstart(t.tag);
      const e = m.get(w) ?? { label: `${Number(w.slice(8, 10))}.${Number(w.slice(5, 7))}.`, titel: `Woche ab ${new Date(`${w}T12:00:00Z`).toLocaleDateString("de-DE")}`, neu: 0, ausstehend: 0, ab: 0, abonniert: null };
      e.neu += t.neu; e.ausstehend += t.ausstehend; e.ab -= t.abmeldungen;
      if (t.abonniert != null) e.abonniert = t.abonniert;
      m.set(w, e);
    }
    return [...m.values()].slice(-26);
  })();
  const ab = daten.map((x) => x.abonniert).filter((x): x is number => x != null);
  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2 flex-wrap">
        <div className="flex gap-3 text-xs text-neutral-600">
          <span className="inline-flex items-center gap-1.5"><i className="inline-block w-2.5 h-2.5 rounded-sm bg-violet-600" />bestätigt</span>
          <span className="inline-flex items-center gap-1.5"><i className="inline-block w-2.5 h-2.5 rounded-sm bg-violet-200" />unbestätigt</span>
          <span className="inline-flex items-center gap-1.5"><i className="inline-block w-2.5 h-2.5 rounded-sm bg-rose-400" />abgemeldet</span>
          <span className="inline-flex items-center gap-1.5"><i className="inline-block w-3 h-0.5 bg-neutral-800" />Abonnenten</span>
        </div>
        <div className="inline-flex rounded-lg border border-neutral-200 p-0.5 text-xs">
          {(["tag", "woche", "monat"] as const).map((a) => (
            <button key={a} type="button" onClick={() => setArt(a)} className={`px-2.5 py-1 rounded-md ${art === a ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100"}`}>
              {a === "tag" ? "Tage" : a === "woche" ? "Wochen" : "Monate"}
            </button>
          ))}
        </div>
      </div>
      <div style={{ height: 300 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={daten} stackOffset="sign" margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="#eee" />
            <XAxis dataKey="label" tickLine={false} axisLine={false} fontSize={11} minTickGap={12} />
            <YAxis yAxisId="z" width={44} tickLine={false} axisLine={false} fontSize={11} tickFormatter={zahl} />
            <YAxis yAxisId="a" orientation="right" width={52} tickLine={false} axisLine={false} fontSize={11} tickFormatter={zahl} domain={ab.length ? [Math.floor(Math.min(...ab) * 0.98), Math.ceil(Math.max(...ab) * 1.01)] : ["auto", "auto"]} />
            <Tooltip content={<Tipp />} cursor={{ fill: "rgba(124,92,255,0.06)" }} />
            <ReferenceLine yAxisId="z" y={0} stroke="#d4d4d8" />
            <Bar yAxisId="z" dataKey="neu" stackId="s" fill="#7c3aed" />
            <Bar yAxisId="z" dataKey="ausstehend" stackId="s" fill="#ddd6fe" radius={[3, 3, 0, 0]} />
            <Bar yAxisId="z" dataKey="ab" stackId="s" fill="#fb7185" radius={[3, 3, 0, 0]} />
            <Line yAxisId="a" type="monotone" dataKey="abonniert" stroke="#18181b" strokeWidth={2} dot={false} connectNulls />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
