"use client";

import { ArrowDownLeft, ArrowRight, ArrowUpRight, HelpCircle, Landmark, Scale } from "lucide-react";
import { kontoZweck } from "@/lib/bank/konten";
import type { KontoSaldo, KontoUmsatz } from "@/lib/actions/kontoumsaetze";

/* Moderne Darstellung der Kontoumsätze-Seite: Bankkarten mit Logo + Verlauf,
   Kennzahl-Kacheln mit Symbolen, Geldfluss als Balken. Reine Darstellung —
   gerechnet wird in kontoumsaetze.tsx. */

export type FlussZeile = { n: number; rein: number; ausgaben: number; steuern: number; uebertrag: number; sonstiges: number; veraenderung: number };

const fmt = (n: number) => n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
const fmt0 = (n: number) => n.toLocaleString("de-DE", { maximumFractionDigits: 0 }) + " €";
/** Betrag mit Vorzeichen für Balken-Beschriftung; 0 als Strich. */
const mitVz = (n: number, vz: "+" | "−") => (Math.abs(n) < 0.5 ? "—" : `${vz}${fmt0(Math.abs(n))}`);

// ── Banken: Name, Markenfarbe, Logo ──────────────────────────────────────────

type Marke = { name: string; karte: string; farbe: string; logo: "sparkasse" | "targobank" | "paypal" | "bank" };
const MARKEN: Record<string, Marke> = {
  "29050101": { name: "Sparkasse", karte: "from-red-600 via-red-600 to-rose-800", farbe: "#dc2626", logo: "sparkasse" },
  "30020900": { name: "Targobank", karte: "from-sky-800 via-slate-800 to-slate-950", farbe: "#0c4a6e", logo: "targobank" },
  PAYPAL: { name: "PayPal", karte: "from-blue-600 via-blue-700 to-indigo-900", farbe: "#1d4ed8", logo: "paypal" },
};
const STD_MARKE: Marke = { name: "Bank", karte: "from-neutral-700 to-neutral-900", farbe: "#525252", logo: "bank" };

export function markeVon(iban: string | null): Marke {
  if (iban === "PAYPAL") return MARKEN.PAYPAL;
  if (iban && iban.startsWith("DE")) return MARKEN[iban.slice(4, 12)] ?? STD_MARKE;
  return STD_MARKE;
}

/** Vereinfachte Bank-Abzeichen in Markenfarbe zur Wiedererkennung der Konten. */
export function BankLogo({ iban, size = 32 }: { iban: string | null; size?: number }) {
  const m = markeVon(iban);
  const common = { width: size, height: size, viewBox: "0 0 40 40", role: "img", "aria-label": m.name } as const;
  if (m.logo === "sparkasse")
    return (
      <svg {...common}>
        <rect width="40" height="40" rx="10" fill="#e30613" />
        <circle cx="20" cy="9.5" r="3.2" fill="#fff" />
        <path d="M26.5 16.5c-1.4-1.6-3.7-2.6-6.4-2.6-3.9 0-6.6 2-6.6 5 0 2.8 2.2 4 5.8 4.8 2.6.6 3.5 1 3.5 2 0 1.1-1.1 1.7-2.9 1.7-2.1 0-3.9-.8-5.2-2.2l-2.4 2.9c1.8 1.9 4.6 3 7.6 3 4.4 0 7.2-2.1 7.2-5.4 0-2.9-2-4.2-6-5.1-2.4-.5-3.3-.9-3.3-1.8 0-.9.9-1.4 2.4-1.4 1.6 0 3 .6 4 1.6l2.3-2.5z" fill="#fff" />
      </svg>
    );
  if (m.logo === "targobank")
    return (
      <svg {...common}>
        <rect width="40" height="40" rx="10" fill="#0b2f5b" />
        <rect x="9" y="11" width="22" height="5" rx="1.5" fill="#fff" />
        <rect x="17.5" y="11" width="5" height="18" rx="1.5" fill="#fff" />
        <rect x="9" y="31" width="22" height="2.5" rx="1.25" fill="#22d3ee" />
      </svg>
    );
  if (m.logo === "paypal")
    return (
      <svg {...common}>
        <rect width="40" height="40" rx="10" fill="#003087" />
        <path d="M15 30l2.6-18h7c3.8 0 5.9 2 5.4 5.3-.6 3.8-3.4 5.7-7.2 5.7h-3l-1 7H15z" fill="#009cde" />
        <path d="M12.5 28l2.6-18h7c3.8 0 5.9 2 5.4 5.3-.6 3.8-3.4 5.7-7.2 5.7h-3l-1 7h-3.8z" fill="#fff" />
      </svg>
    );
  return (
    <span className="inline-flex items-center justify-center rounded-lg bg-neutral-700 text-white" style={{ width: size, height: size }}>
      <Landmark size={size * 0.55} />
    </span>
  );
}

