"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { StickyNote, Save, X, Edit3, ChevronDown } from "lucide-react";
import { updateTeamNotes } from "@/lib/actions/chat-inbox";

/**
 * Interne Team-Notizen pro Session. Nicht an Kundin gesendet.
 * Default: kompakter Ein-Zeilen-Chip im Header-Bereich (Notiz-Preview ODER
 * "+ Notiz hinzufügen"). Klick öffnet einen schlanken Editor. So nervt's
 * nicht im Chat-Flow, ist aber präsent.
 */
export default function TeamNotes({
  sessionId,
  initialNotes,
  updatedAt,
  author,
}: {
  sessionId: string;
  initialNotes: string | null;
  updatedAt?: string | null;
  author?: string | null;
}) {
  const router = useRouter();
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(initialNotes || "");
  const [saving, setSaving] = useState(false);
  const [, startTransition] = useTransition();

  function handleSave() {
    if (saving) return;
    setSaving(true);
    startTransition(async () => {
      try {
        await updateTeamNotes(sessionId, value);
        setEditing(false);
        setExpanded(true);
        router.refresh();
      } finally {
        setSaving(false);
      }
    });
  }

  function handleCancel() {
    setValue(initialNotes || "");
    setEditing(false);
  }

  const hasNotes = (initialNotes || "").trim().length > 0;
  const preview = hasNotes ? (initialNotes || "").trim().slice(0, 80) : "";
  const meta = updatedAt
    ? `${author || "Team"} · ${new Date(updatedAt).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" })} ${new Date(updatedAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`
    : null;

  // Editor-Modus: schlanke Inline-Bearbeitung
  if (editing) {
    return (
      <div className="rounded-xl border-l-4 border-l-amber-400 border-y border-r border-y-amber-100 border-r-amber-100 bg-amber-50/40 px-4 py-3 space-y-2">
        <div className="flex items-center gap-2 text-xs font-medium text-amber-900">
          <StickyNote size={13} className="text-amber-600" />
          Team-Notiz <span className="text-neutral-400 font-normal">· intern</span>
        </div>
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="z.B. 'Warte auf Rückmeldung von Aria' / 'Kundin kommt Donnerstag in den Salon'"
          rows={3}
          autoFocus
          className="w-full rounded-lg border border-amber-200 bg-white px-3 py-2 text-sm focus:ring-2 focus:ring-amber-400 focus:outline-none resize-none"
        />
        <div className="flex items-center justify-end gap-1.5">
          <button
            onClick={handleCancel}
            disabled={saving}
            className="text-xs px-3 py-1.5 rounded-lg text-neutral-600 hover:bg-neutral-100 inline-flex items-center gap-1 disabled:opacity-50"
          >
            <X size={11} /> Abbrechen
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="text-xs px-3 py-1.5 rounded-lg bg-amber-500 text-white hover:bg-amber-600 inline-flex items-center gap-1 disabled:opacity-50"
          >
            <Save size={11} /> {saving ? "Speichere…" : "Speichern"}
          </button>
        </div>
      </div>
    );
  }

  // Default: kompakter One-Liner-Chip
  if (!hasNotes) {
    return (
      <button
        onClick={() => setEditing(true)}
        className="w-full text-left rounded-lg px-3 py-1.5 text-xs text-neutral-500 hover:bg-neutral-50 inline-flex items-center gap-1.5"
      >
        <StickyNote size={11} className="text-neutral-400" />
        <span className="italic">Team-Notiz hinzufügen</span>
      </button>
    );
  }

  // Mit Notiz, kompakt: Ein-Zeilen-Chip, Klick → expand
  return (
    <div className="rounded-lg bg-amber-50/60 border-l-4 border-l-amber-400 px-3 py-2">
      <button
        onClick={() => setExpanded(v => !v)}
        className="w-full text-left flex items-center gap-2 text-xs"
      >
        <StickyNote size={12} className="text-amber-600 shrink-0" />
        <span className={`text-amber-900 ${expanded ? "" : "truncate"}`}>
          {expanded ? (initialNotes || "") : preview}
          {!expanded && (initialNotes || "").length > 80 && "…"}
        </span>
        <ChevronDown size={11} className={`text-amber-700 ml-auto shrink-0 transition-transform ${expanded ? "rotate-180" : ""}`} />
      </button>
      {expanded && (
        <div className="flex items-center justify-between gap-2 pt-1.5 mt-1.5 border-t border-amber-200/60">
          {meta && (
            <span className="text-[10px] text-amber-700/80">{meta}</span>
          )}
          <button
            onClick={() => setEditing(true)}
            className="text-[11px] text-amber-700 hover:text-amber-900 inline-flex items-center gap-1 ml-auto"
          >
            <Edit3 size={10} /> Bearbeiten
          </button>
        </div>
      )}
    </div>
  );
}
