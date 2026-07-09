"use client";

import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { Camera, X, ScanLine } from "lucide-react";

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
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  // Verhindert doppeltes stop() (success-handler + effect-cleanup) — das war
  // die Ursache für iOS-PWA-Crashes ("This page couldn't load").
  const teardownRef = useRef(false);

  // Kamera 100% freigeben: html5-qrcode stop/clear PLUS alle noch offenen
  // MediaStream-Tracks killen. Ohne das bleibt auf iOS die Kamera belegt und
  // WebKit crasht bei der Navigation zur nächsten (kamera-nutzenden) Seite.
  const teardownCamera = async () => {
    if (teardownRef.current) return;
    teardownRef.current = true;
    const sc = scannerRef.current;
    if (sc) {
      try {
        await sc.stop();
      } catch {
        /* schon gestoppt */
      }
      try {
        await sc.clear();
      } catch {
        /* ignore */
      }
      scannerRef.current = null;
    }
    // Fallback: übrig gebliebene Video-Streams im Reader-Container hart stoppen
    try {
      const el = document.getElementById(READER_ID);
      el?.querySelectorAll("video").forEach((v) => {
        const s = (v as HTMLVideoElement).srcObject as MediaStream | null;
        s?.getTracks().forEach((t) => t.stop());
        (v as HTMLVideoElement).srcObject = null;
      });
    } catch {
      /* ignore */
    }
  };

  useEffect(() => {
    if (!open) return;
    teardownRef.current = false;
    let cancelled = false;

    const start = async () => {
      try {
        const scanner = new Html5Qrcode(READER_ID, { verbose: false });
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 280, height: 280 } },
          async (decodedText) => {
            if (cancelled || teardownRef.current) return;
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
              const target = `/pack/${orderName.replace(/^#/, "")}`;
              await teardownCamera();
              setOpen(false);
              // Kurz warten, bis iOS die Kamera-Ressource wirklich freigegeben
              // hat, dann HART navigieren (voller Load statt RSC-Stream —
              // robuster in der standalone-PWA, kein WebKit-Crash).
              setTimeout(() => {
                window.location.assign(target);
              }, 250);
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
      void teardownCamera();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

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
