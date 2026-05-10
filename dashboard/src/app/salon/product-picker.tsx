"use client";

// Schnellpicker: 3-stufiges Auswaehlen — Methode → Laenge → Farbe.
// Wenn mehrere Pack-Groessen die gleiche Methode/Laenge/Farbe haben,
// kommt noch ein 4. Schritt mit der Pack-Groesse.

import { useMemo, useState } from "react";
import { ChevronLeft, Search, X } from "lucide-react";
import type { SalonProductInfo } from "@/lib/actions/salon";

interface PickableProduct extends SalonProductInfo {
  hasBarcode: boolean;
}

const CAT_ORDER = ["tape", "mini_tape", "bonding", "tresse", "clip", "other"] as const;
const CAT_TILES: Record<string, { label: string; emoji: string }> = {
  tape: { label: "Tape", emoji: "🎀" },
  mini_tape: { label: "Mini-Tape", emoji: "📎" },
  bonding: { label: "Bonding", emoji: "🪡" },
  tresse: { label: "Tresse", emoji: "🧵" },
  clip: { label: "Clip-In", emoji: "💇" },
  other: { label: "Sonstiges", emoji: "📦" },
};

interface Props {
  products: PickableProduct[];
  onPick: (p: PickableProduct) => void;
  onClose: () => void;
}

