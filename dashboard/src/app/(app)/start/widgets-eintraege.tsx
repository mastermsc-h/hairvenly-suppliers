"use client";

// Mitmach-Widgets des Startbildschirms: Notizzettel, Ideen, Aufgaben, Meilensteine,
// Wachstumspfeiler, Aktionen, Firmenphilosophie. Änderungen erscheinen sofort und werden
// im Hintergrund gespeichert; schlägt das Speichern fehl, steht es oben im Widget.
import { useCallback, useRef, useState } from "react";
import { CalendarClock, Check, ExternalLink, Flame, Lightbulb, Pencil, Plus, Quote, Trash2, X } from "lucide-react";
import { aendereEintrag, erstelleEintrag, loescheEintrag } from "@/lib/actions/cockpit";
import type { Eintrag, EintragArt, EintragDaten, KampagneDaten } from "@/lib/cockpit/typen";
import { Hinweis, Ring, tagMonat } from "./bausteine";

type Patch = { titel?: string; text?: string; daten?: EintragDaten; erledigt?: boolean; sort?: number };

function useEintraege(start: Eintrag[], art: EintragArt) {
  const [liste, setListe] = useState(() => start.filter((e) => e.art === art));
  const [fehler, setFehler] = useState<string | null>(null);

  const neu = useCallback(async (input: { titel?: string; text?: string; daten?: EintragDaten }) => {
    setFehler(null);
    const res = await erstelleEintrag({ art, ...input });
    if (!res.ok || !res.wert) { setFehler(res.ok ? "Speichern fehlgeschlagen" : res.error); return null; }
    setListe((l) => [...l, res.wert!]);
    return res.wert;
  }, [art]);

  const aendern = useCallback(async (id: string, patch: Patch) => {
    setFehler(null);
    setListe((l) => l.map((e) => (e.id !== id ? e : {
      ...e,
      ...(patch.titel !== undefined ? { titel: patch.titel } : {}),
      ...(patch.text !== undefined ? { text: patch.text } : {}),
      ...(patch.daten !== undefined ? { daten: patch.daten } : {}),
      ...(patch.sort !== undefined ? { sort: patch.sort } : {}),
      ...(patch.erledigt !== undefined ? { erledigt_am: patch.erledigt ? new Date().toISOString() : null } : {}),
    })));
    const res = await aendereEintrag(id, patch);
    if (!res.ok) setFehler(`Nicht gespeichert: ${res.error}`);
  }, []);

  const loeschen = useCallback(async (id: string) => {
    setFehler(null);
    const vorher = liste;
    setListe((l) => l.filter((e) => e.id !== id));
    const res = await loescheEintrag(id);
    if (!res.ok) { setListe(vorher); setFehler(`Nicht gelöscht: ${res.error}`); }
  }, [liste]);

  return { liste, setListe, fehler, neu, aendern, loeschen };
}

function Fehler({ text }: { text: string | null }) {
  if (!text) return null;
  return <div style={{ color: "var(--ck-alarm)", fontSize: 12, marginBottom: 6 }}>{text}</div>;
}

const heuteIso = () => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());

// ── Notizzettel (privat, per Ziehen sortierbar) ─────────────────────────────

const ZETTEL_FARBEN = ["#ffd23f", "#ff8fbf", "#7cc8ff", "#7ddfa8", "#b99bff"];
const DREHUNG = ["-1.2deg", "0.8deg", "-0.5deg", "1.3deg", "0.3deg"];

