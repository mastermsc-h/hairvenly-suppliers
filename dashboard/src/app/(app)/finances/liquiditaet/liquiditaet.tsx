"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Check, Loader2 } from "lucide-react";
import { Area, CartesianGrid, ComposedChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { KATEGORIE_BY_KEY } from "@/lib/bank/kategorien";
import { LIQ_DEFAULTS, prognose, type LiqEinstellungen, type LiqRohdaten } from "@/lib/liquiditaet/rechnung";
import { AMPEL_STIL } from "../../orders/liquiditaet-badge";
import { saveLiquiditaetEinstellungen } from "@/lib/actions/liquiditaet";

type VerbrauchWerte = { avg12mKg: number; avg3mKg: number; d30Kg: number; avg3mEur: number } | null;
export type Verbrauch = { glatt: VerbrauchWerte; wellig: VerbrauchWerte; stand: string | null };

const MONATE = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const STATUS: Record<string, string> = {
  sent_to_supplier: "An Lieferant", confirmed: "Bestätigt", in_production: "In Produktion",
  ready_to_ship: "Versandbereit", shipped: "Versandt", in_customs: "Verzollung", delivered: "Angekommen",
};

function eur(n: number) {
  return Math.round(n).toLocaleString("de-DE") + " €";
}
function usd(n: number) {
  return "$" + Math.round(n).toLocaleString("de-DE");
}
function deDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y.slice(2)}`;
}
function monatLabel(m: string) {
  const [y, mo] = m.split("-");
  return `${MONATE[Number(mo) - 1]} ${y}`;
}

export default function Liquiditaet({ roh, gespeichert, verbrauch }: { roh: LiqRohdaten; gespeichert: LiqEinstellungen; verbrauch: Verbrauch | null }) {
  const [e, setE] = useState<LiqEinstellungen>(gespeichert);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const p = useMemo(() => prognose(roh, e), [roh, e]);
  const geaendert = JSON.stringify(e) !== JSON.stringify(gespeichert);

  const set = <K extends keyof LiqEinstellungen>(k: K, v: LiqEinstellungen[K]) => {
    setE((prev) => ({ ...prev, [k]: v }));
    setMsg(null);
  };

  async function speichern() {
    setSaving(true);
    const res = await saveLiquiditaetEinstellungen(e);
    setSaving(false);
    setMsg(res.ok ? { ok: true, text: "Gespeichert — gilt jetzt auch für die Ampel an den Bestellungen." } : { ok: false, text: res.error ?? "Fehler" });
  }

  const laufendMonat = (p.laufendProTag * 365) / 12;
  const freiProTag = p.einnahmenProTag + p.laufendProTag;
  const chartData = useMemo(() => {
    const byDay = new Map<string, string[]>();
    for (const ev of p.ereignisse) byDay.set(ev.datum, [...(byDay.get(ev.datum) ?? []), `${ev.betrag < 0 ? "−" : "+"}${eur(Math.abs(ev.betrag))} ${ev.label}`]);
    return p.tage.map((t) => ({ ...t, ev: byDay.get(t.datum) ?? [] }));
  }, [p]);
  // Aktions-Eingänge (ein Eintrag pro Tag) im Terminkalender zu einer Zeile zusammenfassen
  const aktionEv = p.ereignisse.filter((x) => x.art === "aktion");
  const termine = [
    ...p.ereignisse.filter((x) => x.art !== "lieferant" && x.art !== "aktion"),
    ...(aktionEv.length
      ? [{ datum: aktionEv[0].datum, betrag: aktionEv.reduce((s, x) => s + x.betrag, 0), art: "aktion" as const, label: `${e.aktion?.label ?? "Aktion"}: Mehrumsatz-Eingänge bis ${deDate(aktionEv.at(-1)!.datum)}` }]
      : []),
  ].sort((a, b) => a.datum.localeCompare(b.datum));
  const setAktion = (patch: Partial<NonNullable<LiqEinstellungen["aktion"]>>) =>
    e.aktion && set("aktion", { ...e.aktion, ...patch });
  const offenAmanda = p.bestellungen.filter((b) => !b.bezahlt).reduce((s, b) => s + b.betragEur, 0);
  const einfuhrSumme = p.bestellungen.reduce((s, b) => s + (b.einfuhr ? b.einfuhr.eust + b.einfuhr.zoll : 0), 0);

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">Liquidität</h1>
        <p className="text-sm text-neutral-500 mt-1">
          Vorschau {e.horizontTage} Tage ab {deDate(p.start)} · Kontostand Sparkasse aus Monatsabschluss + Buchungen bis {deDate(roh.saldoStand)} ·
          Basis Ø {roh.basis.monate.length ? roh.basis.monate.map(monatLabel).join(", ") : "letzte 30 Tage"}
        </p>
      </div>

      {/* Warnung */}
      {p.tiefpunkt.saldo < e.puffer && (
        <div className={`flex items-start gap-3 rounded-2xl border-2 px-4 py-3 ${p.tiefpunkt.saldo < 0 ? "border-red-300 bg-red-50 text-red-800" : "border-amber-300 bg-amber-50 text-amber-800"}`}>
          <AlertTriangle size={20} className="shrink-0 mt-0.5" />
          <div className="text-sm">
            <div className="font-semibold">
              {p.tiefpunkt.saldo < 0
                ? `Am ${deDate(p.tiefpunkt.datum)} fehlen voraussichtlich ${eur(-p.tiefpunkt.saldo)} auf dem Konto.`
                : `Am ${deDate(p.tiefpunkt.datum)} sinkt das Konto auf ${eur(p.tiefpunkt.saldo)} — unter der Reserve von ${eur(e.puffer)}.`}
            </div>
            <div className="mt-0.5 opacity-90">Ursache sind die Amanda-Zahlungen bei Versandbereitschaft plus Einfuhrabgaben bei Ankunft (Details unten).</div>
          </div>
        </div>
      )}
      {!e.andereLieferantenEinrechnen && p.andereLieferantenProTag < 0 && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <div>
            <b>Ebru/China und andere Lieferanten sind nicht eingerechnet</b> (Ebru-Liste noch nicht gepflegt). Laut Kontoumsätzen gingen an sie Ø{" "}
            {eur((-p.andereLieferantenProTag * 365) / 12)} pro Monat. Mit diesem Durchschnitt läge der Tiefpunkt bei{" "}
            <b>{eur(p.tiefpunktMitAnderen.saldo)} am {deDate(p.tiefpunktMitAnderen.datum)}</b>.{" "}
            <button onClick={() => set("andereLieferantenEinrechnen", true)} className="underline font-medium">Einrechnen</button>
          </div>
        </div>
      )}

      {/* Kennzahlen */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kachel
          label="Kontostand Sparkasse"
          value={eur(roh.startSaldo)}
          sub={roh.konten
            .map((k) => {
              const bank = roh.bankSalden.find((b) => b.iban === k.iban);
              return `…${k.iban.slice(-4)} ${eur(k.saldo)}${bank && Math.abs(bank.saldo - k.saldo) > 1 ? ` (Bank ${eur(bank.saldo)})` : ""}`;
            })
            .join(" · ")}
        />
        <Kachel label="Ø Einnahmen / Tag" value={eur(p.einnahmenProTag)} sub={`${eur((p.einnahmenProTag * 365) / 12)} / Monat`} tone="green" />
        <Kachel label="Ø laufende Abgänge" value={eur(-laufendMonat)} sub="pro Monat (ohne Ware & Steuern)" />
        <Kachel label="Frei pro Tag" value={eur(freiProTag)} sub="vor Lieferanten & Steuern" tone={freiProTag >= 0 ? "green" : "red"} />
        <Kachel label="Tiefpunkt" value={eur(p.tiefpunkt.saldo)} sub={deDate(p.tiefpunkt.datum)} tone={p.tiefpunkt.saldo < 0 ? "red" : p.tiefpunkt.saldo < e.puffer ? "amber" : "green"} />
      </div>
      {roh.bankSalden.filter((b) => b.iban.slice(4, 12) === "30020900").map((b) => (
        <div key={b.iban} className="flex flex-wrap items-baseline justify-between gap-2 rounded-xl border border-neutral-200 bg-white px-4 py-2 text-sm">
          <span className="text-neutral-600">
            Gehaltskonto Targobank …{b.iban.slice(-4)} <span className="text-xs text-neutral-400">(nicht in der Vorschau — Gehälter, Miete, Krankenkassen laufen dort über die Überträge von der Sparkasse)</span>
          </span>
          <span className="font-semibold tabular-nums">{eur(b.saldo)} <span className="text-xs font-normal text-neutral-400">Stand {deDate(b.stand)}</span></span>
        </div>
      ))}

      {/* Verlauf */}
      <Card title="Kontostand-Verlauf (Vorschau)" accent="border-l-blue-500">
        <div style={{ width: "100%", height: 300 }}>
          <ResponsiveContainer>
            <ComposedChart data={chartData} margin={{ top: 8, right: 8, left: 8, bottom: 0 }}>
              <CartesianGrid stroke="#f3f4f6" />
              <XAxis dataKey="datum" tick={{ fontSize: 11, fill: "#737373" }} tickFormatter={(d) => `${String(d).slice(8, 10)}.${String(d).slice(5, 7)}.`} minTickGap={24} />
              <YAxis tick={{ fontSize: 11, fill: "#737373" }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} width={44} />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload as { datum: string; saldo: number; ev: string[] };
                  return (
                    <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs shadow-sm max-w-xs">
                      <div className="font-semibold">{deDate(d.datum)}: {eur(d.saldo)}</div>
                      {d.ev.map((x, i) => <div key={i} className="text-neutral-600">{x}</div>)}
                    </div>
                  );
                }}
              />
              <ReferenceLine y={0} stroke="#dc2626" strokeWidth={1.5} />
              <ReferenceLine y={e.puffer} stroke="#d97706" strokeDasharray="4 4" label={{ value: "Reserve", position: "insideTopRight", fontSize: 10, fill: "#d97706" }} />
              <Area type="stepAfter" dataKey="saldo" stroke="#2563eb" fill="#dbeafe" strokeWidth={2} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <p className="mt-2 text-xs text-neutral-500">
          Täglich: + Ø Einnahmen − Ø laufende Abgänge. Stufen = Lieferantenzahlungen, Einfuhrabgaben und Steuertermine (Maus darüber für Details).
        </p>
      </Card>

      {/* Bestellungen */}
      <Card title={`Amanda-Bestellungen — offen ${eur(offenAmanda)} + Einfuhrabgaben ${eur(einfuhrSumme)}`} accent="border-l-violet-500">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200">
                <Th>Bestellung</Th>
                <Th>Status</Th>
                <Th>Ankunft</Th>
                <Th>Zahlung (versandbereit)</Th>
                <Th right>Betrag</Th>
                <Th right>Konto danach</Th>
                <Th>Ampel</Th>
                <Th>Einfuhrabgaben bei Ankunft</Th>
              </tr>
            </thead>
            <tbody>
              {p.bestellungen.map((b) => (
                <tr key={b.orderId} className="border-b border-neutral-100 align-top">
                  <td className="py-2 pr-2">
                    <Link href={`/orders/${b.orderId}`} className="font-medium text-neutral-900 hover:underline">{b.label}</Link>
                  </td>
                  <td className="py-2 pr-2 text-xs text-neutral-600">{STATUS[b.status] ?? b.status}</td>
                  <td className="py-2 pr-2 tabular-nums text-neutral-600">{b.eta ? deDate(b.eta) : "—"}</td>
                  <td className="py-2 pr-2 tabular-nums">
                    {b.bezahlt ? <span className="text-emerald-700">bezahlt</span> : <>{deDate(b.zahlDatum)}{b.sofort && <span className="ml-1 text-xs font-medium text-red-600">sofort</span>}</>}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums">
                    {b.bezahlt ? "—" : <>{eur(b.betragEur)}<div className="text-xs text-neutral-400">{usd(b.betragUsd)}</div></>}
                  </td>
                  <td className={`py-2 pr-2 text-right tabular-nums font-medium ${b.bezahlt ? "text-neutral-400" : b.saldoNachZahlung < 0 ? "text-red-700" : "text-neutral-900"}`}>
                    {b.bezahlt ? "—" : eur(b.saldoNachZahlung)}
                  </td>
                  <td className="py-2 pr-2">
                    {!b.bezahlt && (
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${AMPEL_STIL[b.ampel].cls}`}>
                        {AMPEL_STIL[b.ampel].text}
                        {b.ampel === "luecke" && ` −${eur(b.fehlbetrag)}`}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-2 text-xs tabular-nums">
                    {b.einfuhr ? (
                      <>
                        {deDate(b.einfuhr.datum)}: {eur(b.einfuhr.eust + b.einfuhr.zoll)}
                        <span className="text-neutral-400"> (EUSt {eur(b.einfuhr.eust)}{b.einfuhr.zoll ? ` + Zoll ${eur(b.einfuhr.zoll)}` : ""})</span>
                        <div className={b.einfuhr.saldoDanach < 0 ? "text-red-700 font-medium" : "text-neutral-500"}>Konto danach {eur(b.einfuhr.saldoDanach)}</div>
                      </>
                    ) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-neutral-500">
          Seit Juni zahlt ihr Amanda komplett, sobald die Ware versandbereit ist (vorher mit Anzahlung). Zahltag hier = Ankunft − {e.zahlungVorAnkunftTage} Tage;
          Status „Versandbereit/Versandt“ ohne Zahlung = sofort. Betrag = offener Rest in USD ÷ {p.fx.toLocaleString("de-DE", { maximumFractionDigits: 4 })} USD/€
          ({p.fxQuelle === "auto" ? `Kurs eurer letzten Auslandsüberweisung${roh.fxAuto ? ` vom ${deDate(roh.fxAuto.datum)}` : ""}` : p.fxQuelle === "manuell" ? "manuell" : "Standard"}).
          Die EUSt holt ihr über die USt-Voranmeldung zurück — das ist unten bei der Umsatzsteuer eingerechnet; der Zoll nicht.
        </p>
      </Card>

      {/* Termine */}
      <Card title="Weitere Termine im Zeitraum" accent="border-l-red-500">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              {termine.map((t, i) => (
                <tr key={i} className="border-b border-neutral-100">
                  <td className="py-1.5 pr-3 tabular-nums text-neutral-600 whitespace-nowrap">{deDate(t.datum)}</td>
                  <td className="py-1.5 pr-3 text-neutral-800">{t.label}{t.sofort && <span className="ml-1 text-xs text-red-600">überfällig</span>}</td>
                  <td className={`py-1.5 text-right tabular-nums font-medium ${t.betrag >= 0 ? "text-emerald-700" : "text-neutral-900"}`}>{t.betrag >= 0 ? "+" : "−"}{eur(Math.abs(t.betrag))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-neutral-500">
          Umsatzsteuer: Ø {eur(p.ustBasis)} pro Monat vor EUSt-Verrechnung (aus {roh.steuern.ustHistorie.map((h) => monatLabel(h.monat)).join(", ") || "Einstellung"}),
          minus die im Monat gezahlte EUSt; mit Dauerfristverlängerung fällig am 10. des übernächsten Monats, Erstattungen ca. 3 Wochen später.
          Lohnsteuer = Ø der letzten Anmeldungen. ESt/GewSt = letzte Vorauszahlung.
        </p>
      </Card>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Einnahmen + laufende Abgänge */}
        <Card title="Einnahmen & laufende Abgänge" accent="border-l-emerald-500">
          <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-1">Einnahmen pro Tag (Konto)</div>
          {roh.basis.monatsWerte.map((m) => (
            <div key={m.monat} className="flex justify-between text-sm py-0.5">
              <span className="text-neutral-700">{monatLabel(m.monat)}{m.monat === roh.heute.slice(0, 7) && <span className="text-xs text-neutral-400"> (bis {deDate(roh.saldoStand)})</span>}</span>
              <span className="tabular-nums">{eur(m.einnahmen / m.tage)} <span className="text-xs text-neutral-400">· {eur(m.einnahmen)}</span></span>
            </div>
          ))}
          <div className="flex items-baseline justify-between mt-4 mb-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Laufende Abgänge Ø pro Monat</span>
            <span className="text-[10px] text-neutral-400">fällt weg</span>
          </div>
          {roh.basis.laufend.map((l) => {
            const weg = e.ausgeblendeteKategorien.includes(l.kategorie);
            return (
              <label key={l.kategorie} className="flex items-center justify-between gap-2 text-sm py-0.5 cursor-pointer">
                <span className={weg ? "text-neutral-400 line-through" : "text-neutral-700"}>{KATEGORIE_BY_KEY[l.kategorie]?.label ?? l.kategorie}</span>
                <span className="flex items-center gap-2">
                  <span className={`tabular-nums ${weg ? "text-neutral-400 line-through" : ""}`}>{eur((-l.summe / roh.basis.tage) * (365 / 12))}</span>
                  <input
                    type="checkbox"
                    checked={weg}
                    onChange={(ev) =>
                      set(
                        "ausgeblendeteKategorien",
                        ev.target.checked ? [...e.ausgeblendeteKategorien, l.kategorie] : e.ausgeblendeteKategorien.filter((k) => k !== l.kategorie)
                      )
                    }
                    className="h-3.5 w-3.5 rounded border-neutral-300"
                    title="Fällt ab jetzt weg (z.B. Kredit abbezahlt) — wird nicht mehr eingerechnet"
                  />
                </span>
              </label>
            );
          })}
          <p className="mt-3 text-xs text-neutral-500">
            Aus den <Link href="/finances/bank" className="underline">Kontoumsätzen</Link> (Sparkasse). Der Übertrag aufs Targobank-Gehaltskonto deckt Gehälter, Miete,
            Krankenkassen und Versicherungen ab. Wareneinkauf und Steuern laufen oben einzeln.
          </p>
        </Card>

        {/* Verbrauch */}
        <Card title="Verbrauch & Bestellrhythmus" accent="border-l-neutral-400">
          {verbrauch?.glatt ? (
            <>
              <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-1">Russisch glatt (Amanda) — Verkauf laut Shopify</div>
              <Zeile l="Ø letzte 3 Monate" r={`${verbrauch.glatt.avg3mKg.toLocaleString("de-DE", { maximumFractionDigits: 1 })} kg / Monat`} />
              <Zeile l="Ø letzte 12 Monate" r={`${verbrauch.glatt.avg12mKg.toLocaleString("de-DE", { maximumFractionDigits: 1 })} kg / Monat`} />
              <Zeile l="Letzte 30 Tage" r={`${verbrauch.glatt.d30Kg.toLocaleString("de-DE", { maximumFractionDigits: 1 })} kg`} />
            </>
          ) : (
            <p className="text-sm text-neutral-400">Verkaufsanalyse (Stock-Sheet) gerade nicht erreichbar.</p>
          )}
          {verbrauch?.wellig && (
            <>
              <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mt-3 mb-1">Usbekisch wellig (Ebru) — Verkauf laut Shopify</div>
              <Zeile l="Ø letzte 3 Monate" r={`${verbrauch.wellig.avg3mKg.toLocaleString("de-DE", { maximumFractionDigits: 1 })} kg / Monat`} />
            </>
          )}
          <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mt-3 mb-1">Amanda-Bestellungen</div>
          <Zeile l="Bestellt Ø letzte 3 Monate (inkl. Black-Friday-Vorrat)" r={`${roh.nachbestellung.kgProMonatAuto.toLocaleString("de-DE")} kg / Monat`} />
          <Zeile l="Für Nachbestellungen gerechnet" r={`${p.nachbestellKgMonat.toLocaleString("de-DE", { maximumFractionDigits: 1 })} kg / Monat${e.nachbestellKgMonat ? " (manuell)" : roh.nachbestellung.kgVerbrauchMonat ? " (= Verbrauch)" : ""}`} />
          <Zeile l="Ø Einkaufspreis" r={`${usd(roh.nachbestellung.usdProKgAuto)} / kg`} />
          <Zeile l="Lieferzeit" r={`${roh.nachbestellung.leadWochen} Wochen`} />
          {verbrauch?.stand && <p className="mt-2 text-xs text-neutral-400">Verkaufsanalyse: {verbrauch.stand}</p>}
        </Card>
      </div>

      {/* Verkaufsaktion */}
      {e.aktion && (
        <Card title={`${e.aktion.label} ${deDate(e.aktion.von)}–${deDate(e.aktion.bis)}`} accent="border-l-emerald-500">
          <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-4">
            <div className="pt-5">
              <Schalter label="Mehrumsatz einrechnen" checked={e.aktion.aktiv} onChange={(v) => setAktion({ aktiv: v })} />
            </div>
            <Feld label="Mehrumsatz gesamt brutto (€)" value={e.aktion.mehrumsatzBrutto} onChange={(v) => setAktion({ mehrumsatzBrutto: v ?? 0 })} />
            <Feld label="Tage bis Geld auf dem Konto" value={e.aktion.verzugTage} onChange={(v) => setAktion({ verzugTage: v ?? 0 })} />
            <Feld label="Ankommender Anteil nach Gebühren (%)" value={e.aktion.auszahlungProzent} step={0.5} onChange={(v) => setAktion({ auszahlungProzent: v ?? 100 })} />
          </div>
          <p className="mt-3 text-xs text-neutral-500">
            {e.aktion.quelle}. Verteilt nach dem Tagesverlauf des Vorjahres (Spitzen rund um Black Friday). Eingang auf dem Konto {e.aktion.verzugTage} Tage
            später (Stripe/PayPal-Auszahlung), abzüglich Gebühren. Die Umsatzsteuer auf den Mehrumsatz ({eur((e.aktion.mehrumsatzBrutto * 19) / 119)}) ist in der
            USt-Voranmeldung des Aktionsmonats eingerechnet.
          </p>
        </Card>
      )}

      {/* Einstellungen */}
      <Card title="Annahmen (anpassbar)" accent="border-l-neutral-400">
        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4">
          <Feld label="Zahlung an Amanda (Tage vor Ankunft)" value={e.zahlungVorAnkunftTage} onChange={(v) => set("zahlungVorAnkunftTage", v ?? LIQ_DEFAULTS.zahlungVorAnkunftTage)} />
          <Feld label="Reserve / Puffer (€)" value={e.puffer} onChange={(v) => set("puffer", v ?? 0)} />
          <Feld label="Vorschau (Tage)" value={e.horizontTage} onChange={(v) => set("horizontTage", Math.max(14, Math.min(365, v ?? 90)))} />
          <Feld label={`Wechselkurs USD/€ (leer = aus Bank: ${roh.fxAuto?.kurs ?? "—"})`} value={e.fxUsdProEur} step={0.0001} optional onChange={(v) => set("fxUsdProEur", v)} />
          <Feld label="EUSt-Satz (%)" value={e.eustSatz} step={0.1} onChange={(v) => set("eustSatz", v ?? 19)} />
          <Feld label="Zollsatz (%) — Extensions 2,2" value={e.zollSatz} step={0.1} onChange={(v) => set("zollSatz", v ?? 0)} />
          <Feld label="Fracht-Aufschlag auf Zollwert (%)" value={e.frachtProzent} step={0.5} onChange={(v) => set("frachtProzent", v ?? 0)} />
          <Feld label={`USt pro Monat vor EUSt (leer = Ø ${eur(p.ustBasis)})`} value={e.ustBasisMonat} optional onChange={(v) => set("ustBasisMonat", v)} />
          <div className="space-y-2 pt-5">
            <Schalter label="Ebru/andere Lieferanten (Ø aus Bank)" checked={e.andereLieferantenEinrechnen} onChange={(v) => set("andereLieferantenEinrechnen", v)} />
            <Schalter label="Künftige Amanda-Nachbestellungen (Schätzung)" checked={e.nachbestellungenEinrechnen} onChange={(v) => set("nachbestellungenEinrechnen", v)} />
          </div>
          {e.nachbestellungenEinrechnen && (
            <>
              <Feld
                label={`Nachbestellung kg/Monat (leer = ${roh.nachbestellung.kgVerbrauchMonat != null ? `Verbrauch ${roh.nachbestellung.kgVerbrauchMonat}` : `Ø Bestellungen ${roh.nachbestellung.kgProMonatAuto}`})`}
                value={e.nachbestellKgMonat}
                optional
                onChange={(v) => set("nachbestellKgMonat", v)}
              />
              <Feld label={`USD pro kg (leer = ${roh.nachbestellung.usdProKgAuto})`} value={e.usdProKg} optional onChange={(v) => set("usdProKg", v)} />
            </>
          )}
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={speichern}
            disabled={saving || !geaendert}
            className="flex items-center gap-1.5 bg-neutral-900 text-white font-medium rounded-lg px-4 py-2 text-sm disabled:opacity-40"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : msg?.ok ? <Check size={14} /> : null}
            Speichern
          </button>
          <button onClick={() => setE({ ...LIQ_DEFAULTS, aktion: e.aktion })} className="text-sm text-neutral-500 hover:text-neutral-900">Standardwerte</button>
          {geaendert && !saving && <span className="text-xs text-amber-700">Vorschau zeigt ungespeicherte Annahmen</span>}
          {msg && <span className={`text-xs ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.text}</span>}
        </div>
        {p.hinweise.length > 0 && (
          <ul className="mt-3 list-disc pl-5 text-xs text-amber-700">{p.hinweise.map((h, i) => <li key={i}>{h}</li>)}</ul>
        )}
      </Card>
    </div>
  );
}

function Zeile({ l, r }: { l: string; r: string }) {
  return (
    <div className="flex justify-between text-sm py-0.5">
      <span className="text-neutral-700">{l}</span>
      <span className="tabular-nums">{r}</span>
    </div>
  );
}

function Feld({ label, value, onChange, step = 1, optional }: { label: string; value: number | null; onChange: (v: number | null) => void; step?: number; optional?: boolean }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-neutral-600">{label}</span>
      <input
        type="number"
        step={step}
        value={value ?? ""}
        placeholder={optional ? "automatisch" : undefined}
        onChange={(ev) => {
          const raw = ev.target.value.replace(",", ".");
          onChange(raw === "" ? null : Number(raw));
        }}
        className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900 focus:outline-none"
      />
    </label>
  );
}

function Schalter({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-neutral-700 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(ev) => onChange(ev.target.checked)} className="h-4 w-4 rounded border-neutral-300" />
      {label}
    </label>
  );
}

function Kachel({ label, value, sub, tone = "neutral" }: { label: string; value: string; sub?: string; tone?: "green" | "red" | "amber" | "neutral" }) {
  const color = { green: "text-emerald-700", red: "text-red-700", amber: "text-amber-700", neutral: "text-neutral-900" }[tone];
  return (
    <div className="bg-neutral-50 rounded-xl p-3 text-center">
      <div className="text-xs font-medium text-neutral-500 uppercase tracking-wide">{label}</div>
      <div className={`text-lg font-bold mt-1 tabular-nums ${color}`}>{value}</div>
      {sub && <div className="text-[11px] text-neutral-400 mt-0.5 leading-tight">{sub}</div>}
    </div>
  );
}

function Card({ title, accent, children }: { title: string; accent: string; children: React.ReactNode }) {
  return (
    <div className={`bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden border-l-4 ${accent}`}>
      <div className="px-4 md:px-6 py-3 bg-neutral-50 border-b border-neutral-200">
        <h2 className="text-sm font-semibold text-neutral-900 uppercase tracking-wide">{title}</h2>
      </div>
      <div className="px-4 md:px-6 py-4">{children}</div>
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th className={`py-2 pr-2 text-xs font-medium text-neutral-500 uppercase tracking-wide ${right ? "text-right" : "text-left"}`}>{children}</th>;
}
