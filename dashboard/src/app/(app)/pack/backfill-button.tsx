"use client";

import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";

export default function BackfillButton() {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function runOneBatch(): Promise<{ remaining: number; processed: number; errors: number; sampleErrors?: string[] }> {
    const res = await fetch("/api/pack/backfill", { method: "POST" });
    const text = await res.text();
    let data: { remaining?: number; processed?: number; errors?: number; sampleErrors?: string[]; error?: string } = {};
    try {
      data = JSON.parse(text);
    } catch {
      throw new Error(
        `Server-Antwort konnte nicht gelesen werden (HTTP ${res.status}). Vermutlich Timeout. Erste 200 Zeichen: ${text.slice(0, 200)}`,
      );
    }
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return {
      remaining: data.remaining ?? 0,
      processed: data.processed ?? 0,
      errors: data.errors ?? 0,
      sampleErrors: data.sampleErrors,
    };
  }

  async function handleClick() {
    setRunning(true);
    setProgress(null);
    setDone(null);
    let totalProcessed = 0;
    let totalErrors = 0;
    let lastSampleErrors: string[] | undefined;
    try {
      // Loop bis remaining = 0, max 10 batches (Sicherheits-Cap)
      for (let i = 0; i < 10; i++) {
        const r = await runOneBatch();
        totalProcessed += r.processed;
        totalErrors += r.errors;
        if (r.sampleErrors && r.sampleErrors.length) lastSampleErrors = r.sampleErrors;
        setProgress(
          `Batch ${i + 1}: ${r.processed} OK, ${r.errors} Fehler. ${r.remaining} verbleibend...`,
        );
        if (r.remaining <= 0) break;
      }
      const errorDetail =
        totalErrors > 0 && lastSampleErrors?.length
          ? ` Beispiel-Fehler: ${lastSampleErrors.join(" | ")}`
          : "";
      setDone(
        `Fertig — ${totalProcessed} Orders verarbeitet, ${totalErrors} Fehler.${errorDetail} Page reloaden für aktuelles Bild.`,
      );
    } catch (e) {
      setDone(`Fehler: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRunning(false);
      setProgress(null);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        onClick={handleClick}
        disabled={running}
        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-700 transition disabled:opacity-50"
      >
        {running ? <Loader2 className="animate-spin" size={14} /> : <RefreshCw size={14} />}
        QR-Codes generieren
      </button>
      {progress && (
        <div className="text-xs text-amber-700 max-w-xs text-right">{progress}</div>
      )}
      {done && (
        <div className="text-xs text-neutral-700 max-w-xs text-right">{done}</div>
      )}
    </div>
  );
}