export function NotizenWidget({ eintraege }: { eintraege: Eintrag[] }) {
  const { liste, setListe, fehler, neu, aendern, loeschen } = useEintraege(eintraege, "notiz");
  const zieht = useRef<string | null>(null);
  const [ziel, setZiel] = useState<string | null>(null);
  const sortiert = [...liste].sort((a, b) => a.sort - b.sort);

  const ablegen = (aufId: string) => {
    const von = zieht.current;
    zieht.current = null;
    setZiel(null);
    if (!von || von === aufId) return;
    const ohne = sortiert.filter((e) => e.id !== von);
    const idx = ohne.findIndex((e) => e.id === aufId);
    const davor = ohne[idx - 1]?.sort ?? ohne[idx].sort - 2;
    const sort = (davor + ohne[idx].sort) / 2;
    aendern(von, { sort });
  };

  return (
    <div>
      <Fehler text={fehler} />
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", gap: 16, padding: "8px 4px 4px" }}>
        {sortiert.map((n, idx) => (
          <div
            key={n.id}
            className="ck-zettel"
            data-ziel={ziel === n.id}
            style={{ ["--ck-z" as string]: n.daten.farbe ?? ZETTEL_FARBEN[0], ["--dreh" as string]: DREHUNG[idx % DREHUNG.length] }}
            draggable
            onDragStart={(e) => { zieht.current = n.id; e.dataTransfer.effectAllowed = "move"; }}
            onDragOver={(e) => { if (zieht.current && zieht.current !== n.id) { e.preventDefault(); setZiel(n.id); } }}
            onDragLeave={() => setZiel((z) => (z === n.id ? null : z))}
            onDrop={(e) => { e.preventDefault(); ablegen(n.id); }}
            onDragEnd={() => { zieht.current = null; setZiel(null); }}
          >
            <textarea
              defaultValue={n.text}
              placeholder="Notiz …"
              onChange={(e) => setListe((l) => l.map((x) => (x.id === n.id ? { ...x, text: e.target.value } : x)))}
              onBlur={(e) => aendern(n.id, { text: e.target.value })}
              onMouseDown={(e) => e.stopPropagation()}
              draggable={false}
            />
            <div className="ck-zettel-fuss">
              {ZETTEL_FARBEN.map((f) => (
                <button key={f} type="button" className="ck-farbe" style={{ background: f }} aria-label="Farbe ändern" onClick={() => aendern(n.id, { daten: { ...n.daten, farbe: f } })} />
              ))}
              <button type="button" className="ck-icon-knopf ck-rot" style={{ marginLeft: "auto" }} aria-label="Notiz löschen" onClick={() => loeschen(n.id)}><Trash2 size={13} /></button>
            </div>
          </div>
        ))}
        <button type="button" className="ck-zettel-neu" onClick={() => neu({ text: "", daten: { farbe: ZETTEL_FARBEN[liste.length % ZETTEL_FARBEN.length] } })}>
          <Plus size={22} /> Neuer Zettel
        </button>
      </div>
    </div>
  );
}

// ── Ideen & Inspiration (ganzes Team) ───────────────────────────────────────

const IDEEN_FARBEN = ["#f59e0b", "#7c5cff", "#0fb5ba", "#f0508f", "#2f9bff"];

