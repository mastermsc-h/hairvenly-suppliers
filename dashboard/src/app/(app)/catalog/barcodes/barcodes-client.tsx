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
    // Warten bis alle Canvas-Labels als PNG fertig komponiert sind.
    // Pro Label braucht's ~10-30ms — bei vielen labels also relevant.
    const ms = Math.max(300, printList.length * 25);
    setTimeout(() => window.print(), ms);
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
          /* Hochformat: 25mm breit × 50mm hoch (Zebra ZD421 Portrait) */
          @page { size: 25mm 50mm; margin: 0; }
          .label-sheet { display: block; }
          .label {
            width: 25mm !important;
            height: 50mm !important;
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
          .label-img {
            display: block;
            width: 25mm;
            height: 50mm;
            object-fit: contain;
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

// Pixel-dimensionen des Label-Canvas (Aspect-ratio 50:25 = 2:1).
// 600×300 = ~12 px/mm bei 50mm — gibt scharfe drucke bei 203/300 dpi.
// Hochformat: 25mm breit × 50mm hoch → 1:2 ratio, hier in px (8 px/mm)
const LABEL_W = 300;
const LABEL_H = 600;

function Label({ variant }: { variant: Variant }) {
  // Komplette Label-Komposition in EIN canvas → PNG → <img>.
  // Im print rendert ein <img> mit fixen mm-massen sicher als atomare einheit,
  // browser können es nicht über seiten zerlegen.
  const [labelDataUrl, setLabelDataUrl] = useState<string>("");

  useEffect(() => {
    try {
      // 1) Barcode-Canvas separat erzeugen (JsBarcode beansprucht canvas exklusiv)
      const barcodeCanvas = document.createElement("canvas");
      JsBarcode(barcodeCanvas, variant.barcode, {
        format: "CODE128",
        displayValue: true,
        fontSize: 30,
        height: 130,
        margin: 0,
        textMargin: 4,
        background: "#ffffff",
        lineColor: "#000000",
      });

      // 2) Label-Canvas mit Titel + komponiertem Barcode
      const canvas = document.createElement("canvas");
      canvas.width = LABEL_W;
      canvas.height = LABEL_H;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, LABEL_W, LABEL_H);

      // Titel (max 3 Zeilen — Hochformat hat mehr vertikalen Platz)
      const fullTitle = variant.variantTitle
        ? `${variant.productTitle} · ${variant.variantTitle}`
        : variant.productTitle;
      const titleLines = splitTitle(fullTitle, 22);
      ctx.fillStyle = "#000000";
      ctx.font = "bold 18px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const titleY = 12;
      const lineHeight = 22;
      titleLines.forEach((line, i) => {
        ctx.fillText(line, LABEL_W / 2, titleY + i * lineHeight, LABEL_W - 12);
      });

      // Barcode unterhalb des Titels — um 90° rotiert, damit die Bar-Länge
      // die lange Label-Achse (50mm) nutzt. Sonst wäre der Barcode bei nur
      // 25mm Breite zu dicht für zuverlässiges Scannen.
      const titleBlockH = titleY + titleLines.length * lineHeight + 8;
      const barcodeArea = {
        x: 10,
        y: titleBlockH,
        w: LABEL_W - 20,
        h: LABEL_H - titleBlockH - 10,
      };
      // Original aspect-ratio des barcode-canvas behalten (horizontal)
      const bcRatio = barcodeCanvas.width / barcodeCanvas.height;
      // Drehung: Original-Breite wird zur dargestellten Höhe, original-Höhe zur Breite
      // Wir wollen, dass die rotierte BREITE in barcodeArea.w passt UND die rotierte HÖHE
      // (entspricht der originalen Bar-Länge) in barcodeArea.h passt.
      // Maximal verfügbare rotierte Höhe = barcodeArea.h, maximal rotierte Breite = barcodeArea.w
      let rotatedH = barcodeArea.h;             // entspricht der originalen Bar-Länge
      let rotatedW = rotatedH / bcRatio;         // entspricht der originalen Bar-Höhe
      if (rotatedW > barcodeArea.w) {
        rotatedW = barcodeArea.w;
        rotatedH = rotatedW * bcRatio;
      }
      const cx = barcodeArea.x + barcodeArea.w / 2;
      const cy = barcodeArea.y + barcodeArea.h / 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(Math.PI / 2);
      // Nach Rotation: original-Breite wird vertikal gezeichnet (= rotatedH),
      // original-Höhe wird horizontal (= rotatedW)
      ctx.drawImage(barcodeCanvas, -rotatedH / 2, -rotatedW / 2, rotatedH, rotatedW);
      ctx.restore();

      setLabelDataUrl(canvas.toDataURL("image/png"));
    } catch {
      // ignore
    }
  }, [variant.barcode, variant.productTitle, variant.variantTitle]);

  return (
    <div className="label">
      {labelDataUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={labelDataUrl} alt="" className="label-img" />
      )}
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
