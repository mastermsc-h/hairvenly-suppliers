"use client";

import Link from "next/link";
import { Bar, BarChart, Cell, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import {
  ArrowRight, Banknote, CalendarClock, CircleDollarSign, FileText, HeartPulse, Landmark, LineChart, Receipt, ShoppingBag, Scissors, Wallet,
} from "lucide-react";
import type { FinanzStart } from "@/lib/finanzen/start";

const MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const KURZ = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const eur = (n: number) => `${Math.round(n).toLocaleString("de-DE")} €`;
const kEur = (n: number) => (Math.abs(n) >= 1000 ? `${(n / 1000).toLocaleString("de-DE", { maximumFractionDigits: Math.abs(n) >= 100_000 ? 0 : 1 })}k €` : eur(n));
const dt = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;
const mName = (ym: string) => MONATE[Number(ym.slice(5)) - 1];

const AMPEL = {
  gruen: { dot: "bg-emerald-500", ring: "ring-emerald-100", text: "text-emerald-700", label: "gut" },
  gelb: { dot: "bg-amber-400", ring: "ring-amber-100", text: "text-amber-700", label: "beobachten" },
  rot: { dot: "bg-rose-500", ring: "ring-rose-100", text: "text-rose-700", label: "kritisch" },
  info: { dot: "bg-sky-400", ring: "ring-sky-100", text: "text-sky-700", label: "Info" },
} as const;

function Karte({ titel, icon, children, rechts, className = "" }: { titel: string; icon?: React.ReactNode; children: React.ReactNode; rechts?: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm md:p-5 ${className}`}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-neutral-500">
          {icon}
          {titel}
        </h2>
        {rechts}
      </div>
      {children}
    </section>
  );
}

function Mehr({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="inline-flex items-center gap-1 text-xs font-medium text-neutral-500 hover:text-neutral-900">
      {children} <ArrowRight size={12} />
    </Link>
  );
}

function Richtung({ wert }: { wert: number }) {
  return (
    <span className={`rounded-full px-1.5 py-px text-[10px] font-medium ${wert >= 0 ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>
      {wert >= 0 ? "Zahlung" : "Erstattung"}
    </span>
  );
}

function EstGewstKarte({ j }: { j: NonNullable<FinanzStart["estGewst"]> }) {
  const pr = j.prognose;
  const art = (a: "est" | "gewst") => j.arten.find((x) => x.art === a);
  const zeilen = [
    { key: "est" as const, titel: "Einkommensteuer (inkl. Soli)", erwartet: pr?.est ?? null, vz: pr?.vzEst ?? null, nach: pr?.nachEst ?? null },
    { key: "gewst" as const, titel: "Gewerbesteuer", erwartet: pr?.gewst ?? null, vz: pr?.vzGewst ?? null, nach: pr?.nachGewst ?? null },
  ];
  const nachGesamt = pr ? pr.nachEst + pr.nachGewst : null;
  return (
    <Karte titel={`Einkommen- & Gewerbesteuer ${j.jahr}`} icon={<Landmark size={14} />} rechts={<Mehr href="/finances/overview">Gewinnrechnung</Mehr>}>
      <div className="grid gap-3 md:grid-cols-4">
        <div className="rounded-xl bg-neutral-50 p-3">
          <div className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">Erwarteter Gewinn {j.jahr}</div>
          <div className="mt-1 text-lg font-bold tabular-nums text-neutral-900">{pr ? eur(pr.gewinnJahr) : "—"}</div>
          {pr && <div className="text-[11px] text-neutral-400">hochgerechnet aus {pr.monate} Monaten (bis {mName(pr.bisMonat)}: {kEur(pr.gewinnBisher)})</div>}
        </div>
        <div className="rounded-xl bg-neutral-50 p-3">
          <div className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">Steuer darauf</div>
          <div className="mt-1 text-lg font-bold tabular-nums text-rose-700">{pr ? eur(pr.est + pr.gewst) : "—"}</div>
          {pr && <div className="text-[11px] text-neutral-400">ESt {kEur(pr.est)} · GewSt {kEur(pr.gewst)}</div>}
        </div>
        <div className="rounded-xl bg-neutral-50 p-3">
          <div className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">Schon gezahlt</div>
          <div className="mt-1 text-lg font-bold tabular-nums text-emerald-700">{eur(j.bezahlt)}</div>
          <div className="text-[11px] text-neutral-400">Vorauszahlungen{j.offen > 0 ? ` · noch fällig ${eur(j.offen)}` : ""}</div>
        </div>
        <div className={`rounded-xl p-3 ${nachGesamt !== null && nachGesamt > 0 ? "bg-amber-50" : "bg-emerald-50"}`}>
          <div className={`text-[11px] font-medium uppercase tracking-wide ${nachGesamt !== null && nachGesamt > 0 ? "text-amber-800" : "text-emerald-800"}`}>
            {nachGesamt !== null && nachGesamt < 0 ? "Erstattung erwartet" : "Nachzahlung erwartet"}
          </div>
          <div className="mt-1 text-lg font-bold tabular-nums text-neutral-900">{nachGesamt !== null ? eur(Math.abs(nachGesamt)) : "—"}</div>
          <div className="text-[11px] text-neutral-500">kommt mit dem Steuerbescheid {j.jahr}, meist im Folgejahr</div>
        </div>
      </div>
      <div className="mt-3 overflow-x-auto">
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
        Gewinn aus „Einnahmen & Ausgaben“ (abgeschlossene Monate, auf 12 hochgerechnet), Steuer nach Tarif inkl. Gewerbesteuer-Anrechnung — dieselbe Rechnung wie die
        Steuerkasse auf dem Startbildschirm. Die Personal-, Material- und Fixkosten sind dort teils noch Schätzwerte; je genauer die Monate, desto genauer die Nachzahlung.
      </p>
    </Karte>
  );
}

export default function FinanzStartAnsicht({ d }: { d: FinanzStart }) {
  const monatGesamt = d.umsatz.shop + d.umsatz.salon;
  const jahrGesamt = d.umsatz.jahrShop + d.umsatz.jahrSalon;
  const tief = d.liquiditaet.tiefpunkt;
  const tiefAmpel = tief.saldo < 0 ? "rot" : tief.saldo < d.liquiditaet.puffer ? "gelb" : "gruen";
  const maxFix = Math.max(1, ...d.fixkosten.posten.map((x) => x.monat));
  const stand = new Date(d.stand).toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
  const gruppen = [
    { key: "gehalt" as const, titel: "Über das Gehaltskonto" },
    { key: "betrieb" as const, titel: "Laufender Betrieb" },
  ];

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 md:p-8">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">Finanzen</h1>
          <p className="text-sm text-neutral-500">Die wichtigsten Zahlen auf einen Blick · Stand {stand}</p>
        </div>
      </div>

      {/* Kennzahlen */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="rounded-2xl bg-gradient-to-br from-neutral-900 to-neutral-700 p-4 text-white shadow-sm">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-white/70"><Wallet size={14} /> Auf den Konten</div>
          <div className="mt-2 text-2xl font-bold tabular-nums">{eur(d.konten.gesamt)}</div>
          <div className="mt-2 space-y-0.5 text-[11px] text-white/70">
            {d.konten.liste.map((k) => (
              <div key={k.name} className="flex justify-between gap-2"><span>{k.name}</span><span className="tabular-nums">{eur(k.saldo)}</span></div>
            ))}
          </div>
        </div>
        <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-neutral-500"><CircleDollarSign size={14} /> Umsatz {mName(d.umsatz.monat)} bisher</div>
          <div className="mt-2 text-2xl font-bold tabular-nums text-neutral-900">{eur(monatGesamt)}</div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-neutral-500">
            <span className="inline-flex items-center gap-1"><ShoppingBag size={11} /> Shop {kEur(d.umsatz.shop)}</span>
            <span className="inline-flex items-center gap-1"><Scissors size={11} /> Salon {kEur(d.umsatz.salon)}</span>
          </div>
          {d.umsatz.vorjahrMonatShop !== null && (
            <div className="mt-1 text-[11px] text-neutral-400">Shop {mName(d.umsatz.monat)} Vorjahr gesamt: {kEur(d.umsatz.vorjahrMonatShop)}</div>
          )}
        </div>
        <div className="rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm">
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-neutral-500"><LineChart size={14} /> Umsatz {d.umsatz.monat.slice(0, 4)}</div>
          <div className="mt-2 text-2xl font-bold tabular-nums text-neutral-900">{kEur(jahrGesamt)}</div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-neutral-500">
            <span>Shop {kEur(d.umsatz.jahrShop)}</span>
            <span>Salon {kEur(d.umsatz.jahrSalon)}</span>
          </div>
        </div>
        <Link href="/finances/liquiditaet" className={`rounded-2xl border bg-white p-4 shadow-sm ring-4 ${AMPEL[tiefAmpel].ring} border-neutral-200 hover:border-neutral-300`}>
          <div className="flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-neutral-500"><Landmark size={14} /> Tiefster Kontostand</div>
          <div className={`mt-2 text-2xl font-bold tabular-nums ${AMPEL[tiefAmpel].text}`}>{eur(tief.saldo)}</div>
          <div className="mt-2 text-[11px] text-neutral-500">am {dt(tief.datum)} laut Liquiditätsvorschau · Reserve {kEur(d.liquiditaet.puffer)}</div>
        </Link>
      </div>

      {/* Gesundheits-Check */}
      <Karte titel="Wirtschaftet das Unternehmen gesund?" icon={<HeartPulse size={14} />}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {d.checks.map((c) => (
            <Link key={c.titel} href={c.href} className="group rounded-xl border border-neutral-100 bg-neutral-50/60 p-3 transition hover:border-neutral-200 hover:bg-white">
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-neutral-800">{c.titel}</span>
                <span className={`inline-flex items-center gap-1.5 text-[11px] font-medium ${AMPEL[c.ampel].text}`}>
                  <i className={`inline-block h-2.5 w-2.5 rounded-full ${AMPEL[c.ampel].dot}`} />
                  {AMPEL[c.ampel].label}
                </span>
              </div>
              <div className="mt-1 text-lg font-bold tabular-nums text-neutral-900">{c.wert}</div>
              <div className="mt-0.5 text-[11.5px] leading-snug text-neutral-500">{c.text}</div>
            </Link>
          ))}
        </div>
      </Karte>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Umsatzsteuer */}
        <Karte titel={`Umsatzsteuer ${d.umsatz.monat.slice(0, 4)}`} icon={<Receipt size={14} />} rechts={<Mehr href="/finances/prepayments">Steuern</Mehr>}>
          <div className="grid grid-cols-2 gap-3">
            <div className="rounded-xl bg-neutral-50 p-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-neutral-500">Schon abgerechnet</div>
              <div className="mt-1 text-lg font-bold tabular-nums text-neutral-900">{eur(d.ust.abgerechnet)}</div>
              <div className="text-[11px] text-neutral-400">unterm Strich ans Finanzamt</div>
            </div>
            <div className="rounded-xl bg-amber-50 p-3">
              <div className="text-[11px] font-medium uppercase tracking-wide text-amber-800">Noch offen (grob)</div>
              <div className="mt-1 flex items-baseline gap-2 text-lg font-bold tabular-nums text-neutral-900">{eur(Math.abs(d.ust.offen))} <Richtung wert={d.ust.offen} /></div>
              <div className="text-[11px] text-amber-800/70">aus den Umsätzen gerechnet</div>
            </div>
          </div>
          <div className="mt-3 divide-y divide-neutral-100 text-sm">
            {d.ust.offeneMonate.map((m) => (
              <div key={m.monat} className="flex items-center justify-between gap-2 py-1.5">
                <span className="text-neutral-700">{mName(m.monat)} <span className="text-[11px] text-neutral-400">fällig ca. {dt(m.faellig)}</span></span>
                <span className="flex items-center gap-2 tabular-nums">{eur(Math.abs(m.betrag))} <Richtung wert={m.betrag} /></span>
              </div>
            ))}
          </div>
        </Karte>

        {/* Steuertermine */}
        <Karte titel="Steuertermine (60 Tage)" icon={<CalendarClock size={14} />} rechts={<Mehr href="/finances/liquiditaet">Liquidität</Mehr>}>
          {d.steuerTermine.length === 0 ? (
            <p className="text-sm text-neutral-500">Keine Steuertermine in den nächsten 60 Tagen.</p>
          ) : (
            <div className="divide-y divide-neutral-100 text-sm">
              {d.steuerTermine.map((t, i) => (
                <div key={i} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="flex items-center gap-2">
                    <span className="w-12 shrink-0 tabular-nums text-neutral-500">{dt(t.datum)}</span>
                    <span className="text-neutral-800">{t.label}</span>
                    {t.geschaetzt && <span className="text-[10px] text-neutral-400">≈</span>}
                  </span>
                  <span className={`tabular-nums font-medium ${t.betrag < 0 ? "text-rose-700" : "text-emerald-700"}`}>{t.betrag < 0 ? "−" : "+"}{eur(Math.abs(t.betrag))}</span>
                </div>
              ))}
              <div className="flex items-center justify-between gap-3 pt-2 text-sm font-semibold">
                <span>zusammen</span>
                <span className="tabular-nums">{eur(d.steuerTermine.reduce((s, t) => s + t.betrag, 0))}</span>
              </div>
            </div>
          )}
        </Karte>
      </div>

      {/* Einkommen- und Gewerbesteuer */}
      {d.estGewst && <EstGewstKarte j={d.estGewst} />}

      <div className="grid gap-5 lg:grid-cols-2">
        {/* Fixkosten */}
        <Karte titel="Fixkosten pro Monat" icon={<Banknote size={14} />} rechts={<span className="text-sm font-bold tabular-nums text-neutral-900">{eur(d.fixkosten.summe)}</span>}>
          <div className="space-y-4">
            {gruppen.map((g) => {
              const liste = d.fixkosten.posten.filter((x) => x.gruppe === g.key);
              if (!liste.length) return null;
              return (
                <div key={g.key}>
                  <div className="mb-1.5 flex justify-between text-[11px] font-medium uppercase tracking-wide text-neutral-400">
                    <span>{g.titel}</span>
                    <span className="tabular-nums">{eur(liste.reduce((s, x) => s + x.monat, 0))}</span>
                  </div>
                  <div className="space-y-1.5">
                    {liste.map((x) => (
                      <div key={x.label} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 text-sm">
                        <div className="min-w-0">
                          <div className="truncate text-neutral-700">{x.label}</div>
                          <div className="mt-0.5 h-1.5 rounded-full bg-neutral-100">
                            <div className={`h-1.5 rounded-full ${g.key === "gehalt" ? "bg-violet-400" : "bg-sky-400"}`} style={{ width: `${(x.monat / maxFix) * 100}%` }} />
                          </div>
                        </div>
                        <span className="tabular-nums text-neutral-900">{eur(x.monat)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-3 text-[11px] text-neutral-400">Ø der letzten drei vollen Monate laut Kontoumsätzen. Ohne Ware, Einfuhrabgaben und Steuern (außer Lohnsteuer); Shopify Capital ist abbezahlt und nicht enthalten.</p>
        </Karte>

        {/* Cashflow */}
        <Karte titel="Was am Monatsende übrig bleibt" icon={<FileText size={14} />} rechts={<Mehr href="/finances/overview">Einnahmen & Ausgaben</Mehr>}>
          <div className="h-44">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={d.cashflow} margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
                <XAxis dataKey="monat" tickFormatter={(m: string) => KURZ[Number(m.slice(5)) - 1]} tickLine={false} axisLine={false} fontSize={12} />
                <YAxis tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} tickLine={false} axisLine={false} fontSize={11} width={36} />
                <ReferenceLine y={0} stroke="#d4d4d4" />
                <Tooltip
                  cursor={{ fill: "rgba(0,0,0,0.03)" }}
                  formatter={(v) => eur(Number(v))}
                  labelFormatter={(m) => `${mName(String(m))} ${String(m).slice(0, 4)}`}
                />
                <Bar dataKey="ueberschuss" name="Überschuss" radius={[4, 4, 4, 4]}>
                  {d.cashflow.map((c) => <Cell key={c.monat} fill={c.ueberschuss >= 0 ? "#34d399" : "#fb7185"} />)}
                </Bar>
              </BarChart>
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
                    <td className="py-1 text-neutral-700">{KURZ[Number(c.monat.slice(5)) - 1]}</td>
                    <td className="py-1 text-right text-neutral-900">{kEur(c.einnahmen)}</td>
                    <td className="py-1 text-right text-neutral-500">{kEur(c.ware)}</td>
                    <td className="py-1 text-right text-neutral-500">{kEur(c.steuern)}</td>
                    <td className="py-1 text-right text-neutral-500">{kEur(c.kosten)}</td>
                    <td className={`py-1 text-right font-semibold ${c.ueberschuss >= 0 ? "text-emerald-700" : "text-rose-700"}`}>{c.ueberschuss >= 0 ? "+" : ""}{kEur(c.ueberschuss)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[11px] text-neutral-400">
            Shopify- und Treatwell-Konto; Gehälter, Miete usw. über die Überträge aufs Gehaltskonto. Ware schwankt stark (Black-Friday-Vorrat, Raten). Ohne Kredit-Tilgung und interne Umbuchungen.
          </p>
        </Karte>
      </div>

      {/* Bereiche */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { href: "/finances/overview", t: "Einnahmen & Ausgaben", s: "Monatsrechnung, Gewinn, Steuer" },
          { href: "/finances/liquiditaet", t: "Liquidität", s: "Kontostand der nächsten 90 Tage" },
          { href: "/finances/prepayments", t: "Steuern", s: "Vorauszahlungen, USt je Monat" },
          { href: "/finances/bank", t: "Kontoumsätze", s: "Alle Buchungen mit Kategorien" },
        ].map((x) => (
          <Link key={x.href} href={x.href} className="group rounded-2xl border border-neutral-200 bg-white p-4 shadow-sm transition hover:border-neutral-300">
            <div className="flex items-center justify-between text-sm font-semibold text-neutral-900">{x.t} <ArrowRight size={14} className="text-neutral-400 transition group-hover:translate-x-0.5 group-hover:text-neutral-900" /></div>
            <div className="mt-1 text-xs text-neutral-500">{x.s}</div>
          </Link>
        ))}
      </div>
    </div>
  );
}