export default function ProductPicker({ products, onPick, onClose }: Props) {
  const [category, setCategory] = useState<string | null>(null);
  const [length, setLength] = useState<number | null | "any">(null);
  const [color, setColor] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // Verfuegbare Optionen je Stufe
  const inCat = useMemo(
    () => (category ? products.filter((p) => p.category === category) : []),
    [products, category],
  );
  const lengths = useMemo(() => {
    const set = new Set<number | "any">();
    for (const p of inCat) set.add(p.lengthCm ?? "any");
    return [...set].sort((a, b) => {
      if (a === "any") return 1;
      if (b === "any") return -1;
      return a - b;
    });
  }, [inCat]);
  const inLen = useMemo(
    () => inCat.filter((p) => (length === "any" ? p.lengthCm == null : p.lengthCm === length)),
    [inCat, length],
  );
  const colors = useMemo(() => {
    const map = new Map<string, PickableProduct>();
    for (const p of inLen) {
      const k = (p.color ?? "—").trim() || "—";
      if (!map.has(k)) map.set(k, p);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [inLen]);
  const inColor = useMemo(
    () =>
      inLen.filter((p) => ((p.color ?? "—").trim() || "—") === color),
    [inLen, color],
  );

  // Volltext-Suche querbeet (alternative zum Cascading)
  const searchResults = useMemo(() => {
    if (!search.trim()) return null;
    const q = search.toLowerCase();
    return products
      .filter(
        (p) =>
          p.productTitle.toLowerCase().includes(q) ||
          (p.variantTitle ?? "").toLowerCase().includes(q) ||
          (p.color ?? "").toLowerCase().includes(q),
      )
      .slice(0, 60);
  }, [products, search]);

  return (
    <div className="fixed inset-0 z-50 bg-neutral-950 flex flex-col">
      <header className="px-4 py-3 flex items-center gap-3 border-b border-neutral-900">
        <button
          onClick={() => {
            if (color) setColor(null);
            else if (length) setLength(null);
            else if (category) setCategory(null);
            else onClose();
          }}
          className="p-2 -ml-2 hover:bg-neutral-900 rounded-lg"
        >
          <ChevronLeft size={24} />
        </button>
        <div className="flex-1">
          <div className="text-lg font-semibold">
            {!category && "Methode wählen"}
            {category && !length && `${CAT_TILES[category]?.label} — Länge`}
            {category && length && !color && `${CAT_TILES[category]?.label} ${length === "any" ? "" : length + "cm"} — Farbe`}
            {color && "Pack-Größe"}
          </div>
          <div className="text-xs text-neutral-500">
            {[
              category ? CAT_TILES[category]?.label : null,
              length ? (length === "any" ? "" : `${length}cm`) : null,
              color || null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
        <button onClick={onClose} className="p-2 hover:bg-neutral-900 rounded-lg">
          <X size={22} />
        </button>
      </header>

      {/* Suche oben — alternativer Pfad */}
      <div className="px-4 py-3 border-b border-neutral-900">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Suche (Titel, Farbe, Länge...)"
            className="w-full bg-neutral-900 border border-neutral-700 rounded-xl pl-9 pr-3 py-2.5 text-base text-white placeholder-neutral-500 focus:ring-2 focus:ring-rose-500 outline-none"
          />
        </div>
      </div>

      <main className="flex-1 overflow-y-auto p-4">
        {/* Suche aktiv */}
        {searchResults && (
          <div>
            <div className="text-xs text-neutral-500 uppercase tracking-wide mb-2">
              {searchResults.length} Treffer
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
              {searchResults.map((p, i) => (
                <ProductTile key={i} p={p} onPick={() => onPick(p)} />
              ))}
            </div>
          </div>
        )}

        {/* Cascading: Stufe 1 - Methode */}
        {!searchResults && !category && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-2">
            {CAT_ORDER.filter((c) => products.some((p) => p.category === c)).map((c) => {
              const count = products.filter((p) => p.category === c).length;
              return (
                <button
                  key={c}
                  onClick={() => setCategory(c)}
                  className="bg-neutral-900 hover:bg-neutral-800 rounded-2xl py-10 text-2xl font-bold flex flex-col items-center gap-2 active:scale-95 transition"
                >
                  <span className="text-4xl">{CAT_TILES[c].emoji}</span>
                  <span>{CAT_TILES[c].label}</span>
                  <span className="text-xs text-neutral-500 font-normal">{count} Varianten</span>
                </button>
              );
            })}
          </div>
        )}

        {/* Stufe 2 - Laenge */}
        {!searchResults && category && !length && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-2">
            {lengths.map((l) => (
              <button
                key={String(l)}
                onClick={() => setLength(l)}
                className="bg-neutral-900 hover:bg-neutral-800 rounded-2xl py-10 text-3xl font-bold active:scale-95 transition"
              >
                {l === "any" ? "—" : `${l}cm`}
              </button>
            ))}
          </div>
        )}

        {/* Stufe 3 - Farbe */}
        {!searchResults && category && length != null && !color && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-2">
            {colors.map(([c, sample]) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className="bg-neutral-900 hover:bg-neutral-800 rounded-2xl p-3 text-left active:scale-95 transition flex gap-3 items-center"
              >
                {sample.imageUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={sample.imageUrl} alt="" className="w-16 h-16 rounded-lg object-cover bg-neutral-800" />
                ) : (
                  <div className="w-16 h-16 rounded-lg bg-neutral-800" />
                )}
                <div className="flex-1 min-w-0">
                  <div className="text-base font-semibold leading-tight">{c}</div>
                  <div className="text-xs text-neutral-500 mt-0.5">
                    {inLen.filter((p) => ((p.color ?? "—").trim() || "—") === c).length} Variante(n)
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Stufe 4 - Pack-Groesse (oder direkt picken wenn nur 1) */}
        {!searchResults && color && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mt-2">
            {inColor.map((p, i) => (
              <ProductTile key={i} p={p} onPick={() => onPick(p)} />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function ProductTile({ p, onPick }: { p: PickableProduct; onPick: () => void }) {
  return (
    <button
      onClick={onPick}
      className="bg-neutral-900 hover:bg-neutral-800 rounded-2xl p-3 text-left active:scale-95 transition flex flex-col gap-2"
    >
      {p.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={p.imageUrl} alt="" className="w-full aspect-square rounded-lg object-cover bg-neutral-800" />
      ) : (
        <div className="w-full aspect-square rounded-lg bg-neutral-800" />
      )}
      <div>
        <div className="text-sm font-semibold leading-tight line-clamp-2">{p.productTitle}</div>
        <div className="text-xs text-neutral-400 mt-0.5">{p.variantTitle ?? "—"}</div>
        <div className="mt-1 flex flex-wrap gap-1 text-[10px]">
          <span className="px-1.5 py-0.5 bg-neutral-800 rounded">{p.categoryLabel}</span>
          {p.lengthCm && <span className="px-1.5 py-0.5 bg-neutral-800 rounded">{p.lengthCm}cm</span>}
          <span className="px-1.5 py-0.5 bg-neutral-800 rounded">{p.packGrams}g</span>
          {!p.hasBarcode && (
            <span className="px-1.5 py-0.5 bg-amber-900/60 text-amber-200 rounded">kein Barcode</span>
          )}
        </div>
      </div>
    </button>
  );
}
