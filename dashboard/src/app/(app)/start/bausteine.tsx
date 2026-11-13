"use client";

import { useEffect, useId, useRef, useState } from "react";
import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";

export const eur = (n: number) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
export const zahl = (n: number, nachkomma = 0) => new Intl.NumberFormat("de-DE", { minimumFractionDigits: nachkomma, maximumFractionDigits: nachkomma }).format(n);
/** 83.832 € → "84 T€", 2.031.000 € → "2,03 Mio. €" */
export const kurzEur = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${zahl(n / 1_000_000, 2)} Mio. €`;
  if (a >= 10_000) return `${zahl(n / 1000)} T€`;
  return eur(n);
};
export const tagMonat = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.`;
const MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
export const monatName = (monat: string) => `${MONATE[Number(monat.slice(5, 7)) - 1]} ${monat.slice(0, 4)}`;

/** Zahl, die beim Erscheinen ruhig hochzählt. */
export function Zahl({ wert, format = "zahl", nachkomma = 0, className }: { wert: number; format?: "zahl" | "eur" | "kurzEur"; nachkomma?: number; className?: string }) {
  const [v, setV] = useState(wert);
  const erster = useRef(true);
  useEffect(() => {
    const ruhig = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (ruhig) { setV(wert); return; }
    const von = erster.current ? 0 : v;
    erster.current = false;
    const start = performance.now();
    const dauer = 900;
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - start) / dauer);
      const e = 1 - Math.pow(1 - p, 3);
      setV(von + (wert - von) * e);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wert]);
  const text = format === "eur" ? eur(v) : format === "kurzEur" ? kurzEur(v) : zahl(v, nachkomma);
  return <span className={`ck-mono ${className ?? ""}`}>{text}</span>;
}

/** Veränderung gegenüber einem Vergleichswert, z.B. "▲ +39 %". */
export function Delta({ neu, alt, gutWennHoeher = true, absolut, einheit }: { neu: number; alt: number | null | undefined; gutWennHoeher?: boolean; absolut?: boolean; einheit?: string }) {
  if (alt == null || (!absolut && alt === 0)) return <span className="ck-delta" data-ton="neutral"><Minus size={11} /> kein Vergleich</span>;
  const d = absolut ? neu - alt : ((neu - alt) / Math.abs(alt)) * 100;
  const flach = Math.abs(d) < (absolut ? 0.05 : 0.5);
  const ton = flach ? "neutral" : d > 0 === gutWennHoeher ? "gut" : "schlecht";
  const Icon = flach ? Minus : d > 0 ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="ck-delta ck-mono" data-ton={ton}>
      <Icon size={12} />
      {d > 0 ? "+" : ""}{zahl(d, absolut ? 1 : 0)}{einheit ?? (absolut ? "" : " %")}
    </span>
  );
}

/** Mini-Kurve, die sich beim Erscheinen zeichnet. */
export function Funke({ werte, farbe = "var(--w)", hoehe = 44 }: { werte: number[]; farbe?: string; hoehe?: number }) {
  const id = useId();
  if (werte.length < 2) return <div style={{ height: hoehe }} />;
  const min = Math.min(...werte);
  const max = Math.max(...werte);
  const spanne = max - min || 1;
  const pts = werte.map((w, i) => [(i / (werte.length - 1)) * 100, 4 + (1 - (w - min) / spanne) * (hoehe - 8)] as const);
  const linie = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  return (
    <svg className="ck-funke" viewBox={`0 0 100 ${hoehe}`} preserveAspectRatio="none" width="100%" height={hoehe} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={farbe} stopOpacity="0.32" />
          <stop offset="1" stopColor={farbe} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path className="ck-flaeche" d={`${linie} L100,${hoehe} L0,${hoehe} Z`} fill={`url(#${id})`} />
      <path className="ck-linie-pfad" d={linie} pathLength={1} fill="none" stroke={farbe} strokeWidth={2.2} vectorEffect="non-scaling-stroke" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Fortschrittsring, der sich beim Erscheinen füllt. */
export function Ring({ anteil, groesse = 64, dicke = 7, farbe = "var(--w)", children }: { anteil: number; groesse?: number; dicke?: number; farbe?: string; children?: React.ReactNode }) {
  const [an, setAn] = useState(false);
  useEffect(() => { const t = requestAnimationFrame(() => setAn(true)); return () => cancelAnimationFrame(t); }, []);
  const r = (groesse - dicke) / 2;
  const u = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, anteil)) / 100;
  return (
    <div style={{ position: "relative", width: groesse, height: groesse, flex: "none" }}>
      <svg className="ck-ring" width={groesse} height={groesse} style={{ transform: "rotate(-90deg)" }} aria-hidden>
        <circle cx={groesse / 2} cy={groesse / 2} r={r} fill="none" stroke="rgba(96,84,150,0.12)" strokeWidth={dicke} />
        <circle className="ck-ring-wert" cx={groesse / 2} cy={groesse / 2} r={r} fill="none" stroke={farbe} strokeWidth={dicke} strokeLinecap="round" strokeDasharray={u} strokeDashoffset={an ? u * (1 - p) : u} />
      </svg>
      <div style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center" }}>{children}</div>
    </div>
  );
}

/** Rundes Symbol-Feld in der Widget-Farbe (oder eigener Farbe). */
export function Symbol({ children, farbe, groesse = 36 }: { children: React.ReactNode; farbe?: string; groesse?: number }) {
  return <span className="ck-symbol" style={{ width: groesse, height: groesse, ...(farbe ? { ["--s" as string]: farbe } : {}) }}>{children}</span>;
}

export function Balken({ anteil, von, bis }: { anteil: number; von?: string; bis?: string }) {
  return (
    <div className="ck-balken">
      <i style={{ width: `${Math.max(0, Math.min(100, anteil))}%`, ["--ck-b1" as string]: von, ["--ck-b2" as string]: bis ?? von }} />
    </div>
  );
}

export function Lade() {
  return (
    <div className="ck-lade" aria-label="Lädt">
      <i style={{ width: "45%" }} /><i style={{ width: "80%", height: 26 }} /><i style={{ width: "65%" }} /><i style={{ width: "90%" }} />
    </div>
  );
}

export function Hinweis({ children }: { children: React.ReactNode }) {
  return <div className="ck-dim" style={{ fontSize: 13, lineHeight: 1.5, padding: "6px 0" }}>{children}</div>;
}
