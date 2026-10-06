"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { Camera, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { fetchActivePackSessions } from "@/lib/actions/pack-handoff";
import { uploadPackPhoto } from "@/lib/actions/pack";
import { resizeImage } from "@/lib/image-resize";

type Active = Awaited<ReturnType<typeof fetchActivePackSessions>>[number];

/**
 * Kamera-Station: Das iPhone bleibt auf dieser Seite liegen. Alle 3s wird
 * geholt, welche Bestellung gerade gepackt wird (zuletzt gescannt = oben).
 * Ein Tipp auf "Foto aufnehmen" → Foto landet bei genau dieser Bestellung,
 * der iMac springt automatisch weiter. Kein QR, kein Suchen.
 * Laufen mehrere Bestellungen parallel, kann man die Ziel-Bestellung antippen.
 */
export default function KameraClient() {
  const [sessions, setSessions] = useState<Active[]>([]);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [lastOk, setLastOk] = useState<{ orderName: string; count: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputRef = useRef<HTMLInputElement>(null);
  const inFlightRef = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const list = await fetchActivePackSessions();
      setSessions(list);
      setLoaded(true);
    } catch {
      /* nächster Tick */
    }
  }, []);

  useEffect(() => {
    void refresh();
    const iv = setInterval(() => {
      if (document.visibilityState === "visible" && !inFlightRef.current) void refresh();
    }, 3000);
    return () => clearInterval(iv);
  }, [refresh]);

  // Bildschirm wach halten (iOS 16.4+), damit das Handy nicht einschläft.
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const request = async () => {
      try {
        const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<{ release: () => Promise<void> }> } };
        if (nav.wakeLock && document.visibilityState === "visible") lock = await nav.wakeLock.request("screen");
      } catch {
        /* nicht unterstützt — egal */
      }
    };
    void request();
    const onVis = () => { if (document.visibilityState === "visible") void request(); };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      void lock?.release();
    };
  }, []);

  // Ziel: angepinnte Bestellung (falls noch aktiv), sonst die zuletzt gescannte.
  const target = (pinnedId && sessions.find((s) => s.sessionId === pinnedId)) || sessions[0] || null;

  function onFile(file: File) {
    if (!target) return;
    const t = target;
    setError(null);
    inFlightRef.current = true;
    startTransition(async () => {
      try {
        const compressed = await resizeImage(file, 2000, 1500, 0.85);
        const fd = new FormData();
        fd.append("photo", compressed);
        const res = await uploadPackPhoto(t.sessionId, "products_invoice", fd);
        if (res.success) {
          setLastOk({ orderName: t.orderName, count: t.photoCount + 1 });
          await refresh();
        } else {
          setError(res.error ?? "Upload fehlgeschlagen");
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload fehlgeschlagen");
      } finally {
        inFlightRef.current = false;
      }
    });
  }

  const minutesAgo = (iso: string) => Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));

  return (
    <div className="min-h-dvh bg-neutral-50 p-4 max-w-md mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs font-medium text-neutral-500 uppercase tracking-wide">Kamera-Station</div>
          <div className="text-sm text-neutral-600">Fotos gehen automatisch zur aktuellen Bestellung.</div>
        </div>
        <button type="button" onClick={() => void refresh()} className="p-2 rounded-lg border border-neutral-300 text-neutral-600" aria-label="Aktualisieren">
          <RefreshCw size={16} />
        </button>
      </div>

      {!loaded ? (
        <div className="mt-10 text-center text-neutral-500"><Loader2 className="animate-spin mx-auto" /></div>
      ) : !target ? (
        <div className="mt-8 bg-white rounded-2xl border-2 border-dashed border-neutral-300 p-8 text-center">
          <Camera className="mx-auto text-neutral-300" size={48} />
          <div className="text-lg font-bold text-neutral-700 mt-3">Keine Bestellung in Arbeit</div>
          <div className="text-sm text-neutral-500 mt-1 leading-relaxed">
            Sobald am iMac gescannt wird, erscheint die Bestellung hier von selbst. Handy einfach liegen lassen.
          </div>
        </div>
      ) : (
        <>
          <div className="mt-5 bg-blue-600 text-white rounded-2xl p-5 shadow-md">
            <div className="text-[11px] font-bold uppercase tracking-widest text-blue-100">Foto geht an</div>
            <div className="text-4xl font-black mt-1 leading-none">{target.orderName}</div>
            <div className="text-sm text-blue-100 mt-2">
              {target.itemCount} Position{target.itemCount === 1 ? "" : "en"} · zuletzt gescannt vor {minutesAgo(target.updatedAt)} Min
              {target.photoCount > 0 && <> · {target.photoCount} Foto{target.photoCount === 1 ? "" : "s"} vorhanden</>}
            </div>
          </div>

          <input
            ref={inputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }}
          />
          <button
            type="button"
            disabled={pending}
            onClick={() => inputRef.current?.click()}
            className="mt-4 w-full py-7 rounded-2xl bg-neutral-900 text-white text-2xl font-black flex items-center justify-center gap-3 active:scale-[0.98] transition disabled:opacity-60"
          >
            {pending ? <><Loader2 className="animate-spin" size={28} /> Lädt hoch…</> : <><Camera size={30} /> Foto aufnehmen</>}
          </button>

          {lastOk && (
            <div className="mt-4 bg-emerald-50 border-2 border-emerald-300 rounded-2xl p-4 flex items-center gap-3">
              <CheckCircle2 className="text-emerald-600 shrink-0" size={32} />
              <div>
                <div className="font-bold text-emerald-900">Foto bei {lastOk.orderName} gespeichert</div>
                <div className="text-xs text-emerald-800">Der iMac macht automatisch weiter. ({lastOk.count} Foto{lastOk.count === 1 ? "" : "s"})</div>
              </div>
            </div>
          )}
          {error && <div className="mt-3 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg p-2">{error}</div>}

          {sessions.length > 1 && (
            <div className="mt-6">
              <div className="text-xs font-medium text-neutral-500 uppercase tracking-wide mb-2">Andere Bestellung in Arbeit? Antippen:</div>
              <div className="space-y-2">
                {sessions.map((s) => {
                  const isTarget = s.sessionId === target.sessionId;
                  return (
                    <button
                      key={s.sessionId}
                      type="button"
                      onClick={() => setPinnedId(s.sessionId)}
                      className={`w-full text-left px-4 py-3 rounded-xl border-2 flex items-center justify-between ${isTarget ? "border-blue-500 bg-blue-50" : "border-neutral-200 bg-white"}`}
                    >
                      <span className="font-bold text-neutral-900">{s.orderName}</span>
                      <span className="text-xs text-neutral-500">vor {minutesAgo(s.updatedAt)} Min{s.photoCount > 0 ? ` · ${s.photoCount} 📷` : ""}</span>
                    </button>
                  );
                })}
              </div>
              {pinnedId && (
                <button type="button" onClick={() => setPinnedId(null)} className="mt-2 text-xs text-neutral-500 underline">
                  Wieder automatisch der zuletzt gescannten folgen
                </button>
              )}
            </div>
          )}
        </>
      )}

      <p className="text-[11px] text-neutral-400 mt-8 text-center leading-relaxed">
        Tipp: Diese Seite zum Home-Bildschirm hinzufügen („Kamera") und am Packplatz liegen lassen.
      </p>
    </div>
  );
}
