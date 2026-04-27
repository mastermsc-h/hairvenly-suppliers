"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  recordPackScan,
  recordManualConfirm,
  completePackSession,
  uploadPackPhoto,
  deletePackPhoto,
  resetItemConfirms,
  fetchSessionScans,
  cancelPackSession,
  skipPackPhotos,
  unskipPackPhotos,
  type PhotoSkipReason,
} from "@/lib/actions/pack";
import { t, type Locale } from "@/lib/i18n";
import QRCode from "qrcode";
import { Camera, CheckCircle2, AlertTriangle, Send, Loader2, ScanLine, Check, X, RotateCcw, History, Package2, ImagePlus, ChevronDown, ChevronUp, Smartphone } from "lucide-react";
import CameraScanner from "./camera-scanner";
import OrderQrScanner from "../order-qr-scanner";

interface ExpectedItem {
  variantId: string | null;
  barcode: string | null;
  title: string;
  variantTitle: string | null;
  quantity: number;
  imageUrl: string | null;
  // true für Haar-Extensions, false für Zubehör/Pflege/Schulungen, undefined = Legacy
  isExtension?: boolean;
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

/**
 * Skaliert ein Foto im Browser auf max. lange-Seite × kurze-Seite px,
 * komprimiert als JPEG. Reduziert iPhone-Originale (5 MB) auf ~300-500 KB.
 */
async function resizeImage(
  file: File,
  maxLong = 2000,
  maxShort = 1500,
  quality = 0.85,
): Promise<File> {
  try {
    const blobUrl = URL.createObjectURL(file);
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      img.onload = () => resolve();
      img.onerror = () => reject(new Error("image load failed"));
      img.src = blobUrl;
    });
    URL.revokeObjectURL(blobUrl);

    const isPortrait = img.height >= img.width;
    const longSide = isPortrait ? img.height : img.width;
    const shortSide = isPortrait ? img.width : img.height;

    let targetLong = Math.min(longSide, maxLong);
    let targetShort = Math.round(shortSide * (targetLong / longSide));
    if (targetShort > maxShort) {
      targetShort = maxShort;
      targetLong = Math.round(longSide * (targetShort / shortSide));
    }
    const targetW = isPortrait ? targetShort : targetLong;
    const targetH = isPortrait ? targetLong : targetShort;

    // Wenn Bild eh schon kleiner ist als Ziel und JPEG → Original behalten
    if (longSide <= maxLong && shortSide <= maxShort && file.type === "image/jpeg") {
      return file;
    }

