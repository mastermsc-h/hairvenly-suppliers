"use client";

// Rahmen des Startbildschirms: Kopfzeile, verschiebbares Raster, Anpassen-Modus.
// Die Inhalte der Widgets kommen fertig vom Server (inhalte[id]).
import { useCallback, useMemo, useRef, useState, useSyncExternalStore } from "react";
import ReactGridLayout, { useContainerWidth, verticalCompactor, type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";
import {
  Activity, BadgePercent, CheckSquare, Compass, Eye, EyeOff, Flag, Gauge, Globe2, Megaphone, PackageX, HeartPulse, Lightbulb, MessageSquare,
  MousePointerClick, RotateCcw, Settings2, SlidersHorizontal, Zap, ShoppingBag, StickyNote, TrendingUp, Wallet, Waves, Check, GripVertical, BrainCircuit,
} from "lucide-react";
import { cockpitLayoutZuruecksetzen, speichereCockpitLayout } from "@/lib/actions/cockpit";
import { MIN_GROESSE, STANDARD_LAYOUT, WIDGETS, type CockpitLayout, type LayoutItem } from "@/lib/cockpit/typen";
import Adern from "./adern";
import "./cockpit.css";

const ICONS: Record<string, React.ComponentType<{ size?: number }>> = {
  hi: BrainCircuit,
  lage: Activity, umsatz: TrendingUp, chats: MessageSquare, hy: HeartPulse, aufgaben: CheckSquare, pflichten: Wallet,
  shopify: ShoppingBag, besucher: MousePointerClick, notizen: StickyNote, ideen: Lightbulb, pfeiler: Gauge,
  meilensteine: Flag, ausland: Globe2, toteskapital: PackageX, marketing: Megaphone, aktionen: BadgePercent, philosophie: Compass, liquiditaet: Waves,
};

const SPALTEN = 12;
const ZEILE = 28;
const ABSTAND_STANDARD = 12;
// Zeilenhöhe + Abstand bleiben zusammen konstant (40 px): ein größerer Abstand macht die
// Fenster nicht höher, sondern nur die Spalte dazwischen breiter.

/** Gespeicherte Anordnung + neue Widgets (unten angehängt) − nicht erlaubte. */
function baueLayout(gespeichert: CockpitLayout | null, erlaubt: string[]): { items: LayoutItem[]; aus: string[] } {
  const ok = new Set(erlaubt);
  const aus = (gespeichert?.aus ?? []).filter((id) => ok.has(id));
  const basis = (gespeichert?.items ?? STANDARD_LAYOUT).filter((it) => ok.has(it.i));
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
  const [darstellung, setDarstellung] = useState(false);
  // aktuelle Darstellungs-Werte für das (verzögerte) Speichern
  const adernRef = useRef(adern);
  const abstandRef = useRef(abstand);
  const [anpassen, setAnpassen] = useState(false);
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
      const res = await speichereCockpitLayout({ items: neu, aus: neuAus, adern: adernRef.current, abstand: abstandRef.current });
      setStatus(res.ok ? "gespeichert" : "fehler");
      if (res.ok) setTimeout(() => setStatus((s) => (s === "gespeichert" ? "" : s)), 1800);
    }, 700);
  }, []);

  const sichtbar = items.filter((it) => !aus.includes(it.i));
  const layout: Layout = sichtbar.map((it) => ({ ...it, minW: MIN_GROESSE[it.i]?.w ?? 2, minH: MIN_GROESSE[it.i]?.h ?? 2 }));

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

  const zuruecksetzen = async () => {
    if (!window.confirm("Anordnung auf den Standard zurücksetzen? Deine Notizen und Einträge bleiben erhalten.")) return;
    const std = baueLayout(null, erlaubt);
    setItems(std.items);
    setAus([]);
    setAdern(true); adernRef.current = true;
    setAbstand(ABSTAND_STANDARD); abstandRef.current = ABSTAND_STANDARD;
    if (timer.current) clearTimeout(timer.current);
    const res = await cockpitLayoutZuruecksetzen();
    setStatus(res.ok ? "gespeichert" : "fehler");
  };

  const panel = (id: string, i: number) => {
    const w = WIDGETS.find((x) => x.id === id);
    if (!w) return null;
    const Icon = ICONS[id] ?? Activity;
    return (
      <section className="ck-panel" data-w={id} style={{ ["--ck-i" as string]: i }} aria-label={w.name}>
        <header className={`ck-kopf ${schmal ? "" : "ck-griff"}`} title={schmal ? undefined : "Ziehen zum Verschieben"}>
          <span className="ck-abzeichen"><Icon size={15} /></span>
          <span className="ck-titel">{w.name}</span>
          <div className="ck-kopf-rechts">
            {anpassen && (
              <button type="button" className="ck-icon-knopf ck-rot ck-kein-zug" aria-label={`${w.name} ausblenden`} onClick={() => umschalten(id)}>
                <EyeOff size={14} />
              </button>
            )}
            {!schmal && <GripVertical size={14} style={{ color: "var(--ck-matt)" }} />}
          </div>
        </header>
        <div className="ck-inhalt">{inhalte[id]}</div>
      </section>
    );
  };

  const reihenfolge = [...sichtbar].sort((a, b) => a.y - b.y || a.x - b.x);

  return (
    <div className="ck" data-anpassen={anpassen}>
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
          <div className="ck-raster">
            <Adern aktiv={adern} abstand={abstand} />
            <ReactGridLayout
              width={width - 16}
              layout={layout}
              gridConfig={{ cols: SPALTEN, rowHeight: ZEILE + ABSTAND_STANDARD - abstand, margin: [abstand, abstand], containerPadding: [16, 8] }}
              dragConfig={{ enabled: true, handle: ".ck-griff", cancel: ".ck-kein-zug" }}
              resizeConfig={{ enabled: true, handles: ["se", "e", "s"] }}
              compactor={verticalCompactor}
              onDragStop={(l) => uebernehmen(l)}
              onResizeStop={(l) => uebernehmen(l)}
            >
              {reihenfolge.map((it, i) => <div key={it.i}>{panel(it.i, i)}</div>)}
            </ReactGridLayout>
          </div>
        )}
      </div>
    </div>
  );
}
