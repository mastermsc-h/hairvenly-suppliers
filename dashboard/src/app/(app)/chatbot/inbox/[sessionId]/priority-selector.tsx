"use client";

import { useTransition, useState } from "react";
import { useRouter } from "next/navigation";
import { Flag, ChevronDown } from "lucide-react";
import { setSessionPriority } from "@/lib/actions/chat-inbox";

type ManualPriority = "high" | "normal" | "low" | null;

const OPTIONS: { value: "auto" | "high" | "normal" | "low"; label: string; icon: string; color: string }[] = [
  { value: "auto",   label: "Auto",          icon: "🤖", color: "text-neutral-500" },
  { value: "high",   label: "Hoch",          icon: "🔴", color: "text-pink-700" },
  { value: "normal", label: "Normal",        icon: "🟡", color: "text-amber-700" },
  { value: "low",    label: "Niedrig",       icon: "⚪", color: "text-neutral-600" },
];

/**
 * Manuelle Priorität pro Session setzen.
 * - Auto = Server berechnet Prio aus Triggern (Foto, MA-Marker, Wartezeit, ...)
 * - High/Normal/Low = MA überschreibt explizit, gilt bis zum nächsten Reset auf Auto.
 *
 * UI: kleiner Pill-Button mit Aktueller Wahl, klick → Dropdown mit den 4 Optionen.
 */
export default function PrioritySelector({
  sessionId,
  current,
}: {
  sessionId: string;
  current: ManualPriority;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  const currentValue = current || "auto";
  const currentOpt = OPTIONS.find(o => o.value === currentValue) || OPTIONS[0];

  function handleSelect(value: "auto" | "high" | "normal" | "low") {
    setOpen(false);
    if (value === currentValue) return;
    startTransition(async () => {
      try {
        await setSessionPriority(sessionId, value);
        router.refresh();
      } catch (e) {
        alert(`Priorität setzen fehlgeschlagen: ${(e as Error).message}`);
      }
    });
  }

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(v => !v)}
        disabled={pending}
        title={current
          ? `Manuelle Priorität gesetzt: ${currentOpt.label}. Klick zum Ändern oder auf Auto zurücksetzen.`
          : "Priorität wird automatisch berechnet (aus Foto/MA-Marker/Wartezeit/Kategorie). Klick zum manuellen Setzen."}
        className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full border text-xs font-medium ${currentOpt.color} ${
          current
            ? "border-pink-300 bg-pink-50 hover:bg-pink-100"
            : "border-neutral-300 bg-white hover:bg-neutral-50"
        } disabled:opacity-50`}
      >
        <Flag size={11} />
        <span>{currentOpt.icon}</span>
        <span>{current ? currentOpt.label : "Prio: Auto"}</span>
        <ChevronDown size={10} />
      </button>
      {open && (
        <>
          {/* Backdrop zum Schließen */}
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute top-full mt-1 left-0 z-50 bg-white border border-neutral-200 rounded-lg shadow-lg py-1 min-w-[150px]">
            {OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => handleSelect(opt.value)}
                className={`w-full text-left px-3 py-1.5 text-xs hover:bg-neutral-50 flex items-center gap-1.5 ${
                  opt.value === currentValue ? "font-bold bg-neutral-50" : "font-medium"
                } ${opt.color}`}
              >
                <span>{opt.icon}</span>
                <span>{opt.label}</span>
                {opt.value === currentValue && <span className="ml-auto text-neutral-400">✓</span>}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
