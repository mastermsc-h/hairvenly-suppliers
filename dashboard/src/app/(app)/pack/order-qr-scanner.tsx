"use client";

import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { Camera, X, ScanLine } from "lucide-react";
import { useRouter } from "next/navigation";

const READER_ID = "order-qr-reader";

/**
 * Scannt einen Order-QR direkt im Dashboard und navigiert zur Pack-Page.
 * Vermeidet Umweg über iPhone-Standard-Kamera-App.
 *
 * Erkennt URLs wie `https://suppliers.hairvenly.de/pack/22315` und
 * leitet zu `/pack/22315` weiter.
 */
export default function OrderQrScanner({
  buttonLabel = "Order-QR scannen",
  buttonClass,
}: {
  buttonLabel?: string;
  buttonClass?: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const start = async () => {
      try {
        const scanner = new Html5Qrcode(READER_ID, { verbose: false });
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 280, height: 280 } },
          async (decodedText) => {
            if (cancelled) return;
            // URL parsen → /pack/<order>
            let orderName: string | null = null;
            try {
              const u = new URL(decodedText);
              const m = u.pathname.match(/\/pack\/([^/?#]+)/);
              if (m) orderName = decodeURIComponent(m[1]);
            } catch {
              // Kein gültiger URL — vielleicht direkte Bestellnummer
              const m = decodedText.match(/^#?(\d{3,})$/);
              if (m) orderName = m[1];
            }
            if (orderName) {
              cancelled = true;
              try {
                await scanner.stop();
                await scanner.clear();
              } catch {
                // ignore
              }
              setOpen(false);
              router.push(`/pack/${orderName.replace(/^#/, "")}`);
            }
          },
          () => {
            // Frame ohne QR — ignorieren
          },
        );
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setOpen(false);
      }
    };
    void start();

    return () => {
      cancelled = true;
      const sc = scannerRef.current;
      if (sc) {
        sc.stop()
          .then(() => sc.clear())
          .catch(() => {});
        scannerRef.current = null;
      }
    };
  }, [open, router]);

  return (
    <>
      <button
        onClick={() => {
          setError(null);
          setOpen(true);
        }}
        className={
          buttonClass ??
          "flex items-center gap-2 px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 transition"
        }
      >
        <ScanLine size={16} />
        {buttonLabel}
      </button>
      {error && <div className="mt-1 text-xs text-red-700">{error}</div>}

      {open && (
        <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl overflow-hidden max-w-lg w-full">
            <div className="flex items-center justify-between p-3 bg-neutral-900 text-white">
              <div className="flex items-center gap-2 text-sm">
                <Camera size={16} />
                <span>Order-QR vom Lieferschein scannen</span>
              </div>
              <button onClick={() => setOpen(false)} className="text-white hover:text-red-300">
                <X size={20} />
              </button>
            </div>
            <div id={READER_ID} className="w-full bg-black min-h-[320px]" />
            <div className="p-3 text-xs text-neutral-500 text-center">
              QR vom Lieferschein vor die Kamera halten — Bestellung öffnet automatisch.
            </div>
          </div>
        </div>
      )}
    </>
  );
}
