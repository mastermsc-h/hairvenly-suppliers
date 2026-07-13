"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import QRCode from "qrcode";
import JsBarcode from "jsbarcode";
import { ArrowLeft, Printer, ScanLine } from "lucide-react";
import { ACCESSORY_CODE_VALUE } from "../accessory-code";

/**
 * Druckbare Karte mit dem universellen Zubehör-Scan-Code (QR + Code-128).
 * Einmal drucken, an die Packstation kleben. Beim Packen: Zubehör/Pflege/
 * Schulungen mit diesem Code abscannen statt "manuell bestätigen" zu tippen.
 */
export default function ZubehoerCodeClient() {
  const [qrDataUrl, setQrDataUrl] = useState<string>("");
  const barcodeRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    QRCode.toDataURL(ACCESSORY_CODE_VALUE, {
      width: 520,
      margin: 1,
      errorCorrectionLevel: "H",
    })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(""));
  }, []);

  useEffect(() => {
    if (!barcodeRef.current) return;
    try {
      JsBarcode(barcodeRef.current, ACCESSORY_CODE_VALUE, {
        format: "CODE128",
        displayValue: true,
        fontSize: 20,
        height: 90,
        margin: 0,
        background: "#ffffff",
        lineColor: "#000000",
      });
    } catch {
      /* ignore */
    }
  }, []);

  return (
    <div className="p-4 md:p-8 max-w-3xl space-y-6">
      <Link
        href="/pack"
        className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-900 print:hidden"
      >
        <ArrowLeft size={14} /> Zurück zu Shopify Bestellungen
      </Link>

      <header className="print:hidden">
        <h1 className="text-2xl font-semibold text-neutral-900">Zubehör-Scan-Code</h1>
        <p className="text-sm text-neutral-500 mt-1 leading-relaxed">
          Ein Code für <strong>alles außer Extensions</strong> — Zubehör, Pflege, Schulungen.
          Beim Packen einfach diesen Code scannen, statt „manuell bestätigen" zu tippen.
          Ein Scan hakt die nächste offene Zubehör-Position komplett ab.
        </p>
        <button
          onClick={() => window.print()}
          className="mt-4 inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-700 transition"
        >
          <Printer size={15} /> Drucken
        </button>
      </header>

      {/* Die eigentliche Karte — auch beim Drucken sichtbar */}
      <div className="bg-white rounded-2xl border-2 border-neutral-900 p-6 md:p-8 shadow-sm max-w-md mx-auto text-center">
        <div className="flex items-center justify-center gap-2 text-neutral-900">
          <ScanLine size={20} />
          <span className="text-lg font-bold uppercase tracking-wide">Zubehör &amp; Accessoires</span>
        </div>
        <div className="text-xs text-neutral-500 mt-1">
          Pflege · Schulungen · alles außer Extensions
        </div>

        {qrDataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={qrDataUrl}
            alt="Zubehör-QR"
            className="mx-auto mt-5 w-56 h-56"
          />
        ) : (
          <div className="mx-auto mt-5 w-56 h-56 bg-neutral-100 rounded-lg" />
        )}

        <div className="mt-5 flex justify-center">
          <svg ref={barcodeRef} />
        </div>

        <div className="mt-4 text-[11px] text-neutral-500 leading-relaxed">
          Mit der iPhone-Kamera den <strong>QR</strong> scannen, oder mit dem
          Handscanner den <strong>Strichcode</strong>. Beides bestätigt die
          nächste offene Zubehör-Position im Pack-Vorgang.
        </div>
      </div>
    </div>
  );
}
