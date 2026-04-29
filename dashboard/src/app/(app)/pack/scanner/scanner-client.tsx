"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { Html5Qrcode } from "html5-qrcode";
import { Camera, CameraOff, AlertTriangle, Search, X, ArrowLeft, ScanLine, RefreshCw } from "lucide-react";
import { type Locale } from "@/lib/i18n";
import { scanProductByBarcode } from "@/lib/actions/pack";

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
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const lastScanRef = useRef<{ code: string; ts: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const performLookup = useCallback((barcode: string) => {
    const trimmed = barcode.trim();
    if (!trimmed) return;
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
        const scanner = new Html5Qrcode(READER_ID, { verbose: false });
        scannerRef.current = scanner;
        await scanner.start(
          { facingMode: "environment" },
          { fps: 10, qrbox: { width: 280, height: 200 }, aspectRatio: 1.5 },
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
    inputRef.current?.focus();
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

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Kamera-Scanner */}
        <div className="bg-neutral-900 rounded-2xl overflow-hidden border border-neutral-200">
          <div className="flex items-center justify-between p-3 bg-neutral-800 text-white">
            <div className="flex items-center gap-2 text-sm">
              <Camera size={16} />
              <span>Kamera-Scanner</span>
            </div>
            <div className="flex items-center gap-2">
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
        <div className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="text-xs text-neutral-500">
              Gescannt: <span className="font-mono text-neutral-900">{scanned}</span>
            </div>
            <button onClick={reset} className="text-neutral-400 hover:text-neutral-700" aria-label="Zurücksetzen">
              <X size={18} />
            </button>
          </div>

          {isPending && (
            <div className="text-center py-6 text-neutral-500 text-sm">Suche…</div>
          )}

          {!isPending && notFound && (
            <div className="text-center py-6">
              <AlertTriangle className="mx-auto text-amber-500 mb-2" size={36} />
              <div className="text-lg font-semibold text-neutral-900">Kein Produkt mit dieser EAN</div>
              <div className="text-sm text-neutral-500 mt-1">
                Möglicherweise ist die EAN nicht in Shopify hinterlegt.
              </div>
            </div>
          )}

          {!isPending && results && results.length > 0 && (
            <>
              {results.length > 1 && (
                <div className="mb-3 p-3 bg-amber-50 border border-amber-300 rounded-lg text-sm text-amber-900">
                  <strong>⚠ {results.length} Produkte mit dieser EAN gefunden!</strong>
                  <div className="text-xs mt-1">EAN-Konflikt — bitte in Shopify die Codes einzigartig vergeben.</div>
                </div>
              )}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {results.map((r, i) => (
                  <ProductCard key={i} result={r} />
                ))}
              </div>
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
