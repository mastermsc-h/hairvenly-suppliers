"use client";

import { useState, useTransition } from "react";
import { Save, Loader2 } from "lucide-react";
import { savePackSessionNotes } from "@/lib/actions/pack";
import { t, type Locale } from "@/lib/i18n";

export default function NotesEditor({
  sessionId,
  initialNotes,
  locale,
}: {
  sessionId: string;
  initialNotes: string;
  locale: Locale;
}) {
  const [notes, setNotes] = useState(initialNotes);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function handleSave() {
    startTransition(async () => {
      const r = await savePackSessionNotes(sessionId, notes);
      if (r.success) {
        setSavedMsg(t(locale, "shipping.archive_notes_saved"));
        setTimeout(() => setSavedMsg(null), 2000);
      } else {
        setSavedMsg(`Fehler: ${r.error ?? "unbekannt"}`);
      }
    });
  }

  return (
    <div>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder={t(locale, "shipping.archive_notes_placeholder")}
        rows={3}
        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
      />
      <div className="flex items-center gap-3 mt-2">
        <button
          onClick={handleSave}
          disabled={pending || notes === initialNotes}
          className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-neutral-900 text-white text-xs font-medium hover:bg-neutral-700 transition disabled:opacity-50"
        >
          {pending ? <Loader2 className="animate-spin" size={12} /> : <Save size={12} />}
          {t(locale, "shipping.archive_notes_save")}
        </button>
        {savedMsg && <span className="text-xs text-emerald-700">{savedMsg}</span>}
      </div>
    </div>
  );
}
