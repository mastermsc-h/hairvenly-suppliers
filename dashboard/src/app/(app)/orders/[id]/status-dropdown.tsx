"use client";

import { useState, useTransition, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
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
  "stocked",
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
  stocked:          { bg: "bg-teal-50",    text: "text-teal-700",    dot: "bg-teal-500" },
  cancelled:        { bg: "bg-red-50",     text: "text-red-700",     dot: "bg-red-400" },
};

const MENU_WIDTH = 220;
const MENU_HEIGHT = 380; // approx — used to decide flip up/down

export default function StatusDropdown({ orderId, currentStatus, locale }: {
  orderId: string;
  currentStatus: string;
  locale: Locale;
}) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [coords, setCoords] = useState<{ top: number; left: number; placement: "below" | "above" } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const recalc = useCallback(() => {
    const btn = buttonRef.current;
    if (!btn) return;
    const r = btn.getBoundingClientRect();
    const spaceBelow = window.innerHeight - r.bottom;
    const placement = spaceBelow < MENU_HEIGHT && r.top > MENU_HEIGHT ? "above" : "below";
    const top = placement === "below" ? r.bottom + 4 : r.top - 4;
    // Right-align menu under the button
    let left = r.right - MENU_WIDTH;
    if (left < 8) left = 8;
    if (left + MENU_WIDTH > window.innerWidth - 8) left = window.innerWidth - MENU_WIDTH - 8;
    setCoords({ top, left, placement });
  }, []);

  // Close on outside click + recalc on scroll/resize
  useEffect(() => {
    if (!open) return;
    recalc();
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (buttonRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", handler);
    document.addEventListener("keydown", onKey);
    window.addEventListener("scroll", recalc, true);
    window.addEventListener("resize", recalc);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", recalc, true);
      window.removeEventListener("resize", recalc);
    };
  }, [open, recalc]);

  const handleChange = (status: string) => {
    if (status === currentStatus) { setOpen(false); return; }
    setError(null);
    const fd = new FormData();
    fd.set("status", status);
    startTransition(async () => {
      const res = await updateOrder(orderId, fd);
      if (res?.error) {
        setError(res.error);
        setTimeout(() => setError(null), 4000);
      } else {
        setOpen(false);
      }
    });
  };

  const colors = STATUS_COLORS[currentStatus] ?? STATUS_COLORS.draft;

  const menu = open && coords && (
    <div
      ref={menuRef}
      onClick={(e) => e.stopPropagation()}
      style={{
        position: "fixed",
        top: coords.placement === "below" ? coords.top : undefined,
        bottom: coords.placement === "above" ? window.innerHeight - coords.top : undefined,
        left: coords.left,
        width: MENU_WIDTH,
        zIndex: 100,
      }}
      className="bg-white border border-neutral-200 rounded-xl shadow-lg py-1 max-h-[80vh] overflow-y-auto"
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
            <span className={`w-2 h-2 rounded-full ${sc.dot} shrink-0`} />
            <span className="flex-1 whitespace-nowrap">{t(locale, `order.status.${status}`)}</span>
            {isCurrent && <Check size={12} className="text-emerald-500 shrink-0" />}
          </button>
        );
      })}
      {error && (
        <div className="px-3 py-2 mt-1 border-t border-red-100 bg-red-50 text-[11px] text-red-700">
          {error}
        </div>
      )}
    </div>
  );

  return (
    <>
      <button
        ref={buttonRef}
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen((v) => !v); }}
        disabled={pending}
        className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium transition ${colors.bg} ${colors.text} hover:opacity-80 disabled:opacity-50`}
      >
        <span className={`w-2 h-2 rounded-full ${colors.dot}`} />
        {pending ? "..." : t(locale, `order.status.${currentStatus}`)}
        <ChevronDown size={12} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {mounted && menu ? createPortal(menu, document.body) : null}
    </>
  );
}
