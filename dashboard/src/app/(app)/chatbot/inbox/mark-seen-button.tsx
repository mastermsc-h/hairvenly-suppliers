"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import { markSessionAsSeen } from "@/lib/actions/chat-inbox";

/**
 * Kleiner Icon-Button für Inbox-Zeilen wo die Kundin zuletzt geschrieben hat:
 * Markiert die Session manuell als gesehen/erledigt (z.B. wenn sie nur "Danke!"
 * geschrieben hat und keine Antwort nötig ist). Die Session verschwindet dadurch
 * aus dem "Nur unbeantwortet"-Filter, ohne den Status zu verändern.
 */
export default function MarkSeenButton({ sessionId }: { sessionId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    setBusy(true);
    startTransition(async () => {
      try {
        await markSessionAsSeen(sessionId);
        router.refresh();
      } finally {
        setBusy(false);
      }
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy || pending}
      title="Als erledigt markieren — Session verschwindet aus 'Nur unbeantwortet' (z.B. wenn die Kundin nur 'Danke!' geschrieben hat)"
      className="p-1.5 rounded-md text-neutral-400 hover:text-emerald-600 hover:bg-emerald-50 transition disabled:opacity-40"
    >
      <Check size={14} />
    </button>
  );
}
