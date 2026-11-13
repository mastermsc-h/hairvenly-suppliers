"use client";

// "Adern": ab und zu läuft ein Lichtpuls wie über eine Leiterbahn durch die Spalten
// zwischen den Fenstern. Rein dekorativ; abschaltbar und bei "Bewegung reduzieren" aus.
import { useEffect, useRef } from "react";

// Goldtöne (User-Wunsch: goldene Strahlen)
const FARBEN = ["#f5b301", "#ffc93c", "#e8a100", "#ffd76a"];
const SVG = "http://www.w3.org/2000/svg";

type P = [number, number];

/** Umlauf um ein Fenster (mitten in der Spalte), Ecken wie bei Leiterbahnen abgeschrägt. */
function umlauf(x: number, y: number, w: number, h: number, a: number, f: number): P[] {
  const l = x - a, r = x + w + a, t = y - a, b = y + h + a;
  return [[l + f, t], [r - f, t], [r, t + f], [r, b - f], [r - f, b], [l + f, b], [l, b - f], [l, t + f]];
}

/** Teilstück eines geschlossenen Linienzugs: ab Punkt `start`, `anzahl` Kanten, vor- oder rückwärts. */
function teil(p: P[], start: number, anzahl: number, rueckwaerts: boolean): P[] {
  const out: P[] = [];
  for (let i = 0; i <= anzahl; i++) out.push(p[(((start + (rueckwaerts ? -i : i)) % p.length) + p.length) % p.length]);
  return out;
}

export default function Adern({ aktiv, abstand }: { aktiv: boolean; abstand: number }) {
  const ref = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    const svg = ref.current;
    if (!svg || !aktiv) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const feld = svg.parentElement;
    if (!feld) return;

    const puls = () => {
      if (document.hidden || svg.childElementCount > 5) return;
      const fenster = [...feld.querySelectorAll<HTMLElement>(".react-grid-item:not(.react-grid-placeholder)")];
      if (!fenster.length) return;
      const basis = feld.getBoundingClientRect();
      // nur Fenster, die gerade (teilweise) zu sehen sind
      const sichtbar = fenster.map((e) => e.getBoundingClientRect()).filter((r) => r.bottom > 0 && r.top < window.innerHeight);
      const r = sichtbar[Math.floor(Math.random() * sichtbar.length)];
      if (!r) return;
      const alle = umlauf(r.left - basis.left, r.top - basis.top, r.width, r.height, abstand / 2, 9);
      const pts = teil(alle, Math.floor(Math.random() * alle.length), 3 + Math.floor(Math.random() * 4), Math.random() < 0.5);
      const d = pts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
      const farbe = FARBEN[Math.floor(Math.random() * FARBEN.length)];
      const dauer = 2200 + Math.random() * 1600;

      const g = document.createElementNS(SVG, "g");
      g.style.setProperty("--ader", farbe);
      g.style.setProperty("--dauer", `${dauer}ms`);
      const bahn = document.createElementNS(SVG, "path");
      bahn.setAttribute("d", d);
      bahn.setAttribute("class", "ck-ader-bahn");
      const licht = document.createElementNS(SVG, "path");
      licht.setAttribute("d", d);
      licht.setAttribute("pathLength", "1");
      licht.setAttribute("class", "ck-ader-licht");
      g.append(bahn, licht);
      // Lötpunkte an Anfang und Ende
      for (const [x, y] of [pts[0], pts[pts.length - 1]]) {
        const c = document.createElementNS(SVG, "circle");
        c.setAttribute("cx", x.toFixed(1));
        c.setAttribute("cy", y.toFixed(1));
        c.setAttribute("r", "2.6");
        c.setAttribute("class", "ck-ader-punkt");
        g.append(c);
      }
      svg.append(g);
      window.setTimeout(() => g.remove(), dauer + 500);
    };

    let timer = 0;
    const naechster = () => {
      timer = window.setTimeout(() => { puls(); naechster(); }, 900 + Math.random() * 2400);
    };
    timer = window.setTimeout(() => { puls(); naechster(); }, 1200);
    return () => {
      window.clearTimeout(timer);
      svg.replaceChildren();
    };
  }, [aktiv, abstand]);

  return <svg ref={ref} className="ck-adern" aria-hidden />;
}