export function IdeenWidget({ eintraege }: { eintraege: Eintrag[] }) {
  const { liste, fehler, neu, aendern, loeschen } = useEintraege(eintraege, "idee");
  const [titel, setTitel] = useState("");
  const [offen, setOffen] = useState<string | null>(null);
  const anlegen = async () => {
    const t = titel.trim();
    if (!t) return;
    const link = t.match(/https?:\/\/\S+/)?.[0];
    setTitel("");
    await neu({ titel: link ? t.replace(link, "").trim() || link : t, daten: link ? { link } : {} });
  };
  const sortiert = [...liste].sort((a, b) => b.sort - a.sort);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
      <Fehler text={fehler} />
      <form onSubmit={(e) => { e.preventDefault(); anlegen(); }} style={{ display: "flex", gap: 7 }}>
        <input value={titel} onChange={(e) => setTitel(e.target.value)} placeholder="Idee oder Link festhalten …" style={{ flex: 1, minWidth: 0 }} />
        <button type="submit" className="ck-knopf ck-knopf-klein ck-knopf-voll" style={{ height: 34 }}><Plus size={14} /> Dazu</button>
      </form>
      {!sortiert.length && <Hinweis>Noch keine Ideen. Alles, was euch einfällt oder inspiriert, landet hier – jede im Team kann etwas dazulegen.</Hinweis>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))", gap: 8 }}>
        {sortiert.map((i, idx) => (
          <div key={i.id} className="ck-idee" style={{ ["--i" as string]: IDEEN_FARBEN[idx % IDEEN_FARBEN.length] }}>
            <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
              <Lightbulb size={16} style={{ color: IDEEN_FARBEN[idx % IDEEN_FARBEN.length], flex: "none", marginTop: 1 }} />
              <span style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.35, flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{i.titel}</span>
              <button type="button" className="ck-icon-knopf" aria-label="Beschreibung bearbeiten" onClick={() => setOffen(offen === i.id ? null : i.id)}><Pencil size={12} /></button>
              <button type="button" className="ck-icon-knopf ck-rot" aria-label="Idee löschen" onClick={() => loeschen(i.id)}><Trash2 size={12} /></button>
            </div>
            {offen === i.id ? (
              <textarea autoFocus defaultValue={i.text} rows={3} placeholder="Mehr dazu …" onBlur={(e) => { aendern(i.id, { text: e.target.value }); setOffen(null); }} style={{ width: "100%", resize: "vertical" }} />
            ) : i.text ? <div className="ck-dim" style={{ fontSize: 12.5, lineHeight: 1.45, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{i.text}</div> : null}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "auto", gap: 6 }}>
              <span className="ck-matt" style={{ fontSize: 11 }}>{i.owner_name ?? "Team"} · {tagMonat(i.created_at.slice(0, 10))}</span>
              {i.daten.link && <a href={i.daten.link} target="_blank" rel="noreferrer" className="ck-link" style={{ display: "inline-flex", gap: 3, alignItems: "center" }}>Link <ExternalLink size={11} /></a>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Dringende Aufgaben ──────────────────────────────────────────────────────

export function AufgabenWidget({ eintraege, team }: { eintraege: Eintrag[]; team: string[] }) {
  const { liste, fehler, neu, aendern, loeschen } = useEintraege(eintraege, "aufgabe");
  const [titel, setTitel] = useState("");
  const [zustaendig, setZustaendig] = useState("");
  const [faellig, setFaellig] = useState("");
  const [hoch, setHoch] = useState(true);
  const [zeigeErledigt, setZeigeErledigt] = useState(false);
  const heute = heuteIso();

  const anlegen = async () => {
    const t = titel.trim();
    if (!t) return;
    setTitel("");
    await neu({ titel: t, daten: { prio: hoch ? "hoch" : "normal", ...(zustaendig ? { zustaendig } : {}), ...(faellig ? { faellig } : {}) } });
    setFaellig("");
  };

  const rang = (e: Eintrag) => (e.daten.faellig && e.daten.faellig < heute ? 0 : e.daten.prio === "hoch" ? 1 : 2);
  const offen = liste.filter((e) => !e.erledigt_am).sort((a, b) => rang(a) - rang(b) || (a.daten.faellig ?? "9999").localeCompare(b.daten.faellig ?? "9999") || a.sort - b.sort);
  const erledigt = liste.filter((e) => e.erledigt_am).sort((a, b) => (b.erledigt_am ?? "").localeCompare(a.erledigt_am ?? ""));

  const zeile = (a: Eintrag) => {
    const ueber = !a.erledigt_am && a.daten.faellig && a.daten.faellig < heute;
    const heuteFaellig = !a.erledigt_am && a.daten.faellig === heute;
    return (
      <div key={a.id} className="ck-aufgabe" style={{ opacity: a.erledigt_am ? 0.55 : 1, ["--a" as string]: a.erledigt_am ? "var(--ck-ok)" : ueber ? "var(--ck-alarm)" : a.daten.prio === "hoch" ? "#ff7a45" : undefined }}>
        <button type="button" className="ck-haken" data-an={!!a.erledigt_am} aria-label={a.erledigt_am ? "Wieder öffnen" : "Erledigt"} onClick={() => aendern(a.id, { erledigt: !a.erledigt_am })} style={{ marginTop: 1 }}>
          <Check size={12} strokeWidth={3} />
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13.5, lineHeight: 1.35, textDecoration: a.erledigt_am ? "line-through" : "none", overflowWrap: "anywhere" }}>
            {a.daten.prio === "hoch" && !a.erledigt_am && <Flame size={12} style={{ display: "inline", color: "var(--ck-alarm)", marginRight: 4, verticalAlign: "-1px" }} />}
            {a.titel}
          </div>
          <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 4 }}>
            {a.daten.zustaendig && <span className="ck-marke" data-ton="akzent">{a.daten.zustaendig}</span>}
            {a.daten.faellig && <span className="ck-marke" data-ton={ueber ? "alarm" : heuteFaellig ? "warn" : undefined}>{ueber ? "überfällig seit " : heuteFaellig ? "heute · " : "bis "}{tagMonat(a.daten.faellig)}</span>}
            {a.owner_name && <span className="ck-marke">von {a.owner_name}</span>}
          </div>
        </div>
        <button type="button" className="ck-icon-knopf ck-rot" aria-label="Aufgabe löschen" onClick={() => loeschen(a.id)}><X size={13} /></button>
      </div>
    );
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <Fehler text={fehler} />
      <form onSubmit={(e) => { e.preventDefault(); anlegen(); }} style={{ display: "grid", gap: 6 }}>
        <div style={{ display: "flex", gap: 6 }}>
          <input value={titel} onChange={(e) => setTitel(e.target.value)} placeholder="Neue dringende Aufgabe …" style={{ flex: 1, minWidth: 0 }} />
          <button type="submit" className="ck-knopf ck-knopf-klein ck-knopf-voll" style={{ height: 34 }} aria-label="Aufgabe anlegen"><Plus size={15} /></button>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <select value={zustaendig} onChange={(e) => setZustaendig(e.target.value)} aria-label="Zuständig" style={{ flex: "1 1 96px", minWidth: 0 }}>
            <option value="">Wer?</option>
            {team.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
          <input type="date" value={faellig} onChange={(e) => setFaellig(e.target.value)} aria-label="Fällig bis" style={{ flex: "1 1 120px", minWidth: 0 }} />
          <button type="button" className="ck-chip" data-an={hoch} onClick={() => setHoch(!hoch)} title="Als dringend markieren"><Flame size={12} /> dringend</button>
        </div>
      </form>
      <div style={{ display: "grid", gap: 6 }}>
        {!offen.length && <Hinweis>Keine offenen Aufgaben. 🎉</Hinweis>}
        {offen.map(zeile)}
      </div>
      {erledigt.length > 0 && (
        <div>
          <button type="button" className="ck-link" style={{ background: "none", border: 0, cursor: "pointer", padding: 0 }} onClick={() => setZeigeErledigt(!zeigeErledigt)}>
            {zeigeErledigt ? "Erledigte ausblenden" : `${erledigt.length} erledigt anzeigen`}
          </button>
          {zeigeErledigt && <div style={{ display: "grid", gap: 6, marginTop: 6 }}>{erledigt.slice(0, 20).map(zeile)}</div>}
        </div>
      )}
    </div>
  );
}

// ── Meilensteine ────────────────────────────────────────────────────────────

export function MeilensteineWidget({ eintraege, istAdmin }: { eintraege: Eintrag[]; istAdmin: boolean }) {
  const { liste, fehler, neu, aendern, loeschen } = useEintraege(eintraege, "meilenstein");
  const [titel, setTitel] = useState("");
  const [datum, setDatum] = useState("");
  const sortiert = [...liste].sort((a, b) => (a.daten.faellig ?? "9999").localeCompare(b.daten.faellig ?? "9999") || a.sort - b.sort);
  const anlegen = async () => {
    const t = titel.trim();
    if (!t) return;
    setTitel("");
    await neu({ titel: t, daten: datum ? { faellig: datum } : {} });
    setDatum("");
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <Fehler text={fehler} />
      {!sortiert.length && <Hinweis>Noch keine Meilensteine eingetragen{istAdmin ? " – unten den ersten anlegen." : "."}</Hinweis>}
      <div className="ck-zeitleiste">
        {sortiert.map((m) => (
          <div key={m.id} className="ck-meilenstein" data-erledigt={!!m.erledigt_am}>
            <div style={{ display: "flex", gap: 6, alignItems: "flex-start" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, fontWeight: 600, lineHeight: 1.35, overflowWrap: "anywhere", color: m.erledigt_am ? "var(--ck-dim)" : undefined }}>{m.titel}</div>
                <div style={{ display: "flex", gap: 5, marginTop: 3, flexWrap: "wrap" }}>
                  {m.daten.faellig && <span className="ck-marke ck-mono">{tagMonat(m.daten.faellig)}{m.daten.faellig.slice(0, 4)}</span>}
                  {m.erledigt_am && <span className="ck-marke" data-ton="ok">erreicht</span>}
                </div>
              </div>
              {istAdmin && (
                <>
                  <button type="button" className="ck-icon-knopf" aria-label={m.erledigt_am ? "Als offen markieren" : "Als erreicht markieren"} onClick={() => aendern(m.id, { erledigt: !m.erledigt_am })}><Check size={13} /></button>
                  <button type="button" className="ck-icon-knopf ck-rot" aria-label="Meilenstein löschen" onClick={() => loeschen(m.id)}><Trash2 size={12} /></button>
                </>
              )}
            </div>
          </div>
        ))}
      </div>
      {istAdmin && (
        <form onSubmit={(e) => { e.preventDefault(); anlegen(); }} style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          <input value={titel} onChange={(e) => setTitel(e.target.value)} placeholder="Neuer Meilenstein …" style={{ flex: "2 1 130px", minWidth: 0 }} />
          <input type="date" value={datum} onChange={(e) => setDatum(e.target.value)} aria-label="Zieldatum" style={{ flex: "1 1 120px", minWidth: 0 }} />
          <button type="submit" className="ck-knopf ck-knopf-klein" style={{ height: 32 }} aria-label="Meilenstein anlegen"><Plus size={14} /></button>
        </form>
      )}
    </div>
  );
}

// ── Wachstumspfeiler ────────────────────────────────────────────────────────

const PFEILER_FARBEN = ["#7c5cff", "#f0508f", "#12b76a", "#2f9bff", "#ef9a0c", "#0fb5ba"];

export function PfeilerWidget({ eintraege, istAdmin }: { eintraege: Eintrag[]; istAdmin: boolean }) {
  const { liste, setListe, fehler, neu, aendern, loeschen } = useEintraege(eintraege, "pfeiler");
  const [titel, setTitel] = useState("");
  const [offen, setOffen] = useState<string | null>(null);
  const sortiert = [...liste].sort((a, b) => a.sort - b.sort);
  const gewaehlt = sortiert.find((p) => p.id === offen) ?? null;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <Fehler text={fehler} />
      {!sortiert.length && <Hinweis>Noch keine Wachstumspfeiler eingetragen.</Hinweis>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(96px, 1fr))", gap: 8 }}>
        {sortiert.map((p, idx) => {
          const f = p.daten.fortschritt ?? 0;
          const farbe = PFEILER_FARBEN[idx % PFEILER_FARBEN.length];
          return (
            <button
              key={p.id} type="button" disabled={!istAdmin} onClick={() => setOffen(offen === p.id ? null : p.id)} title={p.text || p.titel}
              style={{
                display: "flex", flexDirection: "column", alignItems: "center", gap: 8, padding: "14px 8px 12px", borderRadius: 16, border: 0, font: "inherit", color: "inherit",
                cursor: istAdmin ? "pointer" : "default", background: `color-mix(in srgb, ${farbe} ${offen === p.id ? 20 : 9}%, #fff)`,
                boxShadow: offen === p.id ? `0 0 0 2px ${farbe}` : "none", transition: "background 0.2s, box-shadow 0.2s",
              }}
            >
              <Ring anteil={f} groesse={68} dicke={8} farbe={farbe}><span className="ck-mono" style={{ fontSize: 15, fontWeight: 750 }}>{f}<span style={{ fontSize: 10 }}> %</span></span></Ring>
              <span style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.25, textAlign: "center", overflowWrap: "anywhere" }}>{p.titel}</span>
            </button>
          );
        })}
      </div>
      {gewaehlt && istAdmin && (
        <div className="ck-kachel" style={{ display: "grid", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <b style={{ fontSize: 13.5, flex: 1, minWidth: 0 }}>{gewaehlt.titel}</b>
            <button type="button" className="ck-icon-knopf" aria-label="Schließen" onClick={() => setOffen(null)}><X size={14} /></button>
          </div>
          <input
            type="range" min={0} max={100} step={5} value={gewaehlt.daten.fortschritt ?? 0} aria-label="Fortschritt in Prozent"
            onChange={(e) => setListe((l) => l.map((x) => (x.id === gewaehlt.id ? { ...x, daten: { ...x.daten, fortschritt: Number(e.target.value) } } : x)))}
            onPointerUp={(e) => aendern(gewaehlt.id, { daten: { ...gewaehlt.daten, fortschritt: Number((e.target as HTMLInputElement).value) } })}
            onKeyUp={(e) => aendern(gewaehlt.id, { daten: { ...gewaehlt.daten, fortschritt: Number((e.target as HTMLInputElement).value) } })}
          />
          <textarea key={gewaehlt.id} defaultValue={gewaehlt.text} rows={2} placeholder="Stand und nächster Schritt …" onBlur={(e) => aendern(gewaehlt.id, { text: e.target.value })} style={{ width: "100%", resize: "vertical" }} />
          <button type="button" className="ck-link" style={{ background: "none", border: 0, cursor: "pointer", padding: 0, color: "var(--ck-alarm)", justifySelf: "start" }} onClick={() => { loeschen(gewaehlt.id); setOffen(null); }}>Pfeiler löschen</button>
        </div>
      )}
      {istAdmin && (
        <form
          onSubmit={async (e) => { e.preventDefault(); const t = titel.trim(); if (!t) return; setTitel(""); await neu({ titel: t, daten: { fortschritt: 0 } }); }}
          style={{ display: "flex", gap: 6 }}
        >
          <input value={titel} onChange={(e) => setTitel(e.target.value)} placeholder="Neuer Wachstumspfeiler …" style={{ flex: 1, minWidth: 0 }} />
          <button type="submit" className="ck-knopf ck-knopf-klein" style={{ height: 32 }} aria-label="Pfeiler anlegen"><Plus size={14} /></button>
        </form>
      )}
    </div>
  );
}

