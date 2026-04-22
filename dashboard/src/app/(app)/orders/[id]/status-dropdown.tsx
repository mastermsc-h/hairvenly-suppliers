"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { ChevronDown, Check } from "lucide-react";
import { updateOrder } from "@/lib/actions/orders";
import { t, type Locale } from "@/lib/i18n";

const STATUSES = [
  "draft",
  "sent_to_supplier",
  "confirmed",
  "in_production",
  "ready_to_ship",
  "shipped",
  "in_customs",
  "delivered",
  "cancelled",
] as const;

const STATUS_COLORS: Record<string, { bg: string; text: string; dot: string }> = {
  draft:            { bg: "bg-neutral-100", text: "text-neutral-700", dot: "bg-neutral-400" },
  sent_to_supplier: { bg: "bg-blue-50",    text: "text-blue-700",    dot: "bg-blue-400" },
  confirmed:        { bg: "bg-indigo-50",  text: "text-indigo-700",  dot: "bg-indigo-400" },
  in_production:    { bg: "bg-amber-50",   text: "text-amber-700",   dot: "bg-amber-400" },
  ready_to_ship:    { bg: "bg-orange-50",  text: "text-orange-700",  dot: "bg-orange-400" },
  shipped:          { bg: "bg-cyan-50",    text: "text-cyan-700",    dot: "bg-cyan-400" },
  in_customs:       { bg: "bg-purple-50",  text: "text-purple-700",  dot: "bg-purple-400" },
  delivered:        { bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-400" },
  cancelled:        { bg: "bg-red-50",     text: "text-red-700",     dot: "bg-red-400" },
};

export default function StatusDropdown({ orderId, currentStatus, locale }: {
  orderId: string;
  currentStatus: string;
  locale: Locale;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleChange = (status: string) => {
    if (status === currentStatus) { setOpen(false); return; }
    setError(null);
    const fd = new FormData();
    fd.set("status", status);
    startTransition(async () => {
      const res = await updateOrder(orderId, fd);
      if (res?.error) {
        setError(res.error);
        // Keep dropdown open so user can see feedback
        setTimeout(() => setError(null), 4000);
      } else {
        setOpen(false);
      }
    });
  };

  const colors = STATUS_COLORS[currentStatus] ?? STATUS_COLORS.draft;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(!open); }}
        disabled={pending}
        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition ${colors.bg} ${colors.text} hover:opacity-80 disabled:opacity-50`}
      >
        <span className={`w-2 h-2 rounded-full ${colors.dot}`} />
        {pending ? "..." : t(locale, `order.status.${currentStatus}`)}
        <ChevronDown size={12} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div
          className="absolute right-0 top-full mt-1 z-50 bg-white border border-neutral-200 rounded-xl shadow-lg py-1 min-w-[200px]"
          onClick={(e) => e.stopPropagation()}
        >
          {STATUSES.map((status) => {
            const sc = STATUS_COLORS[status] ?? STATUS_COLORS.draft;
            const isCurrent = status === currentStatus;
            return (
              <button
                key={status}
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleChange(status); }}
                className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left hover:bg-neutral-50 transition ${isCurrent ? "font-semibold" : ""}`}
              >
                <span className={`w-2 h-2 rounded-full ${sc.dot}`} />
                <span className="flex-1">{t(locale, `order.status.${status}`)}</span>
                {isCurrent && <Check size={12} className="text-emerald-500" />}
              </button>
            );
          })}
          {error && (
            <div className="px-3 py-2 mt-1 border-t border-red-100 bg-red-50 text-[11px] text-red-700">
              {error}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
