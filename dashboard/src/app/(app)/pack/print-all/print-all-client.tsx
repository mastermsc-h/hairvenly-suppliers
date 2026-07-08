"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import Link from "next/link";
import { Printer, ArrowLeft } from "lucide-react";
import { recordSlipPrint } from "@/lib/actions/pack";

interface SlipItem {
  title: string;
  variantTitle: string | null;
  quantity: number;
  isExtension: boolean;
  lineTotal: string;
}

interface Slip {
  name: string;
  numberClean: string;
  createdAt: string;
  totalPrice: string;
  currency: string;
  shippingAddress: {
    name: string | null;
    address1: string | null;
    zip: string | null;
    city: string | null;
    country: string | null;
  } | null;
  items: SlipItem[];
}

function formatMoney(amount: string, currency: string): string {
  const n = parseFloat(amount);
  if (!Number.isFinite(n)) return `${amount} ${currency}`;
  return n.toLocaleString("de-DE", { style: "currency", currency });
}

function detectAttributes(title: string, variantTitle: string | null) {
  const upper = (title + " " + (variantTitle ?? "")).toUpperCase();
  // cls verweist auf eine selbst-definierte CSS-Klasse mit !important-Hintergrund
  // damit die Farbe im Druck definitiv erhalten bleibt (Tailwind-classes gehen
  // im Druck oft verloren).
  let method = { label: "", cls: "" };
  if (upper.includes("BONDING")) method = { label: "BONDINGS", cls: "method-bondings" };
  else if (upper.includes("MINI TAPE") || upper.includes("MINI-TAPE"))
    method = { label: "MINI-TAPES", cls: "method-tapes" };
  else if (upper.includes("TAPE")) method = { label: "TAPES", cls: "method-tapes" };
  else if (upper.includes("INVISIBLE") && upper.includes("TRESSE")) method = { label: "INVISIBLE TRESSE", cls: "method-invisible" };
  else if (upper.includes("BUTTERFLY") && upper.includes("WEFT")) method = { label: "INVISIBLE TRESSE", cls: "method-invisible" };
  else if (upper.includes("GENIUS") && upper.includes("TRESSE")) method = { label: "GENIUS TRESSE", cls: "method-genius" };
  else if (upper.includes("CLASSIC") && upper.includes("TRESSE")) method = { label: "CLASSIC TRESSE", cls: "method-tressen" };
  else if (upper.includes("TRESSE")) method = { label: "TRESSEN", cls: "method-tressen" };
  else if (upper.includes("CLIP")) method = { label: "CLIP-IN", cls: "method-clipin" };
  else if (upper.includes("PONYTAIL")) method = { label: "PONYTAIL", cls: "method-ponytail" };

  let length = "";
  for (const cm of [45, 55, 65, 75, 85]) {
    if (upper.includes(`${cm}CM`)) {
      length = `${cm}cm`;
      break;
    }
  }
  let origin = "";
  if (upper.includes("RU GLATT") || upper.includes("RUSSISCH")) origin = "RU";
  else if (upper.includes("US WELLIG") || upper.includes("USBEKISCH")) origin = "US";

  return { method, length, origin };
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("de-DE", { day: "2-digit", month: "long", year: "numeric" });
  } catch {
    return iso;
  }
}

