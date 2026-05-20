"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { StickyNote, Save, X, Edit3 } from "lucide-react";
import { updateTeamNotes } from "@/lib/actions/chat-inbox";

/**
 * Interne Team-Notizen pro Session. Nicht an Kundin gesendet.
 * Sichtbar für alle Mitarbeiterinnen, dient als gemeinsames Gedächtnis
 * ("warum noch nicht beantwortet", "noch zu klären mit Lager", etc.).
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

  return (
    <div className={`rounded-xl border ${
      hasNotes ? "border-amber-200 bg-amber-50/50" : "border-neutral-200 bg-neutral-50/50"
    } p-3 space-y-2`}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <StickyNote size={14} className={hasNotes ? "text-amber-700" : "text-neutral-500"} />
          <span className={`text-xs font-semibold uppercase tracking-wide ${
            hasNotes ? "text-amber-800" : "text-neutral-600"
          }`}>
            Team-Notiz (intern)
          </span>
        </div>
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            className="text-[11px] text-neutral-500 hover:text-neutral-900 inline-flex items-center gap-1"
          >
            <Edit3 size={11} /> {hasNotes ? "Bearbeiten" : "Notiz hinzufügen"}
          </button>
        )}
      </div>

      {editing ? (
        <>
          <textarea
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="z.B. 'Warte noch auf Rückmeldung von Aria wegen Lieferzeit' oder 'Kundin kommt Donnerstag in den Salon'"
            rows={3}
            autoFocus
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-amber-400 focus:outline-none resize-none"
          />
          <div className="flex items-center justify-end gap-1.5">
            <button
              onClick={handleCancel}
              disabled={saving}
              className="text-xs px-3 py-1.5 rounded-lg border border-neutral-300 text-neutral-600 hover:bg-neutral-50 inline-flex items-center gap-1 disabled:opacity-50"
            >
              <X size={11} /> Abbrechen
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="text-xs px-3 py-1.5 rounded-lg bg-amber-600 text-white hover:bg-amber-700 inline-flex items-center gap-1 disabled:opacity-50"
            >
              <Save size={11} /> {saving ? "Speichere…" : "Speichern"}
            </button>
          </div>
        </>
      ) : hasNotes ? (
        <>
          <p className="text-sm text-amber-900 whitespace-pre-wrap leading-relaxed">{initialNotes}</p>
          {(author || updatedAt) && (
            <div className="flex items-center justify-end gap-1 text-[10px] text-amber-700/80 pt-1 border-t border-amber-200/60">
              {author && <span className="font-medium">{author}</span>}
              {author && updatedAt && <span className="text-amber-500">·</span>}
              {updatedAt && (
                <span>
                  {new Date(updatedAt).toLocaleString("de-DE", {
                    day: "2-digit", month: "2-digit", year: "2-digit",
                    hour: "2-digit", minute: "2-digit",
                  })}
                </span>
              )}
            </div>
          )}
        </>
      ) : (
        <p className="text-xs text-neutral-500 italic">
          Noch keine Notiz. Hier kannst du intern festhalten, warum diese Session offen ist
          oder was mit dem Team zu besprechen ist.
        </p>
      )}
    </div>
  );
}
