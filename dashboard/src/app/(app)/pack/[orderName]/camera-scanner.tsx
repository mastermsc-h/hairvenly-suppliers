"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { Camera, CameraOff, RefreshCw, Flashlight } from "lucide-react";

const READER_ID = "pack-camera-reader";

// Nur die tatsächlich genutzten Formate → schnellerer Decode-Loop.
// EAN/UPC/Code128 (Produkt-Barcodes) + QR (Lieferschein-Order-QR).
const SCAN_FORMATS = [
  Html5QrcodeSupportedFormats.QR_CODE,
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
];

// Höhere Kamera-Auflösung + kontinuierlicher Autofokus erzwingen. Das ist der
// größte Software-Hebel gegen "muss hin- und herfahren bis er scharf stellt":
// scharfes, hochaufgelöstes Bild = die dünnen Code-128-Striche werden getrennt.
// focusMode steht in advanced[] (best-effort, wird ignoriert wo nicht unterstützt,
// statt einen OverconstrainedError zu werfen).
const VIDEO_CONSTRAINTS = {
  facingMode: "environment",
  width: { ideal: 1920 },
  height: { ideal: 1080 },
  // @ts-expect-error focusMode/advanced sind non-standard MediaTrackConstraints
  advanced: [{ focusMode: "continuous" }],
} as MediaTrackConstraints;

// Große, breite Scan-Fläche relativ zum Sucher: der Barcode muss nicht mehr
// exakt zentriert/nah sein. Deckt ~92% Breite ab (1D-Codes sind quer).
function scanBox(vfW: number, vfH: number): { width: number; height: number } {
  const width = Math.max(200, Math.floor(Math.min(vfW * 0.92, 460)));
  const height = Math.max(140, Math.floor(Math.min(vfH * 0.55, 280)));
  return { width, height };
}

