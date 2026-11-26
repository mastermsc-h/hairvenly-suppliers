"use client";

import "./hi.css";
import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import HiGehirn from "./hi-gehirn";
import HiChat, { type SeitenKontext } from "./hi-chat";

/**
 * Hi schwebt als kleine leuchtende Kugel unten rechts auf jeder Seite. Klick klappt ein Chatfenster
 * auf; jede Frage bekommt die aktuelle Seite mit (Pfad, Titel, sichtbarer Text), damit Hi sich auf
 * das bezieht, was gerade zu sehen ist. Jede Seite hat ihr eigenes Gespräch (eigener Verlauf),
 * getrennt vom großen Hi unter /hi. Nicht auf /hi selbst.
 */
export default function HiSchweber() {
  const pfad = usePathname();
  const [offen, setOffen] = useState(false);

  useEffect(() => {
    if (!offen) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOffen(false);
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [offen]);

  // Eigene Sitzung je Seite: Name aus der Seitenüberschrift (beim Öffnen gelesen), sonst aus dem Pfad
  const [titel, setTitel] = useState<{ pfad: string; name: string } | null>(null);
  const pfadName = (() => { const t = (pfad ?? "").split("/").filter(Boolean).pop() ?? "Start"; return t.charAt(0).toUpperCase() + t.slice(1); })();
  const seitenName = titel && titel.pfad === pfad ? titel.name : pfadName;
  const umschalten = () => {
    if (!offen) setTitel({ pfad: pfad ?? "", name: document.querySelector("main h1")?.textContent?.trim() || pfadName });
    setOffen(!offen);
  };

  const kontext = useCallback((): SeitenKontext | null => {
    if (typeof document === "undefined") return null;
    const main = document.querySelector("main");
    const text = (main?.innerText ?? "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, 6000);
    return { pfad: `${location.pathname}${location.search}`, titel: document.title, text };
  }, []);

  if (pfad?.startsWith("/hi")) return null;

  return (
    <div className="hi hi-schweber" data-offen={offen}>
      {offen && (
        <div className="hi-schwebe-fenster" role="dialog" aria-label="Hi zur aktuellen Seite fragen">
          <HiChat key={pfad} variante="schwebe" sitzung={`seite:${pfad}`} sitzungName={seitenName} seitenKontext={kontext} onSchliessen={() => setOffen(false)} />
        </div>
      )}
      <button type="button" className="hi-schwebe-knopf" onClick={umschalten} aria-expanded={offen} aria-label={offen ? "Hi schließen" : "Hi zu dieser Seite fragen"} title={offen ? "Hi schließen (Esc)" : "Hi zu dieser Seite fragen"}>
        <span className="hi-schwebe-ring" aria-hidden />
        <HiGehirn zustand="ruhig" groesse={58} />
        <span className="hi-schwebe-name" aria-hidden>Hi<span className="hi-punkt">.</span></span>
      </button>
    </div>
  );
}
