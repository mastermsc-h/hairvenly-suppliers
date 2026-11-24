"use client";

// Rahmen des Startbildschirms: Kopfzeile, verschiebbares Raster, Anpassen-Modus.
// Die Inhalte der Widgets kommen fertig vom Server (inhalte[id]).
import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import ReactGridLayout, { useContainerWidth, verticalCompactor, type Compactor, type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import {
  Activity, BadgePercent, CheckSquare, Compass, Eye, EyeOff, Flag, Gauge, Globe2, Camera, Newspaper, Repeat, Smile, Sprout, Images, CloudSun, CloudLightning, Inbox, Target, Megaphone, PackageX, HeartPulse, Lightbulb, MessageSquare,
  MousePointerClick, Landmark, Clapperboard, Briefcase, Stamp, RotateCcw, Settings2, SlidersHorizontal, Zap, ShoppingBag, StickyNote, TrendingUp, Wallet, Waves, Check, GripVertical, BrainCircuit,
} from "lucide-react";
import { cockpitLayoutZuruecksetzen, speichereCockpitLayout } from "@/lib/actions/cockpit";
import { Plus, X } from "lucide-react";
import { KACHEL_STILE, MIN_GROESSE, RASTER_FAKTOR, STANDARD_LAYOUT, WIDGETS, type CockpitLayout, type KachelStil, type LayoutItem } from "@/lib/cockpit/typen";
import Adern from "./adern";
import "./cockpit.css";

const ICONS: Record<string, React.ComponentType<{ size?: number }>> = {
  hi: BrainCircuit,
  lage: Activity, umsatz: TrendingUp, chats: MessageSquare, hy: HeartPulse, aufgaben: CheckSquare, pflichten: Wallet,
  shopify: ShoppingBag, besucher: MousePointerClick, notizen: StickyNote, ideen: Lightbulb, pfeiler: Gauge,
  meilensteine: Flag, ausland: Globe2, toteskapital: PackageX, marketing: Megaphone, instagram: Camera, sturm: CloudLightning, newsletter: Newspaper, routinen: Repeat, hailey: Smile, pflanze: Sprout, polaroid: Images, wetter: CloudSun, iganfragen: Inbox, werbung: Target, aktionen: BadgePercent, steuerkasse: Landmark, kanaele: Clapperboard, gewerbe: Briefcase, team: Stamp, philosophie: Compass, liquiditaet: Waves,
};

/** Fenster ohne sichtbaren Rahmen: die Form gibt der Inhalt (Figur, Pflanze, Fotos, Kreis, Zeitung). */
const FREI = new Set(["hailey", "pflanze", "polaroid", "wetter"]);

const SPALTEN = 12;
/** Feines Raster: 10-px-Zeilen ohne senkrechten Rand. Der sichtbare Abstand nach unten entsteht,
 *  weil jedes Fenster um „abstand" kürzer ist als sein Rasterplatz (CSS). So bleibt ein Fenster
 *  genau dort, wo man es loslässt (kein automatisches Hochrutschen). */
const ZEILE = 10;
const ABSTAND_STANDARD = 12;

const nurPos = (l: ReadonlyArray<LayoutItem>): LayoutItem[] => l.map((x) => ({ i: x.i, x: x.x, y: x.y, w: x.w, h: x.h }));

type Geo = { x: number; y: number; w: number; h: number };
type Aktiv = { id: string; art: "zug" | "groesse"; start: Map<string, Geo> } | null;

const ueberlappt = (a: Geo, b: Geo) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;

/**
 * Eigene Kollisionsauflösung für freies Platzieren (statt der Bibliotheks-Logik, die Fenster
 * vertauscht, Verschiebungen aufsummiert und beim Größe-Ändern gar nicht auflöst):
 *  - Während Ziehen/Größe ändern wird IMMER von der Anordnung beim Start der Geste ausgegangen,
 *    nur das aktive Fenster nimmt seine neue Lage ein → nichts springt hin und her.
 *  - Das aktive Fenster bleibt fest; alle anderen behalten ihre Lage, außer sie überlappen –
 *    dann rutschen sie genau so weit nach unten wie nötig (nie seitlich, nie nach oben).
 *  - Beim Ziehen verdrängt das Fenster ein anderes nur, wenn seine Oberkante über dessen
 *    Oberkante hinaus gezogen wird („überholt“). Ragt es nur von unten hinein, dockt es direkt
 *    unter dem anderen an – sonst flöge das obere Fenster samt allem darunter weit nach unten.
 *  - Nach oben ziehen / kürzer machen: alles, was darunter lag, kommt um dieselbe Strecke mit.
 *  - Ohne Geste (Laden, Hinzufügen) werden vorhandene Überlappungen genauso aufgelöst.
 */
function freiAufloesen(layout: Layout, aktiv: Aktiv): Layout {
  const neu = layout.map((it) => {
    const s = aktiv && it.i !== aktiv.id ? aktiv.start.get(it.i) : undefined;
    return { ...it, ...(s ?? {}), y: Math.max(0, s?.y ?? it.y), moved: false };
  });
  const a = aktiv ? neu.find((it) => it.i === aktiv.id) : undefined;
  if (a && aktiv?.art === "zug") {
    const andere = neu.filter((it) => it !== a);
    for (let k = 0; k < 200; k++) {
      const drueber = andere.filter((o) => o.y < a.y && ueberlappt(o, a));
      if (!drueber.length) break;
      a.y = Math.max(...drueber.map((o) => o.y + o.h));
    }
  }
  // Mitziehen: wird das Fenster nach oben gezogen (oder kürzer gemacht), kommen alle Fenster,
  // die komplett darunter lagen, um dieselbe Strecke mit hoch – kein einzelnes Nachschieben.
  const alt = a && aktiv ? aktiv.start.get(a.i) : undefined;
  const hoch = a && alt ? (aktiv?.art === "zug" ? alt.y - a.y : alt.y + alt.h - (a.y + a.h)) : 0;
  const folger = new Set<LayoutItem>();
  if (a && alt && hoch > 0) {
    for (const it of neu) {
      if (it === a || it.y < alt.y + alt.h) continue;
      it.y = Math.max(0, it.y - hoch);
      folger.add(it);
    }
  }
  const nachY = (p: LayoutItem, q: LayoutItem) => p.y - q.y || p.x - q.x;
  // Reihenfolge: aktives Fenster fest, dann die stehenbleibenden, zuletzt die mitgezogenen –
  // so schieben die mitgezogenen nie ein stehendes Fenster weg, sondern docken darunter an.
  const stehend = neu.filter((it) => it !== a && !folger.has(it)).sort(nachY);
  const mit = [...folger].sort(nachY);
  const platziert: Geo[] = a ? [a] : [];
  for (const it of [...stehend, ...mit]) {
    for (let k = 0; k < 500; k++) {
      const stoss = platziert.filter((p) => ueberlappt(p, it));
      if (!stoss.length) break;
      it.y = Math.max(...stoss.map((p) => p.y + p.h));
    }
    platziert.push(it);
  }
  return neu;
}

/** Gespeicherte Anordnung + neue Widgets (unten angehängt) − nicht erlaubte.
 *  Alte Anordnungen (40-px-Zeilen) werden ×4 umgerechnet und einmal so verdichtet,
 *  wie sie bisher angezeigt wurden – das Bild bleibt gleich. */
function baueLayout(gespeichert: CockpitLayout | null, erlaubt: string[]): { items: LayoutItem[]; aus: string[] } {
  const ok = new Set(erlaubt);
  const aus = (gespeichert?.aus ?? []).filter((id) => ok.has(id));
  const fein = gespeichert?.raster === 2;
  const roh = gespeichert
    ? gespeichert.items.map((it) => (fein ? it : { ...it, y: it.y * RASTER_FAKTOR, h: it.h * RASTER_FAKTOR }))
    : STANDARD_LAYOUT;
  const gefiltert = roh.filter((it) => ok.has(it.i) && !aus.includes(it.i));
  const basis = [
    ...(fein ? gefiltert : nurPos(verticalCompactor.compact(gefiltert as Layout, SPALTEN) as LayoutItem[])),
    ...roh.filter((it) => ok.has(it.i) && aus.includes(it.i)),
  ];
  const da = new Set(basis.map((it) => it.i));
  let unten = basis.reduce((m, it) => Math.max(m, it.y + it.h), 0);
  const items = [...basis];
  for (const std of STANDARD_LAYOUT) {
    if (!ok.has(std.i) || da.has(std.i) || aus.includes(std.i)) continue;
    items.push({ ...std, x: 0, y: unten });
    unten += std.h;
  }
  return { items, aus };
}

/** Aktuelle Zeit, alle 20 Sekunden neu; auf dem Server null (kein Hydration-Unterschied). */
function useJetzt(): Date | null {
  const takt = useSyncExternalStore(
    (cb) => { const t = setInterval(cb, 20_000); return () => clearInterval(t); },
    () => Math.floor(Date.now() / 20_000),
    () => null,
  );
  return takt == null ? null : new Date();
}

function Uhr() {
  const jetzt = useJetzt();
  if (!jetzt) return <span className="ck-uhr ck-mono">&nbsp;</span>;
  return (
    <div style={{ textAlign: "right" }}>
      <div className="ck-uhr ck-mono">{jetzt.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" })}</div>
      <div className="ck-etikett">{jetzt.toLocaleDateString("de-DE", { weekday: "long", day: "numeric", month: "long", timeZone: "Europe/Berlin" })}</div>
    </div>
  );
}

/**
 * Plus-Felder auf freien Stellen des Rasters: jede Lücke (mind. 2 Spalten × 100 px) und ein
 * Feld unter dem letzten Fenster. Klick öffnet die Auswahl der nicht gezeigten Fenster.
 */
function PlusFelder({ layout, breite, abstand, zeile, verfuegbar, offen, setOffen, hinzufuegen }: {
  layout: LayoutItem[]; breite: number; abstand: number; zeile: number;
  verfuegbar: ReadonlyArray<{ id: string; name: string; info: string }>;
  offen: string | null; setOffen: (k: string | null) => void;
  hinzufuegen: (id: string, x: number, y: number, maxW: number, maxH: number) => void;
}) {
  if (!verfuegbar.length) return null;
  const PAD_X = 16, PAD_Y = 8;
  const spalteB = (breite - 2 * PAD_X - abstand * (SPALTEN - 1)) / SPALTEN;
  const unten = layout.reduce((m, it) => Math.max(m, it.y + it.h), 0);
  const belegt = (x: number, y: number) => layout.some((it) => x >= it.x && x < it.x + it.w && y >= it.y && y < it.y + it.h);
  const felder: Array<{ x: number; y: number; w: number; h: number }> = [];
  let vorher: Array<[number, number]> = [];
  for (let y = 0; y < unten; y++) {
    const laeufe: Array<[number, number]> = [];
    for (let x = 0; x < SPALTEN;) {
      if (belegt(x, y)) { x++; continue; }
      let e = x;
      while (e < SPALTEN && !belegt(e, y)) e++;
      laeufe.push([x, e]);
      x = e;
    }
    for (const [a, e] of laeufe) {
      if (e - a < 2 || vorher.some(([va, ve]) => va === a && ve === e)) continue; // Lücke läuft von oben weiter
      if (felder.some((f) => a < f.x + f.w && e > f.x && y < f.y + f.h)) continue; // schon von einem Feld abgedeckt
      let h = 0;
      while (y + h < unten && Array.from({ length: e - a }, (_, k) => a + k).every((x) => !belegt(x, y + h))) h++;
      if (h >= 10) felder.push({ x: a, y, w: e - a, h: Math.min(h, 40) });
    }
    vorher = laeufe;
  }
  felder.push({ x: 0, y: unten, w: SPALTEN, h: 12 });
  return (
    <div className="ck-plus-ebene" aria-label="Freie Stellen">
      {felder.slice(0, 16).map((f) => {
        const k = `${f.x}-${f.y}`;
        const style = {
          left: 8 + PAD_X + f.x * (spalteB + abstand),
          top: 4 + PAD_Y + f.y * zeile,
          width: f.w * spalteB + (f.w - 1) * abstand,
          height: f.h * zeile - abstand,
        };
        return (
          <div key={k} className="ck-plus-feld" data-offen={offen === k} style={style}>
            <button type="button" className="ck-plus-knopf" onClick={() => setOffen(offen === k ? null : k)} aria-label="Fenster hier hinzufügen" title="Fenster hier hinzufügen"><Plus size={18} /></button>
            {offen === k && (
              <div className="ck-plus-wahl" role="menu">
                <div className="ck-plus-wahl-kopf">Hier hinzufügen oder hierher holen</div>
                {verfuegbar.map((w) => (
                  <button key={w.id} type="button" role="menuitem" onClick={() => hinzufuegen(w.id, f.x, f.y, f.w, f.y + f.h >= unten ? 999 : f.h)}>
                    <b>{w.name}</b><span>{w.info}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function gruss(stunde: number) {
  return stunde < 5 ? "Gute Nacht" : stunde < 11 ? "Guten Morgen" : stunde < 18 ? "Hallo" : "Guten Abend";
}

export default function CockpitGrid({
  name, erlaubt, gespeichert, inhalte,
}: {
  name: string;
  erlaubt: string[];
  gespeichert: CockpitLayout | null;
  inhalte: Record<string, React.ReactNode>;
}) {
  const start = useMemo(() => baueLayout(gespeichert, erlaubt), [gespeichert, erlaubt]);
  const [items, setItems] = useState<LayoutItem[]>(start.items);
  const [aus, setAus] = useState<string[]>(start.aus);
  const [adern, setAdern] = useState(gespeichert?.adern !== false);
  const [abstand, setAbstand] = useState(gespeichert?.abstand ?? ABSTAND_STANDARD);
  const [stil, setStil] = useState<KachelStil>(gespeichert?.stil ?? "standard");
  const [darstellung, setDarstellung] = useState(false);
  // aktuelle Darstellungs-Werte für das (verzögerte) Speichern
  const adernRef = useRef(adern);
  const abstandRef = useRef(abstand);
  const stilRef = useRef(stil);
  const [anpassen, setAnpassen] = useState(false);
  // Anordnung, wie das Raster sie gerade zeigt (nach dem Verdichten) – Grundlage für die Plus-Felder
  const [angezeigt, setAngezeigt] = useState<LayoutItem[] | null>(null);
  const [plusOffen, setPlusOffen] = useState<string | null>(null);
  // Fenster, das gerade gezogen/in der Größe geändert wird, samt Anordnung beim Start der Geste
  const aktivRef = useRef<Aktiv>(null);
  const [geste, setGeste] = useState(false); // gerade ziehen/vergrößern → Plus-Felder zeigen
  const compactor = useMemo<Compactor>(() => ({
    type: null,
    allowOverlap: true, // Bibliothek schiebt selbst nichts – die Auflösung macht freiAufloesen
    compact: (l) => freiAufloesen(l, aktivRef.current),
  }), []);
  const gesteStart = (l: Layout, it: { i: string } | null, art: "zug" | "groesse") => {
    setGeste(!!it);
    aktivRef.current = it ? { id: it.i, art, start: new Map(l.map((x) => [x.i, { x: x.x, y: x.y, w: x.w, h: x.h }])) } : null;
  };
  const [status, setStatus] = useState<"" | "speichert" | "gespeichert" | "fehler">("");
  const jetzt = useJetzt();
  const stunde = jetzt ? Number(new Intl.DateTimeFormat("de-DE", { hour: "numeric", hour12: false, timeZone: "Europe/Berlin" }).format(jetzt)) : null;
  const { width, containerRef, mounted } = useContainerWidth();
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const schmal = mounted && width < 860;

  const speichern = useCallback((neu: LayoutItem[], neuAus: string[]) => {
    if (timer.current) clearTimeout(timer.current);
    setStatus("speichert");
    timer.current = setTimeout(async () => {
      const res = await speichereCockpitLayout({ items: neu, aus: neuAus, adern: adernRef.current, abstand: abstandRef.current, stil: stilRef.current, raster: 2 });
      setStatus(res.ok ? "gespeichert" : "fehler");
      if (res.ok) setTimeout(() => setStatus((s) => (s === "gespeichert" ? "" : s)), 1800);
    }, 700);
  }, []);

  const sichtbar = items.filter((it) => !aus.includes(it.i));
  const layout: Layout = sichtbar.map((it) => ({ ...it, minW: MIN_GROESSE[it.i]?.w ?? 2, minH: MIN_GROESSE[it.i]?.h ?? 2 * RASTER_FAKTOR }));

  /** Nach Ziehen/Größe ändern: Positionen übernehmen und speichern. */
  const uebernehmen = (l: Layout) => {
    const pos = new Map(l.map((x) => [x.i, x]));
    const neu = items.map((it) => {
      const p = pos.get(it.i);
      return p ? { i: it.i, x: p.x, y: p.y, w: p.w, h: p.h } : it;
    });
    setItems(neu);
    speichern(neu, aus);
  };

  const umschalten = (id: string) => {
    let neuItems = items;
    let neuAus: string[];
    if (aus.includes(id)) {
      neuAus = aus.filter((x) => x !== id);
      // wieder einblenden: unten anhängen, damit nichts verrutscht
      const unten = sichtbar.reduce((m, it) => Math.max(m, it.y + it.h), 0);
      const std = STANDARD_LAYOUT.find((s) => s.i === id)!;
      const alt = items.find((it) => it.i === id);
      neuItems = [...items.filter((it) => it.i !== id), { i: id, x: 0, y: unten, w: alt?.w ?? std.w, h: alt?.h ?? std.h }];
    } else {
      neuAus = [...aus, id];
    }
    setItems(neuItems);
    setAus(neuAus);
    speichern(neuItems, neuAus);
  };

  const adernUmschalten = () => {
    adernRef.current = !adern;
    setAdern(!adern);
    speichern(items, aus);
  };

  const abstandSetzen = (px: number) => {
    abstandRef.current = px;
    setAbstand(px);
    speichern(items, aus);
  };

  const stilSetzen = (s: KachelStil) => {
    stilRef.current = s;
    setStil(s);
    speichern(items, aus);
  };

  const zuruecksetzen = async () => {
    if (!window.confirm("Anordnung auf den Standard zurücksetzen? Deine Notizen und Einträge bleiben erhalten.")) return;
    const std = baueLayout(null, erlaubt);
    setItems(std.items);
    setAus([]);
    setAdern(true); adernRef.current = true;
    setAbstand(ABSTAND_STANDARD); abstandRef.current = ABSTAND_STANDARD;
    setStil("standard"); stilRef.current = "standard";
    if (timer.current) clearTimeout(timer.current);
    const res = await cockpitLayoutZuruecksetzen();
    setStatus(res.ok ? "gespeichert" : "fehler");
  };

  const panel = (id: string, i: number) => {
    const w = WIDGETS.find((x) => x.id === id);
    if (!w) return null;
    const Icon = ICONS[id] ?? Activity;
    return (
      <section className="ck-panel" data-w={id} data-frei={FREI.has(id)} style={{ ["--ck-i" as string]: i }} aria-label={w.name}>
        <header className={`ck-kopf ${schmal ? "" : "ck-griff"}`} title={schmal ? undefined : "Ziehen zum Verschieben"}>
          <span className="ck-abzeichen"><Icon size={15} /></span>
          <span className="ck-titel">{w.name}</span>
          <div className="ck-kopf-rechts">
            <button type="button" className="ck-icon-knopf ck-rot ck-kein-zug ck-entfernen" aria-label={`${w.name} entfernen`} title="Fenster entfernen (über ein Plus oder „Anpassen“ wieder holen)" onClick={() => umschalten(id)}>
              <X size={14} />
            </button>
            {!schmal && <GripVertical size={14} style={{ color: "var(--ck-matt)" }} />}
          </div>
        </header>
        <div className="ck-inhalt">{inhalte[id]}</div>
      </section>
    );
  };

  const reihenfolge = [...sichtbar].sort((a, b) => a.y - b.y || a.x - b.x);

  return (
    <div className="ck" data-anpassen={anpassen} data-geste={geste} data-stil={stil}>
      <div className="ck-top">
        <div>
          <div className="ck-marke-oben">Hairvenly · Überblick</div>
          <div className="ck-gruss">{stunde == null ? "Hallo" : gruss(stunde)}, <b>{name}</b></div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          {status && (
            <span className="ck-etikett" style={{ color: status === "fehler" ? "var(--ck-alarm)" : "var(--ck-dim)", display: "inline-flex", gap: 5, alignItems: "center" }} role="status">
              {status === "gespeichert" && <Check size={12} />}
              {status === "speichert" ? "Speichert …" : status === "gespeichert" ? "Gespeichert" : "Anordnung nicht gespeichert"}
            </span>
          )}
          <div style={{ position: "relative" }}>
            <button type="button" className="ck-knopf" data-aktiv={darstellung} aria-expanded={darstellung} onClick={() => setDarstellung(!darstellung)}>
              <SlidersHorizontal size={15} /> Darstellung
            </button>
            {darstellung && (
              <>
                <div style={{ position: "fixed", inset: 0, zIndex: 40 }} onClick={() => setDarstellung(false)} aria-hidden />
                <div className="ck-menue" role="dialog" aria-label="Darstellung">
                  <div className="ck-menue-zeile" style={{ cursor: "default" }}><span>Stil der Fenster</span></div>
                  <div className="ck-stile" role="radiogroup" aria-label="Stil der Fenster">
                    {KACHEL_STILE.map((s) => (
                      <button key={s.id} type="button" role="radio" aria-checked={stil === s.id} className="ck-stil" data-stil-wahl={s.id} data-an={stil === s.id} onClick={() => stilSetzen(s.id)} title={s.info}>
                        <span className="ck-stil-vorschau" aria-hidden />
                        {s.name}
                      </button>
                    ))}
                  </div>
                  <div className="ck-trenner" />
                  <button type="button" className="ck-menue-zeile" role="switch" aria-checked={adern} onClick={adernUmschalten}>
                    <span style={{ display: "inline-flex", gap: 8, alignItems: "center" }}><Zap size={15} /> Datenfluss</span>
                    <i className="ck-kipp" />
                  </button>
                  <div className="ck-matt" style={{ fontSize: 11.5, margin: "-2px 0 10px 23px" }}>Goldene Lichtpulse zwischen den Fenstern</div>
                  <div className="ck-trenner" />
                  <label className="ck-menue-zeile" style={{ cursor: "default" }} htmlFor="ck-abstand">
                    <span>Abstand zwischen den Fenstern</span>
                    <span className="ck-mono ck-dim">{abstand} px</span>
                  </label>
                  <input id="ck-abstand" type="range" min={4} max={32} step={2} value={abstand} onChange={(e) => abstandSetzen(Number(e.target.value))} style={{ width: "100%" }} />
                  <div className="ck-matt" style={{ fontSize: 11, display: "flex", justifyContent: "space-between" }}><span>eng</span><span>luftig</span></div>
                </div>
              </>
            )}
          </div>
          <button type="button" className="ck-knopf" data-aktiv={anpassen} onClick={() => setAnpassen(!anpassen)}>
            <Settings2 size={15} /> {anpassen ? "Fertig" : "Anpassen"}
          </button>
          <Uhr />
        </div>
      </div>

      {anpassen && (
        <div className="ck-auswahl">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
            <div style={{ fontSize: 13 }}>
              <b>Dein Startbildschirm.</b>{" "}
              <span className="ck-dim">Fenster an der Kopfzeile verschieben, am rechten oder unteren Rand größer und kleiner ziehen – das geht jederzeit. Hier blendest du Fenster ein und aus. Gilt nur für dich.</span>
            </div>
            <button type="button" className="ck-knopf ck-knopf-klein" onClick={zuruecksetzen}><RotateCcw size={13} /> Standard</button>
          </div>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
            {WIDGETS.filter((w) => erlaubt.includes(w.id)).map((w) => {
              const an = !aus.includes(w.id);
              return (
                <button key={w.id} type="button" className="ck-chip" data-an={an} onClick={() => umschalten(w.id)} title={w.info}>
                  {an ? <Eye size={13} /> : <EyeOff size={13} />} {w.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div ref={containerRef}>
        {!mounted ? (
          <div style={{ height: 600 }} />
        ) : schmal ? (
          <div className="ck-stapel" style={{ gap: abstand }}>
            {reihenfolge.map((it, i) => <div key={it.i}>{panel(it.i, i)}</div>)}
          </div>
        ) : (
          <div className="ck-raster" style={{ ["--ck-abstand" as string]: `${abstand}px` }}>
            <Adern aktiv={adern} abstand={abstand} />
            <ReactGridLayout
              width={width - 16}
              layout={layout}
              gridConfig={{ cols: SPALTEN, rowHeight: ZEILE, margin: [abstand, 0], containerPadding: [16, 8] }}
              dragConfig={{ enabled: true, handle: ".ck-griff", cancel: ".ck-kein-zug" }}
              resizeConfig={{ enabled: true, handles: ["se", "e", "s"] }}
              compactor={compactor}
              onDragStart={(l, alt) => gesteStart(l, alt, "zug")}
              onResizeStart={(l, alt) => gesteStart(l, alt, "groesse")}
              onDragStop={(l) => { aktivRef.current = null; setGeste(false); uebernehmen(l); }}
              onResizeStop={(l) => { aktivRef.current = null; setGeste(false); uebernehmen(l); }}
              onLayoutChange={(l) => setAngezeigt(l.map((x) => ({ i: x.i, x: x.x, y: x.y, w: x.w, h: x.h })))}
            >
              {reihenfolge.map((it, i) => <div key={it.i}>{panel(it.i, i)}</div>)}
            </ReactGridLayout>
            <PlusFelder
              layout={angezeigt ?? (freiAufloesen(layout, null) as LayoutItem[])}
              breite={width - 16}
              abstand={abstand}
              zeile={ZEILE}
              verfuegbar={[
                // zuerst, was noch nicht zu sehen ist – danach alle gezeigten (die werden hierher verschoben)
                ...WIDGETS.filter((w) => erlaubt.includes(w.id) && (aus.includes(w.id) || !items.some((it) => it.i === w.id))),
                ...WIDGETS.filter((w) => erlaubt.includes(w.id) && !aus.includes(w.id) && items.some((it) => it.i === w.id))
                  .map((w) => ({ id: w.id, name: w.name, info: "Schon zu sehen – wird hierher verschoben" })),
              ]}
              offen={plusOffen}
              setOffen={setPlusOffen}
              hinzufuegen={(id, x, y, maxW, maxH) => {
                const std = STANDARD_LAYOUT.find((s) => s.i === id);
                const min = MIN_GROESSE[id]?.w ?? 2;
                const neu = { i: id, x, y, w: Math.max(min, Math.min(std?.w ?? 4, maxW)), h: Math.max(MIN_GROESSE[id]?.h ?? 8, Math.min(std?.h ?? 32, maxH)) };
                const alt = items.find((it) => it.i === id && !aus.includes(id));
                if (alt) { neu.w = Math.max(min, Math.min(alt.w, maxW)); neu.h = Math.max(MIN_GROESSE[id]?.h ?? 8, Math.min(alt.h, maxH)); }
                const neuItems = [...items.filter((it) => it.i !== id), neu];
                const neuAus = aus.filter((a) => a !== id);
                setItems(neuItems);
                setAus(neuAus);
                setPlusOffen(null);
                speichern(neuItems, neuAus);
              }}
            />
          </div>
        )}
      </div>
    </div>
  );
}
