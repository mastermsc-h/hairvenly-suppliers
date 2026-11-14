"use client";

import { useEffect, useRef } from "react";

/**
 * Zwei goldene Strähnen gleiten auf dem Rand der Kugel entlang — nie quer darüber. Jede ist eine
 * glatte Sichel: spitzer Anfang, spitzes Ende, in der Mitte am kräftigsten. Sie laufen gegenläufig;
 * wo sie sich begegnen, zuckt ein kleiner Blitz über den Rand.
 * `groesse` = Durchmesser der Kugel; die Zeichenfläche ist etwas größer, damit der Rand Platz hat.
 */
export default function HiStraehnen({ groesse, schnell = false }: { groesse: number; schnell?: boolean }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const schnellRef = useRef(schnell);
  useEffect(() => {
    schnellRef.current = schnell;
  }, [schnell]);
  const flaeche = Math.round(groesse * 1.3);

  useEffect(() => {
    const canvas = ref.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const reduziert = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(flaeche * dpr);
    canvas.height = Math.round(flaeche * dpr);

    const R = groesse / 2;
    const M = flaeche / 2;
    const dicke = Math.max(3, R * 0.055);
    // zwei Strähnen auf leicht verschiedenen Ringen dicht am Rand, gegenläufig
    const straehnen = [
      { ring: 1.035, v: 0.55, start: 0.3, laenge: 1.15 },
      { ring: 1.075, v: -0.42, start: 3.4, laenge: 0.95 },
    ];

    let blitz: { w: number; t: number; pfade: Array<Array<[number, number]>> } | null = null;
    let sperre = 0;
    let zeit = 0;
    let zuletzt = performance.now();
    let raf = 0;

    const pol = (w: number, r: number): [number, number] => [M + Math.cos(w) * r, M + Math.sin(w) * r];
    const zackig = (ax: number, ay: number, bx: number, by: number, tiefe: number): Array<[number, number]> => {
      if (tiefe === 0) return [[ax, ay], [bx, by]];
      const l = Math.hypot(bx - ax, by - ay);
      const mx = (ax + bx) / 2 + (Math.random() - 0.5) * l * 0.5;
      const my = (ay + by) / 2 + (Math.random() - 0.5) * l * 0.5;
      return [...zackig(ax, ay, mx, my, tiefe - 1).slice(0, -1), ...zackig(mx, my, bx, by, tiefe - 1)];
    };
    const winkelDiff = (a: number, b: number) => Math.atan2(Math.sin(a - b), Math.cos(a - b));

    /** Sichel: Außen- und Innenkante folgen dem Ring, Breite = sin-Profil → spitze Enden. */
    const sichel = (mitteW: number, ring: number, laenge: number, breite: number) => {
      const n = 48;
      const r = R * ring;
      ctx.beginPath();
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const w = mitteW - laenge / 2 + laenge * t;
        const b = breite * Math.pow(Math.sin(Math.PI * t), 0.9);
        const [x, y] = pol(w, r + b / 2);
        if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
      }
      for (let i = n; i >= 0; i--) {
        const t = i / n;
        const w = mitteW - laenge / 2 + laenge * t;
        const b = breite * Math.pow(Math.sin(Math.PI * t), 0.9);
        const [x, y] = pol(w, r - b / 2);
        ctx.lineTo(x, y);
      }
      ctx.closePath();
    };

    const zeichne = (jetzt: number) => {
      const dt = Math.min(0.05, (jetzt - zuletzt) / 1000);
      zuletzt = jetzt;
      zeit += dt * (reduziert ? 0.15 : schnellRef.current ? 2 : 1);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, flaeche, flaeche);

      const mitten = straehnen.map((s) => s.start + zeit * s.v);
      straehnen.forEach((s, k) => {
        const w = mitten[k];
        const atem = 1 + 0.06 * Math.sin(jetzt / 700 + k * 2);
        // Glut + Goldverlauf (Enden dunkler Bernstein, Mitte hell)
        ctx.save();
        ctx.shadowColor = "rgba(255, 180, 60, 0.95)";
        ctx.shadowBlur = dicke * 3;
        const [ax, ay] = pol(w - s.laenge / 2, R * s.ring);
        const [bx, by] = pol(w + s.laenge / 2, R * s.ring);
        const verlauf = ctx.createLinearGradient(ax, ay, bx, by);
        verlauf.addColorStop(0, "rgba(196, 128, 24, 0.9)");
        verlauf.addColorStop(0.5, "rgba(255, 214, 120, 1)");
        verlauf.addColorStop(1, "rgba(196, 128, 24, 0.9)");
        ctx.fillStyle = verlauf;
        sichel(w, s.ring, s.laenge, dicke * atem);
        ctx.fill();
        ctx.restore();
        // heller Glanz in der Mitte der Strähne
        ctx.fillStyle = "rgba(255, 246, 214, 0.85)";
        sichel(w, s.ring, s.laenge * 0.7, dicke * 0.32);
        ctx.fill();
        // feine Haarlinien entlang der Sichel
        for (const versatz of [-0.28, 0.28]) {
          ctx.strokeStyle = "rgba(255, 226, 160, 0.45)";
          ctx.lineWidth = 0.7;
          ctx.beginPath();
          ctx.arc(M, M, R * s.ring + dicke * versatz, w - s.laenge * 0.38, w + s.laenge * 0.38);
          ctx.stroke();
        }
      });

      // Begegnung: Mitten auf gleicher Höhe → Blitz quer über beide Ringe
      sperre = Math.max(0, sperre - dt);
      const abstand = Math.abs(winkelDiff(mitten[0], mitten[1]));
      if (!blitz && sperre === 0 && !reduziert && abstand < 0.08) {
        const w = mitten[0] + winkelDiff(mitten[1], mitten[0]) / 2;
        const pfade: Array<Array<[number, number]>> = [];
        for (let i = 0; i < 3; i++) {
          const a = pol(w + (Math.random() - 0.5) * 0.12, R * 0.98);
          const b = pol(w + (Math.random() - 0.5) * 0.16, R * (1.12 + Math.random() * 0.06));
          pfade.push(zackig(a[0], a[1], b[0], b[1], 3));
        }
        blitz = { w, t: 0, pfade };
        sperre = 1.2;
      }
      if (blitz) {
        blitz.t += dt;
        const k = Math.max(0, 1 - blitz.t / 0.35);
        const [cx, cy] = pol(blitz.w, R * 1.055);
        const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 0.32);
        g.addColorStop(0, `rgba(255, 248, 220, ${0.85 * k})`);
        g.addColorStop(0.35, `rgba(255, 205, 110, ${0.4 * k})`);
        g.addColorStop(1, "rgba(255, 180, 80, 0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(cx, cy, R * 0.32, 0, Math.PI * 2);
        ctx.fill();
        if (Math.random() < 0.85) {
          ctx.save();
          ctx.strokeStyle = `rgba(255, 252, 235, ${k})`;
          ctx.lineWidth = 1.5;
          ctx.shadowColor = "rgba(255, 220, 140, 1)";
          ctx.shadowBlur = 12;
          for (const pfad of blitz.pfade) {
            ctx.beginPath();
            pfad.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
            ctx.stroke();
          }
          ctx.restore();
        }
        if (blitz.t > 0.35) blitz = null;
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
