"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";

export default function AutoTrainButton() {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ inserted: number; preview: { blocker: string; good_answer: string }[] } | null>(null);
  const router = useRouter();

  async function trigger() {
    if (!confirm(
      "Auto-Training starten?\n\n" +
      "Bot lernt aus den häufigsten Conversion-Blockern " +
      "(Bedenkzeit, Lager-Problem, Unklare Antwort, Deflection, Foto-Hürde, Preis-Schock).\n\n" +
      "Es werden bis zu 6 GLOBALE Trainings-Einträge generiert oder aktualisiert. " +
      "Dauer: ca. 30 Sekunden."
    )) return;

    setLoading(true);
    setResult(null);
    try {
      const res = await fetch("/api/chat/insights/auto-train", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        alert(`Fehler: ${data.error}`);
        return;
      }
      setResult(data);
      router.refresh();
    } catch (e) {
      alert(`Fehler: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <button
        onClick={trigger}
        disabled={loading}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-purple-600 text-white text-sm font-medium hover:bg-purple-700 disabled:opacity-40 shadow-sm"
      >
        <Sparkles size={14} />
        {loading ? "Generiere Training..." : "Bot aus Insights trainieren"}
      </button>
      {result && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 text-xs max-w-md">
          <div className="font-semibold text-purple-900 mb-1">✓ {result.inserted} Trainings-Einträge erstellt/aktualisiert</div>
          <ul className="space-y-1 text-purple-700">
            {result.preview.map((p, i) => (
              <li key={i}>
                <strong>{p.blocker}:</strong> {p.good_answer.slice(0, 80)}…
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
