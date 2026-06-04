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

  // Druckliste wird ERST beim Klick auf "Drucken" erzeugt — sonst würde
  // jede Mengen-Änderung im Input sofort alle Etiketten reaktiv rendern
  // (auch wenn versteckt via @media screen). Das hat auf langsameren
  // Macs zu Tab-Crashes geführt, wenn die Menge groß war.
  const [printList, setPrintList] = useState<Variant[]>([]);
  const [printing, setPrinting] = useState(false);

  // Schutz: pro Variante auf max 500 cappen — sonst kann ein
  // versehentliches Festhalten des Step-Buttons den Browser killen.
  const MAX_PER_VARIANT = 1000;

  function handlePrint() {
    if (totalLabels === 0 || printing) return;
    setPrinting(true);
    const list: Variant[] = [];
    for (const v of variants) {
      const q = Math.min(quantities[variantKey(v)] ?? 0, MAX_PER_VARIANT);
      for (let i = 0; i < q; i++) list.push(v);
    }
    setPrintList(list);
    // Warten bis alle Canvas-Labels als PNG fertig komponiert sind.
    // Pro Label braucht's ~10-30ms — bei vielen labels also relevant.
    const ms = Math.max(300, list.length * 25);
    setTimeout(() => {
      window.print();
      // Nach dem Druck wieder freigeben, damit der speicher nicht haengt
      setTimeout(() => {
        setPrintList([]);
        setPrinting(false);
      }, 1500);
    }, ms);
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
          html, body {
            background: white !important;
            margin: 0 !important;
            padding: 0 !important;
            line-height: 0 !important;
            font-size: 0 !important;
          }
          main { padding: 0 !important; overflow: visible !important; }
          @page { size: 50mm 25mm; margin: 0; }
          .label-sheet { display: block; line-height: 0; font-size: 0; }
          /* Jedes label = ein PNG-img in fixem container. KEINE descenders,
             KEINE line-height, harter overflow:clip, 0.5mm safety-buffer.
             Aelterer macOS Chrome rundet subpixel anders → ohne diese guards
             ueberwucherte das img den container um ~0.1mm und triggerte
             einen seitenumbruch. */
          .label {
            width: 50mm !important;
            height: 25mm !important;
            max-height: 25mm !important;
            display: block !important;
            position: relative !important;
            overflow: hidden !important;
            line-height: 0 !important;
            font-size: 0 !important;
            box-sizing: border-box !important;
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
            display: block !important;
            width: 50mm !important;
            height: 24.5mm !important;
            max-height: 24.5mm !important;
            vertical-align: top !important;
            margin: 0 !important;
            padding: 0 !important;
            border: 0 !important;
            object-fit: contain !important;
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
                            max={MAX_PER_VARIANT}
                            value={q}
                            onChange={(e) => setQty(v, Math.min(parseInt(e.target.value || "0", 10), MAX_PER_VARIANT))}
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
              disabled={totalLabels === 0 || printing}
              className="flex items-center gap-2 px-5 py-2.5 rounded-lg bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Printer size={16} />
              {printing ? "Etiketten werden vorbereitet…" : "Drucken auf Zebra"}
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
const LABEL_W = 600;
const LABEL_H = 300;

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

      // Titel (max 2 Zeilen)
      const fullTitle = variant.variantTitle
        ? `${variant.productTitle} · ${variant.variantTitle}`
        : variant.productTitle;
      const titleLines = splitTitle(fullTitle, 38);
      ctx.fillStyle = "#000000";
      ctx.font = "bold 22px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const titleY = 12;
      const lineHeight = 26;
      titleLines.forEach((line, i) => {
        ctx.fillText(line, LABEL_W / 2, titleY + i * lineHeight, LABEL_W - 20);
      });

      // Barcode unterhalb des Titels einbetten — proportionsgerecht
      const titleBlockH = titleY + titleLines.length * lineHeight + 6;
      const barcodeArea = {
        x: 20,
        y: titleBlockH,
        w: LABEL_W - 40,
        h: LABEL_H - titleBlockH - 8,
      };
      // Original aspect-ratio des barcode-canvas behalten
      const bcRatio = barcodeCanvas.width / barcodeCanvas.height;
      let drawW = barcodeArea.w;
      let drawH = drawW / bcRatio;
      if (drawH > barcodeArea.h) {
        drawH = barcodeArea.h;
        drawW = drawH * bcRatio;
      }
      const drawX = barcodeArea.x + (barcodeArea.w - drawW) / 2;
      const drawY = barcodeArea.y + (barcodeArea.h - drawH) / 2;
      ctx.drawImage(barcodeCanvas, drawX, drawY, drawW, drawH);

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
