"use client";

import { Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { UstMonat } from "@/lib/steuer/ust-monate";

const MONATE = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const eur = (n: number) => n.toLocaleString("de-DE", { maximumFractionDigits: 0 }) + " €";
const kurz = (n: number) => (Math.abs(n) >= 1000 ? `${(n / 1000).toLocaleString("de-DE", { maximumFractionDigits: 0 })}k` : String(Math.round(n)));
const mName = (m: string) => MONATE[Number(m.slice(5)) - 1];

const QUELLE: Record<NonNullable<UstMonat["quelle"]>, string> = {
  konto: "laut Konto",
  eingetragen: "eingetragen",
  schaetzung: "Schätzung",
};

/**
 * Abweichung in Worten: was das Finanzamt im Vergleich zu unserer Rechnung festgesetzt hat.
 * Werte: > 0 = Zahlung ans Finanzamt, < 0 = Erstattung.
 */
function abweichungText(finanzamt: number, berechnet: number): string {
  if (finanzamt > berechnet) {
    if (berechnet < 0 && finanzamt <= 0) return "weniger Erstattung als berechnet";
    if (berechnet >= 0) return "mehr zu zahlen als berechnet";
    return "Zahlung statt berechneter Erstattung";
  }
  if (berechnet > 0 && finanzamt >= 0) return "weniger zu zahlen als berechnet";
  if (berechnet <= 0) return "mehr Erstattung als berechnet";
  return "Erstattung statt berechneter Zahlung";
}

function Ergebnis({ wert, klein = false }: { wert: number; klein?: boolean }) {
  const zahlung = wert >= 0;
  return (
    <span className={`inline-flex items-baseline gap-1.5 tabular-nums ${klein ? "" : "font-semibold"} ${zahlung ? "text-rose-700" : "text-emerald-700"}`}>
      {eur(Math.abs(wert))}
      <span className={`rounded-full px-1.5 py-px text-[10px] font-medium ${zahlung ? "bg-rose-50 text-rose-700" : "bg-emerald-50 text-emerald-700"}`}>
        {zahlung ? "Zahlung" : "Erstattung"}
      </span>
    </span>
  );
}

function Tipp({ active, payload }: { active?: boolean; payload?: Array<{ payload?: UstMonat }> }) {
  const m = payload?.[0]?.payload;
  if (!active || !m) return null;
  return (
    <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs shadow-sm">
      <div className="mb-1 font-semibold text-neutral-900">{mName(m.monat)} {m.monat.slice(0, 4)}{m.laufend ? " (läuft)" : ""}</div>
      <div className="text-neutral-600">Umsätze {eur(m.shopDe + m.salon + m.shopEu + m.shopDritt)}</div>
      <div className="text-rose-700">USt {eur(m.ust)}</div>
      <div className="text-emerald-700">− Vorsteuer {eur(m.vorsteuer)} − EUSt {eur(m.eust)}</div>
      <div className="mt-1 text-neutral-900">berechnet: {m.berechnet >= 0 ? "Zahlung" : "Erstattung"} {eur(Math.abs(m.berechnet))}</div>
      {m.finanzamt !== null && (
        <div className="font-medium text-neutral-900">
          Finanzamt: {m.finanzamt >= 0 ? "Zahlung" : "Erstattung"} {eur(Math.abs(m.finanzamt))} ({QUELLE[m.quelle ?? "eingetragen"]})
        </div>
      )}
    </div>
  );
}

/** Umsätze, abzuführende USt und abziehbare Vorsteuer/EUSt je Monat — mit Abgleich gegen das Finanzamt. */
export default function UstMonate({ jahr, monate }: { jahr: number; monate: UstMonat[] }) {
  if (!monate.length) return null;
  const chart = monate.map((m) => ({ ...m, abziehbarV: -m.vorsteuer, abziehbarE: -m.eust }));
  const mitFa = monate.filter((m) => m.finanzamt !== null && m.quelle !== "schaetzung" && !m.laufend);
  const summe = (f: (m: UstMonat) => number, liste = monate) => liste.reduce((s, m) => s + f(m), 0);
  const umsatz = (m: UstMonat) => m.shopDe + m.salon + m.shopEu + m.shopDritt;
  // Abgerechnet = Finanzamt-Wert steht fest; offen = noch keine Abrechnung (Schätzung im Ledger zählt als offen)
  const abgerechnet = monate.filter((m) => m.finanzamt !== null && m.quelle !== "schaetzung");
  const offen = monate.filter((m) => !(m.finanzamt !== null && m.quelle !== "schaetzung"));
  const gezahlt = summe((m) => Math.max(0, m.finanzamt ?? 0), abgerechnet);
  const erstattet = summe((m) => Math.max(0, -(m.finanzamt ?? 0)), abgerechnet);
  // Monate, die ohne Salon gemeldet wurden: die USt auf den Salon fehlt beim Finanzamt → offene Nachzahlung
  const luecke = monate.filter((m) => m.salonFehlt && !m.salonNachgemeldet);
  const lueckeUst = summe((m) => m.salonUst, luecke);
  const lueckeUmsatz = summe((m) => m.salon, luecke);
  const lueckeVon = luecke.length ? `${mName(luecke[0].monat)}–${mName(luecke[luecke.length - 1].monat)}` : "";
  const offenSumme = summe((m) => m.berechnet, offen) + lueckeUst;
  // Mit Dauerfristverlängerung fällig am 10. des übernächsten Monats
  const faellig = (m: string) => {
    const [y, mo] = m.split("-").map(Number);
    const d = new Date(Date.UTC(y, mo + 1, 10));
    return `${String(d.getUTCDate()).padStart(2, "0")}.${String(d.getUTCMonth() + 1).padStart(2, "0")}.`;
  };
  // Wie weit lag die Rechnung bisher daneben (über alle abgerechneten Monate)
  // (Monate ohne Salon gegen die Rechnung ohne Salon, sonst zählt die Meldelücke als Rechenfehler)
  const vergleich = (m: UstMonat) => m.berechnet - (m.salonFehlt ? m.salonUst : 0);
  const abweichungSchnitt = abgerechnet.length ? summe((m) => (m.finanzamt ?? 0) - vergleich(m), abgerechnet) / abgerechnet.length : 0;

  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-900">Umsatzsteuer je Monat {jahr}</h2>
        <span className="text-xs text-neutral-500">
          {mitFa.length > 0 && (
            <>
              {mName(mitFa[0].monat)}–{mName(mitFa[mitFa.length - 1].monat)}: Finanzamt {eur(summe((m) => m.finanzamt ?? 0, mitFa))} · berechnet {eur(summe((m) => m.berechnet, mitFa))}
            </>
          )}
        </span>
      </div>

      {luecke.length > 0 && (
        <div className="mt-4 rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900">
          <div className="font-semibold">
            Salon-Umsätze {lueckeVon} nicht ans Finanzamt gemeldet — {eur(lueckeUst)} Umsatzsteuer nachzuzahlen
          </div>
          <p className="mt-1 text-[13px] leading-snug">
            Die Voranmeldungen {luecke.map((m) => mName(m.monat)).join(", ")} enthalten nur die Shop-Umsätze (Kz. 81 = Shop Deutschland netto). Die Eingänge
            auf dem Treatwell-Konto ({eur(lueckeUmsatz)} brutto, Karte/Nexi, Treatwell, Bar) fehlen. Der Steuerberater muss berichtigte Voranmeldungen
            abgeben; die Nachzahlung steht unten bei „Noch offen“ und in der Liquiditätsvorschau. Dieselben Umsätze fehlen auch in seiner
            Buchhaltung für Einkommen- und Gewerbesteuer ({eur(lueckeUmsatz / 1.19)} netto).
          </p>
        </div>
      )}

      {/* Kacheln: Jahr bis jetzt */}
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        {[
          { l: "Umsätze brutto", w: summe(umsatz), cls: "text-neutral-900", sub: `Shop ${kurz(summe((m) => m.shopDe + m.shopEu + m.shopDritt))} · Salon ${kurz(summe((m) => m.salon))}` },
          { l: "USt abzuführen", w: summe((m) => m.ust), cls: "text-rose-700", sub: "19 % auf Shop Deutschland + Salon" },
          { l: "Vorsteuer + EUSt", w: summe((m) => m.vorsteuer + m.eust), cls: "text-emerald-700", sub: `EUSt ${kurz(summe((m) => m.eust))} · Inland ${kurz(summe((m) => m.vorsteuer))}` },
          { l: offenSumme >= 0 ? "Noch zu zahlen (grob)" : "Kommt noch zurück (grob)", w: Math.abs(offenSumme), cls: offenSumme >= 0 ? "text-rose-700" : "text-emerald-700", sub: `${offen.length} Monat${offen.length === 1 ? "" : "e"} offen${lueckeUst > 0 ? " + Salon-Nachmeldung" : ""} · ${abgerechnet.length} abgerechnet` },
        ].map((k) => (
          <div key={k.l} className="rounded-xl bg-neutral-50 p-3 text-center">
            <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">{k.l}</div>
            <div className={`mt-1 text-lg font-bold tabular-nums ${k.cls}`}>{eur(k.w)}</div>
            <div className="mt-0.5 text-[11px] leading-tight text-neutral-400">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Stand: was schon abgerechnet ist, was laut Umsätzen noch kommt */}
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-neutral-200 p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-neutral-500">
            Schon abgerechnet{abgerechnet.length ? ` · ${mName(abgerechnet[0].monat)}–${mName(abgerechnet[abgerechnet.length - 1].monat)}` : ""}
          </div>
          <div className="mt-2 space-y-1 text-sm">
            <div className="flex justify-between"><span className="text-neutral-600">gezahlt</span><span className="tabular-nums text-rose-700">{eur(gezahlt)}</span></div>
            <div className="flex justify-between"><span className="text-neutral-600">zurückbekommen</span><span className="tabular-nums text-emerald-700">{eur(erstattet)}</span></div>
            <div className="flex justify-between border-t border-neutral-100 pt-1 font-semibold">
              <span>unterm Strich</span>
              <Ergebnis wert={gezahlt - erstattet} />
            </div>
          </div>
        </div>
        <div className="rounded-xl border border-amber-200 bg-amber-50/50 p-4">
          <div className="text-xs font-medium uppercase tracking-wide text-amber-800">Noch offen · grob aus den Umsätzen gerechnet</div>
          <div className="mt-2 space-y-1 text-sm">
            {lueckeUst > 0 && (
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-neutral-700">
                  Salon {lueckeVon} nachmelden
                  <span className="ml-1.5 text-[11px] text-neutral-400">nicht in den Voranmeldungen</span>
                </span>
                <Ergebnis wert={lueckeUst} klein />
              </div>
            )}
            {offen.map((m) => (
              <div key={m.monat} className="flex items-baseline justify-between gap-2">
                <span className="text-neutral-700">
                  {mName(m.monat)}
                  {m.laufend ? " (bis heute)" : ""}
                  <span className="ml-1.5 text-[11px] text-neutral-400">fällig ca. {faellig(m.monat)}</span>
                </span>
                <span className="text-right">
                  <Ergebnis wert={m.berechnet} klein />
                  {m.quelle === "schaetzung" && m.finanzamt !== null && (
                    <span className="block text-[10.5px] text-neutral-400">im Ledger geschätzt: {m.finanzamt >= 0 ? "Zahlung" : "Erstattung"} {eur(Math.abs(m.finanzamt))}</span>
                  )}
                </span>
              </div>
            ))}
            <div className="flex justify-between border-t border-amber-200 pt-1 font-semibold">
              <span>zusammen</span>
              <Ergebnis wert={offenSumme} />
            </div>
          </div>
          <p className="mt-2 text-[11px] leading-snug text-amber-800/80">
            Grobe Orientierung: Bisher lag die Rechnung im Schnitt {eur(Math.abs(abweichungSchnitt))} pro Monat {abweichungSchnitt < 0 ? "über" : "unter"} dem
            Finanzamt, einzelne Monate deutlich mehr (Einfuhrumsatzsteuer). Der laufende Monat zählt nur bis heute.
          </p>
        </div>
      </div>

      {/* Diagramm: USt nach oben, Abziehbares nach unten, Punkte = Finanzamt */}
      <div className="mt-4 h-56">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chart} stackOffset="sign" margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid vertical={false} stroke="#f0f0f0" />
            <XAxis dataKey="monat" tickFormatter={mName} tickLine={false} axisLine={false} fontSize={12} />
            <YAxis tickFormatter={kurz} tickLine={false} axisLine={false} fontSize={11} width={40} />
            <ReferenceLine y={0} stroke="#d4d4d4" />
            <Tooltip content={<Tipp />} cursor={{ fill: "rgba(0,0,0,0.03)" }} />
            <Bar dataKey="ust" stackId="u" fill="#fda4af" radius={[4, 4, 0, 0]} name="USt" />
            <Bar dataKey="abziehbarV" stackId="u" fill="#86efac" name="Vorsteuer" />
            <Bar dataKey="abziehbarE" stackId="u" fill="#22c55e" radius={[0, 0, 4, 4]} name="EUSt" />
            <Line dataKey="berechnet" stroke="#737373" strokeDasharray="4 3" dot={{ r: 2.5 }} name="berechnet" isAnimationActive={false} />
            <Line dataKey="finanzamt" stroke="#171717" strokeWidth={0} dot={{ r: 4.5, fill: "#171717" }} connectNulls={false} name="Finanzamt" isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-neutral-500">
        <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-rose-300" /> USt auf Umsätze</span>
        <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-green-300" /> Vorsteuer Inland</span>
        <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-sm bg-green-500" /> Einfuhrumsatzsteuer</span>
        <span className="inline-flex items-center gap-1.5"><i className="inline-block h-0 w-4 border-t-2 border-dashed border-neutral-500" /> berechnet</span>
        <span className="inline-flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-full bg-neutral-900" /> Finanzamt</span>
      </div>

      {/* Tabelle */}
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-left text-xs uppercase tracking-wide text-neutral-500">
              <th className="py-2 pr-3 font-medium">Monat</th>
              <th className="py-2 pr-3 text-right font-medium">Umsätze brutto</th>
              <th className="py-2 pr-3 text-right font-medium">USt 19 %</th>
              <th className="py-2 pr-3 text-right font-medium">− Vorsteuer</th>
              <th className="py-2 pr-3 text-right font-medium">− EUSt</th>
              <th className="py-2 pr-3 text-right font-medium">= berechnet</th>
              <th className="py-2 pr-3 text-right font-medium">Finanzamt</th>
              <th className="py-2 text-right font-medium" title="Unterschied zwischen dem Betrag des Finanzamts und unserer Rechnung, darunter in Worten">Abweichung</th>
            </tr>
          </thead>
          <tbody>
            {[...monate].reverse().map((m) => {
              const diff = m.finanzamt !== null && m.quelle !== "schaetzung" ? m.finanzamt - m.berechnet : null;
              return (
                <tr key={m.monat} className={`border-b border-neutral-100 align-top ${m.laufend ? "bg-neutral-50/60" : ""}`}>
                  <td className="py-2 pr-3 font-medium text-neutral-900">
                    {mName(m.monat)}
                    {m.laufend && <span className="ml-1.5 text-[10px] font-normal text-neutral-400">läuft</span>}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-neutral-900">
                    {eur(umsatz(m))}
                    <div className="text-[10.5px] text-neutral-400">
                      Shop {kurz(m.shopDe)} · Salon {kurz(m.salon)}{m.shopEu ? ` · EU ${kurz(m.shopEu)}` : ""}{m.shopDritt ? ` · Ausland ${kurz(m.shopDritt)}` : ""}
                    </div>
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums text-rose-700">{eur(m.ust)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-emerald-700">{eur(m.vorsteuer)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-emerald-700">{eur(m.eust)}</td>
                  <td className="py-2 pr-3 text-right">
                    <span className="inline-block rounded-lg bg-neutral-100 px-2.5 py-1 ring-1 ring-neutral-200/70">
                      <Ergebnis wert={m.berechnet} />
                    </span>
                  </td>
                  <td className="py-2 pr-3 text-right">
                    {m.finanzamt !== null ? (
                      <>
                        <Ergebnis wert={m.finanzamt} />
                        <div className="text-[10.5px] text-neutral-400">{QUELLE[m.quelle ?? "eingetragen"]}</div>
                        {m.salonFehlt && (
                          <div className={`text-[10.5px] font-medium ${m.salonNachgemeldet ? "text-neutral-500" : "text-rose-700"}`}>
                            {m.salonNachgemeldet ? "Salon nachgemeldet" : `ohne Salon gemeldet · ${eur(m.salonUst)} fehlen`}
                          </div>
                        )}
                      </>
                    ) : (
                      <span className="text-xs text-neutral-400">noch offen</span>
                    )}
                  </td>
                  <td className={`py-2 text-right tabular-nums text-xs ${diff === null ? "text-neutral-300" : Math.abs(diff) > 5000 ? "font-medium text-amber-700" : "text-neutral-500"}`}>
                    {diff === null ? "—" : eur(Math.abs(diff))}
                    {diff !== null && Math.abs(diff) >= 1 && m.finanzamt !== null && (
                      <div className="text-[10.5px] font-normal text-neutral-500 leading-tight">{abweichungText(m.finanzamt, m.berechnet)}</div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 space-y-1 text-xs text-neutral-500">
        <p>
          <b>Umsätze:</b> Shop = Shopify-Bestellungen nach Bestellmonat (nach Erstattungen, ohne Stornos), Salon = Eingänge auf dem Treatwell-Konto (Karte, Treatwell,
          Bareinzahlungen). Verkäufe ins EU-Ausland laufen über OSS mit ausländischer USt und zählen hier nicht zur deutschen USt.
        </p>
        <p>
          <b>Abziehbar:</b> Vorsteuer aus Inlandsrechnungen (Versand, Material, Büro, Steuerberater, Telefon, Strom, Miete) ist aus den Kontoumsätzen geschätzt.
          EUSt = Abbuchungen von DHL und Ungewitter ohne Zollanteil — im Monat der <i>Abbuchung</i>. Das Finanzamt rechnet die EUSt dagegen im Monat der{" "}
          <i>Einfuhr</i>; deshalb schwanken einzelne Monate stark (z.B. September: gerechnet Zahlung, tatsächlich Erstattung). Über mehrere Monate gleicht sich
          das aus. Maßgeblich ist immer die Spalte „Finanzamt“.
        </p>
        <p>
          <b>Abweichung:</b> Unterschied zwischen Finanzamt und unserer Rechnung, darunter in Worten (z.B. „weniger Erstattung als berechnet“). Sie zeigt, wie weit die Schätzung daneben lag — nicht, dass zu viel oder zu wenig gezahlt
          wurde. Gezahlt wurde immer der Betrag aus der Voranmeldung des Steuerberaters. Große Ausschläge in Nachbarmonaten mit umgekehrtem Vorzeichen
          (z.B. April −17k, Mai +29k) sind meist Einfuhrumsatzsteuer, die in einem anderen Monat abgebucht als angerechnet wurde. In Monaten, die ohne
          Salon gemeldet wurden, steckt die fehlende Salon-USt in der Abweichung.
        </p>
      </div>
    </div>
  );
}
