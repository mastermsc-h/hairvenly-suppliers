"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import JsBarcode from "jsbarcode";

/**
 * Shared Druck-Komponente für Barcode-Etiketten (Zebra ZD421, 50×25mm).
 *
 * Rendert via Portal an document.body; im Druck wird ALLES andere
 * ausgeblendet. Jedes Label ist EIN Canvas→PNG — atomar, kann vom
 * Browser nicht über Seitengrenzen gesplittet werden.
 *
 * Verwendet von: stock/inventory-page.tsx (Uzbek/Russisch-Lager) und
 * stock/zubehoer (Zubehör-Kollektionen + Teststrähnen).
 */
export default function PrintLabels({ items }: { items: { title: string; barcode: string }[] }) {
  // Mount-Guard fuer SSR
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted || items.length === 0 || typeof document === "undefined") return null;

  return createPortal(
    <>
      <style>{`
        @media screen { .stock-label-sheet-portal { display: none; } }
        @media print {
          body > *:not(.stock-label-sheet-portal) { display: none !important; }
          .stock-label-sheet-portal { display: block !important; }
          html, body { background: white !important; margin: 0 !important; padding: 0 !important; }
          /* @page mit explizitem size für Chrome/Firefox. Safari ignoriert
             custom @page size historisch — page-break-BEFORE jedem label
             stellt sicher dass ein label nie über die seitengrenze rutscht. */
          @page { size: 50mm 25mm; margin: 0; marks: none; }
          .stock-label {
            width: 50mm !important;
            height: 25mm !important;
            display: block !important;
            position: relative !important;
            margin: 0 !important;
            padding: 0 !important;
            page-break-inside: avoid !important;
            break-inside: avoid !important;
            page-break-before: always !important;
            break-before: page !important;
          }
          .stock-label:first-child {
            page-break-before: avoid !important;
            break-before: avoid !important;
          }
          .stock-label-img {
            display: block;
            width: 50mm;
            height: 25mm;
            object-fit: contain;
            position: absolute;
            top: 0;
            left: 0;
          }
        }
      `}</style>
      <div className="stock-label-sheet-portal">
        {items.map((it, i) => (
          <SingleLabel key={i} title={it.title} barcode={it.barcode} />
        ))}
      </div>
    </>,
    document.body,
  );
}

// Pixel-dimensionen des Label-Canvas (Aspect-ratio 50:25 = 2:1).
// 600×300 px für scharfe drucke bei 203/300 dpi auf Zebra ZD421.
const STOCK_LABEL_W = 600;
const STOCK_LABEL_H = 300;

function SingleLabel({ title, barcode }: { title: string; barcode: string }) {
  // Komplette Label-Komposition in EIN canvas → PNG → <img>.
  const [labelDataUrl, setLabelDataUrl] = useState<string>("");

  useEffect(() => {
    try {
      // 1) Barcode-Canvas separat erzeugen
      // height=65 → bars sind im finalen druck kompakt, text bleibt lesbar
      const barcodeCanvas = document.createElement("canvas");
      JsBarcode(barcodeCanvas, barcode, {
        format: "CODE128",
        displayValue: true,
        fontSize: 30,
        height: 65,
        margin: 0,
        textMargin: 4,
        background: "#ffffff",
        lineColor: "#000000",
      });

      // 2) Label-Canvas mit Titel + komponiertem Barcode
      const canvas = document.createElement("canvas");
      canvas.width = STOCK_LABEL_W;
      canvas.height = STOCK_LABEL_H;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, STOCK_LABEL_W, STOCK_LABEL_H);

      // Titel (max 2 Zeilen)
      const titleLines = splitStockLabelTitle(title, 38);
      ctx.fillStyle = "#000000";
      ctx.font = "bold 22px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      const titleY = 12;
      const lineHeight = 26;
      titleLines.forEach((line, i) => {
        ctx.fillText(line, STOCK_LABEL_W / 2, titleY + i * lineHeight, STOCK_LABEL_W - 20);
      });

      // Barcode unterhalb des Titels — proportionsgerecht eingebettet
      const titleBlockH = titleY + titleLines.length * lineHeight + 6;
      const barcodeArea = {
        x: 20,
        y: titleBlockH,
        w: STOCK_LABEL_W - 40,
        h: STOCK_LABEL_H - titleBlockH - 8,
      };
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
      // ignore (z.B. ungültiger Code)
    }
  }, [title, barcode]);

  return (
    <div className="stock-label">
      {labelDataUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={labelDataUrl} alt="" className="stock-label-img" />
      )}
    </div>
  );
}

// Splittet titel auf max 2 zeilen, zweite zeile bekommt "…"-fallback
function splitStockLabelTitle(title: string, maxCharsPerLine: number): string[] {
  if (title.length <= maxCharsPerLine) return [title];
  let breakAt = -1;
  for (let i = maxCharsPerLine; i > 0; i--) {
    if (title[i] === " ") { breakAt = i; break; }
  }
  if (breakAt === -1) breakAt = maxCharsPerLine;
  const line1 = title.slice(0, breakAt).trim();
  let line2 = title.slice(breakAt).trim();
  if (line2.length > maxCharsPerLine) {
    line2 = line2.slice(0, maxCharsPerLine - 1) + "…";
  }
  return [line1, line2];
}