// ── Aktuelle Aktionen ───────────────────────────────────────────────────────

export function AktionenWidget({ eintraege, kampagnen, istAdmin }: { eintraege: Eintrag[]; kampagnen: KampagneDaten[]; istAdmin: boolean }) {
  const { liste, fehler, neu, loeschen } = useEintraege(eintraege, "aktion");
  const [titel, setTitel] = useState("");
  const [von, setVon] = useState("");
  const [bis, setBis] = useState("");
  const heute = heuteIso();
  type Zeile = { id: string; name: string; von: string | null; bis: string | null; farbe: string; notiz: string | null; eigen: boolean };
  const alle: Zeile[] = [
    ...kampagnen.map((k) => ({ id: k.id, name: k.name, von: k.von, bis: k.bis, farbe: k.farbe, notiz: k.notiz, eigen: false })),
    ...liste.map((e) => ({ id: e.id, name: e.titel, von: e.daten.von ?? null, bis: e.daten.bis ?? null, farbe: "#7c5cff", notiz: e.text || null, eigen: true })),
  ].sort((a, b) => (a.von ?? "").localeCompare(b.von ?? ""));
  const status = (z: Zeile) => (z.von && z.von > heute ? { text: `ab ${tagMonat(z.von)}`, ton: "akzent" } : z.bis && z.bis < heute ? { text: "beendet", ton: undefined } : { text: "läuft", ton: "ok" });
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <Fehler text={fehler} />
      {!alle.length && <Hinweis>Gerade läuft keine Aktion.</Hinweis>}
      {alle.map((z) => {
        const s = status(z);
        const tageBis = z.von && z.von > heute ? Math.round((Date.parse(z.von) - Date.parse(heute)) / 86_400_000) : null;
        const tageRest = !tageBis && z.bis && z.bis >= heute ? Math.round((Date.parse(z.bis) - Date.parse(heute)) / 86_400_000) : null;
        return (
          <div key={z.id} className="ck-aktion" data-vorbei={s.text === "beendet"} style={{ ["--f" as string]: z.farbe }}>
            <div style={{ display: "flex", gap: 8, alignItems: "flex-start", position: "relative", zIndex: 1 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 15, fontWeight: 700, overflowWrap: "anywhere" }}>{z.name}</div>
                <div className="ck-mono" style={{ fontSize: 12, opacity: 0.92, display: "flex", gap: 5, alignItems: "center", marginTop: 2 }}>
                  <CalendarClock size={12} /> {z.von ? tagMonat(z.von) : "?"} – {z.bis ? tagMonat(z.bis) : "offen"}
                </div>
              </div>
              <div style={{ textAlign: "right", flex: "none" }}>
                {tageBis != null ? (
                  <><div className="ck-mono" style={{ fontSize: 24, fontWeight: 750, lineHeight: 1 }}>{tageBis}</div><div style={{ fontSize: 10.5, opacity: 0.92 }}>{tageBis === 1 ? "Tag bis Start" : "Tage bis Start"}</div></>
                ) : tageRest != null ? (
                  <><div className="ck-mono" style={{ fontSize: 24, fontWeight: 750, lineHeight: 1 }}>{tageRest}</div><div style={{ fontSize: 10.5, opacity: 0.92 }}>{tageRest === 1 ? "Tag läuft noch" : "Tage läuft noch"}</div></>
                ) : <span style={{ fontSize: 12, fontWeight: 650 }}>{s.text}</span>}
              </div>
              {z.eigen && istAdmin && <button type="button" className="ck-icon-knopf" style={{ color: "#fff" }} aria-label="Aktion löschen" onClick={() => loeschen(z.id)}><Trash2 size={13} /></button>}
            </div>
            {z.notiz && <div style={{ fontSize: 12, marginTop: 6, lineHeight: 1.4, opacity: 0.95, position: "relative", zIndex: 1 }}>{z.notiz}</div>}
          </div>
        );
      })}
      {istAdmin && (
        <form
          onSubmit={async (e) => {
            e.preventDefault();
            const t = titel.trim();
            if (!t) return;
            setTitel("");
            await neu({ titel: t, daten: { ...(von ? { von } : {}), ...(bis ? { bis } : {}) } });
            setVon(""); setBis("");
          }}
          style={{ display: "grid", gap: 6 }}
        >
          <input value={titel} onChange={(e) => setTitel(e.target.value)} placeholder="Neue Aktion …" />
          <div style={{ display: "flex", gap: 6 }}>
            <input type="date" value={von} onChange={(e) => setVon(e.target.value)} aria-label="Beginn" style={{ flex: 1, minWidth: 0 }} />
            <input type="date" value={bis} onChange={(e) => setBis(e.target.value)} aria-label="Ende" style={{ flex: 1, minWidth: 0 }} />
            <button type="submit" className="ck-knopf ck-knopf-klein" style={{ height: 32 }} aria-label="Aktion anlegen"><Plus size={14} /></button>
          </div>
        </form>
      )}
    </div>
  );
}

