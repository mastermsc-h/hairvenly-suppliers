// Startbildschirm-Fenster "Newsletter" als moderne Zeitung (klare, gut lesbare Schrift): Kopf, Schlagzeile,
// Spalten mit den wichtigsten Zahlen, gestochene Monatsgrafik und eine "Kleinanzeige"
// für unbestätigte Anmeldungen. Zahlen kommen fertig vom Server (lib/newsletter.ts).
import Link from "next/link";

import type { NewsletterDaten } from "@/lib/cockpit/typen";

const zahl = (n: number) => new Intl.NumberFormat("de-DE").format(Math.round(n));
const MON = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

function Veraenderung({ neu, alt }: { neu: number; alt: number }) {
  if (!alt) return <>keinen Vergleich</>;
  const p = Math.round(((neu - alt) / alt) * 100);
  return <>{p > 0 ? `${p} % mehr` : p < 0 ? `${-p} % weniger` : "gleich viele"} als in der Woche davor</>;
}

export default function ZeitungWidget({ d }: { d: NewsletterDaten }) {
  if (!d.bestand) return <div className="zt-leer">Die erste Ausgabe erscheint nach dem nächsten Abgleich.</div>;
  // Ausgabe = Tag des letzten Abgleichs (Datum und Nummer daraus abgeleitet)
  const tag = Date.parse(`${d.bestand.tag}T12:00:00Z`);
  const heute = new Date(tag).toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "Europe/Berlin" });
  const ausgabe = Math.floor((tag - Date.parse("2026-01-01T12:00:00Z")) / 86_400_000) + 1;
  const monate = d.monate.slice(-12);
  const max = Math.max(...monate.map((m) => m.neu + m.ausstehend), 1);
  const kommentar = d.hinweise.find((h) => h.ton !== "gut") ?? d.hinweise[0];

  return (
    <div className="zt-zeitung">
      <div className="zt-rueck" aria-hidden><i /><i /><i /><i /><i /><i /></div>
      <div className="zt-blatt">
    <div className="zt">
      <header className="zt-titel">
        <div className="zt-zeile-oben"><span>Ausgabe Nr. {ausgabe}</span><span>Newsletter-Teil</span><span>Preis: 0 €</span></div>
        <div className="zt-name">Hairvenly <span>Kurier</span></div>
        <div className="zt-datum">{heute}</div>
      </header>

      <h3 className="zt-schlagzeile">{d.schlagzeile}</h3>
      <p className="zt-unterzeile">{d.unterzeile}</p>

      <div className="zt-spalten">
        <section>
          <h4>Leserschaft</h4>
          <div className="zt-gross">{zahl(d.bestand.abonniert)}</div>
          <p>
            Bestätigte Abonnentinnen zählt der Kurier heute.
            {d.abonniertVor30 != null && <> Vor einem Monat waren es {zahl(d.abonniertVor30)}.</>}
            {" "}Insgesamt {zahl(d.bestand.abgemeldet)} haben sich bisher abgemeldet.
          </p>
        </section>
        <section>
          <h4>Diese Woche</h4>
          <div className="zt-reihe"><span>Neu bestätigt</span><b>+{zahl(d.d7.neu)}</b></div>
          <div className="zt-reihe"><span>Unbestätigt</span><b>{zahl(d.d7.ausstehend)}</b></div>
          <div className="zt-reihe"><span>Abgemeldet</span><b>−{zahl(d.d7.abmeldungen)}</b></div>
          <p className="zt-klein"><Veraenderung neu={d.d7.neu} alt={d.d7.vorNeu} />.</p>
          <h4 style={{ marginTop: 10 }}>Im Monat</h4>
          <div className="zt-reihe"><span>Neu bestätigt</span><b>+{zahl(d.d30.neu)}</b></div>
          <div className="zt-reihe"><span>Abgemeldet</span><b>−{zahl(d.d30.abmeldungen)}</b></div>
          {d.bestaetigt30 != null && <div className="zt-reihe"><span>Bestätigungsquote</span><b>{String(d.bestaetigt30).replace(".", ",")} %</b></div>}
        </section>
        <section>
          <h4>Anmeldungen je Monat</h4>
          <svg className="zt-grafik" viewBox="0 0 120 60" preserveAspectRatio="none" role="img" aria-label="Neue Anmeldungen der letzten 12 Monate">
            <defs>
              <pattern id="zt-schraffur" width="2.4" height="2.4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="2.4" stroke="#7c5cff" strokeWidth="0.8" />
              </pattern>
            </defs>
            {monate.map((m, i) => {
              const w = 120 / monate.length;
              const hNeu = (m.neu / max) * 56;
              const hAus = (m.ausstehend / max) * 56;
              return (
                <g key={m.monat}>
                  <rect x={i * w + 1} y={60 - hNeu} width={w - 2} height={hNeu} fill="#7c5cff"><title>{`${MON[Number(m.monat.slice(5, 7)) - 1]} ${m.monat.slice(0, 4)}: ${zahl(m.neu)} bestätigt, ${zahl(m.ausstehend)} unbestätigt`}</title></rect>
                  <rect x={i * w + 1} y={60 - hNeu - hAus} width={w - 2} height={hAus} fill="url(#zt-schraffur)" />
                </g>
              );
            })}
          </svg>
          <div className="zt-achse">{monate.map((m, i) => <span key={m.monat}>{i % 2 === 0 ? MON[Number(m.monat.slice(5, 7)) - 1].slice(0, 1) : ""}</span>)}</div>
          <p className="zt-klein">Voll: bestätigt · schraffiert: unbestätigt</p>
          {d.bestand.ausstehend > 0 && (
            <div className="zt-anzeige">
              <div className="zt-anzeige-kopf">Offen</div>
              <b>{zahl(d.bestand.ausstehend)} Anmeldungen</b> sind noch nicht bestätigt – der Link in der Bestätigungs-E-Mail wurde nie geklickt.
            </div>
          )}
        </section>
      </div>

      {kommentar && (
        <p className="zt-kommentar"><span>Einordnung</span> {kommentar.text}</p>
      )}
      <div className="zt-fuss"><Link href="/marketing/kennzahlen">Ganze Ausgabe lesen →</Link></div>
    </div>
      </div>
    </div>
  );
}
