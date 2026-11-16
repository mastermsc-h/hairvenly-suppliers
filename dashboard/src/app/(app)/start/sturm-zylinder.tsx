"use client";

// Auffälligkeiten als drehbarer Zylinder: Karten in mehreren Reihen rund um eine Achse
// (oben die ernsten, unten die Hinweise). Dreht sich langsam von selbst, lässt sich mit der
// Maus/dem Finger drehen (mit Schwung). Antippen holt eine Karte nach vorn und zeigt Einzelheiten.
// Die Rotation läuft ohne React-Neuzeichnen direkt über Styles (requestAnimationFrame).
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { X, Zap } from "lucide-react";
import type { AuffaelligBereich, Auffaelligkeit } from "@/lib/cockpit/typen";

type Icon = React.ComponentType<{ size?: number }>;

const KARTE_B = 200;
const KARTE_H = 96;
const LUECKE = 18;
const REIHEN_ABSTAND = 12;

export default function SturmZylinder({
  punkte, icons, bereiche, schwereText,
}: {
  punkte: Auffaelligkeit[];
  icons: Record<AuffaelligBereich, Icon>;
  bereiche: Record<AuffaelligBereich, string>;
  schwereText: Record<Auffaelligkeit["schwere"], string>;
}) {
  // Reihen: nach Schwere sortiert in 1–3 Reihen aufteilen, Spalten gleichmäßig um den Zylinder
  // Breite der Szene messen: der Zylinder soll vorne etwa die Fensterbreite ausfüllen
  const szene = useRef<HTMLDivElement | null>(null);
  const [breite, setBreite] = useState(900);
  useEffect(() => {
    const el = szene.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBreite(el.clientWidth || 900));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const { reihen, spalten, radius } = useMemo(() => {
    const n = punkte.length;
    const r = n <= 6 ? 1 : n <= 18 ? 2 : 3;
    const s = Math.max(Math.ceil(n / r), 8); // mindestens 8 Plätze, sonst wirkt es nicht rund
    const umfang = s * (KARTE_B + LUECKE);
    return { reihen: r, spalten: s, radius: Math.max(umfang / (2 * Math.PI), breite * 0.36, 240) };
  }, [punkte.length, breite]);

  const buehne = useRef<HTMLDivElement | null>(null);
  const karten = useRef<Array<HTMLDivElement | null>>([]);
  const winkel = useRef(0);
  const tempo = useRef(0.06); // Grad je Frame (Eigendrehung)
  const ziel = useRef<number | null>(null);
  const zieht = useRef<{ x: number; w: number; t: number; v: number } | null>(null);
  const bewegt = useRef(false);
  const [gewaehlt, setGewaehlt] = useState<number | null>(null);

  const platz = (i: number) => ({ reihe: Math.floor(i / spalten), spalte: i % spalten });

  useEffect(() => {
    const ruhig = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    const schritt = () => {
      if (ziel.current != null) {
        const d = ((ziel.current - winkel.current + 540) % 360) - 180;
        winkel.current += d * 0.12;
        if (Math.abs(d) < 0.3) { winkel.current = ziel.current; ziel.current = null; }
      } else if (!zieht.current) {
        // Schwung nach dem Loslassen klingt aus, danach langsame Eigendrehung
        tempo.current += ((ruhig || gewaehlt != null ? 0 : 0.06) - tempo.current) * 0.03;
        winkel.current += tempo.current;
      }
      if (buehne.current) buehne.current.style.transform = `translateZ(${-radius}px) rotateY(${-winkel.current}deg)`;
      // Karten auf der Rückseite abdunkeln und kleiner zeichnen
      const proSpalte = 360 / spalten;
      karten.current.forEach((el, i) => {
        if (!el) return;
        const a = ((platz(i).spalte * proSpalte - winkel.current) % 360 + 360) % 360;
        const vorne = Math.cos((a * Math.PI) / 180); // 1 = vorne, −1 = hinten
        el.style.opacity = String(0.18 + 0.82 * Math.max(0, (vorne + 0.35) / 1.35));
        el.style.filter = vorne < -0.2 ? "blur(1.5px)" : "none";
        el.style.pointerEvents = vorne > 0.3 ? "auto" : "none";
        el.style.zIndex = String(Math.round((vorne + 1) * 100));
      });
      raf = requestAnimationFrame(schritt);
    };
    raf = requestAnimationFrame(schritt);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [radius, spalten, gewaehlt]);

  const runter = (e: React.PointerEvent) => {
    zieht.current = { x: e.clientX, w: winkel.current, t: performance.now(), v: 0 };
    bewegt.current = false;
    ziel.current = null;
  };
  const ziehen = (e: React.PointerEvent) => {
    const z = zieht.current;
    if (!z) return;
    const dx = e.clientX - z.x;
    // Erst beim echten Ziehen den Zeiger einfangen – sonst käme ein Antippen nicht bei der Karte an
    if (!bewegt.current && Math.abs(dx) > 4) {
      bewegt.current = true;
      try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* egal */ }
    }
    if (!bewegt.current) return;
    const neu = z.w - dx * 0.35;
    const jetzt = performance.now();
    z.v = (neu - winkel.current) / Math.max(1, (jetzt - z.t) / 16.7);
    z.t = jetzt;
    winkel.current = neu;
  };
  const hoch = () => {
    if (zieht.current) tempo.current = Math.max(-6, Math.min(6, zieht.current.v));
    zieht.current = null;
  };

  const nachVorn = (i: number) => {
    if (bewegt.current) return; // war ein Drehen, kein Antippen
    ziel.current = platz(i).spalte * (360 / spalten);
    setGewaehlt(i);
  };

  const p = gewaehlt != null ? punkte[gewaehlt] : null;
  const hoehe = reihen * KARTE_H + (reihen - 1) * REIHEN_ABSTAND;

  return (
    <div className="zy" data-detail={p != null}>
      <div
        className="zy-szene"
        ref={szene}
        style={{ height: hoehe + 44 }}
        onPointerDown={runter}
        onPointerMove={ziehen}
        onPointerUp={hoch}
        onPointerCancel={hoch}
        role="group"
        aria-label="Auffälligkeiten – zum Drehen ziehen"
      >
        <div className="zy-achse" style={{ top: 22 + hoehe / 2 }}>
          <div className="zy-buehne" ref={buehne}>
            {punkte.map((pk, i) => {
              const { reihe, spalte } = platz(i);
              const I = icons[pk.bereich] ?? Zap;
              const y = (reihe - (reihen - 1) / 2) * (KARTE_H + REIHEN_ABSTAND);
              return (
                <div
                  key={pk.id}
                  ref={(el) => { karten.current[i] = el; }}
                  className="zy-karte"
                  data-schwere={pk.schwere}
                  data-aktiv={gewaehlt === i}
                  style={{
                    width: KARTE_B, height: KARTE_H, marginLeft: -KARTE_B / 2, marginTop: -KARTE_H / 2,
                    transform: `rotateY(${spalte * (360 / spalten)}deg) translateZ(${radius}px) translateY(${y}px)`,
                  }}
                  onClick={() => nachVorn(i)}
                >
                  <div className="zy-innen" style={{ animationDelay: `${(i % 7) * -0.9}s` }}>
                    <div className="zy-kopf">
                      <span className="st-icon"><I size={14} /></span>
                      <span className="st-marke">{bereiche[pk.bereich]}</span>
                    </div>
                    <div className="zy-titel">{pk.titel}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
        <div className="zy-boden" />
      </div>

      {p && (
        <div className="zy-detail st-punkt" data-schwere={p.schwere} data-oben={reihen > 1 && platz(gewaehlt!).reihe >= reihen / 2}>
          <div className="st-punkt-kopf">
            <span className="st-icon">{(() => { const I = icons[p.bereich] ?? Zap; return <I size={15} />; })()}</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="st-titel">{p.titel}</div>
              <div className="st-detail">{p.detail}</div>
            </div>
            <div className="st-aktionen">
              <span className="st-marke">{bereiche[p.bereich]} · {schwereText[p.schwere]}</span>
              {p.href && <Link href={p.href} className="st-link">Ansehen</Link>}
            </div>
            <button type="button" className="st-mehr" onClick={() => setGewaehlt(null)} aria-label="Schließen"><X size={13} /></button>
          </div>
          {p.liste && p.liste.length > 0 && <ul className="st-einzel">{p.liste.map((l, j) => <li key={j}>{l}</li>)}</ul>}
        </div>
      )}
      {!p && <div className="zy-tipp">Ziehen zum Drehen · Karte antippen für Einzelheiten</div>}
    </div>
  );
}
