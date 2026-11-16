"use client";

// Steuerkasse: Was geht wann ans Finanzamt, und was bleibt danach auf dem Konto?
// Oben ein „Konto-Streifen“ (heutiger Kontostand, davon für Steuern gebunden), darunter die
// Termine als Abreißkalender-Blätter mit Countdown und Kontostand vorher → nachher.
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { SteuerArt, SteuerKasseDaten } from "@/lib/cockpit/typen";
import { Zahl, eur, kurzEur } from "./bausteine";

const ART: Record<SteuerArt, { name: string; farbe: string }> = {
  ust: { name: "Umsatzsteuer", farbe: "#7c5cff" },
  lst: { name: "Lohnsteuer", farbe: "#0ea5e9" },
  est: { name: "Einkommensteuer", farbe: "#f59e0b" },
  gewst: { name: "Gewerbesteuer", farbe: "#ec4899" },
};
const MON = ["Jan", "Feb", "März", "April", "Mai", "Juni", "Juli", "Aug", "Sep", "Okt", "Nov", "Dez"];
const WT = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"];

function countdown(t: SteuerKasseDaten["termine"][number]) {
  if (t.ueberfaellig) return "überfällig";
  if (t.tageBis === 0) return "heute";
  if (t.tageBis === 1) return "morgen";
  return `in ${t.tageBis} Tagen`;
}

export default function SteuerKasseWidget({ d }: { d: SteuerKasseDaten }) {
  if (!d.termine.length) {
    return <div className="sk-leer">In den nächsten {d.tageHorizont} Tagen ist keine Zahlung ans Finanzamt geplant.</div>;
  }
  const naechster = d.termine.find((t) => t.summe > 0) ?? d.termine[0];
  const frei = d.konto - d.zahlungen;
  const skala = Math.max(d.konto, d.zahlungen, 1);
  const zuWenig = d.zahlungen > d.konto;
  return (
    <div className="sk">
      <div className="sk-kopf">
        <div>
          <div className="ck-etikett">Ans Finanzamt · nächste {d.tageHorizont} Tage</div>
          <div className="sk-gross"><Zahl wert={d.zahlungen} format="eur" /></div>
          {d.erstattungen > 0 && <div className="sk-erst">+ {eur(d.erstattungen)} Erstattung erwartet</div>}
        </div>
        <div className="sk-naechst" data-ampel={naechster.ueberfaellig ? "alarm" : naechster.tageBis <= 7 ? "warn" : "ok"}>
          <div className="ck-etikett">Nächster Termin</div>
          <div className="sk-naechst-zahl">{eur(naechster.summe)}</div>
          <div className="sk-naechst-wann">{Number(naechster.datum.slice(8, 10))}. {MON[Number(naechster.datum.slice(5, 7)) - 1]} · {countdown(naechster)}</div>
        </div>
      </div>

      {/* Konto-Streifen: wie viel vom heutigen Kontostand für Steuern gebunden ist */}
      <div className="sk-streifen-rahmen">
        <div className="sk-streifen-text">
          <span>Konto heute <b>{eur(d.konto)}</b></span>
          <span className={zuWenig ? "sk-rot" : "sk-gruen"}>{zuWenig ? `Es fehlen ${eur(-frei)} für alle Steuern` : <>Heute minus alle Steuern <b>{eur(frei)}</b></>}</span>
        </div>
        <div className="sk-streifen" role="img" aria-label={`Konto ${eur(d.konto)}, davon Steuern ${eur(d.zahlungen)}`}>
          {d.jeArt.map((a, i) => (
            <span key={a.art} className="sk-teil" style={{ width: `${(a.betrag / skala) * 100}%`, background: ART[a.art].farbe, animationDelay: `${i * 0.12}s` }} title={`${ART[a.art].name}: ${eur(a.betrag)}`} />
          ))}
          {!zuWenig && <span className="sk-teil sk-frei" style={{ width: `${(frei / skala) * 100}%` }} title={`Frei: ${eur(frei)}`} />}
          {zuWenig && <span className="sk-kontolinie" style={{ left: `${(d.konto / skala) * 100}%` }} />}
        </div>
        <div className="sk-legende">
          {d.jeArt.map((a) => (
            <span key={a.art}><i style={{ background: ART[a.art].farbe }} />{ART[a.art].name} <b>{kurzEur(a.betrag)}</b></span>
          ))}
        </div>
      </div>

      {/* Abreißkalender */}
      <div className="sk-blaetter">
        {d.termine.map((t, i) => {
          const dt = new Date(`${t.datum}T12:00:00Z`);
          const ampel = t.kontoNachher < 0 ? "alarm" : t.kontoNachher < d.puffer ? "warn" : "ok";
          const kopf = t.summe < 0 ? "#10b981" : ART[t.posten[0].art].farbe;
          const hoch = Math.max(t.kontoVorher, t.kontoNachher, 1);
          return (
            <article key={t.datum} className="sk-blatt" data-erst={t === naechster} data-ampel={ampel} style={{ ["--sk-kopf" as string]: kopf, ["--sk-i" as string]: i }}>
              <div className="sk-ringe" aria-hidden><i /><i /></div>
              <header className="sk-blatt-kopf">
                <span>{MON[dt.getUTCMonth()]}</span>
                <span>{WT[dt.getUTCDay()]}</span>
              </header>
              <div className="sk-tag">{dt.getUTCDate()}</div>
              <div className="sk-countdown" data-ueber={t.ueberfaellig}>{countdown(t)}</div>
              <ul className="sk-posten">
                {t.posten.map((p, k) => (
                  <li key={k} data-erst={p.betrag < 0}>
                    <i style={{ background: p.betrag < 0 ? "#10b981" : ART[p.art].farbe }} />
                    <span className="sk-posten-name">{p.titel}<small>{p.zeitraum}</small></span>
                    <b>{p.geschaetzt ? "≈ " : ""}{p.betrag < 0 ? "+" : ""}{eur(Math.abs(p.betrag))}</b>
                  </li>
                ))}
              </ul>
              <div className="sk-konto" title="Kontostand am Vortag laut Liquiditätsvorschau, danach minus diese Steuer">
                <div className="sk-saeulen" aria-hidden>
                  <span style={{ height: `${Math.max(4, (Math.max(0, t.kontoVorher) / hoch) * 100)}%` }} />
                  <span data-ampel={ampel} style={{ height: `${Math.max(4, (Math.max(0, t.kontoNachher) / hoch) * 100)}%` }} />
                </div>
                <div>
                  <div className="sk-konto-zeile">vorher <b>{kurzEur(t.kontoVorher)}</b></div>
                  <div className="sk-konto-zeile" data-ampel={ampel}>danach <b>{kurzEur(t.kontoNachher)}</b></div>
                </div>
              </div>
            </article>
          );
        })}
      </div>

      <div className="sk-fuss">
        <span>≈ geschätzt aus den letzten Monaten · „vorher“ = Kontostand laut Liquiditätsvorschau, „danach“ = vorher minus Steuer</span>
        <Link href="/finances/prepayments">Steuer-Übersicht <ArrowRight size={13} /></Link>
      </div>
    </div>
  );
}
