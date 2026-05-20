"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Undo2 } from "lucide-react";
import { markSessionAsNotDone } from "@/lib/actions/chat-inbox";

/**
 * Inbox-Hover-Button: holt eine als-erledigt-markierte Session zurück in den
 * "Nur unbeantwortet"-Filter. Setzt last_seen_by_agent_at auf Sentinel (1970),
 * sodass die Filter-Logik die Session unabhängig vom ourTurn-Status reinholt.
 * last_opened_by_agent_at (= Bold-Optik) bleibt unangetastet.
 */
export default function MarkNotDoneButton({ sessionId }: { sessionId: string }) {
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
        await markSessionAsNotDone(sessionId);
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
      title="Wieder auf 'Nicht erledigt' setzen — Session erscheint dann im 'Nur unbeantwortet'-Filter"
      className="p-1.5 rounded-md text-neutral-400 hover:text-amber-600 hover:bg-amber-50 transition disabled:opacity-40"
    >
      <Undo2 size={14} />
    </button>
  );
}
