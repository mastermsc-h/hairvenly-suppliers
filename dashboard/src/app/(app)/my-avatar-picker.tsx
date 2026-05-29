"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, ChevronDown, Check } from "lucide-react";
import { setMyDefaultAvatar } from "@/lib/actions/user-avatar";

interface Props {
  current: string | null;
  options: string[];
}

/**
 * Kleiner Avatar-Picker im Sidebar-User-Bereich.
 * Erlaubt jeder MA, sich selbst eine Default-Signatur zuzuweisen, die
 * dann bei Takeover / Bot-Modus-Switch automatisch auf die Session
 * übertragen wird.
 */
export default function MyAvatarPicker({ current, options }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [picked, setPicked] = useState<string | null>(current);

  function choose(name: string | null) {
    setPicked(name);
    setOpen(false);
    startTransition(async () => {
      try {
        await setMyDefaultAvatar(name);
        router.refresh();
      } catch (e) {
        alert(`Fehler: ${(e as Error).message}`);
        setPicked(current);
      }
    });
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        title="Wähle einen Standard-Avatar. Wird automatisch genutzt wenn du eine Session übernimmst oder den Bot auf auto / assistiert setzt."
        className="w-full flex items-center gap-2 px-2 py-2 text-sm text-neutral-700 hover:bg-neutral-100 rounded-lg transition"
      >
        <Sparkles size={14} className="text-purple-500 shrink-0" />
        <span className="flex-1 text-left truncate">
          {picked ? (
            <>
              Avatar: <span className="font-medium text-neutral-900">{picked}</span>
            </>
          ) : (
            <span className="text-neutral-500">Avatar wählen …</span>
          )}
        </span>
        <ChevronDown
          size={12}
          className={`text-neutral-400 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute bottom-full mb-1 left-0 right-0 z-20 bg-white border border-neutral-200 rounded-xl shadow-xl p-1 max-h-72 overflow-y-auto">
            <div className="text-[10px] font-semibold text-neutral-500 uppercase tracking-wide px-2 pt-1 pb-0.5">
              Mein Standard-Avatar
            </div>
            <button
              type="button"
              onClick={() => choose(null)}
              className={`w-full text-left px-2.5 py-1.5 rounded-md flex items-center gap-2 text-sm transition ${
                !picked ? "bg-neutral-100 font-medium" : "hover:bg-neutral-50"
              }`}
            >
              <span className="text-neutral-500">— Kein Default (zufällig)</span>
              {!picked && <Check size={12} className="text-green-600 ml-auto" />}
            </button>
            {options.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => choose(name)}
                className={`w-full text-left px-2.5 py-1.5 rounded-md flex items-center gap-2 text-sm transition ${
                  picked === name ? "bg-neutral-100 font-medium" : "hover:bg-neutral-50"
                }`}
              >
                <Sparkles size={12} className="text-purple-400" />
                <span>{name}</span>
                {picked === name && <Check size={12} className="text-green-600 ml-auto" />}
              </button>
            ))}
            <div className="text-[10px] text-neutral-400 px-2 pt-1 pb-0.5 border-t border-neutral-100 mt-1 leading-snug">
              Wird automatisch genutzt wenn du eine Session übernimmst oder
              den Bot auf auto / assistiert setzt.
            </div>
          </div>
        </>
      )}
    </div>
  );
}
