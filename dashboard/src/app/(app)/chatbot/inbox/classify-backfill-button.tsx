"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Sparkles } from "lucide-react";

/**
 * Auto-Klassifikation im Hintergrund: feuert einmal pro Inbox-Mount eine Runde
 * Backfill (max 30 Sessions) — wird in der Statuszeile dezent angezeigt.
 * Webhook klassifiziert NEUE Messages sofort, dieser Auto-Run holt nur Bestände
 * ohne Kategorie nach. Idempotent — wenn nichts zu tun ist, kommt sofort 0 zurück.
 */
export default function ClassifyBackfillButton() {
  const router = useRouter();
  const [status, setStatus] = useState<string | null>(null);
  const fired = useRef(false);

  useEffect(() => {
    if (fired.current) return;
    fired.current = true;
    (async () => {
      try {
        const res = await fetch("/api/chatbot/classify-backfill?limit=30", { method: "POST" });
        if (!res.ok) return;
        const data = await res.json();
        const classified = data.classified || 0;
        if (classified > 0) {
          setStatus(`${classified} neu klassifiziert`);
          router.refresh();
          // Indikator nach ein paar Sekunden ausblenden
          setTimeout(() => setStatus(null), 4000);
        }
      } catch {
        // silent — die Klassifikation darf nicht den Inbox-Render stören
      }
    })();
  }, [router]);

  if (!status) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[11px] text-neutral-500">
      <Sparkles size={10} className="text-purple-500" />
      {status}
    </span>
  );
}