export default function PrintAllClient({ slips }: { slips: Slip[] }) {
  const [qrMap, setQrMap] = useState<Record<string, string>>({});
  const [ready, setReady] = useState(false);
  const printedRef = useRef(false);

  // QR-Codes für alle Bestellungen generieren
  useEffect(() => {
    if (typeof window === "undefined") return;
    const origin = window.location.origin;
    let cancelled = false;
    (async () => {
      // Parallel QR-Codes generieren — bei 30 orders war sequenziell zu langsam
      const entries = await Promise.all(
        slips.map(async (slip) => {
          const url = `${origin}/pack/${slip.numberClean}`;
          try {
            const dataUrl = await QRCode.toDataURL(url, {
              width: 180,
              margin: 1,
              errorCorrectionLevel: "M",
              color: { dark: "#000000", light: "#FFFFFF" },
            });
            return [slip.name, dataUrl] as const;
          } catch {
            return [slip.name, ""] as const;
          }
        }),
      );
      if (!cancelled) {
        setQrMap(Object.fromEntries(entries.filter(([, v]) => v)));
        setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [slips]);

  // Sobald alle QRs da sind: einmal automatisch das Druckfenster öffnen
  // + den Druck protokollieren (wer/wann), damit die Versand-Liste + das
  // Archiv anzeigen können dass der Lieferschein raus ist.
  useEffect(() => {
    if (!ready || printedRef.current || slips.length === 0) return;
    printedRef.current = true;
    void recordSlipPrint(slips.map((s) => s.name)).catch(() => {});
    const tm = setTimeout(() => window.print(), 500);
    return () => clearTimeout(tm);
  }, [ready, slips]);

  if (slips.length === 0) {
    return (
      <div className="p-8 max-w-3xl">
        <Link href="/pack" className="text-sm text-neutral-500 hover:text-neutral-900 inline-flex items-center gap-1 mb-4">
          <ArrowLeft size={16} /> Zurück
        </Link>
        <div className="bg-white rounded-2xl border border-neutral-200 p-8 text-center text-neutral-500">
          Keine offenen Bestellungen zum Drucken.
        </div>
      </div>
    );
  }

  return (
    <>
      {/* Print-CSS — einmalig pro Seite */}
      <style>{`
        @media screen {
          .print-bar { position: sticky; top: 0; z-index: 10; }
        }
        @media print {
          /* WICHTIG: Hintergrundfarben im Druck erhalten — sonst druckt der
             Browser farbige Tags als plain text ("Tinte sparen"-Default). */
          *, *::before, *::after {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
            color-adjust: exact !important;
          }
          .no-print { display: none !important; }
          /* Sidebar + Mobile-Header aus layout.tsx ausblenden */
          aside, [data-mobile-sidebar], .top-progress { display: none !important; }
          @page { size: A4; margin: 12mm; }
          html, body { background: white !important; margin: 0 !important; padding: 0 !important; }
          main { padding: 0 !important; overflow: visible !important; }
          .slip-page {
            page-break-after: always;
            break-after: page;
            box-shadow: none !important;
          }
          .slip-page:last-child {
            page-break-after: auto;
            break-after: auto;
          }
        }
        .slip-page {
          width: 100%;
          max-width: 186mm; /* A4 minus margin */
          margin: 0 auto 24px;
          padding: 0;
          background: white;
          color: #1f1f1f;
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
        }
        /* Inline-styles damit Tailwind-classes im Druck nicht verloren gehen */
        .method-badge {
          display: inline-block;
          padding: 3px 8px;
          border-radius: 3px;
          font-weight: 700;
          font-size: 11px;
          letter-spacing: 1.2px;
          color: #fff;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        .method-bondings  { background: #c2410c !important; }
        .method-tapes     { background: #1d4ed8 !important; }
        .method-tressen   { background: #15803d !important; }
        .method-invisible { background: #7e22ce !important; }
        .method-genius    { background: #0f766e !important; }
        .method-clipin    { background: #6d28d9 !important; }
        .method-ponytail  { background: #be185d !important; }
        .tag-secondary {
          display: inline-block;
          padding: 3px 8px;
          border-radius: 3px;
          font-weight: 700;
          font-size: 11px;
          letter-spacing: 1.2px;
          color: #fff;
          margin-left: 4px;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        .tag-length { background: #475569 !important; }
        .tag-origin { background: #b91c1c !important; }
      `}</style>

      <div className="print-bar bg-white border-b border-neutral-200 p-3 flex items-center justify-between gap-3 no-print">
        <div className="flex items-center gap-3">
          <Link href="/pack" className="text-sm text-neutral-500 hover:text-neutral-900 inline-flex items-center gap-1">
            <ArrowLeft size={16} /> Zurück
          </Link>
          <div className="text-sm text-neutral-700">
            <strong>{slips.length}</strong> Lieferschein{slips.length === 1 ? "" : "e"} · automatisches Druckfenster {ready ? "wurde geöffnet" : "wird vorbereitet…"}
          </div>
        </div>
        <button
          type="button"
          onClick={() => window.print()}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-700 transition"
        >
          <Printer size={16} /> Erneut drucken
        </button>
      </div>

      <div className="p-4 md:p-8 bg-neutral-100 min-h-screen print:p-0 print:bg-white">
        {slips.map((slip) => (
          <div key={slip.name} className="slip-page bg-white p-8 md:p-10 shadow-sm print:shadow-none">
            {/* Header */}
            <div className="flex justify-between items-start mb-8">
              <div>
                <h1 className="text-2xl tracking-widest font-semibold m-0">HAIRVENLY</h1>
              </div>
              <div className="text-right">
                {qrMap[slip.name] ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={qrMap[slip.name]} alt="" className="w-[90px] h-[90px] ml-auto block" />
                ) : (
                  <div className="w-[90px] h-[90px] bg-neutral-100 ml-auto" />
                )}
                <div className="text-[8px] text-neutral-500 text-center tracking-widest mt-1">{slip.name}</div>
                <div className="text-sm font-semibold mt-2">Bestellung {slip.name}</div>
                <div className="text-xs text-neutral-500">{formatDate(slip.createdAt)}</div>
              </div>
            </div>

            {/* Adresse */}
            {slip.shippingAddress && (
              <div className="mb-6">
                <div className="text-[11px] tracking-widest font-bold text-neutral-600">LIEFERN AN</div>
                <div className="text-sm leading-relaxed mt-2">
                  {slip.shippingAddress.name && <>{slip.shippingAddress.name}<br /></>}
                  {slip.shippingAddress.address1 && <>{slip.shippingAddress.address1}<br /></>}
                  {(slip.shippingAddress.zip || slip.shippingAddress.city) && (
                    <>{slip.shippingAddress.zip} {slip.shippingAddress.city}<br /></>
                  )}
                  {slip.shippingAddress.country}
                </div>
              </div>
            )}

            {/* Items-Tabelle */}
            <table className="w-full border-collapse mt-2">
              <thead>
                <tr>
                  <th className="text-left text-[11px] tracking-widest text-neutral-600 border-b-2 border-black py-2">ARTIKEL</th>
                  <th className="text-right text-[11px] tracking-widest text-neutral-600 border-b-2 border-black py-2 w-[80px]">ANZAHL</th>
                  <th className="text-right text-[11px] tracking-widest text-neutral-600 border-b-2 border-black py-2 w-[100px]">PREIS</th>
                </tr>
              </thead>
              <tbody>
                {slip.items.map((it, i) => {
                  const attrs = detectAttributes(it.title, it.variantTitle);
                  return (
                    <tr key={i} className="border-b border-neutral-200">
                      <td className="py-3 align-top">
                        {it.isExtension && (attrs.method.label || attrs.length || attrs.origin) && (
                          <div className="mb-1">
                            {attrs.method.label && (
                              <span className={`method-badge ${attrs.method.cls}`}>{attrs.method.label}</span>
                            )}
                            {attrs.length && <span className="tag-secondary tag-length">{attrs.length}</span>}
                            {attrs.origin && <span className="tag-secondary tag-origin">{attrs.origin}</span>}
                          </div>
                        )}
                        <div className="text-sm leading-snug">{it.title}</div>
                        {it.variantTitle && it.variantTitle !== "Default Title" && (
                          <div className="text-xs text-neutral-600 mt-0.5">{it.variantTitle}</div>
                        )}
                      </td>
                      <td className="py-3 align-top text-right">
                        <span className="font-bold text-base">{it.quantity}×</span>
                      </td>
                      <td className="py-3 align-top text-right">
                        <span className="text-sm">{formatMoney(it.lineTotal, slip.currency)}</span>
                      </td>
                    </tr>
                  );
                })}
                <tr>
                  <td colSpan={2} className="py-3 text-right text-sm font-semibold">
                    Gesamt (inkl. Versand)
                  </td>
                  <td className="py-3 text-right text-base font-bold border-t-2 border-black">
                    {formatMoney(slip.totalPrice, slip.currency)}
                  </td>
                </tr>
              </tbody>
            </table>

            {/* Footer */}
            <div className="text-center text-xs text-neutral-600 mt-10 leading-relaxed">
              <div>Danke, dass du bei uns eingekauft hast!</div>
              <div className="mt-3 font-semibold">HAIRVENLY</div>
              <div>info@hairvenly.de</div>
              <div>hairvenly.de</div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
