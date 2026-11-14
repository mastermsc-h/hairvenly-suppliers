"use client";

import { useEffect, useRef } from "react";

/**
 * Zwei goldene Haarsträhnen umkreisen die Kugel auf schräg gestellten Bahnen — mal davor, mal
 * dahinter. Wo sie sich treffen, zuckt ein kleiner Blitz auf.
 * `groesse` = Durchmesser der Kugel; die Zeichenfläche ist größer, damit die Strähnen außen laufen.
 */
export default function HiStraehnen({ groesse, schnell = false }: { groesse: number; schnell?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const schnellRef = useRef(schnell);
  schnellRef.current = schnell;
  const flaeche = Math.round(groesse * 1.42);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduziert = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(flaeche * dpr);
    canvas.height = Math.round(flaeche * dpr);

    const R = groesse / 2;
    const mitte = flaeche / 2;
    // Bahnen: Neigung, Drehung der Bahnebene, Geschwindigkeit, Richtung, Abstand zum Rand
    const straehnen = [
      { neigung: 1.02, dreh: 0.35, v: 0.62, phase: 0, abstand: 1.04, welle: 0.9 },
      // Bahnen so gewählt (simuliert), dass sich die Strähnen alle 3–5 s vor der Kugel treffen
      { neigung: 0.5, dreh: 0.6, v: -0.7, phase: Math.PI * 0.8, abstand: 1.06, welle: 1.3 },
    ];
    const LAENGE = 1.9; // Bogenlänge einer Strähne in Radiant
    const STUECKE = 56;

    // Punkt auf einer geneigten Kreisbahn um die Kugel (3D → 2D), z > 0 = vor der Kugel
    const punkt = (s: (typeof straehnen)[number], th: number, wellig: number) => {
      const r = R * (s.abstand + 0.035 * Math.sin(th * 5 + wellig));
      const x0 = Math.cos(th) * r;
      const y0 = Math.sin(th) * r;
      const y1 = y0 * Math.cos(s.neigung);
      const z1 = y0 * Math.sin(s.neigung);
      const x = x0 * Math.cos(s.dreh) - y1 * Math.sin(s.dreh);
      const y = x0 * Math.sin(s.dreh) + y1 * Math.cos(s.dreh);
      return { x: mitte + x, y: mitte + y, z: z1 / r };
    };

    let blitz: { x: number; y: number; ax: number; ay: number; bx: number; by: number; t: number } | null = null;
    let sperre = 0;
    let zeit = 0;
    let zuletzt = performance.now();
    let raf = 0;

    const zackig = (ax: number, ay: number, bx: number, by: number, tiefe: number): Array<[number, number]> => {
      if (tiefe === 0) return [[ax, ay], [bx, by]];
      const mx = (ax + bx) / 2 + (Math.random() - 0.5) * Math.hypot(bx - ax, by - ay) * 0.45;
      const my = (ay + by) / 2 + (Math.random() - 0.5) * Math.hypot(bx - ax, by - ay) * 0.45;
      return [...zackig(ax, ay, mx, my, tiefe - 1).slice(0, -1), ...zackig(mx, my, bx, by, tiefe - 1)];
    };

    const zeichne = (jetzt: number) => {
      const dt = Math.min(0.05, (jetzt - zuletzt) / 1000);
      zuletzt = jetzt;
      zeit += dt * (reduziert ? 0.15 : schnellRef.current ? 2.2 : 1);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, flaeche, flaeche);

      const koepfe: Array<{ x: number; y: number; z: number; pts: ReturnType<typeof punkt>[] }> = [];
      for (const s of straehnen) {
        const kopf = s.phase + zeit * s.v;
        const pts = Array.from({ length: STUECKE }, (_, i) => {
          const th = kopf - Math.sign(s.v) * (i / (STUECKE - 1)) * LAENGE;
          return punkt(s, th, zeit * s.welle * 3 + i * 0.35);
        });
        koepfe.push({ ...pts[0], pts });
        // Strähne: vorne von dick und hell zum dünnen, ausblendenden Ende; hinter der Kugel gedämpft
        for (let i = 0; i < STUECKE - 1; i++) {
          const a = pts[i], b = pts[i + 1];
          const t = i / (STUECKE - 1);
          const vorne = (a.z + b.z) / 2 > -0.15;
          // hinter der Kugel: innerhalb ihres Umrisses fast verdeckt, außerhalb gedämpft sichtbar
          const verdeckt = !vorne && Math.hypot((a.x + b.x) / 2 - mitte, (a.y + b.y) / 2 - mitte) < R * 0.97;
          const alpha = (1 - t) ** 1.1 * (vorne ? 1 : verdeckt ? 0.08 : 0.45);
          const breite = (vorne ? 6 : 3.5) * (1 - t * 0.8) * Math.max(0.6, groesse / 260);
          ctx.lineCap = "butt"; // keine Perlen an den Stoßstellen — wirkt wie ein glattes Haar
          // dunkler Bernstein-Rand (Kontrast auf hellem Grund) + leuchtender Goldkern
          ctx.shadowColor = "rgba(255, 175, 60, 0.95)";
          ctx.shadowBlur = vorne ? 16 : 5;
          ctx.strokeStyle = `rgba(184, 118, 18, ${alpha * 0.9})`;
          ctx.lineWidth = breite;
          // Mittelpunkt-zu-Mittelpunkt-Kurve: glatt und ohne Überlappung (keine helleren Stoßstellen)
          const v = pts[Math.max(0, i - 1)];
          const sx = i === 0 ? a.x : (v.x + a.x) / 2, sy = i === 0 ? a.y : (v.y + a.y) / 2;
          const ex = (a.x + b.x) / 2, ey = (a.y + b.y) / 2;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.quadraticCurveTo(a.x, a.y, ex, ey);
          ctx.stroke();
          ctx.shadowBlur = 0;
          ctx.strokeStyle = `rgba(255, ${Math.round(214 + 30 * (1 - t))}, ${Math.round(110 + 80 * (1 - t))}, ${alpha})`;
          ctx.lineWidth = breite * 0.55;
          ctx.beginPath();
          ctx.moveTo(sx, sy);
          ctx.quadraticCurveTo(a.x, a.y, ex, ey);
          ctx.stroke();
        }
        // feine Nebenhaare
        ctx.shadowBlur = 0;
        for (let h = 0; h < 3; h++) {
          ctx.strokeStyle = `rgba(255, 225, 160, ${0.18 - h * 0.04})`;
          ctx.lineWidth = 0.8;
          ctx.beginPath();
          for (let i = 0; i < STUECKE; i += 2) {
            const p = pts[i];
            if (p.z < -0.15) continue;
            const off = Math.sin(i * 0.5 + h * 2 + zeit * 4) * (2 + h) * (i / STUECKE);
            if (i === 0) ctx.moveTo(p.x + off, p.y - off); else ctx.lineTo(p.x + off, p.y - off);
          }
          ctx.stroke();
        }
      }

      // Berührung: nächste Punkte beider Strähnen (nur vorne sichtbar) → Blitz
      sperre = Math.max(0, sperre - dt);
      if (!blitz && sperre === 0 && !reduziert) {
        let best = { d: Infinity, a: koepfe[0].pts[0], b: koepfe[1].pts[0] };
        for (let i = 0; i < STUECKE; i++) for (let j = 0; j < STUECKE; j++) {
          const a = koepfe[0].pts[i], b = koepfe[1].pts[j];
          if (a.z < -0.1 || b.z < -0.1) continue;
          const d = Math.hypot(a.x - b.x, a.y - b.y);
          if (d < best.d) best = { d, a, b };
        }
        if (best.d < Math.max(8, R * 0.08)) {
          const x = (best.a.x + best.b.x) / 2, y = (best.a.y + best.b.y) / 2;
          const w = Math.random() * Math.PI * 2, l = R * (0.18 + Math.random() * 0.12);
          blitz = { x, y, ax: x - Math.cos(w) * l, ay: y - Math.sin(w) * l, bx: x + Math.cos(w) * l, by: y + Math.sin(w) * l, t: 0 };
          sperre = 1.4;
        }
      }
      if (blitz) {
        blitz.t += dt;
        const k = Math.max(0, 1 - blitz.t / 0.32);
        const g = ctx.createRadialGradient(blitz.x, blitz.y, 0, blitz.x, blitz.y, R * 0.35);
        g.addColorStop(0, `rgba(255, 245, 210, ${0.75 * k})`);
        g.addColorStop(0.3, `rgba(255, 200, 110, ${0.35 * k})`);
        g.addColorStop(1, "rgba(255, 180, 80, 0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(blitz.x, blitz.y, R * 0.35, 0, Math.PI * 2);
        ctx.fill();
        if (Math.random() < 0.85) {
          for (const [ax, ay, bx, by] of [[blitz.ax, blitz.ay, blitz.x, blitz.y], [blitz.x, blitz.y, blitz.bx, blitz.by]]) {
            const pfad = zackig(ax, ay, bx, by, 4);
            ctx.strokeStyle = `rgba(255, 250, 230, ${k})`;
            ctx.lineWidth = 1.6;
            ctx.shadowColor = "rgba(255, 220, 140, 1)";
            ctx.shadowBlur = 14;
            ctx.beginPath();
            pfad.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
            ctx.stroke();
          }
          ctx.shadowBlur = 0;
        }
        if (blitz.t > 0.32) blitz = null;
      }

      raf = requestAnimationFrame(zeichne);
    };
    raf = requestAnimationFrame(zeichne);
    return () => cancelAnimationFrame(raf);
  }, [groesse, flaeche]);

  return (
    <canvas
      ref={ref}
      className="hi-straehnen"
      aria-hidden
      style={{ width: flaeche, height: flaeche, left: (groesse - flaeche) / 2, top: (groesse - flaeche) / 2 }}
    />
  );
}
