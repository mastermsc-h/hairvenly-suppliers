"use client";

// Gewerbekunden: dunkles „Business“-Fenster mit abgeschrägten Ecken.
// Links ein Ring (Bestand: aktiv 30 T · aktiv 31–90 T · eingeschlafen · nie bestellt),
// rechts Kennzahlen und der Monatsverlauf (Balken = aktive Gewerbekunden, Linie = Anteil am Umsatz).
import { Bar, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis, Cell } from "recharts";
import type { GewerbeDaten } from "@/lib/cockpit/typen";
import { eur, kurzEur, zahl } from "./bausteine";

const MON = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const pct = (x: number) => `${zahl(x * 100, 1)} %`;

function Ring({ teile, gesamt }: { teile: Array<{ wert: number; farbe: string; name: string }>; gesamt: number }) {
  const r = 78;
  const u = 2 * Math.PI * r;
  const summe = Math.max(1, teile.reduce((s, t) => s + t.wert, 0));
  const laengen = teile.map((t) => (t.wert / summe) * u);
  const starts = laengen.map((_, i) => laengen.slice(0, i).reduce((s, x) => s + x, 0));
  return (
    <svg className="gw-ring" viewBox="0 0 200 200" role="img" aria-label={`${gesamt} Gewerbekunden`}>
      <defs>
        <linearGradient id="gw-gold" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#ffe3a3" />
          <stop offset="1" stopColor="#d6a24a" />
        </linearGradient>
      </defs>
      <circle cx="100" cy="100" r={r} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="16" />
      {teile.map((t, i) => {
        const laenge = laengen[i];
        return (
          <circle
            key={t.name} className="gw-bogen" cx="100" cy="100" r={r} fill="none"
            stroke={i === 0 ? "url(#gw-gold)" : t.farbe} strokeWidth={i === 0 ? 16 : 13} strokeLinecap="butt"
            strokeDasharray={`${Math.max(0, laenge - 2)} ${u}`} strokeDashoffset={-starts[i]}
            transform="rotate(-90 100 100)" style={{ ["--gw-i" as string]: i }}
          >
            <title>{`${t.name}: ${t.wert}`}</title>
          </circle>
        );
      })}
      <text x="100" y="94" textAnchor="middle" className="gw-ring-zahl">{zahl(gesamt)}</text>
      <text x="100" y="118" textAnchor="middle" className="gw-ring-text">Gewerbekunden</text>
    </svg>
  );
}

type Punkt = GewerbeDaten["monate"][number] & { label: string };

function Tipp({ active, payload }: { active?: boolean; payload?: Array<{ payload: Punkt }> }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="gw-tipp">
      <b>{MON[Number(p.monat.slice(5, 7)) - 1]} {p.monat.slice(0, 4)}</b>
      <div><i style={{ background: "#e7b75f" }} />{p.aktive} aktive Kunden</div>
      <div><i style={{ background: "#7dd3fc" }} />{pct(p.anteil)} vom Umsatz</div>
      <div className="gw-tipp-matt">{p.bestellungen} Bestellungen · {eur(p.umsatz)} · {p.neue} neu</div>
    </div>
  );
}

