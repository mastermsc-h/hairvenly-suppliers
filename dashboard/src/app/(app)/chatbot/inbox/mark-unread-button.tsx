"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { MailOpen, Mail } from "lucide-react";
import { markSessionUnread } from "@/lib/actions/chat-inbox";

/**
 * Kleiner Icon-Button (z.B. in Inbox-Zeile oder Session-Header):
 * Setzt last_seen_by_agent_at = null, sodass die Session wieder als
 * "ungelesen" (pinker Strich + NEU-Badge) angezeigt wird.
 */
export default function MarkUnreadButton({
  sessionId,
  variant = "icon",
}: {
  sessionId: string;
  variant?: "icon" | "labeled";
}) {
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
        await markSessionUnread(sessionId);
        router.refresh();
      } finally {
        setBusy(false);
      }
    });
  }

  if (variant === "icon") {
    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={busy || pending}
        title="Als ungelesen markieren"
        className="p-1.5 rounded-md text-neutral-400 hover:text-pink-600 hover:bg-pink-50 transition disabled:opacity-40"
      >
        <Mail size={14} />
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={busy || pending}
      title="Setzt diese Session wieder auf 'ungelesen' — sie erscheint dann mit pinkem Strich in der Inbox"
      className="text-xs px-3 py-1.5 rounded-lg border border-neutral-300 text-neutral-600 hover:bg-pink-50 hover:text-pink-700 hover:border-pink-300 inline-flex items-center gap-1 disabled:opacity-50"
    >
      <MailOpen size={12} /> Als ungelesen
    </button>
  );
}
