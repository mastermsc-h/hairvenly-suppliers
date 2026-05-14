"use client";

import { useEffect, useState, useRef } from "react";

/**
 * Polling-Badge für Eskalations-Counter.
 * Zeigt rote Pille mit Anzahl `awaiting_human` Sessions.
 * Browser-Notification wenn Anzahl steigt.
 */
export default function ChatbotInboxBadge() {
  const [awaiting, setAwaiting] = useState(0);
  const [unread, setUnread]     = useState(0);
  const lastAwaiting = useRef<number | null>(null);
  const lastUnread   = useRef<number | null>(null);
  const permissionRequested = useRef(false);

  useEffect(() => {
    if (!permissionRequested.current && "Notification" in window && Notification.permission === "default") {
      permissionRequested.current = true;
      Notification.requestPermission().catch(() => {});
    }

    const poll = async () => {
      try {
        const res = await fetch("/api/chat/inbox-stats");
        if (!res.ok) return;
        const data = await res.json();
        const a = data.awaiting_human || 0;
        const u = data.unread_customer_msgs || 0;
        setAwaiting(a);
        setUnread(u);

        const canNotify = "Notification" in window && Notification.permission === "granted";

        // Neue Eskalation
        if (lastAwaiting.current !== null && a > lastAwaiting.current && canNotify) {
          new Notification("Neue Eskalation im Chatbot", {
            body: `${a} Chat${a === 1 ? "" : "s"} warten auf Mitarbeiter-Übernahme`,
            icon: "/favicon.ico",
            tag: "chatbot-escalation",
          });
        }
        // Neue Kundennachricht in awaiting_human Session
        if (lastUnread.current !== null && u > lastUnread.current && canNotify) {
          new Notification("Kunde hat geantwortet", {
            body: `${u} Chat${u === 1 ? " hat" : "s haben"} neue Kundennachrichten`,
            icon: "/favicon.ico",
            tag: "chatbot-customer-reply",
          });
        }
        lastAwaiting.current = a;
        lastUnread.current = u;
      } catch {}
    };

    poll();
    const interval = setInterval(poll, 20000);
    return () => clearInterval(interval);
  }, []);

  const total = awaiting;
  if (total === 0) return null;

  return (
    <span
      className="ml-auto inline-flex items-center gap-1 px-1.5 h-[18px] rounded-full bg-red-600 text-white text-[10px] font-bold animate-pulse"
      title={`${awaiting} warten · ${unread} ungelesene Kundennachrichten`}
    >
      {total}
      {unread > 0 && <span className="opacity-80">·{unread}</span>}
    </span>
  );
}
