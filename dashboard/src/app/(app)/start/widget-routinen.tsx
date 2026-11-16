"use client";

// Fenster "Routinen": jede wiederkehrende Aufgabe ist ein Ring um eine Uhr. Der Ring füllt sich,
// je näher die Fälligkeit rückt; voll = fällig, überfällig = pulsierend rot umrandet.
// Daneben die Liste mit "Erledigt", Bearbeiten und neuen Routinen.
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, Pencil, Plus, Trash2, Undo2, X } from "lucide-react";
import { routineErledigt, routineLoeschen, routineProduktSuche, routineSpeichern } from "@/lib/actions/cockpit";
import type { Routine } from "@/lib/cockpit/typen";

const zahl = (n: number) => new Intl.NumberFormat("de-DE").format(Math.round(n));
const datum = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.`;

function statusText(r: Routine): string {
  if (r.status === "ruht") return `bestellt am ${datum(r.letzteErledigung!)} · Ware ca. ${datum(r.faellig!)}`;
  if (r.tageBis == null) return r.art === "lager" ? "keine Verkaufsdaten" : "–";
  if (r.tageBis < 0) return `seit ${-r.tageBis} ${r.tageBis === -1 ? "Tag" : "Tagen"} überfällig`;
  if (r.tageBis === 0) return "heute fällig";
  if (r.tageBis === 1) return "morgen fällig";
  return `in ${r.tageBis} Tagen (${datum(r.faellig!)})`;
}

function detailText(r: Routine): string {
  if (r.art === "lager") {
    const k = r.produkte.find((p) => p.reichtTage != null);
    if (!k) return `${r.produkte.length} Produkte · Lieferzeit ${r.lieferzeitTage} Tage`;
    return `${k.titel}: noch ${zahl(k.bestand ?? 0)} Stk., reicht ${k.reichtTage} Tage · Lieferzeit ${r.lieferzeitTage} T.`;
  }
  const teile = [`alle ${r.intervallTage} Tage`];
  if (r.letzteBestellung) teile.push(`letzte Bestellung ${datum(r.letzteBestellung)}`);
  if (r.letzteErledigung && r.letzteErledigung !== r.letzteBestellung) teile.push(`erledigt ${datum(r.letzteErledigung)}${r.erledigtVon ? ` (${r.erledigtVon})` : ""}`);
  return teile.join(" · ");
}

function Ringe({ routinen, aktiv, setAktiv }: { routinen: Routine[]; aktiv: string | null; setAktiv: (id: string | null) => void }) {
  const [an, setAn] = useState(false);
  useEffect(() => { const t = requestAnimationFrame(() => setAn(true)); return () => cancelAnimationFrame(t); }, []);
  const groesse = 210;
  const dicke = Math.max(9, Math.min(15, 70 / Math.max(routinen.length, 1)));
  const abstand = dicke + 5;
  const naechste = [...routinen].filter((r) => r.tageBis != null && r.status !== "ruht").sort((a, b) => a.tageBis! - b.tageBis!)[0];
  const zentrum = routinen.find((r) => r.id === aktiv) ?? naechste ?? routinen[0];
  return (
    <div className="rt-uhr" style={{ width: groesse, height: groesse }}>
      <svg width={groesse} height={groesse} viewBox={`0 0 ${groesse} ${groesse}`} aria-hidden>
        {/* Stundenstriche */}
        {Array.from({ length: 12 }, (_, i) => {
          const w = (i / 12) * 2 * Math.PI;
          const r1 = groesse / 2 - 2, r2 = groesse / 2 - (i % 3 === 0 ? 9 : 5);
          const r = (n: number) => Math.round(n * 100) / 100; // gleich auf Server und Browser
          return <line key={i} x1={r(groesse / 2 + Math.sin(w) * r1)} y1={r(groesse / 2 - Math.cos(w) * r1)} x2={r(groesse / 2 + Math.sin(w) * r2)} y2={r(groesse / 2 - Math.cos(w) * r2)} stroke="#c9cbe0" strokeWidth={i % 3 === 0 ? 2 : 1} strokeLinecap="round" />;
        })}
        {routinen.slice(0, 6).map((r, i) => {
          const radius = groesse / 2 - 18 - i * abstand;
          if (radius < 22) return null;
          const umfang = 2 * Math.PI * radius;
          const anteil = Math.max(0.02, Math.min(1, r.fortschritt));
          const gewaehlt = aktiv === r.id;
          return (
            <g key={r.id} className="rt-ring" data-status={r.status} style={{ ["--f" as string]: r.farbe }} onMouseEnter={() => setAktiv(r.id)} onMouseLeave={() => setAktiv(null)}>
              <circle cx={groesse / 2} cy={groesse / 2} r={radius} fill="none" stroke={r.farbe} strokeOpacity={0.14} strokeWidth={dicke} />
              <circle
                className="rt-bogen" cx={groesse / 2} cy={groesse / 2} r={radius} fill="none" stroke={r.status === "ruht" ? "#b9bdd0" : r.farbe}
                strokeWidth={gewaehlt ? dicke + 2 : dicke} strokeLinecap="round" strokeDasharray={r.status === "ruht" ? `2 ${dicke * 0.9}` : `${umfang}`}
                strokeDashoffset={r.status === "ruht" ? 0 : an ? umfang * (1 - anteil) : umfang}
                transform={`rotate(-90 ${groesse / 2} ${groesse / 2})`}
              />
            </g>
          );
        })}
      </svg>
      <div className="rt-zeiger" aria-hidden />
      {zentrum && (
        <div className="rt-mitte" data-status={zentrum.status}>
          <div className="rt-mitte-titel">{zentrum.titel}</div>
          <div className="rt-mitte-wert">
            {zentrum.status === "ruht" ? "bestellt" : zentrum.tageBis == null ? "–" : zentrum.tageBis < 0 ? `−${-zentrum.tageBis}` : zentrum.tageBis === 0 ? "heute" : zentrum.tageBis}
          </div>
          <div className="rt-mitte-unter">
            {zentrum.status === "ruht" ? `Ware ca. ${datum(zentrum.faellig!)}` : zentrum.tageBis == null ? "" : zentrum.tageBis < 0 ? "Tage überfällig" : zentrum.tageBis === 0 ? "fällig" : zentrum.tageBis === 1 ? "Tag" : "Tage"}
          </div>
        </div>
      )}
    </div>
  );
}

type Entwurf = { id?: string; titel: string; art: "intervall" | "lager"; intervallTage: number; quelle: string; lieferzeitTage: number; produkte: Array<{ handle: string; titel: string }>; notiz: string };

function Formular({ start, onFertig }: { start: Entwurf; onFertig: () => void }) {
  const [e, setE] = useState<Entwurf>(start);
  const [suche, setSuche] = useState("");
  const [treffer, setTreffer] = useState<Array<{ handle: string; titel: string; bestand: number }>>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, starte] = useTransition();
  const router = useRouter();
  useEffect(() => {
    if (e.art !== "lager" || suche.trim().length < 2) return;
    const t = setTimeout(() => { routineProduktSuche(suche).then(setTreffer); }, 300);
    return () => clearTimeout(t);
  }, [suche, e.art]);
  const speichern = () => starte(async () => {
    setFehler(null);
    const r = await routineSpeichern({ ...e, quelle: e.quelle || null });
    if (!r.ok) { setFehler(r.error); return; }
    router.refresh();
    onFertig();
  });
  return (
    <div className="rt-form">
      <input value={e.titel} onChange={(x) => setE({ ...e, titel: x.target.value })} placeholder="Was ist zu tun? z. B. Kleber bei XY bestellen" />
      <div className="rt-form-zeile">
        <select value={e.art} onChange={(x) => setE({ ...e, art: x.target.value as Entwurf["art"] })} aria-label="Art">
          <option value="intervall">Regelmäßig</option>
          <option value="lager">Wenn Lager knapp wird</option>
        </select>
        {e.art === "intervall" ? (
          <label>alle <input type="number" min={1} max={730} value={e.intervallTage} onChange={(x) => setE({ ...e, intervallTage: Number(x.target.value) })} /> Tage</label>
        ) : (
          <label>Lieferzeit <input type="number" min={1} max={365} value={e.lieferzeitTage} onChange={(x) => setE({ ...e, lieferzeitTage: Number(x.target.value) })} /> Tage</label>
        )}
      </div>
      {e.art === "intervall" && (
        <input value={e.quelle} onChange={(x) => setE({ ...e, quelle: x.target.value })} placeholder="Lieferant (optional): letzte Bestellung im Dashboard zählt als erledigt" />
      )}
      {e.art === "lager" && (
        <div className="rt-produkte">
          <div className="rt-chips">
            {e.produkte.map((p) => (
              <span key={p.handle} className="rt-chip">{p.titel}<button type="button" aria-label={`${p.titel} entfernen`} onClick={() => setE({ ...e, produkte: e.produkte.filter((x) => x.handle !== p.handle) })}><X size={11} /></button></span>
            ))}
          </div>
          <input value={suche} onChange={(x) => setSuche(x.target.value)} placeholder="Produkt suchen und hinzufügen …" />
          {suche.trim().length >= 2 && treffer.length > 0 && (
            <div className="rt-treffer">
              {treffer.filter((t) => !e.produkte.some((p) => p.handle === t.handle)).map((t) => (
                <button key={t.handle} type="button" onClick={() => { setE({ ...e, produkte: [...e.produkte, { handle: t.handle, titel: t.titel }] }); setSuche(""); setTreffer([]); }}>
                  <Plus size={12} /> {t.titel} <span>{zahl(t.bestand)} Stk.</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
      {fehler && <div className="rt-fehler">{fehler}</div>}
      <div className="rt-form-zeile" style={{ justifyContent: "flex-end" }}>
        <button type="button" className="ck-knopf ck-knopf-klein" onClick={onFertig}>Abbrechen</button>
        <button type="button" className="ck-knopf ck-knopf-klein ck-knopf-voll" onClick={speichern} disabled={laeuft}>{laeuft ? "Speichert …" : "Speichern"}</button>
      </div>
    </div>
  );
}

export default function RoutinenWidget({ routinen, istAdmin }: { routinen: Routine[]; istAdmin: boolean }) {
  const router = useRouter();
  const [aktiv, setAktiv] = useState<string | null>(null);
  const [offen, setOffen] = useState<string | null>(null);
  const [bearbeite, setBearbeite] = useState<string | "neu" | null>(null);
  const [laeuft, starte] = useTransition();
  const [fehler, setFehler] = useState<string | null>(null);
  const sortiert = useMemo(() => {
    const rang = { ueberfaellig: 0, faellig: 1, bald: 2, ok: 3, ruht: 4 } as const;
    return [...routinen].sort((a, b) => rang[a.status] - rang[b.status] || (a.tageBis ?? 999) - (b.tageBis ?? 999));
  }, [routinen]);

  const aktion = (f: () => Promise<{ ok: boolean; error?: string }>) => starte(async () => {
    setFehler(null);
    const r = await f();
    if (!r.ok) setFehler(r.error ?? "Fehler");
    router.refresh();
  });

  const leer: Entwurf = { titel: "", art: "intervall", intervallTage: 30, quelle: "", lieferzeitTage: 60, produkte: [], notiz: "" };

  return (
    <div className="rt">
      <Ringe routinen={routinen} aktiv={aktiv} setAktiv={setAktiv} />
      <div className="rt-liste">
        {fehler && <div className="rt-fehler">{fehler}</div>}
        {sortiert.map((r) => (
          <div key={r.id} className="rt-zeile" data-status={r.status} data-aktiv={aktiv === r.id} onMouseEnter={() => setAktiv(r.id)} onMouseLeave={() => setAktiv(null)}>
            {bearbeite === r.id ? (
              <Formular
                start={{ id: r.id, titel: r.titel, art: r.art, intervallTage: r.intervallTage ?? 30, quelle: r.quelle ?? "", lieferzeitTage: r.lieferzeitTage ?? 60, produkte: r.produkte.map((p) => ({ handle: p.handle, titel: p.titel })), notiz: r.notiz }}
                onFertig={() => setBearbeite(null)}
              />
            ) : (
              <>
                <div className="rt-zeile-kopf">
                  <i className="rt-punkt" style={{ background: r.farbe }} />
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="rt-titel">{r.titel}</div>
                    <div className="rt-status">{statusText(r)}</div>
                    <div className="rt-detail" title={r.notiz || undefined}>{detailText(r)}</div>
                  </div>
                  <div className="rt-knoepfe">
                    {r.status !== "ruht" && r.status !== "ok" ? (
                      <button type="button" className="rt-erledigt" disabled={laeuft} onClick={() => aktion(() => routineErledigt(r.id))} title={r.art === "lager" ? "Bestellt – Routine ruht bis zur Lieferung" : "Heute erledigt"}><Check size={13} /> Erledigt</button>
                    ) : r.letzteErledigung ? (
                      <button type="button" className="ck-icon-knopf" disabled={laeuft} onClick={() => aktion(() => routineErledigt(r.id, true))} title="Erledigt zurücknehmen"><Undo2 size={13} /></button>
                    ) : null}
                    {r.art === "lager" && r.produkte.length > 0 && (
                      <button type="button" className="ck-icon-knopf" aria-expanded={offen === r.id} onClick={() => setOffen(offen === r.id ? null : r.id)} title="Produkte"><ChevronDown size={14} style={{ transform: offen === r.id ? "rotate(180deg)" : undefined }} /></button>
                    )}
                    <button type="button" className="ck-icon-knopf" onClick={() => setBearbeite(r.id)} title="Bearbeiten"><Pencil size={12} /></button>
                    {istAdmin && <button type="button" className="ck-icon-knopf ck-rot" onClick={() => { if (window.confirm(`„${r.titel}" löschen?`)) aktion(() => routineLoeschen(r.id)); }} title="Löschen"><Trash2 size={12} /></button>}
                  </div>
                </div>
                {offen === r.id && (
                  <div className="rt-produktliste">
                    {r.produkte.map((p) => {
                      const knapp = p.reichtTage != null && p.reichtTage <= (r.lieferzeitTage ?? 60) + r.pufferTage;
                      return (
                        <div key={p.handle} className="rt-produkt" data-knapp={knapp}>
                          <span>{p.titel}</span>
                          <span>{p.bestand != null ? `${zahl(p.bestand)} Stk.` : "–"}</span>
                          <b>{p.reichtTage != null ? `${p.reichtTage} T.` : "kein Verkauf"}</b>
                        </div>
                      );
                    })}
                    <div className="rt-hinweis">Rot: reicht nicht über Lieferzeit ({r.lieferzeitTage} T.) + {r.pufferTage} Tage Puffer. Verkauf = Ø der letzten 60 Tage.</div>
                  </div>
                )}
              </>
            )}
          </div>
        ))}
        {bearbeite === "neu" ? (
          <div className="rt-zeile"><Formular start={leer} onFertig={() => setBearbeite(null)} /></div>
        ) : (
          <button type="button" className="rt-neu" onClick={() => setBearbeite("neu")}><Plus size={14} /> Routine hinzufügen</button>
        )}
      </div>
    </div>
  );
}
