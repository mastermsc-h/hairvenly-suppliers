"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, X, Check, ChevronDown } from "lucide-react";
import { setSessionAdditionalCategories, type SessionCategory } from "@/lib/actions/chat-inbox";

const LABELS: Record<SessionCategory, { label: string; emoji: string }> = {
  availability: { label: "Verfügbarkeit", emoji: "📦" },
  pricing:      { label: "Preis",         emoji: "💰" },
  color_advice: { label: "Farbberatung",  emoji: "🎨" },
  appointment:  { label: "Termin",        emoji: "📅" },
  complaint:    { label: "Reklamation",   emoji: "⚠️" },
  order_status: { label: "Bestellstatus", emoji: "🚚" },
  gewerbe:      { label: "Gewerbe",       emoji: "💼" },
  partnership:  { label: "Partnership",   emoji: "🤝" },
  models:       { label: "Modelle",       emoji: "📸" },
  general:      { label: "Sonstiges",     emoji: "💬" },
};

const ORDER: SessionCategory[] = [
  "availability", "pricing", "color_advice", "appointment",
  "complaint", "order_status", "gewerbe", "partnership", "models", "general",
];

/**
 * Zeigt die manuell gesetzten Zusatz-Kategorien einer Session als kleine
 * Pills + einen +-Button zum Hinzufügen weiterer.
 *
 * Primary-Kategorie wird AUSGESCHLOSSEN — die wird vom CategorySelector
 * separat verwaltet. Hier nur Zweit-/Dritt-Tags.
 *
 * UX: Klick auf Pill X → entfernen. Klick auf + → Dropdown mit verbleibenden
 * Kategorien. Multi-select möglich (Dropdown bleibt offen, jede Auswahl
 * triggert sofort einen Server-Call).
 */
export default function AdditionalCategoriesSelector({
  sessionId,
  primaryCategory,
  initialAdditional,
}: {
  sessionId: string;
  primaryCategory: SessionCategory | null;
  initialAdditional: SessionCategory[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [tags, setTags] = useState<SessionCategory[]>(initialAdditional);

  function commit(next: SessionCategory[]) {
    setTags(next);
    startTransition(async () => {
      try {
        await setSessionAdditionalCategories(sessionId, next);
        router.refresh();
      } catch (e) {
        alert(`Fehler: ${(e as Error).message}`);
        setTags(initialAdditional);
      }
    });
  }

  function add(c: SessionCategory) {
    if (tags.includes(c)) return;
    commit([...tags, c]);
  }
  function remove(c: SessionCategory) {
    commit(tags.filter(t => t !== c));
  }

  const remaining = ORDER.filter(c => c !== primaryCategory && !tags.includes(c));

  return (
    <div className="inline-flex items-center gap-1 flex-wrap">
      {tags.map(c => (
        <span
          key={c}
          className="inline-flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded-md border border-neutral-300 bg-neutral-50 text-neutral-700"
          title={`Zusatz: ${LABELS[c].label} — Klick auf X zum Entfernen`}
        >
          <span>{LABELS[c].emoji}</span>
          <span>{LABELS[c].label}</span>
          <button
            type="button"
            onClick={() => remove(c)}
            disabled={pending}
            className="ml-0.5 -mr-0.5 hover:text-red-600 transition"
            aria-label="Entfernen"
          >
            <X size={10} />
          </button>
        </span>
      ))}
      {remaining.length > 0 && (
        <div className="relative">
          <button
            type="button"
            onClick={() => setOpen(v => !v)}
            disabled={pending}
            title="Zweit-/Dritt-Kategorie hinzufügen"
            className={`inline-flex items-center gap-0.5 text-[11px] px-1.5 py-0.5 rounded-md border transition ${
              tags.length > 0
                ? "border-neutral-200 bg-white hover:bg-neutral-50 text-neutral-500"
                : "border-dashed border-neutral-300 bg-white hover:bg-neutral-50 text-neutral-500"
            }`}
          >
            <Plus size={10} />
            <span>{tags.length === 0 ? "Tag" : ""}</span>
            <ChevronDown size={9} className={`transition-transform ${open ? "rotate-180" : ""}`} />
          </button>
          {open && (
            <>
              <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
              <div className="absolute left-0 top-full mt-1 z-20 w-56 bg-white border border-neutral-200 rounded-xl shadow-xl p-1.5">
                <div className="text-[10px] text-neutral-500 uppercase tracking-wide px-2 py-1">
                  Zusatz-Tag hinzufügen
                </div>
                {remaining.map(key => (
                  <button
                    key={key}
                    onClick={() => add(key)}
                    disabled={pending}
                    className="w-full text-left px-2.5 py-1.5 rounded-lg flex items-center gap-2 text-sm hover:bg-neutral-50 text-neutral-700 transition"
                  >
                    <span className="text-base">{LABELS[key].emoji}</span>
                    <span>{LABELS[key].label}</span>
                  </button>
                ))}
                {tags.length > 0 && (
                  <>
                    <div className="border-t border-neutral-100 my-1" />
                    <div className="text-[10px] text-neutral-400 px-2 py-1">
                      <Check size={10} className="inline mr-1" />
                      {tags.length} bereits getaggt
                    </div>
                  </>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
