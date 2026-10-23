"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Briefcase, Globe2, MapPin, Repeat, ShoppingBag, Users } from "lucide-react";

// ── Datentypen (Zeilen der Views aus 0135_kunden_analyse.sql) ─────
type Num = number | string;
export interface KundenDaten {
  monat: { monat: string; herkunft: string; gewerbe: boolean; neukunde: boolean; bestellungen: number; umsatz: Num; kunden: number }[];
  segment: { monat: string; gewerbe: boolean; bestellungen: number; umsatz: Num; kunden: number; neue_kunden: number }[];
  land: { monat: string; land: string; bestellungen: number; umsatz: Num }[];
  stadt: { halbjahr: number; land: string; stadt_key: string; stadt: string; bestellungen: number; umsatz: Num; kunden: number }[];
  kanal: { monat: string; kanal: string; gewerbe: boolean; bestellungen: number; umsatz: Num }[];
  lifetime: { gewerbe: boolean; herkunft: string; kunden: number; bestellungen: number; umsatz: Num; wiederkaeufer: number }[];
}

const HERKUNFT_LABEL: Record<string, string> = {
  deutsch: "Deutsch",
  tuerkisch: "Türkisch",
  arabisch: "Arabisch",
  kurdisch: "Kurdisch",
  persisch: "Persisch / Afghanisch",
  polnisch: "Polnisch",
  russisch: "Russisch / Ukrainisch",
  balkan: "Balkan / Albanisch",
  rumaenisch: "Rumänisch / Bulgarisch",
  suedeuropa: "Südeuropäisch",
  westeuropa: "West-/Nordeuropäisch",
  afrikanisch: "Afrikanisch",
  asiatisch: "Asiatisch",
  sonstige: "Sonstige",
  unklar: "Nicht eindeutig",
  uebrige: "Übrige",
};
const KANAL_LABEL: Record<string, string> = {
  web: "Online-Shop",
  pos: "Ladenkasse (POS)",
  shopify_draft_order: "Manuell erstellt",
  sonstige: "Sonstige",
};

// Validierte Kategorial-Palette (dataviz, light) — feste Reihenfolge, Farbe folgt der Gruppe
const SERIEN = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6"];
const GRAU = "#a3a3a3";
const FARBE_PRIVAT = "#2a78d6";
const FARBE_GEWERBE = "#eb6834";
const FARBE_NEU = "#6250d6";
const FARBE_STAMM = "#1baf7a";

const MONATE = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const n0 = (n: number) => new Intl.NumberFormat("de-DE", { maximumFractionDigits: 0 }).format(n);
const pct = (n: number, d = 1) => `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: d, minimumFractionDigits: d }).format(n * 100)} %`;
const eur = (n: number) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
const eurK = (n: number) => (Math.abs(n) >= 10000 ? `${n0(n / 1000)} T€` : eur(n));
const num = (v: Num) => Number(v) || 0;
const ym = (iso: string) => iso.slice(0, 7);
const div = (a: number, b: number) => (b > 0 ? a / b : 0);

let laenderNamen: Intl.DisplayNames | null = null;
function landName(code: string) {
  if (code === "??") return "Unbekannt";
  try {
    laenderNamen ??= new Intl.DisplayNames(["de"], { type: "region" });
    return laenderNamen.of(code) ?? code;
  } catch {
    return code;
  }
}

function addMonate(m: string, k: number) {
  const [y, mo] = m.split("-").map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + k, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}
function monatLabel(m: string) {
  return `${MONATE[Number(m.slice(5, 7)) - 1]} ${m.slice(2, 4)}`;
}
function bucketVon(m: string, takt: Takt) {
  if (takt === "monat") return m;
  return `${m.slice(0, 4)}-Q${Math.ceil(Number(m.slice(5, 7)) / 3)}`;
}
function bucketLabel(b: string, takt: Takt, laufend: string) {
  const lfd = bucketVon(laufend, takt) === b ? " (lfd.)" : "";
  if (takt === "monat") return monatLabel(b) + lfd;
  return `${b.slice(5)} ${b.slice(2, 4)}${lfd}`;
}
function spanneLabel(von: string, bis: string) {
  return von === bis ? monatLabel(von) : `${monatLabel(von)} – ${monatLabel(bis)}`;
}

type Takt = "monat" | "quartal";
type Zeitraum = "12" | "24" | "alle";
type Messgroesse = "bestellungen" | "umsatz" | "neukunden";
type Segment = "alle" | "privat" | "gewerbe";

// ── Kleine UI-Bausteine ─────────────────────────────────────────
function Karte({ titel, untertitel, icon, children, rechts }: { titel: string; untertitel?: string; icon?: ReactNode; children: ReactNode; rechts?: ReactNode }) {
  return (
    <section className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <h2 className="text-sm font-semibold text-neutral-800 inline-flex items-center gap-2">
            {icon}
            {titel}
          </h2>
          {untertitel && <p className="text-xs text-neutral-500 mt-0.5">{untertitel}</p>}
        </div>
        {rechts}
      </div>
      {children}
    </section>
  );
}

