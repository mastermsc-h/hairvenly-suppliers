"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";

export default function ClassifyBackfillButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function run(remaining: number) {
    setBusy(true);
    let total = 0;
    let rounds = 0;
    setResult("Klassifiziere…");
    try {
      while (true) {
        rounds++;
        const res = await fetch("/api/chatbot/classify-backfill?limit=30", { method: "POST" });
        const data = await res.json();
        if (!res.ok) {
          setResult(`❌ ${data.error || "Fehler"}: ${data.details || ""}`);
          break;
        }
        total += data.classified || 0;
        setResult(`Klassifiziere… ${total} fertig (Runde ${rounds})`);
        if ((data.processed || 0) === 0) break; // nichts mehr offen
        if (rounds >= 10) break; // safety
      }
      setResult(`✓ ${total} Sessions klassifiziert`);
      router.refresh();
    } catch (e) {
      setResult(`❌ ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
    void remaining;
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        onClick={() => run(0)}
        disabled={busy}
        title="Klassifiziert alle Sessions ohne Kategorie via Haiku — füllt die Filter-Chips. Pro Session ~$0.0005."
        className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-purple-300 bg-purple-50 text-purple-800 hover:bg-purple-100 disabled:opacity-50"
      >
        <Sparkles size={12} className={busy ? "animate-pulse" : ""} />
        {busy ? "Klassifiziere…" : "Sessions klassifizieren"}
      </button>
      {result && <span className="text-xs text-neutral-600">{result}</span>}
    </div>
  );
}