    const canvas = document.createElement("canvas");
    canvas.width = targetW;
    canvas.height = targetH;
    const ctx = canvas.getContext("2d");
    if (!ctx) return file;
    ctx.drawImage(img, 0, 0, targetW, targetH);

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", quality),
    );
    if (!blob) return file;
    const newName = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], newName, { type: "image/jpeg" });
  } catch {
    return file;
  }
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
  initialPhotosSkipped,
  initialPhotosSkipReason,
  shippingAddress,
  shopifyOrderUrl,
  shopifyLabelUrl,
  locale,
}: {
  sessionId: string;
  initialStatus: string;
  orderName: string;
  expectedItems: ExpectedItem[];
  initialCounts: Record<string, number>;
  initialPhotos: Record<string, { id: string; url: string }[]>;
  initialPhotosSkipped: boolean;
  initialPhotosSkipReason: PhotoSkipReason | null;
  shippingAddress: { name: string | null; address1: string | null; zip: string | null; city: string | null; country: string | null } | null;
  shopifyOrderUrl: string | null;
  shopifyLabelUrl: string | null;
  locale: Locale;
}) {
  const [counts, setCounts] = useState<Record<string, number>>(initialCounts);
  const [photos, setPhotos] = useState<Record<string, { id: string; url: string }[]>>(initialPhotos);
  const [photosSkipped, setPhotosSkipped] = useState(initialPhotosSkipped);
  const [photosSkipReason, setPhotosSkipReason] = useState<PhotoSkipReason | null>(initialPhotosSkipReason);
  const [skipModalOpen, setSkipModalOpen] = useState(false);
  const [flash, setFlash] = useState<FlashState>({ kind: null });
  const [scanInput, setScanInput] = useState("");
  const [status, setStatus] = useState(initialStatus);
  const [isPending, startTransition] = useTransition();
  const [fulfillError, setFulfillError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  // Verhindert parallele Server-Calls (Camera kann während laufendem Call erneut scannen)
  const inFlightRef = useRef(false);
  // Pro Item: Manual-Confirm Form aufgeklappt + Checkbox-States (5: Methode/Länge/Herkunft/Farbe/Menge)
  const [manualForms, setManualForms] = useState<Record<number, { open: boolean; checks: boolean[] }>>({});
  // Live-Scan-Historie
  const [scanHistory, setScanHistory] = useState<Awaited<ReturnType<typeof fetchSessionScans>>>([]);
  // Großer Vollbild-Erfolgsflash (bleibt offen bis User „Weiter" klickt)
  const [bigSuccess, setBigSuccess] = useState<{
    title: string;
    count: number;
    total: number;
  } | null>(null);

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

  // Scan-History initial laden + nach Änderungen aktualisieren
  const refreshHistory = useCallback(async () => {
    try {
      const scans = await fetchSessionScans(sessionId, 50);
      setScanHistory(scans);
    } catch {
      // ignore
    }
  }, [sessionId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const scans = await fetchSessionScans(sessionId, 50);
        if (!cancelled) setScanHistory(scans);
      } catch {
        // ignore
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // Big-success Flash bleibt bis User auf "Weiter" klickt — verhindert
  // dass dieselbe Camera-Detection als zwei Scans gewertet wird, weil der
  // Code nach Erfolg noch im Bild ist.

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

  // Nächste noch unvollständige Position (Hinweis "Scanne als Nächstes")
  const nextItem = useMemo(() => {
    for (let idx = 0; idx < expectedItems.length; idx++) {
      const it = expectedItems[idx];
      const counterKey = it.barcode || `manual:${idx}`;
      const got = counts[counterKey] ?? 0;
      if (got < it.quantity) {
        return { item: it, idx, got, attrs: detectAttributes(it.title) };
      }
    }
    return null;
  }, [expectedItems, counts]);

  const handleManualConfirm = useCallback(
    (idx: number) => {
      startTransition(async () => {
        try {
          const res = await recordManualConfirm(sessionId, idx);
          setCounts(res.scannedCounts);
          if (res.status === "match") {
            playBeep(true);
            setFlash({ kind: "match", message: res.matchedTitle });
            const item = expectedItems[idx];
            const counterKey = item.barcode || `manual:${idx}`;
            const count = res.scannedCounts[counterKey] ?? item.quantity;
            setBigSuccess({
              title: res.matchedTitle ?? item.title ?? "OK",
              count,
              total: item.quantity,
            });
            if (status === "open") setStatus("in_progress");
            setManualForms((prev) => ({
              ...prev,
              [idx]: { open: false, checks: [false, false, false, false, false] },
            }));
          } else {
            playBeep(false);
            setFlash({ kind: "overflow", message: t(locale, "shipping.scan_overflow") });
          }
          await refreshHistory();
        } catch (err) {
          playBeep(false);
          setFlash({ kind: "mismatch", message: err instanceof Error ? err.message : "Fehler" });
        }
      });
    },
    [sessionId, status, locale, refreshHistory, expectedItems],
  );

  const allPhotosUploaded =
    photosSkipped || PHOTO_TYPES.every((p) => (photos[p]?.length ?? 0) > 0);
  const canFulfill = isComplete && allPhotosUploaded && status !== "shipped";

  // QR-Code zum Wechsel auf iPhone für Foto-Aufnahme (nur auf desktop sichtbar)
  const [phoneQrDataUrl, setPhoneQrDataUrl] = useState<string | null>(null);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = `${window.location.origin}/pack/${orderName.replace(/^#/, "")}`;
    void QRCode.toDataURL(url, {
      width: 320,
      margin: 1,
      color: { dark: "#000000", light: "#FFFFFF" },
    })
      .then((dataUrl) => setPhoneQrDataUrl(dataUrl))
      .catch(() => setPhoneQrDataUrl(null));
  }, [orderName]);

  // Phase-State für den Assistent-Workflow
  const phase: "scan" | "photos" | "ready" | "shipped" = useMemo(() => {
    if (status === "shipped") return "shipped";
    if (!isComplete) return "scan";
    if (!allPhotosUploaded) return "photos";
    return "ready";
  }, [isComplete, allPhotosUploaded, status]);

  // Refs für Auto-Scroll bei Phase-Wechsel
  const photoSectionRef = useRef<HTMLDivElement>(null);
  const readySectionRef = useRef<HTMLDivElement>(null);
  // null beim ersten Render → auto-scroll greift auch beim Initial-Mount
  // (wichtig wenn iPhone via QR direkt in der Foto-Phase aufmacht)
  const lastPhaseRef = useRef<typeof phase | null>(null);

  // "Scanne als Nächstes" standardmäßig zugeklappt — nur kompakte Header-Zeile
  const [cameraActive, setCameraActive] = useState(false);
  const [hintExpanded, setHintExpanded] = useState(false);
  useEffect(() => {
    if (cameraActive) setHintExpanded(false);
  }, [cameraActive]);

  useEffect(() => {
    if (lastPhaseRef.current === phase) return;
    lastPhaseRef.current = phase;
    if (phase === "photos") {
      setTimeout(() => photoSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    } else if (phase === "ready" || phase === "shipped") {
      setTimeout(() => readySectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
    }
  }, [phase]);

  const submitBarcode = useCallback(
    (barcode: string) => {
      // Solange Erfolgs-Overlay offen ist → keine neuen Scans annehmen
      if (bigSuccess) return;
      // Solange ein Server-Call läuft → keine parallelen Scans
      if (inFlightRef.current) return;
      const trimmed = barcode.trim();
      if (!trimmed) return;
      inFlightRef.current = true;
      startTransition(async () => {
        try {
          const res = await recordPackScan(sessionId, trimmed);
          setCounts(res.scannedCounts);
          if (res.status === "match") {
            playBeep(true);
            setFlash({ kind: "match", message: res.matchedTitle });
            // Item finden + Count anzeigen
            const matchedIdx = expectedItems.findIndex(
              (it) => it.variantId === res.matchedVariantId,
            );
            const it = matchedIdx >= 0 ? expectedItems[matchedIdx] : null;
            const counterKey = it ? it.barcode || `manual:${matchedIdx}` : trimmed;
            const count = res.scannedCounts[counterKey] ?? 0;
            const total = it?.quantity ?? 0;
            setBigSuccess({
              title: res.matchedTitle ?? "OK",
              count,
              total,
            });
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
          await refreshHistory();
        } catch (err) {
          playBeep(false);
          setFlash({ kind: "mismatch", message: err instanceof Error ? err.message : "Fehler" });
        } finally {
          inFlightRef.current = false;
        }
      });
    },
    [sessionId, status, locale, refreshHistory, bigSuccess, expectedItems],
  );

  const handleCancelSession = useCallback(() => {
    if (typeof window !== "undefined") {
      const ok = window.confirm(
        "Pack-Vorgang wirklich abbrechen? Alle Scans + Fotos werden gelöscht. Audit-Log bleibt erhalten. Die Bestellung kann danach erneut bearbeitet werden.",
      );
      if (!ok) return;
    }
    startTransition(async () => {
      const res = await cancelPackSession(sessionId);
      if (res.success) {
        setCounts({});
        setPhotos({});
        setBigSuccess(null);
        setStatus("open");
        setManualForms({});
        setFulfillError(null);
        setFlash({ kind: null });
        await refreshHistory();
      }
    });
  }, [sessionId, refreshHistory]);

  const handleResetItem = useCallback(
    (idx: number) => {
      if (typeof window !== "undefined" && !window.confirm("Diese Position auf 0 zurücksetzen? (Audit-Log bleibt.)")) {
        return;
      }
      startTransition(async () => {
        const res = await resetItemConfirms(sessionId, idx);
        if (res.success) {
          setCounts(res.scannedCounts);
          await refreshHistory();
        }
      });
    },
    [sessionId, refreshHistory],
  );

  function handleScan(e: React.FormEvent) {
    e.preventDefault();
    const barcode = scanInput.trim();
    if (!barcode) return;
    setScanInput("");
    submitBarcode(barcode);
  }

  async function handlePhoto(type: PhotoType, file: File) {
    // Vor dem Upload client-seitig auf max. 2000×1500 px JPEG-0.85 verkleinern
    // (spart ~10× Storage gegenüber iPhone-Originalen)
    const compressed = await resizeImage(file, 2000, 1500, 0.85);
    const fd = new FormData();
    fd.append("photo", compressed);
    startTransition(async () => {
      const res = await uploadPackPhoto(sessionId, type, fd);
      if (res.success && res.storagePath) {
        const reader = new FileReader();
        reader.onload = () => {
          setPhotos((p) => ({
            ...p,
            [type]: [...(p[type] ?? []), { id: `local-${Date.now()}`, url: String(reader.result) }],
          }));
        };
        reader.readAsDataURL(compressed);
      }
    });
  }

  async function handleDeletePhoto(type: PhotoType, photoId: string) {
    if (photoId.startsWith("local-")) {
      // Wurde noch nicht persistiert — einfach lokal entfernen
      setPhotos((p) => ({ ...p, [type]: (p[type] ?? []).filter((x) => x.id !== photoId) }));
      return;
    }
    if (typeof window !== "undefined" && !window.confirm("Foto wirklich löschen?")) return;
    startTransition(async () => {
      const r = await deletePackPhoto(photoId);
      if (r.success) {
        setPhotos((p) => ({ ...p, [type]: (p[type] ?? []).filter((x) => x.id !== photoId) }));
      }
    });
  }

  function handleFulfill() {
    setFulfillError(null);
    startTransition(async () => {
      const res = await completePackSession(sessionId);
      if (res.success) {
        setStatus("shipped");
        // Shopify-Order-Seite (für Lexware-Rechnung-Download) + Versandetikett-
        // Erstellungsseite in neuen Tabs öffnen. Browser erlauben den Aufruf
        // weil es aus einem direkten User-Click stammt.
        if (shopifyOrderUrl) window.open(shopifyOrderUrl, "_blank", "noopener");
        if (shopifyLabelUrl) window.open(shopifyLabelUrl, "_blank", "noopener");
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
      {bigSuccess && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-emerald-500/95 p-6">
          <div className="text-center text-white max-w-3xl">
            <CheckCircle2 size={120} className="mx-auto" strokeWidth={2.5} />
            {bigSuccess.total > 0 && (
              <div className="text-7xl md:text-8xl font-black mt-2 tracking-tight">
                {bigSuccess.count}/{bigSuccess.total}
              </div>
            )}
            <div className="text-2xl md:text-3xl font-black mt-3 leading-tight">
              {bigSuccess.title}
            </div>
            {bigSuccess.total > 0 && bigSuccess.count >= bigSuccess.total && (
              <div className="mt-3 text-white/90 text-lg font-semibold">
                Diese Position ist komplett ✓
              </div>
            )}
          </div>
          <button
            onClick={() => setBigSuccess(null)}
            className="mt-8 px-12 py-6 bg-white text-emerald-700 text-2xl md:text-3xl font-black rounded-2xl shadow-lg hover:bg-emerald-50 active:scale-95 transition flex items-center gap-3"
            autoFocus
          >
            <Check size={32} strokeWidth={3} />
            Weiter
          </button>
          <div className="mt-4 text-white/80 text-sm">
            Tippe „Weiter", um den nächsten Artikel zu scannen.
          </div>
        </div>
      )}

      {/* Phase Indicator (kompakt) */}
      <div className="bg-white rounded-xl border border-neutral-200 p-1.5 shadow-sm flex items-center gap-1 text-xs">
        {([
          { key: "scan", label: "1. Scannen", icon: ScanLine },
          { key: "photos", label: "2. Fotos", icon: Camera },
          { key: "ready", label: "3. Versenden", icon: Send },
        ] as const).map((step) => {
          const order = ["scan", "photos", "ready", "shipped"];
          const stepIdx = order.indexOf(step.key);
          const phaseIdx = order.indexOf(phase);
          const done = phaseIdx > stepIdx || phase === "shipped";
          const active = phaseIdx === stepIdx;
          const Icon = step.icon;
          return (
            <div
              key={step.key}
              className={`flex items-center gap-1 px-2 py-1 rounded-lg flex-1 justify-center transition ${
                done
                  ? "bg-emerald-50 text-emerald-800"
                  : active
                  ? "bg-blue-50 text-blue-900 font-semibold ring-1 ring-blue-400"
                  : "bg-neutral-50 text-neutral-400"
              }`}
            >
              {done ? <CheckCircle2 size={12} /> : <Icon size={12} />}
              <span className="text-[11px]">{step.label}</span>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Left: Scanner + Status */}
        <div className="md:col-span-1 space-y-4">
          {phase === "scan" && <CameraScanner onScan={submitBarcode} paused={isPending} onActiveChange={setCameraActive} />}

          {phase === "scan" && nextItem && (
            <div className="md:hidden bg-blue-50 border-2 border-blue-300 rounded-2xl shadow-sm overflow-hidden">
              {/* Kompakte Header-Zeile — immer sichtbar */}
              <button
                onClick={() => setHintExpanded((e) => !e)}
                className="w-full flex items-center gap-2 p-2.5 hover:bg-blue-100 transition"
              >
                <span className="text-[10px] font-bold text-blue-900 uppercase tracking-widest shrink-0">
                  Nächste:
                </span>
                <div className="flex flex-wrap gap-1 flex-1 min-w-0 justify-start">
                  {nextItem.item.isExtension !== false ? (
                    <>
                      {nextItem.attrs.method.label && (
                        <span
                          className={`inline-block ${nextItem.attrs.method.cls} text-white text-[11px] font-bold px-1.5 py-0.5 rounded tracking-wider`}
                        >
                          {nextItem.attrs.method.label}
                        </span>
                      )}
                      {nextItem.attrs.length && (
                        <span className="inline-block bg-slate-700 text-white text-[11px] font-bold px-1.5 py-0.5 rounded">
                          {nextItem.attrs.length}
                        </span>
                      )}
                      {nextItem.attrs.origin && (
                        <span className="inline-block bg-slate-900 text-white text-[11px] font-bold px-1.5 py-0.5 rounded">
                          {nextItem.attrs.origin}
                        </span>
                      )}
                      {nextItem.attrs.color && (
                        <span className="inline-block bg-amber-600 text-white text-[11px] font-bold px-1.5 py-0.5 rounded font-mono">
                          {nextItem.attrs.color}
                        </span>
                      )}
                    </>
                  ) : (
                    <span className="text-[11px] text-blue-900 font-medium truncate">
                      {nextItem.item.title}
                    </span>
                  )}
                </div>
                <span className="text-base font-black text-blue-900 shrink-0">
                  {nextItem.got}/{nextItem.item.quantity}
                </span>
                {hintExpanded ? (
                  <ChevronUp size={14} className="text-blue-700 shrink-0" />
                ) : (
                  <ChevronDown size={14} className="text-blue-700 shrink-0" />
                )}
              </button>

              {/* Erweiterte Details — collapsable */}
              {hintExpanded && (
                <div className="px-3 pb-3 pt-1 border-t border-blue-200">
                  <div className="flex gap-3">
                    {nextItem.item.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={nextItem.item.imageUrl}
                        alt=""
                        className="w-14 h-14 rounded-lg object-cover bg-white shrink-0"
                      />
                    ) : (
                      <div className="w-14 h-14 rounded-lg bg-neutral-200 shrink-0" />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-neutral-700 line-clamp-2">{nextItem.item.title}</div>
                      {nextItem.item.variantTitle &&
                        nextItem.item.variantTitle !== "Default Title" && (
                          <div className="text-xs font-semibold text-emerald-700 mt-0.5">
                            Variante: {nextItem.item.variantTitle}
                          </div>
                        )}
                    </div>
                  </div>
                  <div className="text-[10px] text-neutral-500 mt-2 italic">
                    Andere Reihenfolge ist auch ok — nur ein Vorschlag.
                  </div>
                </div>
              )}
            </div>
          )}

          {phase === "photos" && (
            <div className="bg-amber-50 border-2 border-amber-300 rounded-2xl p-5 shadow-sm text-center">
              <ImagePlus className="mx-auto text-amber-700 mb-2" size={48} />
              <div className="text-sm font-bold text-amber-900 uppercase tracking-wide">
                Schritt 2 von 3
              </div>
              <div className="text-xl font-black text-amber-900 mt-1">
                Beweis-Fotos aufnehmen
              </div>
              <div className="text-xs text-amber-800 mt-2 leading-relaxed">
                Alle Artikel sind bestätigt ✓<br />
                Bitte 3 Fotos machen: Artikel + Rechnung, Artikel im Karton, Karton auf Waage.
              </div>
            </div>
          )}

          {phase === "ready" && (
            <div className="bg-emerald-50 border-2 border-emerald-400 rounded-2xl p-5 shadow-sm text-center">
              <CheckCircle2 className="mx-auto text-emerald-700 mb-2" size={48} />
              <div className="text-sm font-bold text-emerald-900 uppercase tracking-wide">
                Schritt 3 von 3
              </div>
              <div className="text-xl font-black text-emerald-900 mt-1">
                Bereit zum Versenden
              </div>
              <div className="text-xs text-emerald-800 mt-2">
                Karton schließen und Bestellung als versendet markieren.
              </div>
            </div>
          )}

          {phase === "scan" && (
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
          )}

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

          {phase !== "shipped" && (
            <button
              onClick={handleCancelSession}
              disabled={isPending}
              className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg border border-red-200 text-red-700 text-xs font-medium hover:bg-red-50 hover:border-red-300 transition disabled:opacity-50"
            >
              <X size={14} />
              Pack-Vorgang abbrechen
            </button>
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
                      {/* Große Tags — nur bei Haar-Extensions, nicht bei Zubehör/Pflege/Schulungen */}
                      {it.isExtension !== false && (
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
                      )}

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
                        {got > 0 && (
                          <button
                            onClick={() => handleResetItem(idx)}
                            disabled={isPending}
                            className="text-[11px] text-neutral-500 hover:text-red-700 hover:underline flex items-center gap-1 disabled:opacity-50"
                            title="Diese Position zurücksetzen"
                          >
                            <RotateCcw size={11} />
                            Zurücksetzen
                          </button>
                        )}
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
                            // Bei Zubehör/Pflege/Schulungen die Extension-Attribute weglassen
                            const showExtensionAttrs = it.isExtension !== false;
                            const rows = [
                              ...(showExtensionAttrs
                                ? [
                                    { label: "Methode", value: attrs.method.label || "korrekt" },
                                    { label: "Länge", value: attrs.length || "korrekt" },
                                    { label: "Herkunft", value: attrs.origin || "korrekt" },
                                    { label: "Farbe", value: attrs.color || "korrekt" },
                                  ]
                                : [{ label: "Produkt", value: it.title }]),
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

          {/* Scan-Historie (alle Scans dieser Session, dauerhaft) */}
          <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs font-medium text-neutral-600 uppercase tracking-wide flex items-center gap-1">
                <History size={14} />
                Scan-Verlauf ({scanHistory.length})
              </div>
              <div className="text-xs text-neutral-500 flex items-center gap-3">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-500" />
                  {scanHistory.filter((s) => s.status === "match").length} OK
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-red-500" />
                  {scanHistory.filter((s) => s.status === "mismatch").length} Fehlscan
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-amber-500" />
                  {scanHistory.filter((s) => s.status === "overflow").length} Überzählig
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-neutral-400" />
                  {scanHistory.filter((s) => s.status === "reset").length} Reset
                </span>
              </div>
            </div>
            {scanHistory.length === 0 ? (
              <div className="text-xs text-neutral-400 italic">Noch keine Scans.</div>
            ) : (
              <div className="space-y-1 text-xs font-mono max-h-64 overflow-y-auto">
                {scanHistory.map((s) => {
                  const cls =
                    s.status === "match"
                      ? "bg-emerald-50/60 text-emerald-900"
                      : s.status === "mismatch"
                      ? "bg-red-50/60 text-red-900"
                      : s.status === "overflow"
                      ? "bg-amber-50/60 text-amber-900"
                      : "bg-neutral-100 text-neutral-500 line-through";
                  const icon =
                    s.status === "match" ? (
                      <CheckCircle2 size={12} className="text-emerald-600 shrink-0" />
                    ) : s.status === "mismatch" ? (
                      <AlertTriangle size={12} className="text-red-600 shrink-0" />
                    ) : (
                      <span className="w-3 shrink-0" />
                    );
                  return (
                    <div key={s.id} className={`flex items-center gap-2 px-2 py-1 rounded ${cls}`}>
                      {icon}
                      <span className="text-neutral-500 w-20 shrink-0">
                        {new Date(s.scannedAt).toLocaleTimeString(locale === "de" ? "de-DE" : "en-US", {
                          hour: "2-digit",
                          minute: "2-digit",
                          second: "2-digit",
                        })}
                      </span>
                      <span className="w-20 shrink-0 truncate text-neutral-700">{s.scannedBarcode}</span>
                      <span className="flex-1 truncate">
                        {s.matchedTitle ?? <span className="italic text-neutral-500">unbekannt / falsch</span>}
                      </span>
                      <span className="text-[10px] uppercase tracking-wider text-neutral-500 shrink-0">
                        {s.scanMethod === "manual" ? "manuell" : "scan"}
                      </span>
                      {s.scannedByName && (
                        <span className="text-[10px] text-neutral-500 shrink-0">{s.scannedByName}</span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Phone hand-off — nur desktop, nur solange noch Fotos fehlen */}
          {isComplete && !allPhotosUploaded && (
            <div className="hidden md:flex items-center gap-6 bg-amber-50 border-2 border-amber-300 rounded-2xl p-5 shadow-sm scroll-mt-6">
              <div className="bg-white rounded-xl p-3 shrink-0">
                {phoneQrDataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={phoneQrDataUrl} alt="QR-Code: auf iPhone öffnen" className="w-44 h-44" />
                ) : (
                  <div className="w-44 h-44 bg-neutral-200 animate-pulse rounded-lg" />
                )}
              </div>
              <div>
                <div className="flex items-center gap-2 text-amber-900 mb-1">
                  <Smartphone size={28} />
                  <div className="text-2xl font-black leading-tight">
                    {t(locale, "shipping.display_phone_qr_title")}
                  </div>
                </div>
                <div className="text-sm text-amber-900/90 leading-relaxed">
                  {t(locale, "shipping.display_phone_qr_hint")}
                </div>
              </div>
            </div>
          )}

          {/* Foto-Pflicht übersprungen — Banner statt Foto-Stations */}
          {isComplete && photosSkipped && (
            <div ref={photoSectionRef} className="bg-emerald-50 border-2 border-emerald-300 rounded-2xl p-5 shadow-sm scroll-mt-6 flex items-start gap-4">
              <div className="shrink-0 mt-0.5">
                <CheckCircle2 className="text-emerald-700" size={32} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-bold text-emerald-900 uppercase tracking-wide">
                  {t(locale, "shipping.photos_skipped_title")}
                </div>
                <div className="text-sm text-emerald-900/90 mt-1">
                  {t(locale, `shipping.photos_skip_reason_${photosSkipReason ?? "accessories"}`)}
                </div>
              </div>
              <button
                type="button"
                onClick={() =>
                  startTransition(async () => {
                    const res = await unskipPackPhotos(sessionId);
                    if (res.success) {
                      setPhotosSkipped(false);
                      setPhotosSkipReason(null);
                    }
                  })
                }
                disabled={isPending}
                className="shrink-0 px-3 py-2 text-xs font-medium text-emerald-900 hover:bg-emerald-100 rounded-lg border border-emerald-300 disabled:opacity-50"
              >
                {t(locale, "shipping.photos_skip_undo")}
              </button>
            </div>
          )}

          {/* Photo Stations */}
          {isComplete && !photosSkipped && (
            <div ref={photoSectionRef} className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm scroll-mt-6">
              <div className="flex items-center justify-between mb-3 gap-3">
                <div className="text-xs font-medium text-neutral-600 uppercase tracking-wide">
                  {t(locale, "shipping.photos_required")}
                </div>
                <button
                  type="button"
                  onClick={() => setSkipModalOpen(true)}
                  disabled={isPending}
                  className="text-xs font-medium text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 px-2 py-1 rounded-lg disabled:opacity-50"
                >
                  {t(locale, "shipping.photos_skip_button")}
                </button>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                {PHOTO_TYPES.map((type, idx) => {
                  const nextIdx = PHOTO_TYPES.findIndex((t) => (photos[t]?.length ?? 0) === 0);
                  const isNext = idx === nextIdx;
                  return (
                    <PhotoStation
                      key={type}
                      type={type}
                      label={t(locale, `shipping.photo_${type === "products_invoice" ? "invoice" : type === "products_in_box" ? "in_box" : "on_scale"}`)}
                      photos={photos[type] ?? []}
                      onPhoto={handlePhoto}
                      onDelete={handleDeletePhoto}
                      disabled={isPending}
                      locale={locale}
                      isNext={isNext}
                    />
                  );
                })}
              </div>
            </div>
          )}

          {/* Ready / Fulfill */}
          {canFulfill && (
            <div ref={readySectionRef} className="bg-emerald-50 border-2 border-emerald-300 rounded-2xl p-6 text-center scroll-mt-6">
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

              {(shopifyOrderUrl || shopifyLabelUrl) && (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mt-5 max-w-xl mx-auto">
                  {shopifyOrderUrl && (
                    <a
                      href={shopifyOrderUrl}
                      target="_blank"
                      rel="noopener"
                      className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-white border-2 border-blue-300 text-blue-900 text-sm font-semibold hover:bg-blue-100 transition"
                    >
                      🧾 Rechnung drucken
                    </a>
                  )}
                  {shopifyLabelUrl && (
                    <a
                      href={shopifyLabelUrl}
                      target="_blank"
                      rel="noopener"
                      className="flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-white border-2 border-blue-300 text-blue-900 text-sm font-semibold hover:bg-blue-100 transition"
                    >
                      📦 Versandetikett erstellen
                    </a>
                  )}
                </div>
              )}

              <div className="flex flex-col md:flex-row items-stretch justify-center gap-3 mt-5">
                <OrderQrScanner buttonLabel="Nächste Bestellung scannen" />
                <Link
                  href="/pack"
                  className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-700 transition"
                >
                  <Package2 size={16} />
                  Zur Versand-Liste
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Skip-Modal: Foto-Pflicht überspringen */}
      {skipModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
          onClick={() => setSkipModalOpen(false)}
        >
          <div
            className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-6"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3 mb-4">
              <div>
                <div className="text-lg font-bold text-neutral-900">
                  {t(locale, "shipping.photos_skip_modal_title")}
                </div>
                <div className="text-sm text-neutral-600 mt-1">
                  {t(locale, "shipping.photos_skip_modal_subtitle")}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSkipModalOpen(false)}
                className="text-neutral-400 hover:text-neutral-700 shrink-0"
                aria-label="schließen"
              >
                <X size={20} />
              </button>
            </div>
            <div className="space-y-2">
              {(["accessories", "care_products", "digital_goods"] as const).map((reason) => (
                <button
                  key={reason}
                  type="button"
                  disabled={isPending}
                  onClick={() => {
                    setSkipModalOpen(false);
                    startTransition(async () => {
                      const res = await skipPackPhotos(sessionId, reason);
                      if (res.success) {
                        setPhotosSkipped(true);
                        setPhotosSkipReason(reason);
                      }
                    });
                  }}
                  className="w-full px-4 py-3 rounded-lg border border-neutral-300 hover:border-neutral-900 hover:bg-neutral-50 text-left text-sm font-medium text-neutral-900 disabled:opacity-50"
                >
                  {t(locale, `shipping.photos_skip_reason_${reason}`)}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function PhotoStation({
  type,
  label,
  photos,
  onPhoto,
  onDelete,
  disabled,
  locale,
  isNext,
}: {
  type: PhotoType;
  label: string;
  photos: { id: string; url: string }[];
  onPhoto: (type: PhotoType, file: File) => void;
  onDelete: (type: PhotoType, photoId: string) => void;
  disabled: boolean;
  locale: Locale;
  isNext?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const done = photos.length > 0;
  const containerCls = done
    ? "border-2 border-emerald-400 bg-emerald-50 rounded-xl p-3"
    : isNext
    ? "border-2 border-blue-400 bg-blue-50 rounded-xl p-3 ring-2 ring-blue-200 ring-offset-2"
    : "border-2 border-dashed border-neutral-300 rounded-xl p-3 opacity-60";
  return (
    <div className={containerCls}>
      <div
        className={`text-xs font-bold mb-2 leading-tight text-center ${
          done ? "text-emerald-800" : isNext ? "text-blue-900" : "text-neutral-600"
        }`}
      >
        {label}
      </div>
      {photos.length > 0 ? (
        <div className="space-y-2 mb-2">
          {/* Erstes Foto groß */}
          <div className="relative">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photos[0].url} alt={label} className="w-full h-32 object-cover rounded-lg" />
            <button
              type="button"
              onClick={() => onDelete(type, photos[0].id)}
              disabled={disabled}
              className="absolute top-1 right-1 w-6 h-6 bg-red-600 hover:bg-red-700 text-white rounded-full flex items-center justify-center text-xs disabled:opacity-50"
              title="Foto löschen"
            >
              <X size={12} />
            </button>
          </div>
          {/* Weitere Fotos als Thumbnail-Strip */}
          {photos.length > 1 && (
            <div className="flex gap-1.5 flex-wrap">
              {photos.slice(1).map((p) => (
                <div key={p.id} className="relative w-12 h-12 shrink-0">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt="" className="w-full h-full object-cover rounded" />
                  <button
                    type="button"
                    onClick={() => onDelete(type, p.id)}
                    disabled={disabled}
                    className="absolute -top-1 -right-1 w-4 h-4 bg-red-600 hover:bg-red-700 text-white rounded-full flex items-center justify-center disabled:opacity-50"
                  >
                    <X size={8} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div
          className={`w-full h-32 rounded-lg flex items-center justify-center mb-2 ${
            isNext ? "bg-white" : "bg-neutral-100"
          }`}
        >
          <Camera className={isNext ? "text-blue-500" : "text-neutral-400"} size={isNext ? 36 : 28} />
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
        disabled={disabled || (!done && !isNext)}
        onClick={() => inputRef.current?.click()}
        className={`w-full py-2 rounded-lg text-xs font-medium transition disabled:opacity-50 flex items-center justify-center gap-1 ${
          done
            ? "bg-emerald-600 text-white hover:bg-emerald-700"
            : isNext
            ? "bg-blue-600 text-white hover:bg-blue-700"
            : "bg-neutral-300 text-neutral-600 cursor-not-allowed"
        }`}
      >
        <Camera size={14} />
        {done
          ? `+ Weiteres Foto (${photos.length})`
          : isNext
          ? "Jetzt aufnehmen"
          : "wartet"}
      </button>
    </div>
  );
}
