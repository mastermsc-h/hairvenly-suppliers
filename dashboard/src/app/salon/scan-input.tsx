"use client";

// Universal-Scanner-Eingabefeld:
// - Auto-fokussiert (Bluetooth-Scanner tippt direkt rein)
// - Sendet bei Enter den Barcode
// - Optional: Kamera-Scan via html5-qrcode

import { useEffect, useRef, useState } from "react";
import { Camera, ScanLine } from "lucide-react";

interface Props {
  onScan: (barcode: string) => void;
  busy?: boolean;
  placeholder?: string;
}

const READER_ID = "salon-scanner-reader";

export default function ScanInput({ onScan, busy, placeholder }: Props) {
  const [val, setVal] = useState("");
  const [camActive, setCamActive] = useState(false);
  const [camError, setCamError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const scannerRef = useRef<any>(null);
  const lastSentRef = useRef<{ code: string; ts: number } | null>(null);

  // Auto-focus
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Kamera-Scanner steuern
  useEffect(() => {
    let mounted = true;
    async function start() {
      if (!camActive) return;
      try {
        const { Html5Qrcode } = await import("html5-qrcode");
        if (!mounted) return;
        const sc = new Html5Qrcode(READER_ID);
        scannerRef.current = sc;
        await sc.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: 250 },
          (decoded) => {
            const now = Date.now();
            if (lastSentRef.current && lastSentRef.current.code === decoded && now - lastSentRef.current.ts < 1500) return;
            lastSentRef.current = { code: decoded, ts: now };
            onScan(decoded);
          },
          () => {},
        );
      } catch (e) {
        setCamError(e instanceof Error ? e.message : "Kamera-Fehler");
        setCamActive(false);
      }
    }
    start();
    return () => {
      mounted = false;
      if (scannerRef.current) {
        try {
          scannerRef.current.stop().catch(() => {});
          scannerRef.current.clear?.();
        } catch {
          // ignore
        }
        scannerRef.current = null;
      }
    };
  }, [camActive, onScan]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const code = val.trim();
    if (!code) return;
    setVal("");
    onScan(code);
  }

  return (
    <div className="space-y-3">
      <form onSubmit={submit} className="flex gap-2">
        <input
          ref={inputRef}
          type="text"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder={placeholder ?? "Barcode scannen..."}
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
          className="flex-1 bg-neutral-950 border border-neutral-700 rounded-xl px-4 py-4 text-lg text-white placeholder-neutral-600 focus:ring-2 focus:ring-rose-500 outline-none"
        />
        <button
          type="submit"
          disabled={busy || !val.trim()}
          className="px-5 rounded-xl bg-rose-600 hover:bg-rose-500 disabled:bg-neutral-800 disabled:text-neutral-600 font-semibold flex items-center gap-2"
        >
          <ScanLine size={20} />
        </button>
      </form>
      <div className="flex justify-center">
        <button
          onClick={() => setCamActive((v) => !v)}
          className="flex items-center gap-2 text-sm text-neutral-400 hover:text-white"
        >
          <Camera size={16} />
          {camActive ? "Kamera aus" : "Kamera einschalten"}
        </button>
      </div>
      {camError && <div className="text-rose-400 text-sm text-center">{camError}</div>}
      <div
        id={READER_ID}
        className={camActive ? "rounded-xl overflow-hidden bg-black aspect-square max-w-md mx-auto" : "hidden"}
      />
    </div>
  );
}
