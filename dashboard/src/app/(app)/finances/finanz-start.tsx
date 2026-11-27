"use client";

import Link from "next/link";
import {
  Area, Bar, BarChart, Cell, ComposedChart, Line, Pie, PieChart, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import {
  ArrowRight, Banknote, CalendarClock, CircleDollarSign, HeartPulse, Landmark, LineChart, PiggyBank, Receipt, ShoppingBag, Scissors, TrendingDown, TrendingUp, Wallet,
} from "lucide-react";
import type { FinanzStart, UstStatus } from "@/lib/finanzen/start";

const MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const KURZ = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const eur = (n: number) => `${Math.round(n).toLocaleString("de-DE")} €`;
const kEur = (n: number) => (Math.abs(n) >= 1000 ? `${(n / 1000).toLocaleString("de-DE", { maximumFractionDigits: Math.abs(n) >= 100_000 ? 0 : 1 })}k €` : eur(n));
const dt = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
const mName = (ym: string) => MONATE[Number(ym.slice(5, 7)) - 1];
const mKurz = (ym: string) => KURZ[Number(ym.slice(5, 7)) - 1];
const achseK = (v: number) => `${Math.round(v / 1000)}k`;

const AMPEL = {
  gruen: { dot: "bg-emerald-500", ring: "ring-emerald-100", text: "text-emerald-700", bar: "bg-emerald-500", label: "gut" },
  gelb: { dot: "bg-amber-400", ring: "ring-amber-100", text: "text-amber-700", bar: "bg-amber-400", label: "beobachten" },
  rot: { dot: "bg-rose-500", ring: "ring-rose-100", text: "text-rose-700", bar: "bg-rose-500", label: "kritisch" },
  info: { dot: "bg-sky-400", ring: "ring-sky-100", text: "text-sky-700", bar: "bg-sky-400", label: "Info" },
} as const;

/** Farben + Texte je USt-Stand. */
const UST: Record<UstStatus, { farbe: string; label: string; chip: string }> = {
  bezahlt: { farbe: "#f43f5e", label: "bezahlt", chip: "bg-rose-50 text-rose-700 ring-rose-200" },
  erstattet: { farbe: "#10b981", label: "erstattet", chip: "bg-emerald-50 text-emerald-700 ring-emerald-200" },
  gemeldet: { farbe: "#f59e0b", label: "gemeldet · Geld noch nicht geflossen", chip: "bg-amber-50 text-amber-800 ring-amber-200" },
  geschaetzt: { farbe: "#a5b4fc", label: "geschätzt", chip: "bg-indigo-50 text-indigo-700 ring-indigo-200" },
  laufend: { farbe: "#6366f1", label: "läuft noch · hochgerechnet", chip: "bg-indigo-50 text-indigo-700 ring-indigo-200" },
};
const FIX_FARBEN = ["#6366f1", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#0ea5e9", "#94a3b8"];

function Karte({ titel, icon, farbe = "bg-neutral-100 text-neutral-600", children, rechts, className = "", untertitel }: {
  titel: string; icon?: React.ReactNode; farbe?: string; children: React.ReactNode; rechts?: React.ReactNode; className?: string; untertitel?: string;
}) {
  return (
    <section className={`rounded-3xl border border-neutral-200/70 bg-white p-4 shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.08)] md:p-6 ${className}`}>
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          {icon && <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${farbe}`}>{icon}</span>}
          <div>
            <h2 className="text-[15px] font-semibold text-neutral-900">{titel}</h2>
            {untertitel && <p className="text-xs text-neutral-500">{untertitel}</p>}
          </div>
        </div>
        {rechts}
      </div>
      {children}
    </section>
  );
}

function Mehr({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex shrink-0 items-center gap-1 rounded-full bg-neutral-100 px-2.5 py-1 text-xs font-medium text-neutral-600 transition hover:bg-neutral-900 hover:text-white">
      {children} <ArrowRight size={12} />
    </Link>
  );
}

function StatusChip({ s }: { s: UstStatus }) {
  return <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10.5px] font-medium ring-1 ring-inset ${UST[s].chip}`}>{UST[s].label}</span>;
}

/** Betrag mit Richtung: + Zahlung (rot), − Erstattung (grün). */
function Zahlbetrag({ n, className = "" }: { n: number; className?: string }) {
  return <span className={`whitespace-nowrap tabular-nums font-semibold ${n >= 0 ? "text-rose-700" : "text-emerald-700"} ${className}`}>{n >= 0 ? "" : "+"}{eur(Math.abs(n))}</span>;
}

// ── Umsatzsteuer ──────────────────────────────────────────────────────────────
function UstKarte({ u }: { u: FinanzStart["ustPlan"] }) {
  const netto = u.bezahlt - u.erstattet;
  const zahlen = u.offen.filter((x) => x.betrag > 0).reduce((s, x) => s + x.betrag, 0);
  const zurueck = -u.offen.filter((x) => x.betrag < 0).reduce((s, x) => s + x.betrag, 0);
  const daten = u.monate.map((m) => ({ ...m, kurz: mKurz(m.monat) }));
  const kachel = "rounded-2xl p-3.5";
  return (
    <Karte
      titel={`Umsatzsteuer ${u.jahr} — Monat für Monat`}
      untertitel="Was schon ans Finanzamt ging, was gemeldet ist und was noch kommt"
      icon={<Receipt size={17} />}
      farbe="bg-rose-100 text-rose-700"
      rechts={<Mehr href="/finances/prepayments">Alle Steuern</Mehr>}
    >
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className={`${kachel} bg-rose-50`}>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-rose-800/80">Bezahlt</div>
          <div className="mt-1 text-xl font-bold tabular-nums text-rose-900">{eur(u.bezahlt)}</div>
          <div className="text-[11px] text-rose-800/70">{u.monate.filter((m) => m.status === "bezahlt").length} Monate ans Finanzamt</div>
        </div>
        <div className={`${kachel} bg-emerald-50`}>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800/80">Erstattet</div>
          <div className="mt-1 text-xl font-bold tabular-nums text-emerald-900">{eur(u.erstattet)}</div>
          <div className="text-[11px] text-emerald-800/70">{u.monate.filter((m) => m.status === "erstattet").length} Monate zurückbekommen</div>
        </div>
        <div className={`${kachel} bg-neutral-100`}>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-600">Unterm Strich bisher</div>
          <div className="mt-1 text-xl font-bold tabular-nums text-neutral-900">{eur(netto)}</div>
          <div className="text-[11px] text-neutral-500">bezahlt minus erstattet</div>
        </div>
        <div className={`${kachel} bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-sm`}>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-white/85">Noch offen</div>
          <div className="mt-1 text-xl font-bold tabular-nums">{u.offenSumme >= 0 ? "" : "+"}{eur(Math.abs(u.offenSumme))}</div>
          <div className="text-[11px] text-white/85">{u.offenSumme >= 0 ? "unterm Strich noch zu zahlen" : "unterm Strich kommt zurück"}</div>
        </div>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <div className="h-60">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={daten} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                <defs>
                  <pattern id="ust-schraffur" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                    <rect width="6" height="6" fill="#c7d2fe" />
                    <line x1="0" y1="0" x2="0" y2="6" stroke="#6366f1" strokeWidth="2.5" />
                  </pattern>
                </defs>
                <XAxis dataKey="kurz" tickLine={false} axisLine={false} fontSize={12} />
                <YAxis tickFormatter={achseK} tickLine={false} axisLine={false} fontSize={11} width={36} />
                <ReferenceLine y={0} stroke="#d4d4d4" />
                <Tooltip
                  cursor={{ fill: "rgba(0,0,0,0.03)" }}
                  content={({ active, payload }) => {
                    const m = active && payload?.[0] ? (payload[0].payload as (typeof daten)[number]) : null;
                    if (!m) return null;
                    return (
                      <div className="rounded-xl border border-neutral-200 bg-white px-3 py-2 text-xs shadow-lg">
                        <div className="font-semibold text-neutral-900">{mName(m.monat)} {m.monat.slice(0, 4)}</div>
                        <div className="mt-1"><Zahlbetrag n={m.betrag} /> <span className="text-neutral-500">{m.betrag >= 0 ? "Zahlung" : "Erstattung"}</span></div>
                        <div className="mt-1 text-neutral-500">{UST[m.status].label}</div>
                        {m.datum && <div className="text-neutral-500">Geld geflossen am {dt(m.datum)}{m.datum.slice(0, 4)}</div>}
                        {!m.datum && <div className="text-neutral-500">fällig {dt(m.faellig)}{m.faellig.slice(0, 4)}</div>}
                        {m.bisher !== null && <div className="text-neutral-500">bis heute gebucht: {eur(m.bisher)}</div>}
                      </div>
                    );
                  }}
                />
                <Bar dataKey="betrag" radius={[5, 5, 5, 5]} maxBarSize={34}>
                  {daten.map((m) => (
                    <Cell key={m.monat} fill={m.status === "laufend" || m.status === "geschaetzt" ? "url(#ust-schraffur)" : UST[m.status].farbe} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-neutral-500">
            {(["bezahlt", "erstattet", "gemeldet", "laufend"] as UstStatus[]).map((s) => (
              <span key={s} className="inline-flex items-center gap-1.5">
                <i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s === "laufend" ? "repeating-linear-gradient(45deg,#6366f1 0 2px,#c7d2fe 2px 5px)" : UST[s].farbe }} />
                {s === "laufend" ? "geschätzt / hochgerechnet" : UST[s].label.split(" ·")[0]}
              </span>
            ))}
            <span>· nach oben = Zahlung, nach unten = Erstattung</span>
          </div>
        </div>

        <div className="lg:col-span-2">
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Was noch kommt</div>
          {u.offen.length === 0 ? (
            <p className="rounded-2xl bg-emerald-50 p-3 text-sm text-emerald-800">Alles abgerechnet — nichts offen.</p>
          ) : (
            <div className="space-y-2">
              {u.offen.map((x) => (
                <div key={x.label} className="rounded-2xl border border-neutral-200 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-neutral-900">{x.label}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <StatusChip s={x.status} />
                        <span className="text-[11px] text-neutral-500">{x.betrag >= 0 ? "zahlen bis" : "erwartet ca."} {dt(x.faellig)}{x.faellig.slice(0, 4)}</span>
                      </div>
                      {x.detail && (
                        <div className="mt-1.5 text-[11px] leading-snug text-neutral-500">
                          USt auf Umsätze {kEur(x.detail.ust)} − Vorsteuer {kEur(x.detail.vorsteuer)} − Einfuhrumsatzsteuer {kEur(x.detail.eust)}
                        </div>
                      )}
                    </div>
                    <div className="text-right">
                      <Zahlbetrag n={x.betrag} className="text-base" />
                      <div className="text-[10.5px] text-neutral-400">{x.betrag >= 0 ? "Zahlung" : "Erstattung"}</div>
                    </div>
                  </div>
                </div>
              ))}
              <div className="grid grid-cols-2 gap-2 pt-1 text-xs">
                <div className="rounded-xl bg-rose-50 px-3 py-2 text-rose-800">zahlen: <b className="tabular-nums">{eur(zahlen)}</b></div>
                <div className="rounded-xl bg-emerald-50 px-3 py-2 text-emerald-800">zurück: <b className="tabular-nums">{eur(zurueck)}</b></div>
              </div>
            </div>
          )}
        </div>
      </div>
      <p className="mt-4 text-[11px] leading-relaxed text-neutral-400">
        Mit Dauerfristverlängerung: Voranmeldung und Zahlung jeweils am 10. des übernächsten Monats. „Gemeldet“ = Voranmeldung ist abgegeben, Betrag steht fest, Geld ist
        noch nicht geflossen. Der laufende Monat ist aus den Umsätzen bis heute auf den ganzen Monat hochgerechnet (Vorsteuer und Einfuhrumsatzsteuer nur, soweit schon
        abgebucht — daher eher zu hoch). Sobald das Geld fließt, übernimmt das Konto den echten Betrag automatisch.
      </p>
    </Karte>
  );
}

// ── Einkommen- und Gewerbesteuer ──────────────────────────────────────────────
function EstGewstKarte({ j }: { j: NonNullable<FinanzStart["estGewst"]> }) {
  const pr = j.prognose;
  const art = (a: "est" | "gewst") => j.arten.find((x) => x.art === a);
  const zeilen = [
    { key: "est" as const, titel: "Einkommensteuer (inkl. Soli)", erwartet: pr?.est ?? null, vz: pr?.vzEst ?? null, nach: pr?.nachEst ?? null },
    { key: "gewst" as const, titel: "Gewerbesteuer", erwartet: pr?.gewst ?? null, vz: pr?.vzGewst ?? null, nach: pr?.nachGewst ?? null },
  ];
  const nachGesamt = pr ? pr.nachEst + pr.nachGewst : null;
  const erwartet = pr ? pr.est + pr.gewst : 0;
  const anteil = erwartet > 0 ? Math.min(1, j.bezahlt / erwartet) : 0;
  return (
    <Karte
      titel={`Einkommen- & Gewerbesteuer ${j.jahr}`}
      untertitel="Aus dem hochgerechneten Gewinn — gleiche Rechnung wie die Steuerkasse"
      icon={<Landmark size={17} />}
      farbe="bg-violet-100 text-violet-700"
      rechts={<Mehr href="/finances/overview">Gewinnrechnung</Mehr>}
    >
      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-2xl bg-neutral-50 p-3.5">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Erwarteter Gewinn</div>
          <div className="mt-1 text-xl font-bold tabular-nums text-neutral-900">{pr ? eur(pr.gewinnJahr) : "—"}</div>
          {pr && <div className="text-[11px] text-neutral-400">aus {pr.monate} Monaten (bis {mName(pr.bisMonat)}: {kEur(pr.gewinnBisher)})</div>}
        </div>
        <div className="rounded-2xl bg-violet-50 p-3.5">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-violet-800/80">Steuer darauf</div>
          <div className="mt-1 text-xl font-bold tabular-nums text-violet-900">{pr ? eur(erwartet) : "—"}</div>
          {pr && <div className="text-[11px] text-violet-800/70">ESt {kEur(pr.est)} · GewSt {kEur(pr.gewst)}</div>}
        </div>
        <div className="rounded-2xl bg-emerald-50 p-3.5">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-emerald-800/80">Schon gezahlt</div>
          <div className="mt-1 text-xl font-bold tabular-nums text-emerald-900">{eur(j.bezahlt)}</div>
          <div className="text-[11px] text-emerald-800/70">Vorauszahlungen{j.offen > 0 ? ` · noch fällig ${eur(j.offen)}` : ""}</div>
        </div>
        <div className={`rounded-2xl p-3.5 text-white shadow-sm ${nachGesamt !== null && nachGesamt > 0 ? "bg-gradient-to-br from-violet-500 to-fuchsia-500" : "bg-gradient-to-br from-emerald-500 to-teal-500"}`}>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-white/85">{nachGesamt !== null && nachGesamt < 0 ? "Erstattung erwartet" : "Nachzahlung erwartet"}</div>
          <div className="mt-1 text-xl font-bold tabular-nums">{nachGesamt !== null ? eur(Math.abs(nachGesamt)) : "—"}</div>
          <div className="text-[11px] text-white/85">mit dem Steuerbescheid, meist im Folgejahr</div>
        </div>
      </div>
      {pr && erwartet > 0 && (
        <div className="mt-4">
          <div className="flex justify-between text-[11px] text-neutral-500">
            <span>Davon schon über Vorauszahlungen gedeckt</span>
            <span className="tabular-nums font-medium text-neutral-700">{Math.round(anteil * 100)} %</span>
          </div>
          <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-violet-100">
            <div className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-500" style={{ width: `${anteil * 100}%` }} />
          </div>
        </div>
      )}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[520px] text-sm">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide text-neutral-400">
              <th className="py-1.5 font-medium"></th>
              <th className="py-1.5 text-right font-medium">erwartet</th>
              <th className="py-1.5 text-right font-medium">Vorauszahlungen</th>
              <th className="py-1.5 text-right font-medium">davon gezahlt</th>
              <th className="py-1.5 text-right font-medium">Nachzahlung</th>
            </tr>
          </thead>
          <tbody className="tabular-nums">
            {zeilen.map((z) => (
              <tr key={z.key} className="border-t border-neutral-100">
                <td className="py-1.5 text-neutral-800">{z.titel}</td>
                <td className="py-1.5 text-right">{z.erwartet !== null ? eur(z.erwartet) : "—"}</td>
                <td className="py-1.5 text-right text-neutral-600">{z.vz !== null ? eur(z.vz) : "—"}</td>
                <td className="py-1.5 text-right text-emerald-700">{eur(art(z.key)?.bezahlt ?? 0)}</td>
                <td className={`py-1.5 text-right font-semibold ${z.nach !== null && z.nach > 0 ? "text-rose-700" : "text-emerald-700"}`}>{z.nach !== null ? `${z.nach < 0 ? "−" : ""}${eur(Math.abs(z.nach))}` : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-[11px] text-neutral-400">
        Gewinn aus „Einnahmen & Ausgaben“ (abgeschlossene Monate, auf 12 hochgerechnet), Steuer nach Tarif inkl. Gewerbesteuer-Anrechnung. Personal-, Material- und
        Fixkosten sind dort teils noch Schätzwerte; je genauer die Monate, desto genauer die Nachzahlung.
      </p>
    </Karte>
  );
}

// ── Seite ─────────────────────────────────────────────────────────────────────
export default function FinanzStartAnsicht({ d }: { d: FinanzStart }) {
  const monatGesamt = d.umsatz.shop + d.umsatz.salon;
  const jahrGesamt = d.umsatz.jahrShop + d.umsatz.jahrSalon;
  const tief = d.liquiditaet.tiefpunkt;
  const tiefAmpel = tief.saldo < 0 ? "rot" : tief.saldo < d.liquiditaet.puffer ? "gelb" : "gruen";
  const stand = new Date(d.stand).toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const heute = d.kontoKurve.find((k) => k.prognose !== null)?.datum ?? null;
  const vorjahrQuote = d.umsatz.vorjahrMonatShop ? d.umsatz.shop / d.umsatz.vorjahrMonatShop - 1 : null;
  const fixTop = d.fixkosten.posten.slice(0, 6);
  const fixRest = d.fixkosten.posten.slice(6).reduce((s, x) => s + x.monat, 0);
  const fixDonut = [...fixTop.map((x) => ({ name: x.label, wert: x.monat })), ...(fixRest > 0 ? [{ name: "Übrige", wert: fixRest }] : [])];
  const cashflow = d.cashflow.map((c) => ({ ...c, ausgaben: c.ware + c.steuern + c.kosten }));

  return (
    <div className="min-h-full bg-gradient-to-b from-slate-50 to-white">
      <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-8">
        {/* Kopf */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-neutral-900">Finanzen</h1>
            <p className="text-sm text-neutral-500">Die wichtigsten Zahlen auf einen Blick · Stand {stand}</p>
          </div>
          <nav className="flex flex-wrap gap-1.5">
            {[
              { href: "/finances/overview", t: "Einnahmen & Ausgaben" },
              { href: "/finances/liquiditaet", t: "Liquidität" },
              { href: "/finances/prepayments", t: "Steuern" },
              { href: "/finances/bank", t: "Kontoumsätze" },
            ].map((x) => (
              <Link key={x.href} href={x.href} className="rounded-full border border-neutral-200 bg-white px-3 py-1.5 text-xs font-medium text-neutral-700 shadow-sm transition hover:border-neutral-900 hover:bg-neutral-900 hover:text-white">
                {x.t}
              </Link>
            ))}
          </nav>
        </div>

        {/* Kennzahlen */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <div className="flex flex-col overflow-hidden rounded-3xl bg-gradient-to-br from-slate-900 via-indigo-950 to-indigo-800 p-4 text-white shadow-lg md:p-5">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-white/70"><Wallet size={14} /> Auf den Konten</div>
            <div className="mt-2 text-2xl font-bold tabular-nums md:text-3xl">{eur(d.konten.gesamt)}</div>
            <div className="mt-2 flex-1 space-y-0.5 text-[11px] text-white/70">
              {d.konten.liste.map((k) => (
                <div key={k.name} className="flex justify-between gap-2"><span className="truncate">{k.name}</span><span className="tabular-nums">{eur(k.saldo)}</span></div>
              ))}
            </div>
            <div className="pointer-events-none -mx-1 -mb-2 mt-2 h-12 opacity-70">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={d.kontoKurve.filter((k) => k.ist !== null)}>
                  <defs>
                    <linearGradient id="kopf-ist" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#a5b4fc" stopOpacity={0.7} />
                      <stop offset="100%" stopColor="#a5b4fc" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <YAxis hide domain={["dataMin", "dataMax"]} />
                  <Area dataKey="ist" type="monotone" stroke="#c7d2fe" strokeWidth={1.5} fill="url(#kopf-ist)" isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="rounded-3xl border border-neutral-200/70 bg-white p-4 shadow-sm md:p-5">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
              <span className="grid h-6 w-6 place-items-center rounded-lg bg-emerald-100 text-emerald-700"><CircleDollarSign size={13} /></span>
              Umsatz {mName(d.umsatz.monat)}
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums text-neutral-900 md:text-3xl">{kEur(monatGesamt)}</div>
            <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-neutral-500">
              <span className="inline-flex items-center gap-1"><ShoppingBag size={11} /> Shop {kEur(d.umsatz.shop)}</span>
              <span className="inline-flex items-center gap-1"><Scissors size={11} /> Salon {kEur(d.umsatz.salon)}</span>
            </div>
            {vorjahrQuote !== null && (
              <div className={`mt-2 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${vorjahrQuote >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-800"}`}>
                {vorjahrQuote >= 0 ? <TrendingUp size={12} /> : <TrendingDown size={12} />}
                Shop {vorjahrQuote >= 0 ? "+" : ""}{Math.round(vorjahrQuote * 100)} % ggü. {mName(d.umsatz.monat)} Vorjahr (ganzer Monat)
              </div>
            )}
          </div>

          <div className="rounded-3xl border border-neutral-200/70 bg-white p-4 shadow-sm md:p-5">
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
              <span className="grid h-6 w-6 place-items-center rounded-lg bg-sky-100 text-sky-700"><LineChart size={13} /></span>
              Umsatz {d.umsatz.monat.slice(0, 4)}
            </div>
            <div className="mt-2 text-2xl font-bold tabular-nums text-neutral-900 md:text-3xl">{kEur(jahrGesamt)}</div>
            <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-neutral-500">
              <span>Shop {kEur(d.umsatz.jahrShop)}</span>
              <span>Salon {kEur(d.umsatz.jahrSalon)}</span>
            </div>
            <div className="mt-2 h-10">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={d.umsatzMonate} margin={{ top: 0, right: 0, left: 0, bottom: 0 }}>
                  <Bar dataKey={(m: FinanzStart["umsatzMonate"][number]) => m.shop + m.salon} radius={[3, 3, 0, 0]} isAnimationActive={false}>
                    {d.umsatzMonate.map((m) => <Cell key={m.monat} fill={m.monat === d.umsatz.monat ? "#0ea5e9" : "#bae6fd"} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <Link href="/finances/liquiditaet" className={`rounded-3xl border border-neutral-200/70 bg-white p-4 shadow-sm ring-4 transition hover:-translate-y-0.5 hover:shadow-md md:p-5 ${AMPEL[tiefAmpel].ring}`}>
            <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-neutral-500">
              <span className="grid h-6 w-6 place-items-center rounded-lg bg-amber-100 text-amber-700"><PiggyBank size={13} /></span>
              Tiefster Kontostand
            </div>
            <div className={`mt-2 text-2xl font-bold tabular-nums md:text-3xl ${AMPEL[tiefAmpel].text}`}>{eur(tief.saldo)}</div>
            <div className="mt-2 text-[11px] text-neutral-500">am {dt(tief.datum)} laut Liquiditätsvorschau</div>
            <div className="mt-1 text-[11px] text-neutral-400">Reserve {kEur(d.liquiditaet.puffer)}</div>
          </Link>
        </div>

        {/* Kontostand: Verlauf + Vorschau */}
        {d.kontoKurve.length > 1 && (
          <Karte
            titel="Kontostand — Verlauf und Vorschau"
            untertitel="Letzte 60 Tage laut Konto, danach die Liquiditätsvorschau (Sparkasse, Vorschau ggf. inkl. PayPal)"
            icon={<Wallet size={17} />}
            farbe="bg-indigo-100 text-indigo-700"
            rechts={<Mehr href="/finances/liquiditaet">Liquidität</Mehr>}
          >
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={d.kontoKurve} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="kurve-ist" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#6366f1" stopOpacity={0.35} />
                      <stop offset="100%" stopColor="#6366f1" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="kurve-prog" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#a855f7" stopOpacity={0.18} />
                      <stop offset="100%" stopColor="#a855f7" stopOpacity={0.01} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="datum" tickFormatter={(v: string) => dt(v)} tickLine={false} axisLine={false} fontSize={11} minTickGap={40} />
                  <YAxis tickFormatter={achseK} tickLine={false} axisLine={false} fontSize={11} width={40} />
                  <Tooltip
                    formatter={(v, name) => [eur(Number(v)), name === "ist" ? "Kontostand" : "Vorschau"]}
                    labelFormatter={(v) => `${dt(String(v))}${String(v).slice(0, 4)}`}
                  />
                  <ReferenceLine y={d.liquiditaet.puffer} stroke="#f59e0b" strokeDasharray="4 4" label={{ value: "Reserve", position: "insideTopLeft", fontSize: 10, fill: "#b45309" }} />
                  <ReferenceLine y={0} stroke="#e5e5e5" />
                  {heute && <ReferenceLine x={heute} stroke="#a3a3a3" strokeDasharray="2 3" label={{ value: "heute", position: "top", fontSize: 10, fill: "#737373" }} />}
                  <Area dataKey="ist" type="monotone" stroke="#6366f1" strokeWidth={2} fill="url(#kurve-ist)" connectNulls={false} dot={false} isAnimationActive={false} />
                  <Area dataKey="prognose" type="monotone" stroke="#a855f7" strokeWidth={2} strokeDasharray="5 4" fill="url(#kurve-prog)" connectNulls={false} dot={false} isAnimationActive={false} />
                  <ReferenceDot x={tief.datum} y={tief.saldo} r={5} fill={tiefAmpel === "rot" ? "#f43f5e" : tiefAmpel === "gelb" ? "#f59e0b" : "#10b981"} stroke="#fff" strokeWidth={2} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </Karte>
        )}

        {/* Umsatzsteuer */}
        <UstKarte u={d.ustPlan} />

        {/* Gesundheits-Check */}
        <Karte titel="Wirtschaftet das Unternehmen gesund?" icon={<HeartPulse size={17} />} farbe="bg-pink-100 text-pink-700">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {d.checks.map((c) => (
              <Link key={c.titel} href={c.href} className="group relative overflow-hidden rounded-2xl border border-neutral-200/70 bg-white p-3.5 pl-4 transition hover:-translate-y-0.5 hover:shadow-md">
                <i className={`absolute inset-y-0 left-0 w-1 ${AMPEL[c.ampel].bar}`} />
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-neutral-800">{c.titel}</span>
                  <span className={`inline-flex items-center gap-1.5 rounded-full bg-neutral-50 px-2 py-0.5 text-[11px] font-medium ${AMPEL[c.ampel].text}`}>
                    <i className={`inline-block h-2 w-2 rounded-full ${AMPEL[c.ampel].dot}`} />
                    {AMPEL[c.ampel].label}
                  </span>
                </div>
                <div className="mt-1 text-xl font-bold tabular-nums text-neutral-900">{c.wert}</div>
                <div className="mt-0.5 text-[11.5px] leading-snug text-neutral-500">{c.text}</div>
              </Link>
            ))}
          </div>
        </Karte>

        <div className="grid gap-6 lg:grid-cols-5">
          {/* Umsatz je Monat */}
          <Karte
            className="lg:col-span-3"
            titel={`Umsatz ${d.umsatz.monat.slice(0, 4)} je Monat`}
            untertitel="Shop + Salon (inkl. USt, nach Erstattungen) · Linie = Shop im Vorjahr"
            icon={<CircleDollarSign size={17} />}
            farbe="bg-emerald-100 text-emerald-700"
          >
            <div className="h-60">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={d.umsatzMonate} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                  <XAxis dataKey="monat" tickFormatter={mKurz} tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis tickFormatter={achseK} tickLine={false} axisLine={false} fontSize={11} width={40} />
                  <Tooltip
                    cursor={{ fill: "rgba(0,0,0,0.03)" }}
                    formatter={(v, name) => [eur(Number(v)), name === "shop" ? "Shop" : name === "salon" ? "Salon" : "Shop Vorjahr"]}
                    labelFormatter={(m) => `${mName(String(m))} ${String(m).slice(0, 4)}`}
                  />
                  <Bar dataKey="shop" stackId="u" fill="#10b981" maxBarSize={34} isAnimationActive={false} />
                  <Bar dataKey="salon" stackId="u" fill="#f472b6" radius={[5, 5, 0, 0]} maxBarSize={34} isAnimationActive={false} />
                  <Line dataKey="vorjahr" type="monotone" stroke="#94a3b8" strokeWidth={2} strokeDasharray="4 3" dot={{ r: 2.5, fill: "#94a3b8" }} connectNulls isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 flex flex-wrap gap-x-4 text-[11px] text-neutral-500">
              <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-emerald-500" /> Shop</span>
              <span className="inline-flex items-center gap-1.5"><i className="h-2.5 w-2.5 rounded-sm bg-pink-400" /> Salon</span>
              <span className="inline-flex items-center gap-1.5"><i className="h-0.5 w-4 bg-slate-400" /> Shop Vorjahr</span>
              <span>· {mName(d.umsatz.monat)} läuft noch</span>
            </div>
          </Karte>

          {/* Fixkosten */}
          <Karte
            className="lg:col-span-2"
            titel="Fixkosten pro Monat"
            untertitel="Ø der letzten drei vollen Monate laut Konto"
            icon={<Banknote size={17} />}
            farbe="bg-sky-100 text-sky-700"
          >
            <div className="flex items-center gap-4">
              <div className="relative h-36 w-36 shrink-0">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={fixDonut} dataKey="wert" nameKey="name" innerRadius="62%" outerRadius="100%" paddingAngle={2} stroke="none" isAnimationActive={false}>
                      {fixDonut.map((x, i) => <Cell key={x.name} fill={FIX_FARBEN[i % FIX_FARBEN.length]} />)}
                    </Pie>
                    <Tooltip formatter={(v) => eur(Number(v))} />
                  </PieChart>
                </ResponsiveContainer>
                <div className="pointer-events-none absolute inset-0 grid place-items-center text-center">
                  <div>
                    <div className="text-[10px] uppercase tracking-wide text-neutral-400">gesamt</div>
                    <div className="text-sm font-bold tabular-nums text-neutral-900">{kEur(d.fixkosten.summe)}</div>
                  </div>
                </div>
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">
                {fixDonut.map((x, i) => (
                  <div key={x.name} className="flex items-center justify-between gap-2 text-xs">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <i className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: FIX_FARBEN[i % FIX_FARBEN.length] }} />
                      <span className="truncate text-neutral-700">{x.name}</span>
                    </span>
                    <span className="tabular-nums font-medium text-neutral-900">{kEur(x.wert)}</span>
                  </div>
                ))}
              </div>
            </div>
            <p className="mt-3 text-[11px] text-neutral-400">Ohne Ware, Einfuhrabgaben und Steuern (außer Lohnsteuer). Privatentnahmen sind kein Betriebsaufwand.</p>
          </Karte>
        </div>

        {/* Einkommen- und Gewerbesteuer */}
        {d.estGewst && <EstGewstKarte j={d.estGewst} />}

        <div className="grid gap-6 lg:grid-cols-5">
          {/* Cashflow */}
          <Karte
            className="lg:col-span-3"
            titel="Was am Monatsende übrig bleibt"
            untertitel="Einnahmen, Ausgaben und Überschuss je Monat laut Konto"
            icon={<TrendingUp size={17} />}
            farbe="bg-teal-100 text-teal-700"
            rechts={<Mehr href="/finances/overview">Einnahmen & Ausgaben</Mehr>}
          >
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={cashflow} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
                  <XAxis dataKey="monat" tickFormatter={mKurz} tickLine={false} axisLine={false} fontSize={12} />
                  <YAxis tickFormatter={achseK} tickLine={false} axisLine={false} fontSize={11} width={40} />
                  <ReferenceLine y={0} stroke="#d4d4d4" />
                  <Tooltip
                    cursor={{ fill: "rgba(0,0,0,0.03)" }}
                    formatter={(v, name) => [eur(Number(v)), name === "einnahmen" ? "Einnahmen" : name === "ausgaben" ? "Ausgaben (Ware, Steuern, Kosten)" : "Übrig"]}
                    labelFormatter={(m) => `${mName(String(m))} ${String(m).slice(0, 4)}`}
                  />
                  <Bar dataKey="einnahmen" fill="#a7f3d0" radius={[5, 5, 0, 0]} maxBarSize={26} isAnimationActive={false} />
                  <Bar dataKey="ausgaben" fill="#fecdd3" radius={[0, 0, 5, 5]} maxBarSize={26} isAnimationActive={false} />
                  <Line dataKey="ueberschuss" type="monotone" stroke="#0f766e" strokeWidth={2.5} dot={{ r: 4, fill: "#0f766e", stroke: "#fff", strokeWidth: 2 }} isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[420px] text-xs">
                <thead>
                  <tr className="text-left text-neutral-400">
                    <th className="py-1 font-medium">Monat</th>
                    <th className="py-1 text-right font-medium">Einnahmen</th>
                    <th className="py-1 text-right font-medium">Ware</th>
                    <th className="py-1 text-right font-medium">Steuern</th>
                    <th className="py-1 text-right font-medium">Kosten</th>
                    <th className="py-1 text-right font-medium">Übrig</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums">
                  {[...d.cashflow].reverse().map((c) => (
                    <tr key={c.monat} className="border-t border-neutral-100">
                      <td className="py-1 text-neutral-700">{mKurz(c.monat)}</td>
                      <td className="py-1 text-right text-neutral-900">{kEur(c.einnahmen)}</td>
                      <td className="py-1 text-right text-neutral-500">{kEur(c.ware)}</td>
                      <td className="py-1 text-right text-neutral-500">{kEur(c.steuern)}</td>
                      <td className="py-1 text-right text-neutral-500">{kEur(c.kosten)}</td>
                      <td className="py-1 text-right">
                        <span className={`rounded-full px-1.5 py-px font-semibold ${c.ueberschuss >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700"}`}>{c.ueberschuss >= 0 ? "+" : ""}{kEur(c.ueberschuss)}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="mt-2 text-[11px] text-neutral-400">
              Shopify- und Treatwell-Konto; Gehälter, Miete usw. über die Überträge aufs Gehaltskonto. Ware schwankt stark (Black-Friday-Vorrat, Raten). Ohne Kredit-Tilgung
              und interne Umbuchungen.
            </p>
          </Karte>

          {/* Steuertermine */}
          <Karte className="lg:col-span-2" titel="Steuertermine" untertitel="Nächste 60 Tage laut Liquiditätsvorschau" icon={<CalendarClock size={17} />} farbe="bg-amber-100 text-amber-700">
            {d.steuerTermine.length === 0 ? (
              <p className="text-sm text-neutral-500">Keine Steuertermine in den nächsten 60 Tagen.</p>
            ) : (
              <ol className="relative space-y-3 border-l-2 border-neutral-100 pl-4">
                {d.steuerTermine.map((t, i) => (
                  <li key={i} className="relative">
                    <i className={`absolute -left-[23px] top-1 h-3 w-3 rounded-full ring-4 ring-white ${t.betrag < 0 ? "bg-rose-500" : "bg-emerald-500"}`} />
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-[11px] font-medium tabular-nums text-neutral-400">{dt(t.datum)}{t.datum.slice(0, 4)}{t.geschaetzt ? " · geschätzt" : ""}</div>
                        <div className="text-sm text-neutral-800">{t.label}</div>
                      </div>
                      <span className={`shrink-0 tabular-nums text-sm font-semibold ${t.betrag < 0 ? "text-rose-700" : "text-emerald-700"}`}>{t.betrag < 0 ? "−" : "+"}{eur(Math.abs(t.betrag))}</span>
                    </div>
                  </li>
                ))}
              </ol>
            )}
            {d.steuerTermine.length > 0 && (
              <div className="mt-4 flex items-center justify-between rounded-xl bg-neutral-50 px-3 py-2 text-sm font-semibold">
                <span>zusammen</span>
                <span className="tabular-nums">{eur(d.steuerTermine.reduce((s, t) => s + t.betrag, 0))}</span>
              </div>
            )}
          </Karte>
        </div>
      </div>
    </div>
  );
}