// ── Kontostand-Verlauf (aus aktuellem Stand rückwärts gerechnet) ─────────────

function verlauf(iban: string, saldo: number, umsaetze: KontoUmsatz[], tage = 30): number[] {
  const heute = new Date();
  const eigene = umsaetze.filter((u) => u.account_iban === iban);
  const frueheste = eigene.reduce((m, u) => (u.booking_date < m ? u.booking_date : m), "9999");
  const punkte: number[] = [];
  for (let i = tage; i >= 0; i--) {
    const d = new Date(heute.getTime() - i * 86400_000).toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
    if (d < frueheste.slice(0, 10)) continue; // ohne geladene Umsätze kein Verlauf erfinden
    const spaeter = eigene.filter((u) => u.booking_date.slice(0, 10) > d).reduce((s, u) => s + u.amount, 0);
    punkte.push(saldo - spaeter);
  }
  return punkte;
}

function Sparkline({ werte, hell = true }: { werte: number[]; hell?: boolean }) {
  if (werte.length < 3) return null;
  const w = 220, h = 44;
  const min = Math.min(...werte), max = Math.max(...werte);
  const span = max - min || 1;
  const pts = werte.map((v, i) => [(i / (werte.length - 1)) * w, h - 4 - ((v - min) / span) * (h - 8)] as const);
  const linie = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const flaeche = `${linie} L${w},${h} L0,${h} Z`;
  const farbe = hell ? "#ffffff" : "#0f172a";
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-11" preserveAspectRatio="none" aria-hidden>
      <path d={flaeche} fill={farbe} opacity={0.12} />
      <path d={linie} fill="none" stroke={farbe} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" opacity={0.9} />
    </svg>
  );
}

// ── Bankkarten ───────────────────────────────────────────────────────────────

function saldoRang(iban: string): number {
  if (iban === "PAYPAL") return 3;
  return iban.slice(4, 12) === "30020900" ? 2 : 1;
}