// ── Firmenphilosophie ───────────────────────────────────────────────────────

export function PhilosophieWidget({ eintraege, istAdmin }: { eintraege: Eintrag[]; istAdmin: boolean }) {
  const { liste, fehler, neu, aendern } = useEintraege(eintraege, "philosophie");
  const [bearbeiten, setBearbeiten] = useState(false);
  const e = liste[0];
  const speichern = async (text: string) => {
    setBearbeiten(false);
    if (e) await aendern(e.id, { text });
    else if (text.trim()) await neu({ text });
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", gap: 6 }}>
      <Fehler text={fehler} />
      {bearbeiten ? (
        <textarea autoFocus defaultValue={e?.text ?? ""} placeholder="Wofür steht Hairvenly? Was ist uns wichtig?" onBlur={(ev) => speichern(ev.target.value)} style={{ flex: 1, minHeight: 90, width: "100%", resize: "none" }} />
      ) : e?.text ? (
        <div style={{ position: "relative", paddingLeft: 34 }}>
          <Quote size={24} style={{ position: "absolute", left: 0, top: 0, color: "var(--w)", opacity: 0.55 }} />
          <div style={{ fontSize: 16, lineHeight: 1.5, whiteSpace: "pre-wrap", fontWeight: 550 }}>{e.text}</div>
        </div>
      ) : (
        <Hinweis>{istAdmin ? "Hier steht, wofür Hairvenly steht – damit es jede im Team jeden Tag vor Augen hat." : "Noch nichts eingetragen."}</Hinweis>
      )}
      {istAdmin && !bearbeiten && (
        <button type="button" className="ck-link" style={{ background: "none", border: 0, cursor: "pointer", padding: 0, marginTop: "auto", alignSelf: "flex-start" }} onClick={() => setBearbeiten(true)}>
          {e?.text ? "Bearbeiten" : "Jetzt eintragen"}
        </button>
      )}
    </div>
  );
}