export default function GewerbeWidget({ d }: { d: GewerbeDaten }) {
  const gesamt = d.registriert ?? d.kaeufer;
  const nie = Math.max(0, gesamt - d.kaeufer);
  const schlafend = Math.max(0, d.kaeufer - d.aktiv90);
  const teile = [
    { name: "Aktiv · 30 Tage", wert: d.aktiv30, farbe: "#e7b75f" },
    { name: "Aktiv · 31–90 Tage", wert: Math.max(0, d.aktiv90 - d.aktiv30), farbe: "#a8864a" },
    { name: "Eingeschlafen (> 90 Tage)", wert: schlafend, farbe: "#55607a" },
    { name: "Registriert, nie bestellt", wert: nie, farbe: "#2c3448" },
  ];
  const delta = d.aktiv90 - d.aktiv90Vorjahr;
  const daten: Punkt[] = d.monate.map((m) => ({ ...m, label: MON[Number(m.monat.slice(5, 7)) - 1] }));
  const maxAnteil = Math.max(0.05, ...daten.map((m) => m.anteil));
  const letzter = daten.length - 1;

  return (
    <div className="gw-huelle">
    <div className="gw">
      <div className="gw-links">
        <Ring teile={teile} gesamt={gesamt} />
        <ul className="gw-legende">
          {teile.map((t) => (
            <li key={t.name}><i style={{ background: t.farbe }} /><span>{t.name}</span><b>{zahl(t.wert)}</b></li>
          ))}
        </ul>
      </div>

      <div className="gw-rechts">
        <div className="gw-kpis">
          <div className="gw-kpi gw-kpi-haupt">
            <span>Aktiv · 90 Tage</span>
            <b>{zahl(d.aktiv90)}</b>
            <small data-plus={delta >= 0}>{delta >= 0 ? "▲" : "▼"} {Math.abs(delta)} ggü. Vorjahr</small>
          </div>
          <div className="gw-kpi">
            <span>Aktiv · 30 Tage</span>
            <b>{zahl(d.aktiv30)}</b>
            <small>{pct(d.aktiv30 / Math.max(1, gesamt))} aller Gewerbekunden</small>
          </div>
          <div className="gw-kpi">
            <span>Umsatz · 90 Tage</span>
            <b>{kurzEur(d.umsatz90)}</b>
            <small>{zahl(d.bestellungen90)} Bestellungen · Ø {eur(d.umsatz90 / Math.max(1, d.bestellungen90))}</small>
          </div>
          <div className="gw-kpi">
            <span>Anteil am Umsatz</span>
            <b>{pct(d.anteil)}</b>
            <small>letzte 3 volle Monate</small>
          </div>
        </div>

        <div className="gw-chart">
          <div className="gw-chart-kopf">
            <span>Aktive Gewerbekunden je Monat</span>
            <span className="gw-chart-legende"><i className="gw-balken" />aktiv <i className="gw-linie" />Anteil am Umsatz</span>
          </div>
          <div className="gw-chart-flaeche">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={daten} margin={{ top: 8, right: 4, left: -6, bottom: 4 }}>
                <defs>
                  <linearGradient id="gw-balken" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#f3cf85" />
                    <stop offset="1" stopColor="#b8873d" stopOpacity={0.55} />
                  </linearGradient>
                  <linearGradient id="gw-balken-akt" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0" stopColor="#f3cf85" stopOpacity={0.55} />
                    <stop offset="1" stopColor="#b8873d" stopOpacity={0.2} />
                  </linearGradient>
                </defs>
                <XAxis dataKey="label" tick={{ fill: "rgba(226,232,255,0.55)", fontSize: 10.5 }} axisLine={false} tickLine={false} interval={0} />
                <YAxis yAxisId="a" tick={{ fill: "rgba(226,232,255,0.4)", fontSize: 10 }} axisLine={false} tickLine={false} width={34} allowDecimals={false} />
                <YAxis yAxisId="p" orientation="right" hide domain={[0, maxAnteil * 1.25]} />
                <Tooltip content={<Tipp />} cursor={{ fill: "rgba(255,255,255,0.05)" }} />
                <Bar yAxisId="a" dataKey="aktive" radius={[6, 6, 2, 2]} maxBarSize={26} isAnimationActive>
                  {daten.map((_, i) => <Cell key={i} fill={i === letzter ? "url(#gw-balken-akt)" : "url(#gw-balken)"} />)}
                </Bar>
                <Line yAxisId="p" dataKey="anteil" type="monotone" stroke="#7dd3fc" strokeWidth={2} dot={{ r: 2.5, fill: "#0f1424", stroke: "#7dd3fc", strokeWidth: 1.5 }} activeDot={{ r: 4 }} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="gw-fuss">Gewerbekunde = Kunde mit Tag „B2B“ in Shopify · laufender Monat blasser</div>
        </div>
      </div>
    </div>
    </div>
  );
}
