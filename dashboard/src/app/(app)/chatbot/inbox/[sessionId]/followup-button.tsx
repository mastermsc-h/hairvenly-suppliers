"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bell, X, ChevronDown } from "lucide-react";
import { setFollowupReminder } from "@/lib/actions/chat-inbox";

/**
 * Markiert eine Session zur späteren Wiedervorlage. Optional mit Notiz
 * (z.B. "fragen ob gekauft" / "noch Bedenken klären"). Zeigt sich danach
 * unter /chatbot/follow-ups und als Badge in der Inbox.
 */
export default function FollowupButton({
  sessionId,
  initialDueAt,
}: {
  sessionId: string;
  initialDueAt?: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState("");
  const [, startTransition] = useTransition();

  const isFlagged = !!initialDueAt;
  const dueDate = initialDueAt ? new Date(initialDueAt) : null;
  const daysOptions = [
    { days: 1, label: "Morgen" },
    { days: 3, label: "In 3 Tagen" },
    { days: 7, label: "In 1 Woche" },
    { days: 14, label: "In 2 Wochen" },
    { days: 30, label: "In 1 Monat" },
  ];

  async function apply(days: number) {
    if (busy) return;
    setBusy(true);
    startTransition(async () => {
      try {
        await setFollowupReminder(sessionId, days, days > 0 ? reason : undefined);
        setOpen(false);
        setReason("");
        router.refresh();
      } finally {
        setBusy(false);
      }
    });
  }

  return (
    <div className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        disabled={busy}
        title={isFlagged
          ? `Follow-Up fällig am ${dueDate?.toLocaleDateString("de-DE")}`
          : "Session zur späteren Wiedervorlage markieren"}
        className={`text-xs px-3 py-1.5 rounded-lg border inline-flex items-center gap-1 disabled:opacity-50 ${
          isFlagged
            ? "bg-violet-600 text-white border-violet-600 hover:bg-violet-700"
            : "border-violet-200 text-violet-700 hover:bg-violet-50 hover:border-violet-300"
        }`}
      >
        <Bell size={12} />
        {isFlagged ? `Follow-Up: ${dueDate?.toLocaleDateString("de-DE")}` : "Follow-Up"}
        <ChevronDown size={11} className={open ? "rotate-180" : ""} />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div
            className="absolute left-0 top-full mt-1 z-20 w-72 bg-white border border-neutral-200 rounded-xl shadow-xl p-3 space-y-2"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-xs font-semibold text-neutral-700">Wann erinnern?</div>
            {daysOptions.map(opt => (
              <button
                key={opt.days}
                onClick={() => apply(opt.days)}
                disabled={busy}
                className="w-full text-left text-xs px-2.5 py-1.5 rounded-md hover:bg-violet-50 text-neutral-700 inline-flex items-center gap-2 disabled:opacity-50"
              >
                <Bell size={11} className="text-violet-500" />
                {opt.label}
                <span className="ml-auto text-neutral-400 text-[10px]">
                  ({new Date(Date.now() + opt.days * 86400 * 1000).toLocaleDateString("de-DE")})
                </span>
              </button>
            ))}
            <div className="pt-2 border-t border-neutral-100">
              <label className="text-[10px] font-medium text-neutral-500 uppercase tracking-wide">
                Notiz (optional)
              </label>
              <input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="z.B. fragen ob gekauft / Bedenken?"
                className="mt-1 w-full rounded-md border border-neutral-300 px-2 py-1.5 text-xs focus:ring-2 focus:ring-violet-400 focus:outline-none"
              />
            </div>
            {isFlagged && (
              <div className="pt-2 border-t border-neutral-100">
                <button
                  onClick={() => apply(0)}
                  disabled={busy}
                  className="w-full text-left text-xs px-2.5 py-1.5 rounded-md hover:bg-red-50 text-red-600 inline-flex items-center gap-2 disabled:opacity-50"
                >
                  <X size={11} />
                  Follow-Up entfernen
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
