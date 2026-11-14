"use client";

// Seitenleiste am Desktop: lässt sich zuklappen, damit die Seite die ganze Breite bekommt.
// Der Zustand steht in einem Cookie — so rendert schon der Server richtig (kein Aufblitzen).
import { useState } from "react";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";

/** Gleicher Name wie beim Lesen in layout.tsx (Server kann Konstanten aus Client-Dateien nicht nutzen). */
const SIDEBAR_COOKIE = "hv_sidebar_zu";

export default function DesktopSidebar({
  startZu, labelZu, labelAuf, children,
}: {
  startZu: boolean;
  labelZu: string;
  labelAuf: string;
  children: React.ReactNode;
}) {
  const [zu, setZu] = useState(startZu);
  const setze = (wert: boolean) => {
    setZu(wert);
    document.cookie = `${SIDEBAR_COOKIE}=${wert ? "1" : "0"}; path=/; max-age=31536000; samesite=lax`;
  };

  return (
    <>
      <aside className={`hidden ${zu ? "" : "md:flex"} relative w-60 border-r border-neutral-200 bg-white flex-col shrink-0`}>
        <button
          type="button"
          onClick={() => setze(true)}
          title={labelZu}
          aria-label={labelZu}
          className="absolute top-5 right-3 z-10 w-8 h-8 rounded-lg flex items-center justify-center text-neutral-400 hover:text-neutral-800 hover:bg-neutral-100 transition"
        >
          <PanelLeftClose size={17} />
        </button>
        {children}
      </aside>
      {zu && (
        <button
          type="button"
          onClick={() => setze(false)}
          title={labelAuf}
          aria-label={labelAuf}
          className="hidden md:flex fixed left-0 top-1/2 -translate-y-1/2 z-40 w-6 h-14 items-center justify-center rounded-r-xl bg-white/90 border border-l-0 border-neutral-200 shadow-sm text-neutral-500 hover:text-neutral-900 hover:w-8 transition-all"
        >
          <PanelLeftOpen size={15} />
        </button>
      )}
    </>
  );
}