export function KontoKarten({
  salden, umsaetze, aktiv, onWaehle, jetzt,
}: { salden: KontoSaldo[]; umsaetze: KontoUmsatz[]; aktiv: string; onWaehle: (filter: string) => void; jetzt: number }) {
  if (!salden.length) return null;
  const liste = [...salden].sort((a, b) => saldoRang(a.iban) - saldoRang(b.iban) || a.iban.localeCompare(b.iban));
  const gesamt = liste.reduce((s, b) => s + b.saldo, 0);
  const positiv = liste.filter((b) => b.saldo > 0);
  const summePositiv = positiv.reduce((s, b) => s + b.saldo, 0) || 1;

  // Donut: Anteil je Konto am Gesamtguthaben
  const segmente = positiv.reduce<{ iban: string; start: number; anteil: number }[]>((acc, b) => {
    const vorher = acc.length ? acc[acc.length - 1].start + acc[acc.length - 1].anteil : 0;
    return [...acc, { iban: b.iban, start: vorher, anteil: b.saldo / summePositiv }];
  }, []);
  // Farbe je Segment: Markenfarbe, weiteres Konto derselben Bank heller
  const HELLER: Record<string, string> = { "#dc2626": "#fca5a5", "#38bdf8": "#bae6fd", "#1d4ed8": "#93c5fd", "#525252": "#a3a3a3" };
  const farben = segmente.reduce<string[]>((acc, s) => {
    const basis = markeVon(s.iban).farbe === "#0c4a6e" ? "#38bdf8" : markeVon(s.iban).farbe;
    return [...acc, acc.includes(basis) ? HELLER[basis] ?? basis : basis];
  }, []);
  const bogen = (start: number, anteil: number) => {
    const r = 15.9155; // Umfang 100
    return { r, dash: `${(anteil * 100).toFixed(2)} ${(100 - anteil * 100).toFixed(2)}`, offset: (25 - start * 100).toFixed(2) };
  };

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-3">
      {liste.map((b) => {
        const m = markeVon(b.iban);
        const istPaypal = b.iban === "PAYPAL";
        const gewaehlt = aktiv === b.iban;
        const alt = jetzt - new Date(b.abgerufenAm).getTime() > 26 * 3600_000;
        const zeit = new Date(b.abgerufenAm).toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
        const werte = istPaypal ? [] : verlauf(b.iban, b.saldo, umsaetze);
        const diff = werte.length > 1 ? werte[werte.length - 1] - werte[0] : null;
        return (
          <button
            key={b.iban}
            type="button"
            disabled={istPaypal}
            onClick={() => onWaehle(b.iban)}
            title={istPaypal ? "PayPal: nur Guthaben, keine Umsätze" : gewaehlt ? "Wieder alle Konten zeigen" : "Umsätze dieses Kontos anzeigen"}
            className={`group relative overflow-hidden rounded-2xl bg-gradient-to-br ${m.karte} p-4 text-left text-white shadow-md transition-all ${istPaypal ? "cursor-default" : "hover:-translate-y-0.5 hover:shadow-xl"} ${gewaehlt ? "ring-4 ring-offset-2 ring-neutral-900" : ""}`}
          >
            <div className="pointer-events-none absolute -right-8 -top-8 h-28 w-28 rounded-full bg-white/10" />
            <div className="pointer-events-none absolute -right-2 bottom-6 h-16 w-16 rounded-full bg-white/5" />
            <div className="relative flex items-center gap-2.5">
              <span className="rounded-[10px] ring-2 ring-white/30"><BankLogo iban={b.iban} size={34} /></span>
              <div className="min-w-0">
                <div className="text-sm font-semibold leading-tight">{istPaypal ? "PayPal" : kontoZweck(b.iban) ?? m.name}</div>
                <div className="text-[11px] text-white/70 leading-tight">{istPaypal ? "Guthaben" : `${m.name} ·· ${b.iban.slice(-4)}`}</div>
              </div>
            </div>
            <div className="relative mt-4 text-2xl font-bold tabular-nums tracking-tight">{fmt(b.saldo)}</div>
            {diff !== null && (
              <div className={`relative mt-0.5 text-[11px] font-medium ${diff >= 0 ? "text-emerald-200" : "text-rose-200"}`}>
                {diff >= 0 ? "▲" : "▼"} {fmt0(Math.abs(diff))} in 30 Tagen
              </div>
            )}
            <div className="relative mt-1"><Sparkline werte={werte} /></div>
            <div className="relative mt-1 flex items-center justify-between text-[11px] text-white/70">
              <span className={alt ? "rounded bg-amber-400 px-1.5 py-0.5 font-semibold text-amber-950" : ""}>{alt ? "veraltet · " : ""}{zeit}</span>
              {!istPaypal && (
                <span className="flex items-center gap-1 font-medium text-white group-hover:underline">
                  {gewaehlt ? "✕ alle Konten" : <>Umsätze <ArrowRight size={12} /></>}
                </span>
              )}
            </div>
          </button>
        );
      })}

      {/* Gesamt mit Verteilung */}
      <div className="relative overflow-hidden rounded-2xl bg-neutral-950 p-4 text-white shadow-md">
        <div className="text-[11px] font-semibold uppercase tracking-widest text-neutral-400">Gesamt verfügbar</div>
        <div className="mt-1 text-2xl font-bold tabular-nums tracking-tight">{fmt(gesamt)}</div>
        <div className="mt-3 flex items-center gap-2.5">
          <svg viewBox="0 0 42 42" className="h-14 w-14 shrink-0" aria-hidden>
            <circle cx="21" cy="21" r="15.9155" fill="none" stroke="#262626" strokeWidth="6" />
            {segmente.map((s, i) => {
              const g = bogen(s.start, s.anteil);
              return <circle key={s.iban} cx="21" cy="21" r={g.r} fill="none" stroke={farben[i]} strokeWidth="6" strokeDasharray={g.dash} strokeDashoffset={g.offset} />;
            })}
          </svg>
          <ul className="min-w-0 space-y-1 text-[11px]">
            {segmente.map((s, i) => {
              const b = liste.find((x) => x.iban === s.iban)!;
              const farbe = farben[i];
              return (
                <li key={s.iban} className="flex items-center gap-1.5 truncate">
                  <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: farbe }} />
                  <span className="truncate text-neutral-300">{s.iban === "PAYPAL" ? "PayPal" : kontoZweck(s.iban) ?? b.iban.slice(-4)}</span>
                  <span className="ml-auto tabular-nums text-neutral-400">{Math.round(s.anteil * 100)} %</span>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}

// ── Kennzahlen ───────────────────────────────────────────────────────────────

export function Kennzahlen({
  einnahmen, ausgaben, steuern, saldo, unklarN, unklarSumme, onUnklar, unklarAktiv,
}: {
  einnahmen: number; ausgaben: number; steuern: number; saldo: number;
  unklarN: number; unklarSumme: number; onUnklar: () => void; unklarAktiv: boolean;
}) {
  const kacheln = [
    { label: "Einnahmen", wert: einnahmen, fluss: einnahmen, icon: <ArrowDownLeft size={18} />, ring: "bg-emerald-100 text-emerald-700", text: "text-emerald-700" },
    { label: "Ausgaben", wert: ausgaben, fluss: -ausgaben, icon: <ArrowUpRight size={18} />, ring: "bg-orange-100 text-orange-700", text: "text-neutral-900" },
    { label: "Steuern & Zoll", wert: steuern, fluss: -steuern, icon: <Landmark size={18} />, ring: "bg-red-100 text-red-700", text: "text-red-700" },
    { label: "Saldo (inkl. Überträge)", wert: saldo, fluss: saldo, icon: <Scale size={18} />, ring: saldo >= 0 ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700", text: saldo >= 0 ? "text-emerald-700" : "text-red-700" },
  ];
  const basis = einnahmen > 0 ? einnahmen : 1;
  const anteilAus = Math.min(100, (ausgaben / basis) * 100);
  const anteilSt = Math.min(100 - anteilAus, (steuern / basis) * 100);
  const rest = Math.max(0, 100 - anteilAus - anteilSt);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {kacheln.map((k) => (
          <div key={k.label} className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
            <div className="flex items-center gap-2">
              <span className={`flex h-8 w-8 items-center justify-center rounded-full ${k.ring}`}>{k.icon}</span>
              <span className="text-xs font-medium text-neutral-500">{k.label}</span>
            </div>
            <div className={`mt-2 text-xl font-bold tabular-nums tracking-tight ${k.text}`}>
              {Math.abs(k.fluss) < 0.005 ? fmt(0) : `${k.fluss > 0 ? "+" : "−"}${fmt(Math.abs(k.fluss))}`}
            </div>
          </div>
        ))}
        <button
          type="button"
          onClick={onUnklar}
          title="Anklicken: nur die nicht zugeordneten Umsätze zeigen"
          className={`rounded-2xl border p-4 text-left shadow-sm transition-shadow hover:shadow-md ${unklarN > 0 ? "border-amber-300 bg-amber-50" : "border-neutral-200 bg-white"} ${unklarAktiv ? "ring-2 ring-amber-500" : ""}`}
        >
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-amber-100 text-amber-700"><HelpCircle size={18} /></span>
            <span className="text-xs font-medium text-amber-800">Nicht zugeordnet</span>
          </div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="text-xl font-bold text-amber-800">{unklarN}</span>
            <span className="text-xs tabular-nums text-amber-700">{fmt(unklarSumme)}</span>
          </div>
        </button>
      </div>

      {einnahmen > 0 && (
        <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
            <span className="font-semibold text-neutral-800">Wohin gingen die Einnahmen?</span>
            <span className="text-xs text-neutral-500">
              Von 100 € Einnahmen: <b className="text-orange-700">{Math.round(anteilAus)} €</b> Ausgaben ·{" "}
              <b className="text-red-700">{Math.round(anteilSt)} €</b> Steuern · <b className="text-emerald-700">{Math.round(rest)} €</b> übrig
            </span>
          </div>
          <div className="mt-2 flex h-3 overflow-hidden rounded-full bg-neutral-100">
            <div className="bg-orange-400" style={{ width: `${anteilAus}%` }} />
            <div className="bg-red-500" style={{ width: `${anteilSt}%` }} />
            <div className="bg-emerald-400" style={{ width: `${rest}%` }} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Geldfluss je Konto als Balken ────────────────────────────────────────────

export function GeldflussBalken({
  konten, gesamt, aktiv, onWaehle, frage,
}: {
  konten: { iban: string; z: FlussZeile }[];
  gesamt: FlussZeile;
  aktiv: string;
  onWaehle: (filter: string) => void;
  frage: string;
}) {
  const max = Math.max(1, ...konten.map(({ z }) => Math.max(z.rein, -(z.ausgaben + z.steuern))));
  return (
    <div className="space-y-2">
      <p className="text-sm text-neutral-600">{frage}</p>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-neutral-500">
        <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-emerald-400" /> rein</span>
        <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-orange-400" /> Ausgaben</span>
        <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-red-500" /> Steuern</span>
        <span className="flex items-center gap-1"><span className="h-2 w-3 rounded-sm bg-slate-300" /> Übertrag zwischen eigenen Konten</span>
      </div>
      <div className="divide-y divide-neutral-100">
        {konten.map(({ iban, z }) => {
          const gewaehlt = aktiv === iban;
          const m = markeVon(iban);
          return (
            <button
              key={iban}
              type="button"
              onClick={() => onWaehle(iban)}
              title={gewaehlt ? "Filter aufheben" : "Nur dieses Konto zeigen"}
              className={`grid w-full grid-cols-[auto_1fr] md:grid-cols-[220px_1fr_150px] items-center gap-x-4 gap-y-2 rounded-xl px-2 py-3 text-left transition-colors hover:bg-neutral-50 ${gewaehlt ? "bg-neutral-100 ring-2 ring-neutral-900" : ""}`}
            >
              <div className="flex items-center gap-2.5">
                <BankLogo iban={iban} size={34} />
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-neutral-900">{kontoZweck(iban) ?? m.name}</div>
                  <div className="text-[11px] text-neutral-500">{m.name} ·· {iban.slice(-4)} · {z.n} Umsätze</div>
                </div>
              </div>
              <div className="col-span-2 md:col-span-1 space-y-1">
                <div className="flex items-center gap-2">
                  <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-neutral-100">
                    <div className="h-full rounded-full bg-emerald-400" style={{ width: `${(z.rein / max) * 100}%` }} />
                  </div>
                  <span className="w-28 text-right text-xs tabular-nums text-emerald-700">{mitVz(z.rein, "+")}</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex h-2.5 flex-1 overflow-hidden rounded-full bg-neutral-100">
                    <div className="h-full bg-orange-400" style={{ width: `${(-z.ausgaben / max) * 100}%` }} />
                    <div className="h-full bg-red-500" style={{ width: `${(-z.steuern / max) * 100}%` }} />
                  </div>
                  <span className="w-28 text-right text-xs tabular-nums text-orange-700">{mitVz(z.ausgaben + z.steuern, "−")}</span>
                </div>
                {(Math.abs(z.uebertrag) > 0.005 || Math.abs(z.sonstiges) > 0.005) && (
                  <div className="flex flex-wrap gap-1.5 pt-0.5">
                    {Math.abs(z.uebertrag) > 0.005 && (
                      <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                        {z.uebertrag > 0 ? "von" : "an"} eigene Konten {fmt0(Math.abs(z.uebertrag))}
                      </span>
                    )}
                    {Math.abs(z.sonstiges) > 0.005 && (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[11px] text-amber-800" title="Privat, Kredit, Unternehmenskauf, noch nicht zugeordnet">
                        Sonstiges {z.sonstiges > 0 ? "+" : "−"}{fmt0(Math.abs(z.sonstiges))}
                      </span>
                    )}
                  </div>
                )}
              </div>
              <div className="col-span-2 md:col-span-1 flex md:justify-end">
                <span className={`rounded-full px-3 py-1 text-sm font-bold tabular-nums ${z.veraenderung >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-700"}`}>
                  {z.veraenderung >= 0 ? "▲ +" : "▼ −"}{fmt0(Math.abs(z.veraenderung))}
                </span>
              </div>
            </button>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-neutral-50 px-3 py-2.5 text-sm">
        <span className="font-semibold text-neutral-800">Alle Konten zusammen</span>
        <span className="flex flex-wrap items-center gap-3 tabular-nums text-xs">
          <span className="text-emerald-700">+{fmt0(gesamt.rein)}</span>
          <span className="text-orange-700">−{fmt0(-gesamt.ausgaben)}</span>
          <span className="text-red-700">−{fmt0(-gesamt.steuern)}</span>
          <span className={`rounded-full px-3 py-1 text-sm font-bold ${gesamt.veraenderung >= 0 ? "bg-emerald-100 text-emerald-800" : "bg-red-100 text-red-800"}`}>
            {gesamt.veraenderung >= 0 ? "▲ +" : "▼ −"}{fmt0(Math.abs(gesamt.veraenderung))}
          </span>
        </span>
      </div>
      <p className="text-xs text-neutral-500">
        Der Pfeil rechts zeigt, um wie viel der Kontostand im Zeitraum gestiegen oder gesunken ist. Überträge zwischen euren eigenen Konten
        sind weder Gewinn noch Verlust. Konto anklicken = die ganze Seite zeigt nur dieses Konto.
      </p>
    </div>
  );
}
