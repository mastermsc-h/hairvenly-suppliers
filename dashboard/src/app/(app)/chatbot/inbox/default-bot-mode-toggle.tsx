"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Power, ChevronDown, Check } from "lucide-react";
import { setGlobalDefaultBotMode } from "@/lib/actions/chat-inbox";

type Mode = "auto" | "assisted" | "off";

interface Props {
  currentMode: Mode;
}

const OPTIONS: { v: Mode; icon: string; label: string; desc: string; color: string }[] = [
  { v: "off",      icon: "⏸",   label: "Manuell",     desc: "Bot ist komplett aus. Keine Generierung, kein Auto-Draft. Du schreibst alles selbst.",           color: "neutral" },
  { v: "assisted", icon: "🤝", label: "Assistiert", desc: "Bot wartet auf deinen Klick. Erst wenn du 'Antwort generieren' drückst, baut der Bot einen Entwurf für dich, den du dann freigibst.",            color: "blue" },
  { v: "auto",     icon: "🤖",   label: "Auto-Antwort", desc: "Bot sendet bei neuen DMs sofort selbst — keine Rückfrage. Nur für vertraute Avatare.",     color: "green" },
];

export default function DefaultBotModeToggle({ currentMode }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<Mode>(currentMode);

  const active = OPTIONS.find(o => o.v === mode) || OPTIONS[0];

  function handleChange(v: Mode) {
    if (v === mode) { setOpen(false); return; }
    setMode(v);
    setOpen(false);
    startTransition(async () => {
      try { await setGlobalDefaultBotMode(v); router.refresh(); }
      catch (e) { alert(`Fehler: ${(e as Error).message}`); setMode(currentMode); }
    });
  }

  return (
    <div className="relative">
      <span className="text-[10px] text-neutral-400 uppercase tracking-wide block mb-0.5">
        Bot-Standard für neue Anfragen
      </span>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        disabled={pending}
        title="Standard-Verhalten des Bots wenn eine neue Kundennachricht reinkommt"
        className={`inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg border-2 shadow-sm hover:shadow transition ${
          active.color === "green"   ? "bg-green-50 text-green-800 border-green-400 hover:bg-green-100" :
          active.color === "blue"    ? "bg-blue-50 text-blue-800 border-blue-400 hover:bg-blue-100" :
                                       "bg-white text-neutral-800 border-neutral-400 hover:bg-neutral-50"
        } ${pending ? "opacity-50 cursor-wait" : "cursor-pointer"}`}
      >
        <Power size={12} className="text-neutral-400" />
        <span>{active.icon} {active.label}</span>
        <ChevronDown size={14} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-20 w-80 bg-white border border-neutral-200 rounded-xl shadow-xl p-2 space-y-1">
            <div className="text-[10px] font-semibold text-neutral-500 uppercase tracking-wide px-2 pt-1">
              Wenn neue Kundin schreibt:
            </div>
            {OPTIONS.map(opt => {
              const isActive = mode === opt.v;
              return (
                <button
                  key={opt.v}
                  onClick={() => handleChange(opt.v)}
                  className={`w-full text-left p-2.5 rounded-lg border-2 transition ${
                    isActive
                      ? opt.color === "green" ? "border-green-400 bg-green-50"
                      : opt.color === "blue"  ? "border-blue-400 bg-blue-50"
                      :                          "border-neutral-400 bg-neutral-50"
                      : "border-transparent hover:bg-neutral-50"
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{opt.icon}</span>
                    <span className="text-sm font-semibold text-neutral-900">{opt.label}</span>
                    {isActive && <Check size={14} className="text-green-600 ml-auto" />}
                  </div>
                  <div className="text-[11px] text-neutral-600 mt-0.5 ml-7">{opt.desc}</div>
                </button>
              );
            })}
            <div className="text-[10px] text-neutral-400 px-2 pt-1 pb-0.5 border-t border-neutral-100 mt-1">
              Gilt nur für NEU eingehende Sessions. Bestehende Chats behalten ihren eigenen Modus.
            </div>
          </div>
        </>
      )}
    </div>
  );
}
