"use client";

// Team-Stempelkarte: das Fenster sieht aus wie eine alte Stempelkarte (Karton, seitliche Lochung,
// Perforation zwischen den Feldern, Gummistempel). Drei Felder: Krankenstation (Thermometer),
// Stempeluhr (gestanzte Löcher je Verspätung + schnelle Erfassung) und Treue (Medaillen).
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Undo2 } from "lucide-react";
import type { TeamDaten } from "@/lib/cockpit/typen";
import { verspaetungErfassen, verspaetungZuruecknehmen } from "@/lib/actions/cockpit";

const vorname = (n: string) => n.split(" ")[0];
const tm = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.${iso.slice(2, 4)}`;
function dauer(tage: number) {
  const j = Math.floor(tage / 365);
  const m = Math.floor((tage % 365) / 30.4);
  if (j && m) return `${j} J ${m} M`;
  if (j) return `${j} Jahr${j > 1 ? "e" : ""}`;
  if (m) return `${m} Monat${m > 1 ? "e" : ""}`;
  return `${tage} Tage`;
}

function Thermometer({ anteil }: { anteil: number }) {
  return (
    <svg className="tk-thermo" viewBox="0 0 120 22" aria-hidden>
      <rect x="16" y="7" width="100" height="8" rx="4" fill="#efe6d2" stroke="#d8c9a8" />
      <rect className="tk-quecksilber" x="16" y="8.5" width={Math.max(6, anteil * 98)} height="5" rx="2.5" fill="#d6453d" />
      <circle cx="11" cy="11" r="8" fill="#d6453d" stroke="#b8322b" />
      <circle cx="9" cy="9" r="2.2" fill="#fff" opacity="0.5" />
    </svg>
  );
}

const MEDAILLE = ["#e3b341", "#b9c0c9", "#c98a52"];

export default function TeamWidget({ d }: { d: TeamDaten }) {
  const router = useRouter();
  const [laeuft, start] = useTransition();
  const [wer, setWer] = useState("");
  const [minuten, setMinuten] = useState(10);
  const [meldung, setMeldung] = useState<{ ok: boolean; text: string } | null>(null);
  const maxKrank = Math.max(1, ...d.krank.map((k) => k.tage));
  const treueTop = d.treue.slice(0, 3);
  const gleichauf = treueTop.length > 1 && treueTop.every((t) => t.tage === treueTop[0].tage);

  const stempeln = () => {
    if (!wer) { setMeldung({ ok: false, text: "Erst auswählen, wer zu spät war." }); return; }
    start(async () => {
      const r = await verspaetungErfassen(wer, minuten);
      setMeldung(r.ok ? { ok: true, text: `Gestempelt: ${vorname(d.mitarbeiter.find((m) => m.id === wer)?.name ?? "")} +${minuten} Min.` } : { ok: false, text: r.error ?? "Fehler" });
      if (r.ok) { setWer(""); router.refresh(); }
    });
  };
  const zurueck = () => start(async () => {
    const r = await verspaetungZuruecknehmen();
    setMeldung(r.ok ? { ok: true, text: "Letzte Stempelung zurückgenommen." } : { ok: false, text: r.error ?? "Fehler" });
    if (r.ok) router.refresh();
  });

  return (
    <div className="tk">
      <div className="tk-kopfzeile">
        <span>STEMPELKARTE · HAIRVENLY</span>
        <span>{d.mitarbeiter.length} MITARBEITER · LETZTE 12 MONATE</span>
      </div>

      <div className="tk-felder">
        {/* ── Krankenstation ── */}
        <section className="tk-feld">
          <div className="tk-feld-kopf"><b>№ 01</b> Krankenstation</div>
          {d.krank.length ? (
            <ol className="tk-liste">
              {d.krank.slice(0, 4).map((k, i) => (
                <li key={k.id} className="tk-zeile" data-erst={i === 0}>
                  <span className="tk-name">{vorname(k.name)}</span>
                  <Thermometer anteil={k.tage / maxKrank} />
                  <span className="tk-wert"><b>{k.tage}</b> T<small>{k.faelle}× krank</small></span>
                </li>
              ))}
            </ol>
          ) : (
            <div className="tk-leer">
              <span className="tk-leer-icon" aria-hidden>🌡️</span>
              Noch keine Krankmeldung erfasst.
              <Link href="/staff/sick" className="tk-link ck-kein-zug">Krankheitstage eintragen →</Link>
            </div>
          )}
          {d.krank.length > 0 && <div className="tk-stempel tk-stempel-rot" aria-hidden>MEISTE TAGE</div>}
        </section>

        <div className="tk-perforation" aria-hidden />

        {/* ── Stempeluhr ── */}
        <section className="tk-feld">
          <div className="tk-feld-kopf"><b>№ 02</b> Stempeluhr · zu spät</div>
          {d.spaet.length ? (
            <ol className="tk-liste">
              {d.spaet.slice(0, 4).map((s, i) => (
                <li key={s.id} className="tk-zeile" data-erst={i === 0}>
                  <span className="tk-name">{vorname(s.name)}</span>
                  <span className="tk-loecher" aria-label={`${s.anzahl}-mal zu spät`}>
                    {Array.from({ length: Math.min(s.anzahl, 12) }, (_, j) => <i key={j} />)}
                    {s.anzahl > 12 && <em>+{s.anzahl - 12}</em>}
                  </span>
                  <span className="tk-wert"><b>{s.anzahl}×</b><small>{s.minuten} Min.</small></span>
                </li>
              ))}
            </ol>
          ) : (
            <div className="tk-leer"><span className="tk-leer-icon" aria-hidden>⏰</span>Noch niemand zu spät gestempelt – vorbildlich!</div>
          )}
          <div className="tk-uhr ck-kein-zug">
            <select value={wer} onChange={(e) => setWer(e.target.value)} aria-label="Wer war zu spät?">
              <option value="">Wer war zu spät?</option>
              {d.mitarbeiter.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <div className="tk-minuten" role="radiogroup" aria-label="Minuten">
              {[5, 10, 15, 30, 60].map((m) => (
                <button key={m} type="button" role="radio" aria-checked={minuten === m} onClick={() => setMinuten(m)}>{m}</button>
              ))}
            </div>
            <button type="button" className="tk-stempel-knopf" onClick={stempeln} disabled={laeuft}>STEMPELN</button>
            {d.letzteSpaet && (
              <button type="button" className="tk-zurueck" onClick={zurueck} disabled={laeuft} title="Meine letzte Stempelung zurücknehmen"><Undo2 size={13} /></button>
            )}
          </div>
          {meldung && <div className="tk-meldung" data-ok={meldung.ok}>{meldung.text}</div>}
        </section>

        <div className="tk-perforation" aria-hidden />

        {/* ── Treue ── */}
        <section className="tk-feld">
          <div className="tk-feld-kopf"><b>№ 03</b> Treue · am längsten dabei</div>
          {treueTop.length ? (
            <ol className="tk-liste">
              {treueTop.map((t, i) => (
                <li key={t.id} className="tk-zeile tk-treue" data-erst={i === 0}>
                  <svg viewBox="0 0 24 24" width="26" height="26" className="tk-medaille" aria-hidden>
                    <path d="M7 1 L10 9 M17 1 L14 9" stroke="#8a6d3b" strokeWidth="2.4" strokeLinecap="round" />
                    <circle cx="12" cy="15" r="8" fill={gleichauf ? MEDAILLE[0] : MEDAILLE[i]} stroke="rgba(0,0,0,0.15)" />
                    <text x="12" y="18.5" textAnchor="middle" fontSize="9" fontWeight="800" fill="#5a4320">{gleichauf ? 1 : i + 1}</text>
                  </svg>
                  <span className="tk-name">{t.name}</span>
                  <span className="tk-wert"><b>{dauer(t.tage)}</b><small>seit {tm(t.seit)}</small></span>
                </li>
              ))}
            </ol>
          ) : (
            <div className="tk-leer">Kein Eintrittsdatum hinterlegt.</div>
          )}
          {d.gleicherStart && (
            <div className="tk-hinweis">{d.gleicherStart.anzahl} Personen mit Eintritt {tm(d.gleicherStart.datum)} – stimmt das? <Link href="/staff/members" className="tk-link ck-kein-zug">prüfen →</Link></div>
          )}
          <div className="tk-stempel tk-stempel-blau" aria-hidden>TREUE</div>
        </section>
      </div>
    </div>
  );
}
