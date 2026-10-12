"use client";

import { useRef, useState, useTransition } from "react";
import { Check, Loader2, MessageSquarePlus, Pencil, X } from "lucide-react";
import { savePackOrderNote } from "@/lib/actions/pack";

export interface OrderNote {
  note: string;
  by: string | null;
  at: string;
}

// Häufige Gründe zum Antippen — schneller als tippen, und einheitlich genug,
// dass jeder im Team sofort weiß, was gemeint ist.
const QUICK_REASONS = ["Ware fehlt", "Warte auf Kunde", "Adresse klären", "Rückfrage offen"];

function fmt(iso: string): string {
  return new Date(iso).toLocaleString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "Europe/Berlin",
  });
}

/**
 * Notiz-Zelle (Versand-Übersicht): zeigt die aktuelle Notiz mit Autor + Zeit,
 * Klick → Inline-Editor mit Schnell-Gründen. Speichern: Button oder ⌘/Strg+Enter.
 * Leer speichern löscht die Notiz. Zustand liegt beim Elternteil (value/onChange),
 * damit Filter-Zähler und Server-Refresh konsistent bleiben.
 */
export default function OrderNoteCell({
  orderName,
  value,
  onChange,
}: {
  orderName: string;
  value: OrderNote | null;
  onChange: (v: OrderNote | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const areaRef = useRef<HTMLTextAreaElement>(null);

  function open() {
    setDraft(value?.note ?? "");
    setError(null);
    setEditing(true);
    setTimeout(() => areaRef.current?.focus(), 0);
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const res = await savePackOrderNote(orderName, draft);
      if (res.success) {
        onChange(
          res.note ? { note: res.note, by: res.updatedByName ?? null, at: res.updatedAt ?? new Date().toISOString() } : null,
        );
        setEditing(false);
      } else {
        setError(res.error ?? "Speichern fehlgeschlagen");
      }
    });
  }

  function addReason(text: string) {
    setDraft((d) => (d.trim() ? `${d.trim()} · ${text}` : text));
    areaRef.current?.focus();
  }

  if (!editing) {
    if (!value) {
      return (
        <button
          type="button"
          onClick={open}
          className="inline-flex items-center gap-1 text-xs text-neutral-400 hover:text-neutral-800 transition"
          title="Notiz hinzufügen — z.B. warum die Bestellung noch nicht raus ist"
        >
          <MessageSquarePlus size={14} /> Notiz
        </button>
      );
    }
    return (
      <button
        type="button"
        onClick={open}
        className="group w-full text-left rounded-lg bg-amber-50 border border-amber-200 px-2.5 py-1.5 hover:border-amber-400 transition"
        title="Notiz bearbeiten"
      >
        <div className="text-xs text-neutral-900 whitespace-pre-wrap break-words leading-snug">{value.note}</div>
        <div className="mt-0.5 flex items-center gap-1 text-[10px] text-neutral-500">
          <span>
            {value.by ? `${value.by} · ` : ""}
            {fmt(value.at)}
          </span>
          <Pencil size={9} className="opacity-0 group-hover:opacity-100 transition" />
        </div>
      </button>
    );
  }

  return (
    <div className="w-full min-w-[220px]">
      <textarea
        ref={areaRef}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            save();
          } else if (e.key === "Escape") {
            setEditing(false);
          }
        }}
        maxLength={500}
        rows={3}
        placeholder="Warum ist die Bestellung noch nicht raus? Was ist der Stand?"
        className="w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-neutral-900"
      />
      <div className="mt-1 flex flex-wrap gap-1">
        {QUICK_REASONS.map((r) => (
          <button
            key={r}
            type="button"
            onClick={() => addReason(r)}
            className="px-1.5 py-0.5 rounded border border-neutral-300 text-[10px] text-neutral-600 hover:bg-neutral-100"
          >
            {r}
          </button>
        ))}
      </div>
      {error && <div className="mt-1 text-[11px] text-red-700">{error}</div>}
      <div className="mt-1.5 flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-neutral-900 text-white text-xs font-medium hover:bg-neutral-700 disabled:opacity-50"
        >
          {pending ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
          Speichern
        </button>
        <button
          type="button"
          onClick={() => setEditing(false)}
          disabled={pending}
          className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-xs text-neutral-600 hover:bg-neutral-100"
        >
          <X size={12} /> Abbrechen
        </button>
        <span className="text-[10px] text-neutral-400 ml-auto">{draft.length}/500</span>
      </div>
    </div>
  );
}
