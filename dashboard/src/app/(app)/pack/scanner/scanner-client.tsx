"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Html5Qrcode, Html5QrcodeSupportedFormats } from "html5-qrcode";
import { Camera, CameraOff, AlertTriangle, Search, ArrowLeft, ScanLine, RefreshCw, Flashlight } from "lucide-react";
import { type Locale } from "@/lib/i18n";
import { scanProductByBarcode } from "@/lib/actions/pack";

// Nur die Formate erlauben, die wir tatsächlich brauchen — das beschleunigt
// die Dekodierung deutlich (die Lib probiert sonst alle ~15 Symbologien durch).
const SCAN_FORMATS = [
  Html5QrcodeSupportedFormats.QR_CODE,
  Html5QrcodeSupportedFormats.CODE_128,
  Html5QrcodeSupportedFormats.CODE_39,
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
];

// Höhere Auflösung + kontinuierlicher Autofokus → scharfes Bild, damit die
// dünnen Code-128-Striche getrennt werden (größter Software-Hebel gegen
// "muss hin- und herfahren"). focusMode in advanced[] = best-effort.
const VIDEO_CONSTRAINTS = {
  facingMode: "environment",
  width: { ideal: 1920 },
  height: { ideal: 1080 },
  // @ts-expect-error focusMode/advanced sind non-standard MediaTrackConstraints
  advanced: [{ focusMode: "continuous" }],
} as MediaTrackConstraints;

// Große, breite Scan-Fläche relativ zum Sucher (Barcode muss nicht exakt
// zentriert/nah sein). 1D-Codes sind quer → ~92% Breite.
function scanBox(vfW: number, vfH: number): { width: number; height: number } {
  const width = Math.max(200, Math.floor(Math.min(vfW * 0.92, 460)));
  const height = Math.max(140, Math.floor(Math.min(vfH * 0.55, 280)));
  return { width, height };
}

interface Result {
  productTitle: string;
  variantTitle: string | null;
  barcode: string;
  imageUrl: string | null;
  collectionTitles: string[];
  productHandle: string;
  variantId: string;
}

const READER_ID = "scanner-reader";

