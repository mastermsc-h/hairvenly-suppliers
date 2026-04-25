"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { recordPackScan, recordManualConfirm, completePackSession, uploadPackPhoto } from "@/lib/actions/pack";
import { t, type Locale } from "@/lib/i18n";
import { Camera, CheckCircle2, AlertTriangle, Send, Loader2, ScanLine, Check, X } from "lucide-react";
import CameraScanner from "./camera-scanner";

interface ExpectedItem {
  variantId: string | null;
  barcode: string | null;
  title: string;
  variantTitle: string | null;
  quantity: number;
  imageUrl: string | null;
}

type FlashState = { kind: "match" | "mismatch" | "overflow" | null; message?: string };

const PHOTO_TYPES = ["products_invoice", "products_in_box", "package_on_scale"] as const;
type PhotoType = (typeof PHOTO_TYPES)[number];

function detectAttributes(title: string): {
  method: { label: string; cls: string };
  length: string;
  origin: string;
  color: string;
} {
  const upper = title.toUpperCase();
  let method = { label: "", cls: "" };
  if (upper.includes("BONDING")) method = { label: "BONDINGS", cls: "bg-orange-700" };
  else if (upper.includes("MINI TAPE") || upper.includes("MINI-TAPE"))
    method = { label: "MINI-TAPES", cls: "bg-blue-700" };
  else if (upper.includes("TAPE")) method = { label: "TAPES", cls: "bg-blue-700" };
  else if (upper.includes("TRESSE")) method = { label: "TRESSEN", cls: "bg-green-700" };
  else if (upper.includes("CLIP")) method = { label: "CLIP-IN", cls: "bg-violet-600" };
  else if (upper.includes("PONYTAIL")) method = { label: "PONYTAIL", cls: "bg-pink-700" };

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

  let color = "";
  const colorMatch = title.match(/#([A-Z0-9/]+(?:T[A-Z0-9]+)?)/i);
  if (colorMatch) color = "#" + colorMatch[1];

  return { method, length, origin, color };
}

function playBeep(success: boolean) {
  try {
    const ctx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    if (success) {
      osc.frequency.value = 1200;
      gain.gain.setValueAtTime(0.3, ctx.currentTime);
      osc.start();
      osc.stop(ctx.currentTime + 0.12);
    } else {
      osc.frequency.value = 220;
      gain.gain.setValueAtTime(0.45, ctx.currentTime);
      osc.start();
      osc.stop(ctx.currentTime + 0.6);
    }
  } catch {
    // Audio not available
  }
}

export default function PackMode({
  sessionId,
  initialStatus,
  orderName,
  expectedItems,
  initialCounts,
  initialPhotos,
  shippingAddress,
  locale,
}: {
  sessionId: string;
  initialStatus: string;
  orderName: string;
  expectedItems: ExpectedItem[];
  initialCounts: Record<string, number>;
  initialPhotos: Record<string, string>;
  shippingAddress: { name: string | null; address1: string | null; zip: string | null; city: string | null; country: string | null } | null;
  locale: Locale;
}) {
  const [counts, setCounts] = useState<Record<string, number>>(initialCounts);
  const [photos, setPhotos] = useState<Record<string, string>>(initialPhotos);
  const [flash, setFlash] = useState<FlashState>({ kind: null });
  const [scanInput, setScanInput] = useState("");
  const [status, setStatus] = useState(initialStatus);
  const [isPending, startTransition] = useTransition();
  const [fulfillError, setFulfillError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Pro Item: Manual-Confirm Form aufgeklappt + Checkbox-States (5: Methode/Länge/Herkunft/Farbe/Menge)
  const [manualForms, setManualForms] = useState<Record<number, { open: boolean; checks: boolean[] }>>({});

  function setManualOpen(idx: number, open: boolean) {
    setManualForms((prev) => ({
      ...prev,
      [idx]: { open, checks: prev[idx]?.checks ?? [false, false, false, false, false] },
    }));
  }
  function toggleManualCheck(idx: number, checkIdx: number) {
    setManualForms((prev) => {
      const cur = prev[idx] ?? { open: true, checks: [false, false, false, false, false] };
      const newChecks = [...cur.checks];
      newChecks[checkIdx] = !newChecks[checkIdx];
      return { ...prev, [idx]: { ...cur, checks: newChecks } };
    });
  }

  // Autofocus aufs Eingabefeld nach jedem Scan
  useEffect(() => {
    inputRef.current?.focus();
  }, [counts]);

  // Flash auto-clear
  useEffect(() => {
    if (flash.kind === null) return;
    const ms = flash.kind === "match" ? 800 : 2400;
    const tm = setTimeout(() => setFlash({ kind: null }), ms);
    return () => clearTimeout(tm);
  }, [flash]);

  const isComplete = useMemo(() => {
    return expectedItems.every((e, idx) => {
      const key = e.barcode || `manual:${idx}`;
      return (counts[key] ?? 0) >= e.quantity;
    });
  }, [counts, expectedItems]);

  const handleManualConfirm = useCallback(
    (idx: number) => {
      startTransition(async () => {
        try {
          const res = await recordManualConfirm(sessionId, idx);
          setCounts(res.scannedCounts);
          if (res.status === "match") {
            playBeep(true);
            setFlash({ kind: "match", message: res.matchedTitle });
            if (status === "open") setStatus("in_progress");
            // Form schließen + checks zurücksetzen
            setManualForms((prev) => ({
              ...prev,
              [idx]: { open: false, checks: [false, false, false, false, false] },
            }));
          } else {
            playBeep(false);
            setFlash({ kind: "overflow", message: t(locale, "shipping.scan_overflow") });
          }
        } catch (err) {
          playBeep(false);
          setFlash({ kind: "mismatch", message: err instanceof Error ? err.message : "Fehler" });
        }
      });
    },
    [sessionId, status, locale],
  );

  const allPhotosUploaded = PHOTO_TYPES.every((p) => !!photos[p]);
  const canFulfill = isComplete && allPhotosUploaded && status !== "shipped";

  const submitBarcode = useCallback(
    (barcode: string) => {
      const trimmed = barcode.trim();
      if (!trimmed) return;
      startTransition(async () => {
        try {
          const res = await recordPackScan(sessionId, trimmed);
          setCounts(res.scannedCounts);
          if (res.status === "match") {
            playBeep(true);
            setFlash({ kind: "match", message: res.matchedTitle });
            if (status === "open") setStatus("in_progress");
          } else if (res.status === "overflow") {
            playBeep(false);
            setFlash({
              kind: "overflow",
              message: t(locale, "shipping.scan_overflow"),
            });
          } else {
            playBeep(false);
            setFlash({
              kind: "mismatch",
              message: t(locale, "shipping.scan_mismatch"),
            });
          }
        } catch (err) {
          playBeep(false);
          setFlash({ kind: "mismatch", message: err instanceof Error ? err.message : "Fehler" });
        }
      });
    },
    [sessionId, status, locale],
  );

  function handleScan(e: React.FormEvent) {
    e.preventDefault();
    const barcode = scanInput.trim();
    if (!barcode) return;
    setScanInput("");
    submitBarcode(barcode);
  }

  async function handlePhoto(type: PhotoType, file: File) {
    const fd = new FormData();
    fd.append("photo", file);
    startTransition(async () => {
      const res = await uploadPackPhoto(sessionId, type, fd);
      if (res.success && res.storagePath) {
        // Lokale Vorschau via FileReader für sofortiges Feedback
        const reader = new FileReader();
        reader.onload = () => {
          setPhotos((p) => ({ ...p, [type]: String(reader.result) }));
        };
        reader.readAsDataURL(file);
      }
    });
  }

  function handleFulfill() {
    setFulfillError(null);
    startTransition(async () => {
      const res = await completePackSession(sessionId);
      if (res.success) {
        setStatus("shipped");
      } else {
        setFulfillError(res.error ?? "Fehler");
      }
    });
  }

  return (
    <>
      {/* Flash Overlay */}
      {flash.kind && flash.kind !== "match" && (
        <div
          className={`fixed inset-0 z-50 flex items-center justify-center pointer-events-none animate-pulse ${
            flash.kind === "mismatch" ? "bg-red-600/90" : "bg-amber-500/90"
          }`}
        >
          <div className="text-center text-white">
            <AlertTriangle size={120} className="mx-auto" />
            <div className="text-3xl font-bold mt-4">{flash.message}</div>
          </div>
        </div>
      )}
      {flash.kind === "match" && (
        <div className="fixed inset-x-0 top-0 h-2 bg-emerald-500 z-50 animate-pulse" />
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left: Scanner + Status */}
        <div className="md:col-span-1 space-y-4">
          <CameraScanner onScan={submitBarcode} paused={isPending} />

          <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
            <form onSubmit={handleScan}>
              <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide flex items-center gap-1">
                <ScanLine size={14} />
                {t(locale, "shipping.scan_product")}
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
                placeholder="Barcode..."
              />
              <div className="text-xs text-neutral-500 mt-2">
                Tipp: USB-Scanner oder iPhone-Kamera tippt direkt rein.
              </div>
            </form>
          </div>

          {shippingAddress && (
            <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm text-sm">
              <div className="text-xs font-medium text-neutral-600 uppercase tracking-wide mb-2">
                Lieferadresse
              </div>
              <div className="text-neutral-700 leading-relaxed">
                {shippingAddress.name}<br />
                {shippingAddress.address1}<br />
                {shippingAddress.zip} {shippingAddress.city}<br />
                {shippingAddress.country}
              </div>
            </div>
          )}
        </div>

        {/* Right: Items + Photos */}
        <div className="md:col-span-2 space-y-4">
          <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
            <div className="text-xs font-medium text-neutral-600 uppercase tracking-wide mb-3">
              {t(locale, "shipping.expected_items")}
            </div>
            <div className="space-y-4">
              {expectedItems.map((it, idx) => {
                const counterKey = it.barcode || `manual:${idx}`;
                const got = counts[counterKey] ?? 0;
                const done = got >= it.quantity;
                const attrs = detectAttributes(it.title);
                return (
                  <div
                    key={idx}
                    className={`flex flex-col md:flex-row gap-4 p-4 rounded-xl border-2 transition ${
                      done
                        ? "border-emerald-400 bg-emerald-50"
                        : "border-neutral-200 bg-white"
                    }`}
                  >
                    {it.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={it.imageUrl}
                        alt=""
                        className="w-24 h-24 rounded-lg object-cover bg-white shrink-0"
                      />
                    ) : (
                      <div className="w-24 h-24 rounded-lg bg-neutral-200 shrink-0" />
                    )}

                    <div className="flex-1 min-w-0">
                      {/* Große Tags */}
                      <div className="flex flex-wrap gap-2 mb-2">
                        {attrs.method.label && (
                          <span
                            className={`inline-block ${attrs.method.cls} text-white text-base md:text-lg font-bold px-3 py-1 rounded tracking-wider`}
                          >
                            {attrs.method.label}
                          </span>
                        )}
                        {attrs.length && (
                          <span className="inline-block bg-slate-700 text-white text-base md:text-lg font-bold px-3 py-1 rounded tracking-wider">
                            {attrs.length}
                          </span>
                        )}
                        {attrs.origin && (
                          <span className="inline-block bg-slate-900 text-white text-base md:text-lg font-bold px-3 py-1 rounded tracking-wider">
                            {attrs.origin}
                          </span>
                        )}
                        {attrs.color && (
                          <span className="inline-block bg-amber-600 text-white text-base md:text-lg font-bold px-3 py-1 rounded font-mono">
                            {attrs.color}
                          </span>
                        )}
                      </div>

                      <div className="text-sm text-neutral-700 line-clamp-2">{it.title}</div>
                      {it.variantTitle && it.variantTitle !== "Default Title" && (
                        <div className="text-sm font-semibold text-neutral-900 mt-1">
                          Variante: <span className="text-emerald-700">{it.variantTitle}</span>
                        </div>
                      )}
                      {it.barcode ? (
                        <div className="text-xs text-neutral-500 font-mono mt-1">
                          EAN: {it.barcode}
                        </div>
                      ) : (
                        <div className="text-xs text-amber-700 font-medium mt-1">
                          ⚠ Kein Barcode hinterlegt — bitte manuell bestätigen
                        </div>
                      )}
                    </div>

                    {/* Counter + (optional) Manual-Form */}
                    <div className="flex items-start gap-3 shrink-0">
                      <div className="flex flex-col items-end gap-1">
                        <div
                          className={`text-3xl font-black ${
                            done ? "text-emerald-600" : "text-neutral-400"
                          }`}
                        >
                          {got}/{it.quantity}
                        </div>
                        {!done && !(manualForms[idx]?.open) && (
                          <button
                            onClick={() => setManualOpen(idx, true)}
                            className="text-[11px] text-amber-700 hover:text-amber-900 hover:underline"
                          >
                            QR nicht vorhanden?
                          </button>
                        )}
                      </div>
                      {done && <CheckCircle2 className="text-emerald-500 mt-1" size={32} />}

                      {!done && manualForms[idx]?.open && (
                        <div className="bg-amber-50 border border-amber-300 rounded-lg p-3 w-72">
                          <div className="flex items-center justify-between mb-2">
                            <div className="text-xs font-bold text-amber-900 uppercase tracking-wide">
                              Manuell bestätigen
                            </div>
                            <button
                              onClick={() => setManualOpen(idx, false)}
                              className="text-amber-700 hover:text-amber-900"
                              aria-label="Schließen"
                            >
                              <X size={14} />
                            </button>
                          </div>
                          {(() => {
                            const rows = [
                              { label: "Methode", value: attrs.method.label || "korrekt" },
                              { label: "Länge", value: attrs.length || "korrekt" },
                              { label: "Herkunft", value: attrs.origin || "korrekt" },
                              { label: "Farbe", value: attrs.color || "korrekt" },
                              ...(it.variantTitle && it.variantTitle !== "Default Title"
                                ? [{ label: "Variante", value: it.variantTitle }]
                                : []),
                              { label: "Menge", value: `${it.quantity}×` },
                            ];
                            const checks = manualForms[idx]?.checks ?? [];
                            const allChecked = rows.every((_, ci) => checks[ci] === true);
                            return (
                              <>
                                <div className="space-y-1.5 text-xs">
                                  {rows.map((row, ci) => (
                                    <label key={ci} className="flex items-center gap-2 cursor-pointer text-amber-900">
                                      <input
                                        type="checkbox"
                                        checked={checks[ci] ?? false}
                                        onChange={() => toggleManualCheck(idx, ci)}
                                        className="w-4 h-4 accent-amber-600"
                                      />
                                      <span className="font-medium">{row.label}:</span>
                                      <span className="font-bold">{row.value}</span>
                                    </label>
                                  ))}
                                </div>
                                <button
                                  onClick={() => handleManualConfirm(idx)}
                                  disabled={isPending || !allChecked}
                                  className="mt-3 w-full flex items-center justify-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-medium hover:bg-emerald-700 transition disabled:opacity-40 disabled:cursor-not-allowed"
                                >
                                  <Check size={14} />
                                  Manuell bestätigen
                                </button>
                              </>
                            );
                          })()}
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Photo Stations */}
          {isComplete && (
            <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
              <div className="text-xs font-medium text-neutral-600 uppercase tracking-wide mb-3">
                {t(locale, "shipping.photos_required")}
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {PHOTO_TYPES.map((type) => (
                  <PhotoStation
                    key={type}
                    type={type}
                    label={t(locale, `shipping.photo_${type === "products_invoice" ? "invoice" : type === "products_in_box" ? "in_box" : "on_scale"}`)}
                    currentUrl={photos[type]}
                    onPhoto={handlePhoto}
                    disabled={isPending}
                    locale={locale}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Ready / Fulfill */}
          {canFulfill && (
            <div className="bg-emerald-50 border-2 border-emerald-300 rounded-2xl p-6 text-center">
              <CheckCircle2 className="mx-auto text-emerald-600 mb-3" size={48} />
              <div className="text-2xl font-bold text-emerald-900 mb-3">
                {t(locale, "shipping.ready")}
              </div>
              <button
                onClick={handleFulfill}
                disabled={isPending}
                className="inline-flex items-center gap-2 px-6 py-3 bg-emerald-600 text-white font-medium rounded-lg hover:bg-emerald-700 transition disabled:opacity-50"
              >
                {isPending ? <Loader2 className="animate-spin" size={18} /> : <Send size={18} />}
                {t(locale, "shipping.fulfill")}
              </button>
              {fulfillError && (
                <div className="text-sm text-red-700 mt-3 bg-red-50 border border-red-200 p-2 rounded">
                  {fulfillError}
                </div>
              )}
            </div>
          )}

          {status === "shipped" && (
            <div className="bg-blue-50 border-2 border-blue-300 rounded-2xl p-6 text-center">
              <Send className="mx-auto text-blue-700 mb-3" size={40} />
              <div className="text-xl font-bold text-blue-900">
                {t(locale, "shipping.fulfill_success")}
              </div>
              <div className="text-sm text-blue-700 mt-1">{orderName}</div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function PhotoStation({
  type,
  label,
  currentUrl,
  onPhoto,
  disabled,
  locale,
}: {
  type: PhotoType;
  label: string;
  currentUrl: string | undefined;
  onPhoto: (type: PhotoType, file: File) => void;
  disabled: boolean;
  locale: Locale;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <div className="border-2 border-dashed border-neutral-300 rounded-xl p-3 text-center">
      <div className="text-xs font-medium text-neutral-700 mb-2">{label}</div>
      {currentUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={currentUrl} alt={label} className="w-full h-32 object-cover rounded-lg mb-2" />
      ) : (
        <div className="w-full h-32 bg-neutral-100 rounded-lg flex items-center justify-center mb-2">
          <Camera className="text-neutral-400" size={28} />
        </div>
      )}
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onPhoto(type, f);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        disabled={disabled}
        onClick={() => inputRef.current?.click()}
        className="w-full py-2 rounded-lg bg-neutral-900 text-white text-xs font-medium hover:bg-neutral-700 transition disabled:opacity-50 flex items-center justify-center gap-1"
      >
        <Camera size={14} />
        {currentUrl ? t(locale, "shipping.photo_taken") + " ✓" : t(locale, "shipping.photo_take")}
      </button>
    </div>
  );
}
