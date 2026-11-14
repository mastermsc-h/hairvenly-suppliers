"use client";

import { useEffect, useRef } from "react";

export type HiZustand = "ruhig" | "denkt" | "spricht";

/**
 * Animiertes "Gehirn": ein rotierendes Netz aus Neuronen (Punkte auf einer Kugel, verbunden mit
 * ihren Nachbarn). Beim Denken schneller, heller und mit wandernden Impulsen auf den Verbindungen;
 * beim Sprechen pulsiert es im Takt der ankommenden Wörter.
 */
export default function HiGehirn({ zustand, groesse = 260, impuls = 0 }: { zustand: HiZustand; groesse?: number; impuls?: number }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const zustandRef = useRef(zustand);
  const impulsRef = useRef(impuls);
  zustandRef.current = zustand;
  impulsRef.current = impuls;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const reduziert = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

    // Punkte gleichmäßig auf einer Kugel (Fibonacci), leicht "verbeult" wie ein Gehirn
    const N = groesse < 120 ? 90 : 180;
    const punkte: Array<{ x: number; y: number; z: number; p: number }> = [];
    const gold = Math.PI * (3 - Math.sqrt(5));
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const th = gold * i;
      const beule = 1 + 0.08 * Math.sin(th * 3) * Math.cos(y * 4);
      punkte.push({ x: Math.cos(th) * r * beule, y: y * 0.92 * beule, z: Math.sin(th) * r * beule, p: Math.random() * Math.PI * 2 });
    }
    // Jede Nervenzelle mit ihren 3 nächsten Nachbarn verbinden
    const kanten: Array<[number, number]> = [];
    const gesehen = new Set<string>();
    for (let i = 0; i < N; i++) {
      const nah = punkte
        .map((q, j) => ({ j, d: (q.x - punkte[i].x) ** 2 + (q.y - punkte[i].y) ** 2 + (q.z - punkte[i].z) ** 2 }))
        .filter((x) => x.j !== i)
        .sort((a, b) => a.d - b.d)
        .slice(0, 3);
      for (const { j } of nah) {
        const k = i < j ? `${i}-${j}` : `${j}-${i}`;
        if (!gesehen.has(k)) { gesehen.add(k); kanten.push([i, j]); }
      }
    }
    // Wandernde Impulse auf den Verbindungen
    const impulse: Array<{ k: number; t: number; v: number }> = [];

    let w = 0, h = 0, dpr = 1;
    const groesseSetzen = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      w = canvas.clientWidth;
      h = canvas.clientHeight;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    };
    groesseSetzen();
    const ro = new ResizeObserver(groesseSetzen);
    ro.observe(canvas);

    let winkel = 0;
    let energie = 0.2; // 0 = ruhig, 1 = denkt
    let letzterImpuls = impulsRef.current;
    let welle = 0;
    let raf = 0;
    let zuletzt = performance.now();

    const zeichne = (jetzt: number) => {
      const dt = Math.min(0.05, (jetzt - zuletzt) / 1000);
      zuletzt = jetzt;
      const z = zustandRef.current;
      const ziel = z === "denkt" ? 1 : z === "spricht" ? 0.65 : 0.18;
      energie += (ziel - energie) * Math.min(1, dt * 3);
      if (impulsRef.current !== letzterImpuls) {
        letzterImpuls = impulsRef.current;
        welle = 1;
      }
      welle = Math.max(0, welle - dt * 2.5);
      winkel += dt * (reduziert ? 0.05 : 0.18 + energie * 0.9);

      if (!reduziert && Math.random() < dt * (2 + energie * 40) && impulse.length < 60) {
        impulse.push({ k: Math.floor(Math.random() * kanten.length), t: 0, v: 0.8 + Math.random() * 1.6 });
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      const cx = w / 2, cy = h / 2;
      const R = Math.min(w, h) * 0.36 * (1 + welle * 0.04 + Math.sin(jetzt / 900) * 0.01 * (1 + energie * 2));

      // Kern-Leuchten
      const kern = ctx.createRadialGradient(cx, cy, 0, cx, cy, R * 1.6);
      kern.addColorStop(0, `rgba(120, 90, 255, ${0.18 + energie * 0.22 + welle * 0.1})`);
      kern.addColorStop(0.45, `rgba(40, 200, 255, ${0.06 + energie * 0.08})`);
      kern.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = kern;
      ctx.fillRect(0, 0, w, h);

      const sa = Math.sin(winkel), ca = Math.cos(winkel);
      const sb = Math.sin(winkel * 0.37 + 0.4), cb = Math.cos(winkel * 0.37 + 0.4);
      const proj = punkte.map((q) => {
        const x1 = q.x * ca + q.z * sa;
        const z1 = -q.x * sa + q.z * ca;
        const y1 = q.y * cb - z1 * sb;
        const z2 = q.y * sb + z1 * cb;
        const s = 1 / (1.9 - z2 * 0.6);
        return { x: cx + x1 * R * s * 1.5, y: cy + y1 * R * s * 1.5, t: (z2 + 1) / 2 };
      });

      ctx.lineWidth = 1;
      for (const [a, b] of kanten) {
        const pa = proj[a], pb = proj[b];
        const t = (pa.t + pb.t) / 2;
        ctx.strokeStyle = `rgba(${Math.round(90 + 80 * t)}, ${Math.round(170 + 50 * t)}, 255, ${0.05 + t * (0.22 + energie * 0.25)})`;
        ctx.beginPath();
        ctx.moveTo(pa.x, pa.y);
        ctx.lineTo(pb.x, pb.y);
        ctx.stroke();
      }

      for (let i = impulse.length - 1; i >= 0; i--) {
        const im = impulse[i];
        im.t += dt * im.v;
        if (im.t >= 1) { impulse.splice(i, 1); continue; }
        const [a, b] = kanten[im.k];
        const pa = proj[a], pb = proj[b];
        const x = pa.x + (pb.x - pa.x) * im.t, y = pa.y + (pb.y - pa.y) * im.t;
        const g = ctx.createRadialGradient(x, y, 0, x, y, 6);
        g.addColorStop(0, "rgba(255, 220, 140, 0.95)");
        g.addColorStop(1, "rgba(255, 180, 80, 0)");
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(x, y, 6, 0, Math.PI * 2);
        ctx.fill();
      }

      for (let i = 0; i < proj.length; i++) {
        const p = proj[i];
        const flimmern = 0.6 + 0.4 * Math.sin(jetzt / 400 + punkte[i].p) * energie;
        const r = (0.8 + p.t * 1.8) * (groesse < 120 ? 0.8 : 1);
        ctx.fillStyle = `rgba(${Math.round(150 + 100 * p.t)}, ${Math.round(200 + 55 * p.t)}, 255, ${(0.25 + p.t * 0.7) * flimmern})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Ring beim Sprechen
      if (welle > 0.01) {
        ctx.strokeStyle = `rgba(160, 220, 255, ${welle * 0.35})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(cx, cy, R * (1.25 + (1 - welle) * 0.35), 0, Math.PI * 2);
        ctx.stroke();
      }

      raf = requestAnimationFrame(zeichne);
    };
    raf = requestAnimationFrame(zeichne);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
  }, [groesse]);

  return <canvas ref={canvasRef} className="hi-gehirn" style={{ width: groesse, height: groesse }} aria-hidden />;
}
