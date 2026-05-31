"use client";

import { useEffect, useState, useRef } from "react";

/**
 * Polling-Badge für Chat-Inbox am Sub-Item.
 *
 * Zeigt die "Zu tun"-Annäherung — analog zum Tab-Filter in der Inbox.
 * Dadurch ist Sidebar-Zahl visuell konsistent mit dem Tab.
 *
 * Anzeige-Modi:
 *   - Neutrale Pille (grau): todo_approx > 0, awaiting_human = 0
 *     "12 offene Sessions im Zu-tun-Tab"
 *   - Rote pulsierende Pille: awaiting_human > 0
 *     Eskalation (überlagert die neutrale Anzeige)
 *
 * Browser-Notification bleibt unverändert (escalation + customer-reply).
 */
export default function ChatbotInboxBadge() {
  const [awaiting, setAwaiting] = useState(0);
  const [unreadInAwaiting, setUnreadInAwaiting] = useState(0);
  const [todoApprox, setTodoApprox] = useState(0);
  const lastAwaiting = useRef<number | null>(null);
  const lastUnread = useRef<number | null>(null);
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
        const todo = data.todo_approx || 0;
        setAwaiting(a);
        setUnreadInAwaiting(u);
        setTodoApprox(todo);

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

  // User-Wunsch 2026-05-30: NUR die Zu-tun-Zahl, KEINE Pulsierung
  // (pulsierend macht nervös). Eskalations-Subset wird nur im Tooltip
  // erwähnt. Wenn todoApprox=0 → kein Badge (auch wenn awaiting>0,
  // weil awaiting eigentlich Untermenge von todo sein sollte; falls
  // doch nicht: lieber kein Badge als verwirrender Mini-Counter).
  if (todoApprox === 0) return null;

  const tooltipParts: string[] = [
    `${todoApprox} offene Session${todoApprox === 1 ? "" : "s"} im Zu-tun-Tab (Drafts + Ungelesen + B2B-Warning)`,
  ];
  if (awaiting > 0) {
    tooltipParts.push(`davon ${awaiting} Eskalation${awaiting === 1 ? "" : "en"}`);
  }
  if (unreadInAwaiting > 0 && unreadInAwaiting !== awaiting) {
    tooltipParts.push(`+ ${unreadInAwaiting} ungelesene Kunden-Msg in awaiting-Sessions`);
  }

  return (
    <span
      className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1.5 rounded-full bg-neutral-200 text-neutral-700 text-[10px] font-semibold"
      title={tooltipParts.join(" · ")}
    >
      {todoApprox}
    </span>
  );
}
