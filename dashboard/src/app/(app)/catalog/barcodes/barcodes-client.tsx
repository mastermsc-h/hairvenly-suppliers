"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import JsBarcode from "jsbarcode";
import { ArrowLeft, Printer, Search, ShieldCheck } from "lucide-react";

interface Variant {
  productTitle: string;
  variantTitle: string | null;
  barcode: string;
  collectionHandles: string[];
  imageUrl: string | null;
}

interface Collection {
  handle: string;
  title: string;
}

function variantKey(v: Variant): string {
  return `${v.barcode}__${v.productTitle}__${v.variantTitle ?? ""}`;
}

export default function BarcodesClient({
  variants,
  collections,
}: {
  variants: Variant[];
  collections: Collection[];
}) {
  const [selectedCollection, setSelectedCollection] = useState<string>("");
  const [search, setSearch] = useState("");
  const [quantities, setQuantities] = useState<Record<string, number>>({});

  const filtered = useMemo(() => {
    const lower = search.trim().toLowerCase();
    return variants.filter((v) => {
      if (selectedCollection && !v.collectionHandles.includes(selectedCollection)) return false;
      if (!lower) return true;
      const hay = `${v.productTitle} ${v.variantTitle ?? ""} ${v.barcode}`.toLowerCase();
      return hay.includes(lower);
    });
  }, [variants, selectedCollection, search]);

  const totalLabels = useMemo(
    () => filtered.reduce((s, v) => s + (quantities[variantKey(v)] ?? 0), 0),
    [filtered, quantities],
  );

  function setBulk(qty: number) {
    const next: Record<string, number> = { ...quantities };
    for (const v of filtered) next[variantKey(v)] = qty;
    setQuantities(next);
  }

  function setQty(v: Variant, qty: number) {
    const next = { ...quantities };
    next[variantKey(v)] = Math.max(0, qty);
    setQuantities(next);
  }

  // Liste der zu druckenden Etiketten (jedes mehrfach laut quantities)
  const printList = useMemo(() => {
    const list: Variant[] = [];
    for (const v of variants) {
      const q = quantities[variantKey(v)] ?? 0;
      for (let i = 0; i < q; i++) list.push(v);
    }
    return list;
  }, [variants, quantities]);

  function handlePrint() {
    if (printList.length === 0) return;
    // Kurz warten, damit alle Barcode-SVGs gerendert sind
    setTimeout(() => window.print(), 100);
  }

  return (
    <>
      <style>{`
        @media screen {
          .label-sheet { display: none; }
        }
        @media print {
          .no-print, .no-print * { display: none !important; }
          aside, [data-mobile-sidebar] { display: none !important; }
          html, body { background: white !important; margin: 0 !important; padding: 0 !important; }
          main { padding: 0 !important; overflow: visible !important; }
          @page { size: 50mm 25mm; margin: 0; }
          .label-sheet { display: block; }
          /* Jedes label = 1 SVG mit fixen 50mm x 25mm. Kein flow-overflow,
             daher kann der browser nicht ueber seitengrenzen aufsplitten. */
          .label {
            width: 50mm !important;
            height: 25mm !important;
            display: block !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            page-break-after: always !important;
            break-after: page !important;
          }
          .label:last-child {
            page-break-after: auto !important;
            break-after: auto !important;
          }
          .label svg {
            display: block;
            width: 50mm;
            height: 25mm;
          }
        }
      `}</style>

      <div className="no-print p-4 md:p-6 max-w-5xl">
        <Link
          href="/catalog"
          className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-900 mb-4"
        >
          <ArrowLeft size={14} /> Zurück zum Katalog
        </Link>

        <header className="mb-5 flex items-start justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-semibold text-neutral-900">Barcode-Etiketten drucken</h1>
            <p className="text-sm text-neutral-500 mt-1">
              Format 50 × 25 mm · Zebra ZD421 · {variants.length} Varianten verfügbar
            </p>
          </div>
          <Link
            href="/catalog/barcodes/audit"
            className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-neutral-300 text-sm font-medium text-neutral-700 hover:bg-neutral-50 hover:border-neutral-400 transition shrink-0"
          >
            <ShieldCheck size={14} /> Barcode-Check
          </Link>
        </header>

        <div className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-5 shadow-sm space-y-4">
          {/* Filter */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide mb-1 block">
                Collection
              </label>
              <select
                value={selectedCollection}
                onChange={(e) => setSelectedCollection(e.target.value)}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900 focus:outline-none"
              >
                <option value="">Alle ({variants.length})</option>
                {collections.map((c) => {
                  const count = variants.filter((v) => v.collectionHandles.includes(c.handle)).length;
                  return (
                    <option key={c.handle} value={c.handle}>
                      {c.title} ({count})
                    </option>
                  );
                })}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide mb-1 block">
                Suche im Titel / EAN
              </label>
              <div className="relative">
                <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
                <input
                  type="search"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="z.B. Bondings, Tape 65cm, …"
                  className="w-full rounded-lg border border-neutral-300 pl-9 pr-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900 focus:outline-none"
                />
              </div>
            </div>
          </div>

          {/* Bulk-Aktionen */}
          <div className="flex items-center gap-2 flex-wrap text-xs">
            <span className="text-neutral-600">
              {filtered.length} Varianten in Auswahl —
            </span>
            <button
              type="button"
              onClick={() => setBulk(0)}
              className="px-2 py-1 rounded border border-neutral-300 hover:bg-neutral-50"
            >
              Alle auf 0
            </button>
            <button
              type="button"
              onClick={() => setBulk(1)}
              className="px-2 py-1 rounded border border-neutral-300 hover:bg-neutral-50"
            >
              Alle auf 1×
            </button>
            <button
              type="button"
              onClick={() => setBulk(5)}
              className="px-2 py-1 rounded border border-neutral-300 hover:bg-neutral-50"
            >
              Alle auf 5×
            </button>
            <button
              type="button"
              onClick={() => setBulk(10)}
              className="px-2 py-1 rounded border border-neutral-300 hover:bg-neutral-50"
            >
              Alle auf 10×
            </button>
          </div>

          {/* Liste */}
          <div className="border border-neutral-200 rounded-lg overflow-hidden max-h-[55vh] overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-neutral-50 sticky top-0 z-10">
                <tr className="text-left text-xs uppercase tracking-wide text-neutral-600">
                  <th className="px-3 py-2 w-[40px]"></th>
                  <th className="px-3 py-2">Produkt</th>
                  <th className="px-3 py-2 w-[120px]">EAN</th>
                  <th className="px-3 py-2 w-[100px] text-right">Anzahl</th>
                </tr>
              </thead>
              <tbody>
                {filtered.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-6 text-center text-neutral-500">
                      Keine Varianten in dieser Auswahl.
                    </td>
                  </tr>
                ) : (
                  filtered.map((v) => {
                    const k = variantKey(v);
                    const q = quantities[k] ?? 0;
                    return (
                      <tr key={k} className="border-t border-neutral-100 hover:bg-neutral-50">
                        <td className="px-3 py-2">
                          {v.imageUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={v.imageUrl} alt="" className="w-8 h-8 rounded object-cover" />
                          ) : (
                            <div className="w-8 h-8 rounded bg-neutral-100" />
                          )}
                        </td>
                        <td className="px-3 py-2">
                          <div className="text-neutral-900 line-clamp-1">{v.productTitle}</div>
                          {v.variantTitle && (
                            <div className="text-xs text-neutral-500">{v.variantTitle}</div>
                          )}
                        </td>
                        <td className="px-3 py-2 font-mono text-xs">{v.barcode}</td>
                        <td className="px-3 py-2 text-right">
                          <input
                            type="number"
                            min={0}
                            value={q}
                            onChange={(e) => setQty(v, parseInt(e.target.value || "0", 10))}
                            className="w-16 text-right rounded border border-neutral-300 px-2 py-1 text-sm focus:ring-2 focus:ring-neutral-900 focus:outline-none"
                          />
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>

          {/* Drucken */}
          <div className="flex items-center justify-between gap-3 pt-2 border-t border-neutral-200">
            <div className="text-sm text-neutral-700">
              <strong>{totalLabels}</strong> Etikett{totalLabels === 1 ? "" : "en"} zum Drucken
            </div>
            <button
              type="button"
              onClick={handlePrint}
              disabled={totalLabels === 0}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Printer size={16} />
              Drucken auf Zebra
            </button>
          </div>
        </div>

        <p className="text-xs text-neutral-500 mt-4">
          Hinweis: Im Druckdialog Zebra ZD421 wählen, Papierformat &quot;50 × 25 mm&quot; (oder das passende Label-Profil),
          Skalierung &quot;Tatsächliche Größe&quot; / 100 %.
        </p>
      </div>

      {/* Druckbereich — nur via @media print sichtbar */}
      <div className="label-sheet">
        {printList.map((v, i) => (
          <Label key={i} variant={v} />
        ))}
      </div>
    </>
  );
}

function Label({ variant }: { variant: Variant }) {
  // Wir rendern den Barcode in einen offscreen-canvas, holen das DataURL
  // und embedden es als <image> in EIN großes SVG mit festem viewBox.
  // Dadurch ist jedes Label genau EIN element mit fixen 50mm x 25mm —
  // Browser können das nicht ueber seitengrenzen aufsplitten.
  const [barcodeDataUrl, setBarcodeDataUrl] = useState<string>("");

  useEffect(() => {
    try {
      const canvas = document.createElement("canvas");
      JsBarcode(canvas, variant.barcode, {
        format: "CODE128",
        displayValue: true,
        fontSize: 14,
        height: 50,
        margin: 0,
        textMargin: 2,
        background: "#ffffff",
        lineColor: "#000000",
      });
      setBarcodeDataUrl(canvas.toDataURL("image/png"));
    } catch {
      // ignore
    }
  }, [variant.barcode]);

  const fullTitle = variant.variantTitle
    ? `${variant.productTitle} · ${variant.variantTitle}`
    : variant.productTitle;
  // Titel auf zwei Zeilen splitten falls zu lang (manuell per zeichen-budget)
  const titleLines = splitTitle(fullTitle, 38);

  // SVG-Koordinatensystem: 50mm × 25mm. 1 mm = 1 Einheit.
  return (
    <div className="label">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 50 25"
        width="50mm"
        height="25mm"
        preserveAspectRatio="xMidYMid meet"
      >
        {titleLines.map((line, i) => (
          <text
            key={i}
            x={25}
            y={2 + i * 1.8}
            textAnchor="middle"
            fontFamily="-apple-system, BlinkMacSystemFont, sans-serif"
            fontSize={1.5}
            fill="#000"
          >
            {line}
          </text>
        ))}
        {barcodeDataUrl && (
          <image
            href={barcodeDataUrl}
            x={2}
            y={titleLines.length === 2 ? 6.5 : 4.5}
            width={46}
            height={titleLines.length === 2 ? 18 : 20}
            preserveAspectRatio="xMidYMid meet"
          />
        )}
      </svg>
    </div>
  );
}

// Splittet titel auf max 2 zeilen, die zweite zeile bekommt einen "…"-fallback
function splitTitle(title: string, maxCharsPerLine: number): string[] {
  if (title.length <= maxCharsPerLine) return [title];
  // Versuche an einem space zu splitten
  const words = title.split(" ");
  let line1 = "";
  let line2 = "";
  for (const w of words) {
    if (!line1 || (line1.length + 1 + w.length) <= maxCharsPerLine) {
      line1 = line1 ? `${line1} ${w}` : w;
    } else {
      line2 = line2 ? `${line2} ${w}` : w;
    }
  }
  if (line2.length > maxCharsPerLine) {
    line2 = line2.slice(0, maxCharsPerLine - 1) + "…";
  }
  return line2 ? [line1, line2] : [line1];
}
