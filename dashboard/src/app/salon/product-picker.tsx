"use client";

// Schnellpicker — adaptive Stufen:
//   Methode → Qualitaet (Russisch/Usbekisch) → Laenge → Farbe → Variante
// Stufen mit nur 1 Option werden automatisch uebersprungen.

import { useEffect, useMemo, useState } from "react";
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

const QUALITY_TILES: Record<string, { label: string; emoji: string; sub: string }> = {
  russisch: { label: "Russisch", emoji: "🪞", sub: "Glatt" },
  usbekisch: { label: "Usbekisch", emoji: "🌊", sub: "Wellig" },
  null: { label: "Sonstiges", emoji: "❓", sub: "ohne Qualität" },
};

interface Props {
  products: PickableProduct[];
  onPick: (p: PickableProduct) => void;
  onClose: () => void;
}

export default function ProductPicker({ products, onPick, onClose }: Props) {
  const [category, setCategory] = useState<string | null>(null);
  const [quality, setQuality] = useState<string | null | "_none_">(null);
  const [length, setLength] = useState<number | null | "any">(null);
  const [color, setColor] = useState<string | null>(null);
  const [search, setSearch] = useState("");

  // ─── Verfügbare Stufen-Optionen ─────────────────────────────
  const inCat = useMemo(
    () => (category ? products.filter((p) => p.category === category) : []),
    [products, category],
  );
  const qualities = useMemo(() => {
    const set = new Set<string>();
    for (const p of inCat) set.add(p.quality ?? "_none_");
    return [...set];
  }, [inCat]);
  const inQuality = useMemo(
    () =>
      quality
        ? inCat.filter((p) => (p.quality ?? "_none_") === quality)
        : inCat,
    [inCat, quality],
  );
  const lengths = useMemo(() => {
    const set = new Set<number | "any">();
    for (const p of inQuality) set.add(p.lengthCm ?? "any");
    return [...set].sort((a, b) => {
      if (a === "any") return 1;
      if (b === "any") return -1;
      return a - b;
    });
  }, [inQuality]);
  const inLen = useMemo(
    () =>
      length != null
        ? inQuality.filter((p) =>
            length === "any" ? p.lengthCm == null : p.lengthCm === length,
          )
        : inQuality,
    [inQuality, length],
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
      color ? inLen.filter((p) => ((p.color ?? "—").trim() || "—") === color) : inLen,
    [inLen, color],
  );

  // ─── Adaptive Skip ──────────────────────────────────────────
  // Wenn beim Aktivieren einer Stufe nur 1 Option existiert: auto-pick.
  useEffect(() => {
    if (category && quality == null && qualities.length === 1) {
      setQuality(qualities[0]);
    }
  }, [category, quality, qualities]);

  useEffect(() => {
    if (category && quality != null && length == null && lengths.length === 1) {
      setLength(lengths[0]);
    }
  }, [category, quality, length, lengths]);

  // Wenn nach Farb-Pick nur 1 Variante uebrig → direkt picken
  useEffect(() => {
    if (color && inColor.length === 1) {
      onPick(inColor[0]);
    }
  }, [color, inColor, onPick]);

  // ─── Volltext-Suche ─────────────────────────────────────────
  const searchResults = useMemo(() => {
    if (!search.trim()) return null;
    const q = search.toLowerCase();
    return products
      .filter(
        (p) =>
          p.productTitle.toLowerCase().includes(q) ||
          (p.variantTitle ?? "").toLowerCase().includes(q) ||
          (p.color ?? "").toLowerCase().includes(q) ||
          (p.quality ?? "").toLowerCase().includes(q),
      )
      .slice(0, 80);
  }, [products, search]);

  // ─── Back-Navigation ─────────────────────────────────────────
  function back() {
    if (color) setColor(null);
    else if (length != null) setLength(null);
    else if (quality != null) setQuality(null);
    else if (category) setCategory(null);
    else onClose();
  }

  const stage =
    !category ? "cat" : quality == null ? "qual" : length == null ? "len" : !color ? "col" : "var";

  return (
    <div className="fixed inset-0 z-50 bg-neutral-950 flex flex-col">
      <header className="px-4 py-3 flex items-center gap-3 border-b border-neutral-900">
        <button
          onClick={back}
          className="p-2 -ml-2 hover:bg-neutral-900 rounded-lg"
        >
          <ChevronLeft size={24} />
        </button>
        <div className="flex-1">
          <div className="text-lg font-semibold">
            {stage === "cat" && "Methode wählen"}
            {stage === "qual" && "Qualität wählen"}
            {stage === "len" && "Länge wählen"}
            {stage === "col" && "Farbe wählen"}
            {stage === "var" && "Pack wählen"}
          </div>
          <div className="text-xs text-neutral-500 truncate">
            {[
              category ? CAT_TILES[category]?.label : null,
              quality && quality !== "_none_" ? QUALITY_TILES[quality]?.label : null,
              length != null ? (length === "any" ? "" : `${length}cm`) : null,
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

      <div className="px-4 py-3 border-b border-neutral-900">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-500" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Suche (Titel, Farbe, Qualität...)"
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

        {/* Stufe 1: Methode */}
        {!searchResults && stage === "cat" && (
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

        {/* Stufe 2: Qualitaet */}
        {!searchResults && stage === "qual" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
            {qualities.map((q) => {
              const def = QUALITY_TILES[q];
              const count = inCat.filter((p) => (p.quality ?? "_none_") === q).length;
              return (
                <button
                  key={q}
                  onClick={() => setQuality(q)}
                  className="bg-neutral-900 hover:bg-neutral-800 rounded-2xl py-10 text-2xl font-bold flex flex-col items-center gap-2 active:scale-95 transition"
                >
                  <span className="text-4xl">{def.emoji}</span>
                  <span>{def.label}</span>
                  <span className="text-xs text-neutral-500 font-normal">
                    {def.sub} · {count} Varianten
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {/* Stufe 3: Laenge */}
        {!searchResults && stage === "len" && (
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

        {/* Stufe 4: Farbe */}
        {!searchResults && stage === "col" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
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

        {/* Stufe 5: Variante (nur wenn mehrere Pack-Groessen pro Farbe) */}
        {!searchResults && stage === "var" && (
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
          {p.quality && (
            <span className="px-1.5 py-0.5 bg-neutral-800 rounded capitalize">{p.quality}</span>
          )}
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
