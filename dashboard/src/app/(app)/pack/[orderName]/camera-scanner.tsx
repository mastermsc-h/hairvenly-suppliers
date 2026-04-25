"use client";

import { useEffect, useRef, useState } from "react";
import { Html5Qrcode } from "html5-qrcode";
import { Camera, CameraOff } from "lucide-react";

const READER_ID = "pack-camera-reader";

export default function CameraScanner({
  onScan,
  paused = false,
}: {
  onScan: (barcode: string) => void;
  paused?: boolean;
}) {
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const lastScanRef = useRef<{ code: string; ts: number } | null>(null);
  const onScanRef = useRef(onScan);

  useEffect(() => {
    onScanRef.current = onScan;
  }, [onScan]);

  // Start / stop based on `active`
  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    const start = async () => {
      try {
        const scanner = new Html5Qrcode(READER_ID, { verbose: false });
        scannerRef.current = scanner;

        await scanner.start(
          { facingMode: "environment" },
          {
            fps: 10,
            qrbox: { width: 280, height: 200 },
            aspectRatio: 1.5,
          },
          (decodedText) => {
            // De-dupe scans within 1.2s window so a single barcode in front of camera
            // doesn't trigger 10 scans per second.
            const now = Date.now();
            const last = lastScanRef.current;
            if (last && last.code === decodedText && now - last.ts < 1200) return;
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
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        setActive(false);
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
          .catch(() => {
            // already stopped
          });
        scannerRef.current = null;
      }
    };
  }, [active]);

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
