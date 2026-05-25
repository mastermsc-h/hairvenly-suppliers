"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronUp, Loader2 } from "lucide-react";

/**
 * "Ältere Nachrichten laden"-Button — oberhalb des Message-Verlaufs.
 *
 * Klick triggert /api/chatbot/sync-instagram-session, holt die nächsten
 * 50 älteren Messages aus IG, fügt sie in chat_messages ein und refresht
 * die Seite. Mehrfach klickbar — Pagination via Server gecachte paging-URL.
 *
 * Sichtbar nur für Instagram-Sessions (channel === "instagram").
 */
export default function LoadOlderMessagesButton({
  sessionId,
  channel,
}: {
  sessionId: string;
  channel: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [info, setInfo] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(false);

  if (channel !== "instagram") return null; // WhatsApp folgt später

  async function handle() {
    if (busy || exhausted) return;
    setBusy(true);
    setInfo(null);
    try {
      const res = await fetch("/api/chatbot/sync-instagram-session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setInfo(`❌ ${data.error || "Fehler"}${data.details ? `: ${data.details}` : ""}`);
        return;
      }
      const n = data.messages_created || 0;
      if (n === 0 && !data.has_more) {
        setInfo("Keine älteren Nachrichten mehr auf Instagram.");
        setExhausted(true);
      } else if (n === 0) {
        setInfo("Keine neuen Nachrichten — alle waren schon im Dashboard.");
      } else {
        setInfo(`✓ ${n} ältere Nachricht${n === 1 ? "" : "en"} nachgeladen.${data.has_more ? "" : " (Conversation vollständig)"}`);
        if (!data.has_more) setExhausted(true);
        router.refresh();
      }
    } catch (e) {
      setInfo(`❌ ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-1 py-2">
      <button
        type="button"
        onClick={handle}
        disabled={busy || exhausted}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-full border border-neutral-200 bg-white hover:bg-neutral-50 hover:border-neutral-300 text-neutral-600 hover:text-neutral-900 transition disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
        title="Lädt die nächsten ~50 älteren Nachrichten aus dieser Instagram-Conversation"
      >
        {busy ? (
          <><Loader2 size={12} className="animate-spin" /> lade…</>
        ) : exhausted ? (
          <>Alle Nachrichten geladen</>
        ) : (
          <><ChevronUp size={12} /> Ältere Nachrichten von Instagram laden</>
        )}
      </button>
      {info && (
        <div className="text-[11px] text-neutral-500">{info}</div>
      )}
    </div>
  );
}
