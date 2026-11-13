"use client";

import dynamic from "next/dynamic";

// Three.js läuft nur im Browser und ist groß — deshalb als eigener Chunk,
// der nur auf dieser Seite geladen wird.
const WeltScene = dynamic(() => import("./welt-scene"), {
  ssr: false,
  loading: () => (
    <div className="flex h-[calc(100dvh-3.5rem)] md:h-dvh items-center justify-center bg-[#08070b] text-sm text-white/70">
      Hairvenly Welt wird geladen …
    </div>
  ),
});

export default function WeltLoader({ start }: { start?: string }) {
  return <WeltScene start={start} />;
}