export default function ScannerClient({ locale: _locale }: { locale: Locale }) {
  const [active, setActive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [restartTick, setRestartTick] = useState(0);
  const [scanInput, setScanInput] = useState("");
  const [results, setResults] = useState<Result[] | null>(null);
  const [scanned, setScanned] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [history, setHistory] = useState<{ barcode: string; result: Result | null; ts: number }[]>([]);
  const [torchOn, setTorchOn] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const lastScanRef = useRef<{ code: string; ts: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const resultRef = useRef<HTMLDivElement>(null);
  const wasCameraActiveRef = useRef(false);

  // Wenn ein neues Ergebnis kommt: zum result scrollen
  useEffect(() => {
    if ((results || notFound) && !isPending) {
      setTimeout(() => {
        resultRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 50);
    }
  }, [results, notFound, isPending]);

  // Wenn ergebnis angezeigt: kamera pausieren (sonst läuft sie im hintergrund)
  useEffect(() => {
    const hasResult = !!(results || notFound);
    if (hasResult && active) {
      // Merken dass die Kamera AN war, damit Reset sie wieder aktiviert
      wasCameraActiveRef.current = true;
      setActive(false);
    }
  }, [results, notFound, active]);

  const performLookup = useCallback((barcode: string) => {
    const trimmed = barcode.trim();
    if (!trimmed) return;
    // Order-QR erkannt (Lieferschein-QR) → direkt in den Pack-Mode springen
    const packUrl = trimmed.match(/\/pack\/(\d+)/);
    if (packUrl) {
      window.location.href = `/pack/${packUrl[1]}`;
      return;
    }
    setScanned(trimmed);
    setNotFound(false);
    setResults(null);
    startTransition(async () => {
      const res = await scanProductByBarcode(trimmed);
      if (!res.success) {
        setError(res.error ?? "Fehler");
        return;
      }
      const list = res.results ?? [];
      if (list.length === 0) {
        setNotFound(true);
        setResults(null);
        setHistory((h) => [{ barcode: trimmed, result: null, ts: Date.now() }, ...h].slice(0, 10));
      } else {
        setResults(list);
        setHistory((h) => [{ barcode: trimmed, result: list[0], ts: Date.now() }, ...h].slice(0, 10));
      }
    });
  }, []);

  const restart = useCallback(() => setRestartTick((t) => t + 1), []);

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

  // Camera-Scanner setup
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    (async () => {
      try {
        if (scannerRef.current) {
          try {
            await scannerRef.current.stop();
            await scannerRef.current.clear();
          } catch {
            /* ignore */
          }
          scannerRef.current = null;
        }
        const scanner = new Html5Qrcode(READER_ID, {
          verbose: false,
          formatsToSupport: SCAN_FORMATS,
          // Nutzt die native BarcodeDetector-API des Browsers wo verfügbar
          // (iOS Safari/WebKit) — deutlich schnellere & robustere Erkennung.
          experimentalFeatures: { useBarCodeDetectorIfSupported: true },
        });
        scannerRef.current = scanner;
        await scanner.start(
          // 1. Param MUSS genau 1 Key haben — volle Constraints (Auflösung/
          // Fokus) gehören in config.videoConstraints (siehe camera-scanner.tsx).
          { facingMode: "environment" },
          // Große Scan-Fläche (siehe scanBox) + kontinuierlicher Fokus →
          // toleranter bei Abstand/Winkel, weniger "hin- und herfahren".
          { fps: 12, qrbox: scanBox, aspectRatio: 1.777, videoConstraints: VIDEO_CONSTRAINTS },
          (text) => {
            const now = Date.now();
            const last = lastScanRef.current;
            if (last && last.code === text && now - last.ts < 3000) return;
            lastScanRef.current = { code: text, ts: now };
            performLookup(text);
          },
          () => {
            /* ignore non-decodes */
          },
        );
        if (cancelled) {
          await scanner.stop();
          await scanner.clear();
        } else {
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
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
      const s = scannerRef.current;
      if (s) {
        s.stop().then(() => s.clear()).catch(() => {});
        scannerRef.current = null;
      }
    };
  }, [active, restartTick, performLookup]);

  function handleManualSubmit(e: React.FormEvent) {
    e.preventDefault();
    performLookup(scanInput);
    setScanInput("");
  }

  function reset() {
    setResults(null);
    setScanned(null);
    setNotFound(false);
    setScanInput("");
    // Wenn vorher Kamera lief: wieder einschalten, sonst Input fokussieren
    if (wasCameraActiveRef.current) {
      wasCameraActiveRef.current = false;
      setActive(true);
    } else {
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }

  return (
    <div className="p-4 md:p-6 max-w-4xl space-y-4">
      <Link
        href="/pack"
        className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-900"
      >
        <ArrowLeft size={14} /> Zurück zum Versand
      </Link>

      <header>
        <h1 className="text-2xl font-semibold text-neutral-900">Produkt-Scanner</h1>
        <p className="text-sm text-neutral-500 mt-1">
          Barcode scannen — System zeigt dir an, um welches Produkt es sich handelt.
        </p>
      </header>

      <div className={`grid grid-cols-1 md:grid-cols-2 gap-4 ${results || notFound || isPending ? "hidden" : ""}`}>
        {/* Kamera-Scanner */}
        <div className="bg-neutral-900 rounded-2xl overflow-hidden border border-neutral-200">
          <div className="flex items-center justify-between p-3 bg-neutral-800 text-white">
            <div className="flex items-center gap-2 text-sm">
              <Camera size={16} />
              <span>Kamera-Scanner</span>
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
                  title="Kamera neu starten"
                >
                  <RefreshCw size={12} />
                </button>
              )}
              <button
                onClick={() => setActive((a) => !a)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium ${active ? "bg-red-600 text-white" : "bg-emerald-600 text-white"}`}
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
          <div id={READER_ID} className="w-full bg-black" style={{ minHeight: active ? 280 : 0 }} />
          {!active && (
            <div className="p-6 text-center text-neutral-400 text-sm">
              Tippe „Start", um die Kamera zu aktivieren — oder nutze das Eingabefeld rechts (USB-Scanner / manuelle Eingabe).
            </div>
          )}
          {error && <div className="p-3 bg-red-900/40 text-red-200 text-xs">Kamera-Fehler: {error}</div>}
        </div>

        {/* Manuelle Eingabe */}
        <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
          <form onSubmit={handleManualSubmit}>
            <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide flex items-center gap-1">
              <ScanLine size={14} />
              Barcode / EAN eingeben
            </label>
            <input
              ref={inputRef}
              type="text"
              value={scanInput}
              onChange={(e) => setScanInput(e.target.value)}
              autoFocus
              inputMode="text"
              autoComplete="off"
              className="mt-2 w-full text-2xl font-mono px-4 py-4 rounded-lg border-2 border-neutral-300 focus:outline-none focus:border-neutral-900 focus:ring-2 focus:ring-neutral-900"
              placeholder="z.B. 27212552"
            />
            <div className="text-xs text-neutral-500 mt-2">
              USB-Scanner sendet automatisch + Enter. Manuell: tippe und Enter drücken.
            </div>
            <button
              type="submit"
              disabled={isPending || !scanInput.trim()}
              className="mt-3 w-full px-4 py-2 rounded-lg bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-700 transition disabled:opacity-50 inline-flex items-center justify-center gap-2"
            >
              <Search size={14} />
              Suchen
            </button>
          </form>
        </div>
      </div>

      {/* Ergebnis */}
      {(results || notFound || isPending) && scanned && (
        <div ref={resultRef} className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm scroll-mt-4">
          <div className="flex items-center justify-between mb-4 flex-wrap gap-2">
            <div className="text-xs text-neutral-500">
              Gescannt: <span className="font-mono text-neutral-900">{scanned}</span>
            </div>
            {!isPending && (
              <button
                onClick={reset}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-700 transition"
              >
                <ScanLine size={14} />
                Nächster Scan
              </button>
            )}
          </div>

          {isPending && (
            <div className="text-center py-10 text-neutral-500 text-sm">Suche…</div>
          )}

          {!isPending && notFound && (
            <div className="text-center py-8">
              <AlertTriangle className="mx-auto text-amber-500 mb-3" size={48} />
              <div className="text-xl font-semibold text-neutral-900">Kein Produkt mit dieser EAN</div>
              <div className="text-sm text-neutral-500 mt-2">
                Möglicherweise ist die EAN nicht in Shopify hinterlegt.
              </div>
            </div>
          )}

          {!isPending && results && results.length > 0 && (
            <>
              {results.length > 1 && (
                <div className="mb-4 p-3 bg-amber-50 border border-amber-300 rounded-lg text-sm text-amber-900">
                  <strong>⚠ {results.length} Produkte mit dieser EAN gefunden!</strong>
                  <div className="text-xs mt-1">EAN-Konflikt — bitte in Shopify die Codes einzigartig vergeben.</div>
                </div>
              )}
              {results.length === 1 ? (
                <BigProductCard result={results[0]} />
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {results.map((r, i) => (
                    <ProductCard key={i} result={r} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Verlauf */}
      {history.length > 0 && (
        <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
          <div className="text-xs font-medium text-neutral-600 uppercase tracking-wide mb-2">Letzte Scans</div>
          <div className="divide-y divide-neutral-100">
            {history.map((h, i) => (
              <button
                key={i}
                onClick={() => performLookup(h.barcode)}
                className="w-full flex items-center justify-between gap-3 py-2 text-left hover:bg-neutral-50 px-2 rounded transition"
              >
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-mono text-neutral-700">{h.barcode}</div>
                  {h.result ? (
                    <div className="text-sm text-neutral-900 truncate">
                      {h.result.productTitle}
                      {h.result.variantTitle && (
                        <span className="text-neutral-500"> · {h.result.variantTitle}</span>
                      )}
                    </div>
                  ) : (
                    <div className="text-sm text-amber-700">Nicht gefunden</div>
                  )}
                </div>
                <div className="text-[10px] text-neutral-400">
                  {new Date(h.ts).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BigProductCard({ result }: { result: Result }) {
  return (
    <div className="flex flex-col md:flex-row gap-5 items-start">
      {result.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={result.imageUrl}
          alt=""
          className="w-full md:w-48 h-48 rounded-xl object-cover bg-neutral-100 shrink-0"
        />
      ) : (
        <div className="w-full md:w-48 h-48 rounded-xl bg-neutral-100 shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className="text-xl md:text-2xl font-bold text-neutral-900 leading-tight">
          {result.productTitle}
        </div>
        {result.variantTitle && (
          <div className="mt-2 inline-block bg-emerald-100 text-emerald-800 text-sm font-semibold px-3 py-1 rounded">
            Variante: {result.variantTitle}
          </div>
        )}
        <div className="text-sm font-mono text-neutral-500 mt-3">EAN {result.barcode}</div>
        {result.collectionTitles.length > 0 && (
          <div className="flex flex-wrap gap-1.5 mt-3">
            {result.collectionTitles.map((c, i) => (
              <span key={i} className="text-xs bg-indigo-50 text-indigo-700 border border-indigo-200 px-2 py-1 rounded">
                {c}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ProductCard({ result }: { result: Result }) {
  return (
    <div className="border border-neutral-200 rounded-lg p-3 flex gap-3">
      {result.imageUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={result.imageUrl} alt="" className="w-20 h-20 rounded object-cover bg-neutral-100 shrink-0" />
      ) : (
        <div className="w-20 h-20 rounded bg-neutral-100 shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-semibold text-neutral-900 line-clamp-2">{result.productTitle}</div>
        {result.variantTitle && (
          <div className="text-xs text-emerald-700 font-medium mt-0.5">Variante: {result.variantTitle}</div>
        )}
        <div className="text-[10px] font-mono text-neutral-500 mt-1">EAN {result.barcode}</div>
        {result.collectionTitles.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {result.collectionTitles.slice(0, 3).map((c, i) => (
              <span key={i} className="text-[10px] bg-indigo-50 text-indigo-700 border border-indigo-200 px-1.5 py-0.5 rounded">
                {c}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