export default function CameraScanner({
  onScan,
  paused = false,
  onActiveChange,
}: {
  onScan: (barcode: string) => void;
  paused?: boolean;
  onActiveChange?: (active: boolean) => void;
}) {
  const [active, setActive] = useState(false);

  useEffect(() => {
    onActiveChange?.(active);
  }, [active, onActiveChange]);
  const [error, setError] = useState<string | null>(null);
  const [restartTick, setRestartTick] = useState(0);
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const lastScanRef = useRef<{ code: string; ts: number } | null>(null);
  const onScanRef = useRef(onScan);

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  // Taschenlampe umschalten (hilft enorm bei dunklen Lager-Regalen).
  const toggleTorch = useCallback(async () => {
    const sc = scannerRef.current;
    if (!sc) return;
    const next = !torchOn;
    try {
      // @ts-expect-error torch ist eine nicht-standard-constraint, device-abhängig
      await sc.applyVideoConstraints({ advanced: [{ torch: next }] });
      setTorchOn(next);
    } catch {
      setTorchAvailable(false);
    }
  }, [torchOn]);

  const restart = useCallback(() => {
    setRestartTick((t) => t + 1);
  }, []);

  // Start / stop based on `active` (oder restartTick)
  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    const start = async () => {
      try {
        // Sicherheits-cleanup falls noch ein alter scanner aktiv ist
        if (scannerRef.current) {
          try {
            await scannerRef.current.stop();
            await scannerRef.current.clear();
          } catch {
            // ignore
          }
          scannerRef.current = null;
        }

        const scanner = new Html5Qrcode(READER_ID, {
          verbose: false,
          formatsToSupport: SCAN_FORMATS,
          // Nutzt die native (deutlich schnellere) BarcodeDetector-API wo
          // verfügbar — auf iOS-Safari nicht, schadet aber nicht.
          experimentalFeatures: { useBarCodeDetectorIfSupported: true },
        });
        scannerRef.current = scanner;

        await scanner.start(
          VIDEO_CONSTRAINTS,
          {
            fps: 12,
            // Breite, große Scan-Fläche (siehe scanBox) → Barcode muss nicht
            // exakt zentriert/nah sein; mehr Sample-Zeilen = toleranter bei
            // Schräglage. Etwas weniger fps, weil der größere Crop mehr rechnet.
            qrbox: scanBox,
            aspectRatio: 1.777,
          },
          (decodedText) => {
            const now = Date.now();
            const last = lastScanRef.current;
            // De-Dupe-Fenster: 3000ms — verhindert dass ein lange im Bild
            // gehaltener Code mehrfach gewertet wird, auch wenn der Server-Call
            // länger als 1.2s dauert.
            if (last && last.code === decodedText && now - last.ts < 3000) return;
            lastScanRef.current = { code: decodedText, ts: now };
            onScanRef.current(decodedText);
          },
          () => {
            // ignore frames without barcode
          },
        );
        if (cancelled) {
          await scanner.stop();
          await scanner.clear();
        } else {
          // Prüfen ob die Kamera eine Taschenlampe hat → Torch-Button zeigen
          try {
            const caps = scanner.getRunningTrackCapabilities?.() as
              | { torch?: boolean }
              | undefined;
            setTorchAvailable(!!caps?.torch);
          } catch {
            setTorchAvailable(false);
          }
          setTorchOn(false);
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
      }
    };
    void start();

    return () => {
      cancelled = true;
      const scanner = scannerRef.current;
      if (scanner) {
        scanner
          .stop()
          .then(() => scanner.clear())
          .catch(() => {});
        scannerRef.current = null;
      }
    };
  }, [active, restartTick]);

  // IntersectionObserver: bei out-of-view pause, bei in-view resume.
  // Verhindert dass die Kamera einfriert wenn man wegscrollt (iOS-Safari-Bug).
  useEffect(() => {
    if (!active) return;
    const el = document.getElementById(READER_ID);
    if (!el) return;
    let wasOut = false;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        const sc = scannerRef.current;
        if (!sc) return;
        if (entry.isIntersecting) {
          if (wasOut) {
            // Beim Wieder-Reinscrollen: resumen oder full-restart
            try {
              sc.resume();
              wasOut = false;
            } catch {
              restart();
              wasOut = false;
            }
          }
        } else {
          try {
            sc.pause(true);
            wasOut = true;
          } catch {
            // ignore
          }
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [active, restart]);

  // Page Visibility: bei Tab-Wechsel zurück → restart (iOS pausiert oft)
  useEffect(() => {
    if (!active) return;
    function onVis() {
      if (document.visibilityState === "visible") {
        const sc = scannerRef.current;
        if (sc) {
          try {
            sc.resume();
          } catch {
            restart();
          }
        }
      }
    }
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [active, restart]);

  // Pause: keep scanner mounted but ignore detections (handled by parent via not calling onScan)
  // We rely on parent to trigger; here we just expose UI state.

  return (
    <div className="bg-neutral-900 rounded-2xl overflow-hidden border border-neutral-200 relative">
      <div className="flex items-center justify-between p-3 bg-neutral-800 text-white">
        <div className="flex items-center gap-2 text-sm">
          <Camera size={16} />
          <span>Kamera-Scanner</span>
          {paused && <span className="text-xs text-amber-300">(pausiert)</span>}
        </div>
        <div className="flex items-center gap-2">
          {active && torchAvailable && (
            <button
              onClick={toggleTorch}
              className={`px-2 py-1.5 rounded-lg text-xs font-medium ${
                torchOn ? "bg-amber-400 text-neutral-900" : "bg-neutral-700 text-white hover:bg-neutral-600"
              }`}
              title="Taschenlampe an/aus"
            >
              <Flashlight size={12} />
            </button>
          )}
          {active && (
            <button
              onClick={restart}
              className="px-2 py-1.5 rounded-lg text-xs font-medium bg-neutral-700 text-white hover:bg-neutral-600"
              title="Kamera neu starten (falls eingefroren)"
            >
              <RefreshCw size={12} />
            </button>
          )}
          <button
            onClick={() => setActive((a) => !a)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium ${
              active ? "bg-red-600 text-white" : "bg-emerald-600 text-white"
            }`}
          >
            {active ? (
              <span className="flex items-center gap-1">
                <CameraOff size={12} /> Aus
              </span>
            ) : (
              <span className="flex items-center gap-1">
                <Camera size={12} /> Start
              </span>
            )}
          </button>
        </div>
      </div>

      <div
        id={READER_ID}
        className="w-full bg-black"
        style={{ minHeight: active ? 280 : 0 }}
      />

      {!active && (
        <div className="p-6 text-center text-neutral-400 text-sm">
          Kamera aus. Tippe „Start“ — oder nutze stattdessen den USB-Scanner / das Eingabefeld unten.
        </div>
      )}

      {error && (
        <div className="p-3 bg-red-900/40 text-red-200 text-xs">
          Kamera-Fehler: {error}
        </div>
      )}
    </div>
  );
}
