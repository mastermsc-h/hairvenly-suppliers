"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Check, AlertCircle } from "lucide-react";

interface SyncResult {
  ok?: boolean;
  scraped_count?: number;
  inserted?: number;
  updated?: number;
  unchanged?: number;
  deactivated?: number;
  error?: string;
  details?: string;
}

export default function SyncTreatwellButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState<SyncResult | null>(null);
  const [running, setRunning] = useState(false);

  async function handleSync() {
    if (running) return;
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch("/api/chatbot/sync-treatwell-services", {
        method: "POST",
      });
      const json: SyncResult = await res.json();
      setResult(json);
      if (json.ok) {
        // Page-Reload damit die neue Liste sichtbar wird
        startTransition(() => router.refresh());
      }
    } catch (e) {
      setResult({ error: (e as Error).message });
    } finally {
      setRunning(false);
    }
  }

  const summary = result
    ? result.ok
      ? `+${result.inserted ?? 0} neu · ~${result.updated ?? 0} aktualisiert · ${result.unchanged ?? 0} unverändert${
          (result.deactivated ?? 0) > 0 ? ` · -${result.deactivated} deaktiviert` : ""
        }`
      : `Fehler: ${result.error || "Unbekannt"}`
    : null;

  return (
    <div className="flex flex-col items-end gap-1">
      <button
        type="button"
        onClick={handleSync}
        disabled={running || pending}
        className={`inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium border transition ${
          running || pending
            ? "bg-neutral-100 text-neutral-400 border-neutral-200 cursor-wait"
            : "bg-neutral-900 text-white border-neutral-900 hover:bg-neutral-800"
        }`}
      >
        <RefreshCw size={14} className={running ? "animate-spin" : ""} />
        {running ? "Sync läuft …" : "Aus Treatwell aktualisieren"}
      </button>
      {summary && (
        <div
          className={`inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-md ${
            result?.ok
              ? "bg-emerald-50 text-emerald-800 border border-emerald-200"
              : "bg-rose-50 text-rose-800 border border-rose-200"
          }`}
        >
          {result?.ok ? <Check size={11} /> : <AlertCircle size={11} />}
          {summary}
        </div>
      )}
    </div>
  );
}
