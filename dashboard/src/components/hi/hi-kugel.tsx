"use client";

import "./hi.css";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowUp } from "lucide-react";
import HiGehirn from "./hi-gehirn";
import HiStraehnen from "./hi-straehnen";
import HiChat from "./hi-chat";

/**
 * Hi als schwebende Kugel (Startbildschirm): kein Fenster, sondern eine leuchtende Glaskugel mit
 * dem Neuronennetz und einem Eingabefeld darunter. Klick oder Frage → Hi öffnet sich im Vollbild,
 * kreisförmig aus der Kugel heraus.
 */
export default function HiKugel() {
  const boxRef = useRef<HTMLDivElement>(null);
  const kugelRef = useRef<HTMLButtonElement>(null);
  const [groesse, setGroesse] = useState(220);
  const [eingabe, setEingabe] = useState("");
  const [offen, setOffen] = useState<{ frage?: string; x: number; y: number } | null>(null);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const w = el.clientWidth, h = el.clientHeight;
      setGroesse(Math.max(110, Math.min(w - 24, h - 96, 520)));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const oeffnen = (frage?: string) => {
    const r = kugelRef.current?.getBoundingClientRect();
    setOffen({ frage: frage?.trim() || undefined, x: r ? r.left + r.width / 2 : window.innerWidth / 2, y: r ? r.top + r.height / 2 : window.innerHeight / 2 });
    setEingabe("");
  };

  return (
    <div className="hi hi-kugel-box" ref={boxRef}>
      <button
        ref={kugelRef}
        type="button"
        className="hi-kugel ck-kein-zug"
        style={{ width: groesse, height: groesse }}
        onClick={() => oeffnen()}
        aria-label="Hi öffnen"
        title="Hi öffnen"
      >
        <span className="hi-kugel-glas" aria-hidden />
        <HiGehirn zustand="ruhig" groesse={groesse} />
        <HiStraehnen groesse={groesse} />
        <span className="hi-kugel-name" aria-hidden>Hi<span className="hi-punkt">.</span></span>
      </button>
      <form className="hi-eingabe hi-kugel-eingabe ck-kein-zug" onSubmit={(e) => { e.preventDefault(); if (eingabe.trim()) oeffnen(eingabe); }}>
        <textarea
          value={eingabe}
          rows={1}
          placeholder="Frag Hi irgendetwas …"
          onChange={(e) => setEingabe(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (eingabe.trim()) oeffnen(eingabe); }
          }}
        />
        <button type="submit" className="hi-senden" disabled={!eingabe.trim()} aria-label="Fragen"><ArrowUp size={16} /></button>
      </form>

      {offen &&
        createPortal(
          <div className="hi-vollbild" style={{ ["--hi-ox" as string]: `${offen.x}px`, ["--hi-oy" as string]: `${offen.y}px` }} role="dialog" aria-label="Hi · Hairvenly Intelligence">
            <HiChat variante="seite" startFrage={offen.frage} onSchliessen={() => setOffen(null)} />
          </div>,
          document.body,
        )}
    </div>
  );
}
