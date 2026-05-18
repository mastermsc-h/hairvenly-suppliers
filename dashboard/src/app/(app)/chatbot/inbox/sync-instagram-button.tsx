"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";

export default function SyncInstagramButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  async function handle() {
    if (busy) return;
    if (!confirm("Instagram-DMs aus den letzten Conversations nachladen?\n\nKeine Bot-Antworten — nur Daten-Sync. Bestehende Nachrichten werden NICHT doppelt angelegt.")) return;
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/chatbot/sync-instagram?limit=100", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setResult(`❌ ${data.error || "Sync fehlgeschlagen"}: ${data.details || ""}`);
      } else {
        setResult(`✓ ${data.conversations_seen} Conversations · ${data.sessions_created} neue Sessions · ${data.messages_created} neue Nachrichten · ${data.messages_skipped} bereits da`);
        router.refresh();
      }
    } catch (e) {
      setResult(`❌ ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2 flex-wrap">
      <button
        onClick={handle}
        disabled={busy}
        title="Holt alle Instagram-Conversations + Messages aus der Graph API und legt fehlende in der DB an"
        className="inline-flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg border border-neutral-300 bg-white hover:bg-neutral-50 disabled:opacity-50"
      >
        <RefreshCw size={12} className={busy ? "animate-spin" : ""} />
        {busy ? "Synchronisiere…" : "Instagram-DMs synchronisieren"}
      </button>
      {result && (
        <span className="text-xs text-neutral-600">{result}</span>
      )}
    </div>
  );
}
