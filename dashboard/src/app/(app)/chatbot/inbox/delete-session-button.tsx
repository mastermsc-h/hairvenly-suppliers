"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";
import { deleteSession } from "@/lib/actions/chat-inbox";

/**
 * Kleiner Icon-Button für die Inbox-Liste: löscht die Session komplett
 * (z.B. Spam, versehentlich angelegt, Test-Sessions).
 *
 * Zweistufige Bestätigung — erster Klick öffnet confirm-Dialog, weil
 * Session-Löschung NICHT rückgängig zu machen ist (alle Messages weg).
 *
 * Positioniert sich unten-rechts in der Session-Card, halbtransparent
 * bis Hover — damit kein versehentliches Klicken passiert, aber bei
 * Spam-Sweep schnell erreichbar.
 */
export default function DeleteSessionButton({
  sessionId,
  customerName,
}: {
  sessionId: string;
  customerName?: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [pending, startTransition] = useTransition();

  function handleClick(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    const label = customerName ? `Session mit „${customerName}"` : "diese Session";
    if (!confirm(`${label} komplett löschen?\n\nAlle Nachrichten gehen verloren — kann nicht rückgängig gemacht werden.`)) {
      return;
    }
    setBusy(true);
    startTransition(async () => {
      try {
        await deleteSession(sessionId);
        router.refresh();
      } catch (e) {
        alert(`Löschen fehlgeschlagen: ${(e as Error).message}`);
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
      title="Session komplett löschen (z.B. Spam)"
      aria-label="Session löschen"
      className="p-1.5 rounded-md text-neutral-300 hover:text-red-600 hover:bg-red-50 transition disabled:opacity-40"
    >
      <Trash2 size={13} />
    </button>
  );
}
