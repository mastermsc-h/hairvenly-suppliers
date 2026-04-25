"use client";

import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";

export default function BackfillButton() {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function handleClick() {
    setRunning(true);
    setResult(null);
    try {
      const res = await fetch("/api/pack/backfill", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setResult(`Fehler: ${data.error || res.status}`);
      } else {
        setResult(
          `OK — ${data.processed}/${data.total} Orders verarbeitet, ${data.errors} Fehler. Page reloaden für aktuelles Bild.`,
        );
      }
    } catch (e) {
      setResult(`Fehler: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRunning(false);
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
      {result && (
        <div className="text-xs text-neutral-600 max-w-xs text-right">{result}</div>
      )}
    </div>
  );
}
