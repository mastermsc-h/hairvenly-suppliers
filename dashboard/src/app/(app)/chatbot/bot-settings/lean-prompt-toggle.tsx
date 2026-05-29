"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Zap, AlertTriangle } from "lucide-react";
import { setLeanPromptMode } from "@/lib/actions/chatbot-settings";

interface Props {
  initialEnabled: boolean;
}

export default function LeanPromptToggle({ initialEnabled }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(initialEnabled);

  function toggle(value: boolean) {
    setEnabled(value);
    startTransition(async () => {
      try {
        await setLeanPromptMode(value);
        router.refresh();
      } catch (e) {
        alert(`Fehler: ${(e as Error).message}`);
        setEnabled(initialEnabled);
      }
    });
  }

  return (
    <div
      className={`bg-white rounded-2xl border-2 shadow-sm p-4 ${
        enabled ? "border-amber-300" : "border-neutral-100"
      }`}
    >
      <div className="flex items-center gap-2 mb-2">
        <Zap size={14} className={enabled ? "text-amber-600" : "text-neutral-500"} />
        <h2 className="text-sm font-semibold text-neutral-900">
          Slim-Prompt-Modus (experimentell)
        </h2>
        {enabled && (
          <span className="ml-auto inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 text-[10px] font-semibold uppercase tracking-wide">
            aktiv
          </span>
        )}
      </div>
      <p className="text-xs text-neutral-600 mb-3 leading-relaxed">
        Reduziert den System-Prompt von ~50.000 auf ~10.000 Tokens.
        Training-Beispiele + Verkaufs-Strategien werden weggelassen, der
        Hard-Rule-Block wird auf 10 Punkte komprimiert. Sonnet 4.5
        bekommt mehr Aufmerksamkeit für die echte Kundennachricht —
        sollte gleichzeitig schlauer UND ~60-70 % günstiger werden.
      </p>
      <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-2.5 mb-3 flex gap-2 text-[11px] text-amber-900 leading-relaxed">
        <AlertTriangle size={12} className="shrink-0 mt-0.5" />
        <div>
          Bei Regressionen: Toggle wieder ausschalten — sofortiger Rollback,
          alte Verbose-Pipeline läuft weiter wie vorher. Beobachte die
          Inbox aktiv für die ersten 1-2 Stunden nach Aktivierung.
        </div>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => toggle(false)}
          disabled={pending}
          className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border-2 transition ${
            !enabled
              ? "bg-neutral-100 text-neutral-900 border-neutral-300"
              : "bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50"
          }`}
        >
          📚 Voll (50k Tokens)
        </button>
        <button
          type="button"
          onClick={() => toggle(true)}
          disabled={pending}
          className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border-2 transition ${
            enabled
              ? "bg-amber-50 text-amber-900 border-amber-400"
              : "bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50"
          }`}
        >
          ⚡ Slim (~10k Tokens)
        </button>
      </div>
    </div>
  );
}