function Umschalter<T extends string>({ wert, optionen, onChange }: { wert: T; optionen: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex rounded-lg bg-neutral-100 p-0.5 text-xs">
      {optionen.map(([v, l]) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          className={`px-2.5 py-1 rounded-md transition ${wert === v ? "bg-white text-neutral-900 shadow-sm font-medium" : "text-neutral-500 hover:text-neutral-800"}`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

function Legende({ eintraege }: { eintraege: { farbe: string; text: string }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-neutral-600 mt-3">
      {eintraege.map((e) => (
        <span key={e.text} className="inline-flex items-center gap-1.5">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: e.farbe }} />
          {e.text}
        </span>
      ))}
    </div>
  );
}

function Delta({ wert, einheit = "pp", invert = false }: { wert: number; einheit?: "pp" | "%"; invert?: boolean }) {
  const txt = einheit === "pp" ? `${wert >= 0 ? "+" : "−"}${n0Dez(Math.abs(wert * 100))} pp` : `${wert >= 0 ? "+" : "−"}${n0(Math.abs(wert * 100))} %`;
  const gut = invert ? wert < 0 : wert > 0;
  const neutral = Math.abs(wert) < (einheit === "pp" ? 0.002 : 0.01);
  return (
    <span className={`tabular-nums font-medium ${neutral ? "text-neutral-400" : gut ? "text-emerald-600" : "text-rose-600"}`}>
      {neutral ? "±0" : wert > 0 ? "▲" : "▼"} {neutral ? "" : txt}
    </span>
  );
}
const n0Dez = (n: number) => new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(n);

interface TippZeile {
  name: string;
  farbe: string;
  wert: string;
}
function Tipp({ titel, zeilen, fuss }: { titel: string; zeilen: TippZeile[]; fuss?: string }) {
  return (
    <div className="rounded-lg border border-neutral-200 bg-white/95 backdrop-blur px-3 py-2 shadow-lg text-xs min-w-[180px]">
      <div className="font-medium text-neutral-800 mb-1">{titel}</div>
      {zeilen.map((z) => (
        <div key={z.name} className="flex items-center justify-between gap-4 py-0.5">
          <span className="inline-flex items-center gap-1.5 text-neutral-600">
            <span className="inline-block w-2 h-2 rounded-sm" style={{ background: z.farbe }} />
            {z.name}
          </span>
          <span className="tabular-nums text-neutral-900">{z.wert}</span>
        </div>
      ))}
      {fuss && <div className="text-neutral-400 mt-1 pt-1 border-t border-neutral-100">{fuss}</div>}
    </div>
  );
}

const achse = { tickLine: false, axisLine: false, tick: { fontSize: 11, fill: "#737373" } } as const;
const yAchse = { tickLine: false, axisLine: false, tick: { fontSize: 11, fill: "#a3a3a3" } } as const;

// ── Hauptkomponente ─────────────────────────────────────────────
export default function KundenAnalyse({ daten }: { daten: KundenDaten }) {
  const [zeitraum, setZeitraum] = useState<Zeitraum>("24");
  const [takt, setTakt] = useState<Takt>("monat");
  const [mass, setMass] = useState<Messgroesse>("bestellungen");
  const [segment, setSegment] = useState<Segment>("alle");

  const heute = new Date();
  const laufend = `${heute.getFullYear()}-${String(heute.getMonth() + 1).padStart(2, "0")}`;
  const alleMonate = useMemo(() => [...new Set(daten.monat.map((r) => ym(r.monat)))].sort(), [daten.monat]);
  const ersterMonat = alleMonate[0];
  const letzterVoll = addMonate(laufend, -1);

  const vonMonat = zeitraum === "alle" ? ersterMonat : [ersterMonat, addMonate(laufend, -(Number(zeitraum) - 1))].sort()[1];
  const imZeitraum = (m: string) => m >= vonMonat && m <= laufend;
  const buckets = useMemo(() => {
    const s = new Set<string>();
    for (const m of alleMonate) if (m >= vonMonat && m <= laufend) s.add(bucketVon(m, takt));
    return [...s].sort();
  }, [alleMonate, vonMonat, laufend, takt]);

  // Vergleichsfenster: erste vs. letzte 6 volle Monate des Zeitraums
  const fensterA = { von: vonMonat, bis: [addMonate(vonMonat, 5), letzterVoll].sort()[0] };
  const fensterB = { von: [addMonate(letzterVoll, -5), vonMonat].sort()[1], bis: letzterVoll };
  const inA = (m: string) => m >= fensterA.von && m <= fensterA.bis;
  const inB = (m: string) => m >= fensterB.von && m <= fensterB.bis;

  // Gruppenreihenfolge über ALLE Daten → Farben bleiben bei jedem Filter gleich
  const gruppen = useMemo(() => {
    const t = new Map<string, number>();
    for (const r of daten.monat) if (r.herkunft !== "unklar") t.set(r.herkunft, (t.get(r.herkunft) ?? 0) + r.bestellungen);
    const sortiert = [...t].sort((a, b) => b[1] - a[1]).map(([k]) => k);
    return { haupt: sortiert.slice(0, SERIEN.length), alle: sortiert };
  }, [daten.monat]);
  const farbeVon = (g: string) => {
    const i = gruppen.haupt.indexOf(g);
    return i >= 0 ? SERIEN[i] : GRAU;
  };
  const gruppeVon = (h: string) => (gruppen.haupt.includes(h) ? h : "uebrige");

  const passtSegment = (gewerbe: boolean) => segment === "alle" || (segment === "gewerbe") === gewerbe;
  const wertVon = (r: KundenDaten["monat"][number]) =>
    mass === "umsatz" ? num(r.umsatz) : mass === "neukunden" ? (r.neukunde ? r.bestellungen : 0) : r.bestellungen;
  const massLabel = mass === "umsatz" ? "Umsatz" : mass === "neukunden" ? "Neukunden" : "Bestellungen";
  const fmtMass = (v: number) => (mass === "umsatz" ? eur(v) : n0(v));

  // ── KPIs: letzte 12 volle Monate vs. 12 davor ──
  const kpi = useMemo(() => {
    const b = { von: addMonate(letzterVoll, -11), bis: letzterVoll };
    const a = { von: addMonate(letzterVoll, -23), bis: addMonate(letzterVoll, -12) };
    const leer = () => ({ best: 0, umsatz: 0, gewUmsatz: 0, neu: 0, stamm: 0, deutsch: 0, bekannt: 0 });
    const s = { a: leer(), b: leer() };
    for (const r of daten.monat) {
      const m = ym(r.monat);
      const k = m >= b.von && m <= b.bis ? s.b : m >= a.von && m <= a.bis ? s.a : null;
      if (!k) continue;
      k.best += r.bestellungen;
      k.umsatz += num(r.umsatz);
      if (r.gewerbe) k.gewUmsatz += num(r.umsatz);
      if (r.neukunde) k.neu += r.bestellungen;
      else k.stamm += r.bestellungen;
      if (r.herkunft !== "unklar") {
        k.bekannt += r.bestellungen;
        if (r.herkunft === "deutsch") k.deutsch += r.bestellungen;
      }
    }
    const vollA = a.von >= ersterMonat;
    return { ...s, vollA, labelB: spanneLabel(b.von, b.bis), labelA: spanneLabel(a.von, a.bis) };
  }, [daten.monat, letzterVoll, ersterMonat]);

  // ── Herkunft: 100%-Fläche pro Bucket ──
  const herkunftReihe = useMemo(() => {
    const map = new Map<string, Record<string, number>>();
    for (const b of buckets) map.set(b, {});
    for (const r of daten.monat) {
      const m = ym(r.monat);
      if (!imZeitraum(m) || !passtSegment(r.gewerbe) || r.herkunft === "unklar") continue;
      const z = map.get(bucketVon(m, takt));
      if (!z) continue;
      const g = gruppeVon(r.herkunft);
      z[g] = (z[g] ?? 0) + wertVon(r);
    }
    return buckets.map((b) => {
      const z = map.get(b)!;
      const summe = Object.values(z).reduce((x, y) => x + y, 0);
      const anteile: Record<string, number> = {};
      for (const [g, v] of Object.entries(z)) anteile[g] = div(v, summe);
      return { b, label: bucketLabel(b, takt, laufend), summe, absolut: z, ...anteile };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daten.monat, buckets, takt, segment, mass, vonMonat, gruppen]);

  // ── Herkunft: Vergleich Anfang vs. Ende ──
  const herkunftVergleich = useMemo(() => {
    const t = new Map<string, { a: number; b: number; bBest: number; bUmsatz: number }>();
    let sumA = 0;
    let sumB = 0;
    let unklarB = 0;
    let alleB = 0;
    for (const r of daten.monat) {
      const m = ym(r.monat);
      if (!passtSegment(r.gewerbe)) continue;
      if (inB(m)) {
        alleB += wertVon(r);
        if (r.herkunft === "unklar") unklarB += wertVon(r);
      }
      if (r.herkunft === "unklar") continue;
      const z = t.get(r.herkunft) ?? { a: 0, b: 0, bBest: 0, bUmsatz: 0 };
      if (inA(m)) {
        z.a += wertVon(r);
        sumA += wertVon(r);
      }
      if (inB(m)) {
        z.b += wertVon(r);
        sumB += wertVon(r);
        z.bBest += r.bestellungen;
        z.bUmsatz += num(r.umsatz);
      }
      t.set(r.herkunft, z);
    }
    const zeilen = [...t]
      .map(([g, z]) => ({ g, anteilA: div(z.a, sumA), anteilB: div(z.b, sumB), wertB: z.b, bon: div(z.bUmsatz, z.bBest) }))
      .filter((z) => z.anteilA > 0.002 || z.anteilB > 0.002)
      .sort((x, y) => y.anteilB - x.anteilB);
    return { zeilen, unklarAnteil: div(unklarB, alleB) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daten.monat, segment, mass, fensterA.von, fensterA.bis, fensterB.von, fensterB.bis]);

  // ── Gewerbe vs. Privat ──
  const segmentReihe = useMemo(() => {
    const map = new Map<string, { gB: number; pB: number; gU: number; pU: number; gNeu: number; pNeu: number; gKunden: number }>();
    for (const b of buckets) map.set(b, { gB: 0, pB: 0, gU: 0, pU: 0, gNeu: 0, pNeu: 0, gKunden: 0 });
    for (const r of daten.segment) {
      const m = ym(r.monat);
      if (!imZeitraum(m)) continue;
      const z = map.get(bucketVon(m, takt));
      if (!z) continue;
      if (r.gewerbe) {
        z.gB += r.bestellungen;
        z.gU += num(r.umsatz);
        z.gNeu += r.neue_kunden;
        z.gKunden += r.kunden;
      } else {
        z.pB += r.bestellungen;
        z.pU += num(r.umsatz);
        z.pNeu += r.neue_kunden;
      }
    }
    return buckets.map((b) => {
      const z = map.get(b)!;
      return {
        label: bucketLabel(b, takt, laufend),
        ...z,
        anteilBest: div(z.gB, z.gB + z.pB),
        anteilUmsatz: div(z.gU, z.gU + z.pU),
      };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daten.segment, buckets, takt, vonMonat]);

  const segmentVergleich = useMemo(() => {
    const s = { g: { best: 0, umsatz: 0 }, p: { best: 0, umsatz: 0 } };
    for (const r of daten.segment) {
      if (!imZeitraum(ym(r.monat))) continue;
      const z = r.gewerbe ? s.g : s.p;
      z.best += r.bestellungen;
      z.umsatz += num(r.umsatz);
    }
    const l = { g: { kunden: 0, best: 0, umsatz: 0, wieder: 0 }, p: { kunden: 0, best: 0, umsatz: 0, wieder: 0 } };
    const gewerbeHerkunft = new Map<string, number>();
    for (const r of daten.lifetime) {
      const z = r.gewerbe ? l.g : l.p;
      z.kunden += r.kunden;
      z.best += r.bestellungen;
      z.umsatz += num(r.umsatz);
      z.wieder += r.wiederkaeufer;
      if (r.gewerbe && r.herkunft !== "unklar") gewerbeHerkunft.set(r.herkunft, (gewerbeHerkunft.get(r.herkunft) ?? 0) + r.kunden);
    }
    const ghSumme = [...gewerbeHerkunft.values()].reduce((a, b) => a + b, 0);
    const gh = [...gewerbeHerkunft].map(([g, k]) => ({ g, anteil: div(k, ghSumme), k })).sort((a, b) => b.k - a.k).slice(0, 6);
    return { s, l, gh, ghSumme };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daten.segment, daten.lifetime, vonMonat]);

  // ── Neu vs. Stamm ──
  const neuReihe = useMemo(() => {
    const map = new Map<string, { neu: number; stamm: number }>();
    for (const b of buckets) map.set(b, { neu: 0, stamm: 0 });
    for (const r of daten.monat) {
      const m = ym(r.monat);
      if (!imZeitraum(m) || !passtSegment(r.gewerbe)) continue;
      const z = map.get(bucketVon(m, takt));
      if (!z) continue;
      const v = mass === "umsatz" ? num(r.umsatz) : r.bestellungen;
      if (r.neukunde) z.neu += v;
      else z.stamm += v;
    }
    return buckets.map((b) => ({ label: bucketLabel(b, takt, laufend), ...map.get(b)! }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daten.monat, buckets, takt, segment, mass, vonMonat]);

  // ── Kanäle ──
  const kanaele = ["web", "pos", "shopify_draft_order", "sonstige"];
  const kanalFarbe: Record<string, string> = { web: SERIEN[0], pos: SERIEN[1], shopify_draft_order: SERIEN[2], sonstige: GRAU };
  const kanalReihe = useMemo(() => {
    const map = new Map<string, Record<string, number>>();
    for (const b of buckets) map.set(b, {});
    for (const r of daten.kanal) {
      const m = ym(r.monat);
      if (!imZeitraum(m) || !passtSegment(r.gewerbe)) continue;
      const z = map.get(bucketVon(m, takt));
      if (!z) continue;
      const k = kanaele.includes(r.kanal) ? r.kanal : "sonstige";
      z[k] = (z[k] ?? 0) + (mass === "umsatz" ? num(r.umsatz) : r.bestellungen);
    }
    return buckets.map((b) => ({ label: bucketLabel(b, takt, laufend), ...map.get(b)! }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daten.kanal, buckets, takt, segment, mass, vonMonat]);

  // ── Länder ──
  const laender = useMemo(() => {
    const t = new Map<string, { a: number; b: number; bWert: number }>();
    let sa = 0;
    let sb = 0;
    for (const r of daten.land) {
      const m = ym(r.monat);
      const v = mass === "umsatz" ? num(r.umsatz) : r.bestellungen;
      const z = t.get(r.land) ?? { a: 0, b: 0, bWert: 0 };
      if (inA(m)) {
        z.a += v;
        sa += v;
      }
      if (inB(m)) {
        z.b += v;
        sb += v;
      }
      t.set(r.land, z);
    }
    return [...t]
      .map(([land, z]) => ({ land, anteilA: div(z.a, sa), anteilB: div(z.b, sb), wertB: z.b }))
      .sort((x, y) => y.wertB - x.wertB)
      .slice(0, 8);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daten.land, mass, fensterA.von, fensterA.bis, fensterB.von, fensterB.bis]);

  // ── Städte: Halbjahre ──
  const [stadtSort, setStadtSort] = useState<"gesamt" | "wachstum">("gesamt");
  const stadtDaten = useMemo(() => {
    const laufendHj = Number(laufend.slice(0, 4)) * 10 + (Number(laufend.slice(5, 7)) <= 6 ? 1 : 2);
    const hjs = [...new Set(daten.stadt.map((r) => r.halbjahr))].sort();
    const letztesVoll = hjs.filter((h) => h < laufendHj).pop();
    const vorjahr = letztesVoll ? letztesVoll - 10 : undefined;
    const t = new Map<string, { stadt: string; land: string; je: Map<number, number>; summe: number }>();
    for (const r of daten.stadt) {
      const key = `${r.land}|${r.stadt_key}`;
      const v = mass === "umsatz" ? num(r.umsatz) : r.bestellungen;
      const z = t.get(key) ?? { stadt: r.stadt, land: r.land, je: new Map(), summe: 0 };
      z.je.set(r.halbjahr, (z.je.get(r.halbjahr) ?? 0) + v);
      z.summe += v;
      t.set(key, z);
    }
    let zeilen = [...t.values()].map((z) => {
      const jetzt = letztesVoll ? z.je.get(letztesVoll) ?? 0 : 0;
      const vor = vorjahr ? z.je.get(vorjahr) ?? 0 : 0;
      return { ...z, jetzt, vor, wachstum: vor > 0 ? jetzt / vor - 1 : null };
    });
    zeilen = zeilen.sort((a, b) => b.summe - a.summe).slice(0, 40);
    if (stadtSort === "wachstum") zeilen = zeilen.filter((z) => z.vor >= 5).sort((a, b) => (b.wachstum ?? 0) - (a.wachstum ?? 0));
    const hjLabel = (h: number) => `${h % 10 === 1 ? "H1" : "H2"} ${String(Math.floor(h / 10)).slice(2)}`;
    return { zeilen: zeilen.slice(0, 15), hjs, hjLabel, letztesVoll, vorjahr, laufendHj };
  }, [daten.stadt, mass, laufend, stadtSort]);

  const maxStadt = Math.max(1, ...stadtDaten.zeilen.flatMap((z) => [...z.je.values()]));
  const herkunftSerien = [...gruppen.haupt, "uebrige"];
  const fensterText = `${spanneLabel(fensterA.von, fensterA.bis)} vs. ${spanneLabel(fensterB.von, fensterB.bis)}`;

  return (
    <div className="space-y-6">
      {/* Filterleiste */}
      <div className="sticky top-0 z-10 -mx-4 md:mx-0 px-4 md:px-0 py-2 bg-neutral-50/90 backdrop-blur flex flex-wrap items-center gap-2">
        <Umschalter wert={zeitraum} onChange={setZeitraum} optionen={[["12", "12 Monate"], ["24", "24 Monate"], ["alle", "Alles"]]} />
        <Umschalter wert={takt} onChange={setTakt} optionen={[["monat", "Monat"], ["quartal", "Quartal"]]} />
        <Umschalter wert={mass} onChange={setMass} optionen={[["bestellungen", "Bestellungen"], ["umsatz", "Umsatz"], ["neukunden", "Neukunden"]]} />
        <Umschalter wert={segment} onChange={setSegment} optionen={[["alle", "Alle Kunden"], ["privat", "Privat"], ["gewerbe", "Gewerbe"]]} />
      </div>

      {/* KPIs */}
      <div>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { t: "Bestellungen", v: n0(kpi.b.best), d: div(kpi.b.best, kpi.a.best) - 1, e: "%" as const },
            { t: "Umsatz", v: eurK(kpi.b.umsatz), d: div(kpi.b.umsatz, kpi.a.umsatz) - 1, e: "%" as const },
            { t: "Ø Bestellwert", v: eur(div(kpi.b.umsatz, kpi.b.best)), d: div(div(kpi.b.umsatz, kpi.b.best), div(kpi.a.umsatz, kpi.a.best)) - 1, e: "%" as const },
            { t: "Gewerbe-Anteil Umsatz", neutral: false, v: pct(div(kpi.b.gewUmsatz, kpi.b.umsatz)), d: div(kpi.b.gewUmsatz, kpi.b.umsatz) - div(kpi.a.gewUmsatz, kpi.a.umsatz), e: "pp" as const },
            { t: "Stammkunden-Anteil", v: pct(div(kpi.b.stamm, kpi.b.best)), d: div(kpi.b.stamm, kpi.b.best) - div(kpi.a.stamm, kpi.a.best), e: "pp" as const },
            { t: "Anteil dt. Namen", v: pct(div(kpi.b.deutsch, kpi.b.bekannt)), d: div(kpi.b.deutsch, kpi.b.bekannt) - div(kpi.a.deutsch, kpi.a.bekannt), e: "pp" as const, neutral: true },
          ].map((k) => (
            <div key={k.t} className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
              <div className="text-[11px] font-medium text-neutral-500 uppercase tracking-wide">{k.t}</div>
              <div className="text-2xl font-semibold text-neutral-900 mt-1 tabular-nums">{k.v}</div>
              <div className="text-xs mt-1">{!kpi.vollA ? <span className="text-neutral-400">—</span> : "neutral" in k && k.neutral ? <DeltaNeutral wert={k.d} /> : <Delta wert={k.d} einheit={k.e} />}</div>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-neutral-400 mt-2">
          Letzte 12 volle Monate ({kpi.labelB}) vs. die 12 Monate davor ({kpi.labelA}){!kpi.vollA && " — Vorjahr noch nicht vollständig"}. Unabhängig von den Filtern oben.
        </p>
      </div>

      {/* Herkunft */}
      <Karte
        titel="Namensherkunft im Verlauf"
        icon={<Globe2 size={16} className="text-neutral-400" />}
        untertitel={`Anteil an ${massLabel}${segment !== "alle" ? ` · nur ${segment === "privat" ? "Privat" : "Gewerbe"}` : ""} · statistische Schätzung aus Vor-/Nachname, ohne „nicht eindeutig“`}
      >
        <div className="h-80">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={herkunftReihe} stackOffset="expand" margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
              <CartesianGrid vertical={false} stroke="#f0f0f0" />
              <XAxis dataKey="label" {...achse} minTickGap={16} />
              <YAxis {...yAchse} tickFormatter={(v: number) => `${Math.round(v * 100)} %`} width={48} />
              <Tooltip
                cursor={{ stroke: "#d4d4d4" }}
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null;
                  const p = payload[0].payload as (typeof herkunftReihe)[number];
                  return (
                    <Tipp
                      titel={String(label)}
                      zeilen={[...herkunftSerien].reverse().filter((g) => (p.absolut[g] ?? 0) > 0).map((g) => ({
                        name: HERKUNFT_LABEL[g] ?? g,
                        farbe: farbeVon(g),
                        wert: `${pct(div(p.absolut[g] ?? 0, p.summe))} · ${fmtMass(p.absolut[g] ?? 0)}`,
                      }))}
                      fuss={`Summe ${fmtMass(p.summe)}`}
                    />
                  );
                }}
              />
              {herkunftSerien.map((g) => (
                <Area key={g} dataKey={g} stackId="1" type="monotone" stroke="#fff" strokeWidth={1.5} fill={farbeVon(g)} fillOpacity={0.9} isAnimationActive={false} />
              ))}
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <Legende eintraege={herkunftSerien.map((g) => ({ farbe: farbeVon(g), text: HERKUNFT_LABEL[g] ?? g }))} />

        <div className="mt-6 overflow-x-auto">
          <div className="text-xs font-medium text-neutral-600 mb-2">Veränderung: {fensterText}</div>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[11px] uppercase tracking-wide text-neutral-500 border-b border-neutral-200">
                <th className="text-left font-medium py-2">Gruppe</th>
                <th className="text-right font-medium py-2">Anteil vorher</th>
                <th className="text-right font-medium py-2">Anteil jetzt</th>
                <th className="text-right font-medium py-2">Veränderung</th>
                <th className="text-left font-medium py-2 pl-4 w-1/4 hidden md:table-cell">Anteil jetzt</th>
                <th className="text-right font-medium py-2">{massLabel} jetzt</th>
                <th className="text-right font-medium py-2">Ø Bestellwert</th>
              </tr>
            </thead>
            <tbody>
              {herkunftVergleich.zeilen.map((z) => (
                <tr key={z.g} className="border-b border-neutral-100 last:border-0">
                  <td className="py-2">
                    <span className="inline-flex items-center gap-2">
                      <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: farbeVon(z.g) }} />
                      {HERKUNFT_LABEL[z.g] ?? z.g}
                    </span>
                  </td>
                  <td className="py-2 text-right tabular-nums text-neutral-500">{pct(z.anteilA)}</td>
                  <td className="py-2 text-right tabular-nums font-medium">{pct(z.anteilB)}</td>
                  <td className="py-2 text-right text-xs"><DeltaNeutral wert={z.anteilB - z.anteilA} /></td>
                  <td className="py-2 pl-4 hidden md:table-cell">
                    <div className="h-2 rounded-full bg-neutral-100 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${Math.min(100, z.anteilB * 100)}%`, background: farbeVon(z.g) }} />
                    </div>
                  </td>
                  <td className="py-2 text-right tabular-nums text-neutral-600">{fmtMass(z.wertB)}</td>
                  <td className="py-2 text-right tabular-nums text-neutral-600">{eur(z.bon)}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-[11px] text-neutral-400 mt-2">
            „Nicht eindeutig“ (Initialen, Firmen, nicht zuordenbar): {pct(herkunftVergleich.unklarAnteil)} im aktuellen Fenster, aus den Anteilen herausgerechnet.
            Die Herkunft wird aus dem Namen geschätzt — sie sagt nichts über Staatsangehörigkeit oder Wohnort aus und ist im Einzelfall oft falsch; für Trends über viele Bestellungen ist sie aussagekräftig.
          </p>
        </div>
      </Karte>

      {/* Gewerbe vs. Privat */}
      <Karte
        titel="Gewerbe vs. Privat"
        icon={<Briefcase size={16} className="text-neutral-400" />}
        untertitel="Gewerbekunde = Kunde oder Bestellung mit Tag „B2B“ in Shopify"
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-6">
          {(() => {
            const { s, l } = segmentVergleich;
            const zeilen: { t: string; p: string; g: string; hinweis?: string }[] = [
              { t: "Anteil Bestellungen", p: pct(div(s.p.best, s.p.best + s.g.best)), g: pct(div(s.g.best, s.p.best + s.g.best)) },
              { t: "Anteil Umsatz", p: pct(div(s.p.umsatz, s.p.umsatz + s.g.umsatz)), g: pct(div(s.g.umsatz, s.p.umsatz + s.g.umsatz)) },
              { t: "Ø Bestellwert", p: eur(div(s.p.umsatz, s.p.best)), g: eur(div(s.g.umsatz, s.g.best)) },
              { t: "Kunden", p: n0(l.p.kunden), g: n0(l.g.kunden), hinweis: "gesamt" },
              { t: "Bestellungen pro Kunde", p: n0Dez(div(l.p.best, l.p.kunden)), g: n0Dez(div(l.g.best, l.g.kunden)), hinweis: "gesamt" },
              { t: "Umsatz pro Kunde", p: eur(div(l.p.umsatz, l.p.kunden)), g: eur(div(l.g.umsatz, l.g.kunden)), hinweis: "gesamt" },
              { t: "Wiederkaufquote", p: pct(div(l.p.wieder, l.p.kunden)), g: pct(div(l.g.wieder, l.g.kunden)), hinweis: "gesamt, ≥ 2 Bestellungen" },
            ];
            return (
              <div className="md:col-span-2 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[11px] uppercase tracking-wide text-neutral-500 border-b border-neutral-200">
                      <th className="text-left font-medium py-2">Kennzahl</th>
                      <th className="text-right font-medium py-2">
                        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: FARBE_PRIVAT }} />Privat</span>
                      </th>
                      <th className="text-right font-medium py-2">
                        <span className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ background: FARBE_GEWERBE }} />Gewerbe</span>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {zeilen.map((z) => (
                      <tr key={z.t} className="border-b border-neutral-100 last:border-0">
                        <td className="py-2 text-neutral-700">
                          {z.t}
                          <span className="text-[11px] text-neutral-400 ml-1.5">{z.hinweis ?? "im Zeitraum"}</span>
                        </td>
                        <td className="py-2 text-right tabular-nums">{z.p}</td>
                        <td className="py-2 text-right tabular-nums font-medium">{z.g}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            );
          })()}
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <div className="text-xs font-medium text-neutral-600 mb-2">Gewerbe-Anteil im Verlauf</div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={segmentReihe} margin={{ top: 4, right: 8, bottom: 0, left: -8 }}>
                  <CartesianGrid vertical={false} stroke="#f0f0f0" />
                  <XAxis dataKey="label" {...achse} minTickGap={16} />
                  <YAxis {...yAchse} tickFormatter={(v: number) => `${Math.round(v * 100)} %`} width={48} />
                  <Tooltip
                    cursor={{ stroke: "#d4d4d4" }}
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      const p = payload[0].payload as (typeof segmentReihe)[number];
                      return (
                        <Tipp
                          titel={String(label)}
                          zeilen={[
                            { name: "Anteil Umsatz", farbe: FARBE_GEWERBE, wert: pct(p.anteilUmsatz) },
                            { name: "Anteil Bestellungen", farbe: FARBE_PRIVAT, wert: pct(p.anteilBest) },
                          ]}
                          fuss={`Gewerbe: ${n0(p.gB)} Bestellungen · ${eur(p.gU)}`}
                        />
                      );
                    }}
                  />
                  <Line dataKey="anteilUmsatz" stroke={FARBE_GEWERBE} strokeWidth={2} dot={{ r: 3, fill: FARBE_GEWERBE, stroke: "#fff", strokeWidth: 2 }} isAnimationActive={false} />
                  <Line dataKey="anteilBest" stroke={FARBE_PRIVAT} strokeWidth={2} dot={{ r: 3, fill: FARBE_PRIVAT, stroke: "#fff", strokeWidth: 2 }} isAnimationActive={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
            <Legende eintraege={[{ farbe: FARBE_GEWERBE, text: "Anteil am Umsatz" }, { farbe: FARBE_PRIVAT, text: "Anteil an Bestellungen" }]} />
          </div>
          <div>
            <div className="text-xs font-medium text-neutral-600 mb-2">Gewerbekunden: Bestellungen und Neuzugänge</div>
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={segmentReihe} margin={{ top: 4, right: 8, bottom: 0, left: -8 }} barCategoryGap="20%">
                  <CartesianGrid vertical={false} stroke="#f0f0f0" />
                  <XAxis dataKey="label" {...achse} minTickGap={16} />
                  <YAxis {...yAchse} width={48} allowDecimals={false} />
                  <Tooltip
                    cursor={{ fill: "#f5f5f5" }}
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null;
                      const p = payload[0].payload as (typeof segmentReihe)[number];
                      return (
                        <Tipp
                          titel={String(label)}
                          zeilen={[
                            { name: "Bestellungen", farbe: FARBE_GEWERBE, wert: n0(p.gB) },
                            { name: "Neue Gewerbekunden", farbe: FARBE_NEU, wert: n0(p.gNeu) },
                          ]}
                          fuss={takt === "monat" ? `${n0(p.gKunden)} aktive Gewerbekunden` : undefined}
                        />
                      );
                    }}
                  />
                  <Bar dataKey="gB" fill={FARBE_GEWERBE} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
                  <Bar dataKey="gNeu" fill={FARBE_NEU} radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <Legende eintraege={[{ farbe: FARBE_GEWERBE, text: "Bestellungen Gewerbe" }, { farbe: FARBE_NEU, text: "Neue Gewerbekunden" }]} />
          </div>
        </div>

        {segmentVergleich.gh.length > 0 && (
          <div className="mt-6">
            <div className="text-xs font-medium text-neutral-600 mb-2">Gewerbekunden nach Namensherkunft ({n0(segmentVergleich.ghSumme)} zuordenbar)</div>
            <div className="space-y-1.5">
              {segmentVergleich.gh.map((z) => (
                <div key={z.g} className="flex items-center gap-3 text-sm">
                  <span className="w-40 shrink-0 text-neutral-700 truncate">{HERKUNFT_LABEL[z.g] ?? z.g}</span>
                  <div className="flex-1 h-2 rounded-full bg-neutral-100 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${z.anteil * 100}%`, background: farbeVon(z.g) }} />
                  </div>
                  <span className="w-24 text-right tabular-nums text-neutral-600">{pct(z.anteil)} · {n0(z.k)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </Karte>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Neu vs. Stamm */}
        <Karte titel="Neukunden vs. Stammkunden" icon={<Repeat size={16} className="text-neutral-400" />} untertitel={`${mass === "umsatz" ? "Umsatz" : "Bestellungen"} von Erst- und Folgebestellungen`}>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={neuReihe} margin={{ top: 4, right: 8, bottom: 0, left: -8 }} barCategoryGap="20%">
                <CartesianGrid vertical={false} stroke="#f0f0f0" />
                <XAxis dataKey="label" {...achse} minTickGap={16} />
                <YAxis {...yAchse} width={52} tickFormatter={(v: number) => (mass === "umsatz" ? eurK(v) : n0(v))} />
                <Tooltip
                  cursor={{ fill: "#f5f5f5" }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const p = payload[0].payload as (typeof neuReihe)[number];
                    const f = (v: number) => (mass === "umsatz" ? eur(v) : n0(v));
                    return (
                      <Tipp
                        titel={String(label)}
                        zeilen={[
                          { name: "Stammkunden", farbe: FARBE_STAMM, wert: `${f(p.stamm)} · ${pct(div(p.stamm, p.neu + p.stamm))}` },
                          { name: "Neukunden", farbe: FARBE_NEU, wert: `${f(p.neu)} · ${pct(div(p.neu, p.neu + p.stamm))}` },
                        ]}
                      />
                    );
                  }}
                />
                <Bar dataKey="neu" stackId="a" fill={FARBE_NEU} stroke="#fff" strokeWidth={2} maxBarSize={36} isAnimationActive={false} />
                <Bar dataKey="stamm" stackId="a" fill={FARBE_STAMM} stroke="#fff" strokeWidth={2} radius={[4, 4, 0, 0]} maxBarSize={36} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <Legende eintraege={[{ farbe: FARBE_STAMM, text: "Stammkunden" }, { farbe: FARBE_NEU, text: "Neukunden" }]} />
        </Karte>

        {/* Kanäle */}
        <Karte titel="Verkaufskanäle" icon={<ShoppingBag size={16} className="text-neutral-400" />} untertitel={`${mass === "umsatz" ? "Umsatz" : "Bestellungen"} nach Kanal`}>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={kanalReihe} margin={{ top: 4, right: 8, bottom: 0, left: -8 }} barCategoryGap="20%">
                <CartesianGrid vertical={false} stroke="#f0f0f0" />
                <XAxis dataKey="label" {...achse} minTickGap={16} />
                <YAxis {...yAchse} width={52} tickFormatter={(v: number) => (mass === "umsatz" ? eurK(v) : n0(v))} />
                <Tooltip
                  cursor={{ fill: "#f5f5f5" }}
                  content={({ active, payload, label }) => {
                    if (!active || !payload?.length) return null;
                    const p = payload[0].payload as Record<string, number>;
                    const summe = kanaele.reduce((a, k) => a + (p[k] ?? 0), 0);
                    return (
                      <Tipp
                        titel={String(label)}
                        zeilen={[...kanaele].reverse().filter((k) => (p[k] ?? 0) > 0).map((k) => ({
                          name: KANAL_LABEL[k],
                          farbe: kanalFarbe[k],
                          wert: `${mass === "umsatz" ? eur(p[k]) : n0(p[k])} · ${pct(div(p[k], summe))}`,
                        }))}
                      />
                    );
                  }}
                />
                {kanaele.map((k, i) => (
                  <Bar key={k} dataKey={k} stackId="a" fill={kanalFarbe[k]} stroke="#fff" strokeWidth={2} radius={i === kanaele.length - 1 ? [4, 4, 0, 0] : undefined} maxBarSize={36} isAnimationActive={false} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
          <Legende eintraege={kanaele.map((k) => ({ farbe: kanalFarbe[k], text: KANAL_LABEL[k] }))} />
        </Karte>
      </div>

      {/* Geografie */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-2">
          <Karte titel="Länder" icon={<Globe2 size={16} className="text-neutral-400" />} untertitel={`Anteil an ${mass === "umsatz" ? "Umsatz" : "Bestellungen"} · ${fensterText}`}>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-neutral-500 border-b border-neutral-200">
                  <th className="text-left font-medium py-2">Land</th>
                  <th className="text-right font-medium py-2">vorher</th>
                  <th className="text-right font-medium py-2">jetzt</th>
                  <th className="text-right font-medium py-2">Δ</th>
                </tr>
              </thead>
              <tbody>
                {laender.map((z) => (
                  <tr key={z.land} className="border-b border-neutral-100 last:border-0">
                    <td className="py-2 text-neutral-700">{landName(z.land)}</td>
                    <td className="py-2 text-right tabular-nums text-neutral-500">{pct(z.anteilA)}</td>
                    <td className="py-2 text-right tabular-nums font-medium">{pct(z.anteilB)}</td>
                    <td className="py-2 text-right text-xs"><DeltaNeutral wert={z.anteilB - z.anteilA} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Karte>
        </div>
        <div className="lg:col-span-3">
          <Karte
            titel="Top-Städte"
            icon={<MapPin size={16} className="text-neutral-400" />}
            untertitel={`${mass === "umsatz" ? "Umsatz" : "Bestellungen"} pro Halbjahr · Wachstum ${stadtDaten.letztesVoll ? stadtDaten.hjLabel(stadtDaten.letztesVoll) : ""} vs. ${stadtDaten.vorjahr ? stadtDaten.hjLabel(stadtDaten.vorjahr) : ""}`}
            rechts={<Umschalter wert={stadtSort} onChange={setStadtSort} optionen={[["gesamt", "Größte"], ["wachstum", "Am stärksten gewachsen"]]} />}
          >
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[11px] uppercase tracking-wide text-neutral-500 border-b border-neutral-200">
                    <th className="text-left font-medium py-2">Stadt</th>
                    {stadtDaten.hjs.map((h) => (
                      <th key={h} className="text-center font-medium py-2 px-1">{stadtDaten.hjLabel(h)}{h === stadtDaten.laufendHj ? "*" : ""}</th>
                    ))}
                    <th className="text-right font-medium py-2">Wachstum</th>
                  </tr>
                </thead>
                <tbody>
                  {stadtDaten.zeilen.map((z) => (
                    <tr key={`${z.land}|${z.stadt}`} className="border-b border-neutral-100 last:border-0">
                      <td className="py-1.5 text-neutral-700 whitespace-nowrap">
                        {z.stadt}
                        {z.land !== "DE" && <span className="text-[11px] text-neutral-400 ml-1">{z.land}</span>}
                      </td>
                      {stadtDaten.hjs.map((h) => {
                        const v = z.je.get(h) ?? 0;
                        return (
                          <td key={h} className="py-1.5 px-1" title={`${stadtDaten.hjLabel(h)}: ${mass === "umsatz" ? eur(v) : n0(v)}`}>
                            <div className="flex flex-col items-center gap-0.5">
                              <div className="w-full h-1.5 rounded-full bg-neutral-100 overflow-hidden">
                                <div className="h-full rounded-full" style={{ width: `${(v / maxStadt) * 100}%`, background: SERIEN[0], opacity: h === stadtDaten.laufendHj ? 0.45 : 1 }} />
                              </div>
                              <span className="text-[11px] tabular-nums text-neutral-500">{mass === "umsatz" ? eurK(v) : n0(v)}</span>
                            </div>
                          </td>
                        );
                      })}
                      <td className="py-1.5 text-right text-xs">{z.wachstum == null ? <span className="text-neutral-300">neu</span> : <Delta wert={z.wachstum} einheit="%" />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="text-[11px] text-neutral-400 mt-2">* laufendes Halbjahr, noch unvollständig. „Am stärksten gewachsen“ zeigt nur Städte mit mind. 5 im Vorjahres-Halbjahr.</p>
          </Karte>
        </div>
      </div>

      <p className="text-[11px] text-neutral-400 flex items-center gap-1.5">
        <Users size={12} /> Es werden keine Namen gespeichert — nur die geschätzte Herkunftsgruppe pro Bestellung. Sichtbar nur für Admins.
      </p>
    </div>
  );
}

// Anteilsverschiebung ohne Wertung (mehr/weniger einer Gruppe ist weder gut noch schlecht)
function DeltaNeutral({ wert }: { wert: number }) {
  if (Math.abs(wert) < 0.002) return <span className="text-neutral-400 tabular-nums">±0</span>;
  return (
    <span className={`tabular-nums font-medium ${wert > 0 ? "text-neutral-900" : "text-neutral-500"}`}>
      {wert > 0 ? "▲ +" : "▼ −"}
      {n0Dez(Math.abs(wert * 100))} pp
    </span>
  );
}
