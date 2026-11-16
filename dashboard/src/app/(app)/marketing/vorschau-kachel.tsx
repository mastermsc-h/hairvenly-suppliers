"use client";

import { useState } from "react";
import { Play, Image as ImageIcon, Layers, ExternalLink, X } from "lucide-react";

/** Kleine Vorschau der beworbenen Anzeige. Klick: Instagram-Beitrag im Fenster (Video spielt),
 *  ohne bekannten Beitrag: Werbeanzeigenmanager im neuen Tab. */
export default function VorschauKachel({ bild, link, manager, typ, titel }: { bild: string | null; link: string | null; manager: string | null; typ: "video" | "bild" | "karussell" | null; titel: string }) {
  const [offen, setOffen] = useState(false);
  const [bildFehler, setBildFehler] = useState(false);
  const ziel = link ?? manager;
  const Symbol = typ === "video" ? Play : typ === "karussell" ? Layers : ImageIcon;

  const kachel = (
    <span className="group relative block h-16 w-12 shrink-0 overflow-hidden rounded-lg bg-neutral-100 ring-1 ring-neutral-200">
      {bild && !bildFehler ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={bild} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBildFehler(true)} className="h-full w-full object-cover transition duration-200 group-hover:scale-105" />
      ) : (
        <span className="flex h-full w-full items-center justify-center text-neutral-400"><Symbol size={16} /></span>
      )}
      {bild && !bildFehler && typ === "video" && (
        <span className="absolute inset-0 flex items-center justify-center bg-black/10 group-hover:bg-black/25">
          <Play size={14} className="fill-white text-white drop-shadow" />
        </span>
      )}
    </span>
  );

  if (!ziel) return kachel;
  if (!link) {
    return <a href={ziel} target="_blank" rel="noreferrer" title="Im Werbeanzeigenmanager öffnen">{kachel}</a>;
  }
  return (
    <>
      <button type="button" onClick={() => setOffen(true)} title={typ === "video" ? "Video ansehen" : "Beitrag ansehen"} className="cursor-pointer">
        {kachel}
      </button>
      {offen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setOffen(false)}>
          <div className="w-full max-w-sm overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between gap-2 px-4 py-2.5">
              <span className="truncate text-sm font-medium text-neutral-700" title={titel}>{titel}</span>
              <span className="flex shrink-0 items-center gap-1">
                <a href={link} target="_blank" rel="noreferrer" title="Auf Instagram öffnen" className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"><ExternalLink size={16} /></a>
                {manager && <a href={manager} target="_blank" rel="noreferrer" title="Im Werbeanzeigenmanager öffnen" className="rounded-lg px-1.5 py-1 text-xs text-neutral-500 hover:bg-neutral-100">Ads</a>}
                <button type="button" onClick={() => setOffen(false)} aria-label="Schließen" className="rounded-lg p-1.5 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700"><X size={16} /></button>
              </span>
            </div>
            <iframe src={`${link.replace(/\/?$/, "/")}embed/`} title={titel} className="h-[560px] w-full border-0" allow="autoplay; encrypted-media" />
          </div>
        </div>
      )}
    </>
  );
}
