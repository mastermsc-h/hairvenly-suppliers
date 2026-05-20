"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Tag, ChevronDown, Check } from "lucide-react";
import { setSessionCategory, type SessionCategory } from "@/lib/actions/chat-inbox";

const LABELS: Record<SessionCategory, { label: string; emoji: string }> = {
  availability: { label: "Verfügbarkeit", emoji: "📦" },
  pricing:      { label: "Preis",         emoji: "💰" },
  color_advice: { label: "Farbberatung",  emoji: "🎨" },
  appointment:  { label: "Termin",        emoji: "📅" },
  complaint:    { label: "Reklamation",   emoji: "⚠️" },
  order_status: { label: "Bestellstatus", emoji: "🚚" },
  gewerbe:      { label: "Gewerbe",       emoji: "💼" },
  partnership:  { label: "Partnership",   emoji: "🤝" },
  general:      { label: "Sonstiges",     emoji: "💬" },
};

const ORDER: SessionCategory[] = [
  "availability", "pricing", "color_advice", "appointment",
  "complaint", "order_status", "gewerbe", "partnership", "general",
];

export default function CategorySelector({
  sessionId,
  currentCategory,
}: {
  sessionId: string;
  currentCategory: SessionCategory | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [cat, setCat] = useState<SessionCategory | null>(currentCategory);

  const active = cat ? LABELS[cat] : { label: "Kategorie", emoji: "🏷" };

  function handleChange(c: SessionCategory) {
    setCat(c);
    setOpen(false);
    startTransition(async () => {
      try { await setSessionCategory(sessionId, c); router.refresh(); }
      catch (e) { alert(`Fehler: ${(e as Error).message}`); setCat(currentCategory); }
    });
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        disabled={pending}
        title="Tag manuell setzen / ändern"
        className="inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border border-neutral-300 bg-white hover:bg-neutral-50 transition"
      >
        <Tag size={11} className="text-neutral-400" />
        <span>{active.emoji} {active.label}</span>
        <ChevronDown size={11} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1 z-20 w-56 bg-white border border-neutral-200 rounded-xl shadow-xl p-1.5">
            {ORDER.map(key => {
              const isActive = cat === key;
              return (
                <button
                  key={key}
                  onClick={() => handleChange(key)}
                  className={`w-full text-left px-2.5 py-1.5 rounded-lg flex items-center gap-2 text-sm transition ${
                    isActive ? "bg-neutral-100 font-semibold text-neutral-900" : "hover:bg-neutral-50 text-neutral-700"
                  }`}
                >
                  <span className="text-base">{LABELS[key].emoji}</span>
                  <span>{LABELS[key].label}</span>
                  {isActive && <Check size={12} className="text-green-600 ml-auto" />}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
