"use client";

import type { ReactNode } from "react";

// Gemeinsame, moderne Bausteine für den Mitarbeiter-Bereich:
// Karten mit farbigem Header-Streifen (Icon-Chip) → klare Abtrennungen.

export type Tint =
  | "neutral" | "indigo" | "sky" | "emerald" | "amber" | "rose" | "violet" | "fuchsia";

const TINT_CHIP: Record<Tint, string> = {
  neutral: "bg-neutral-100 text-neutral-600",
  indigo: "bg-indigo-100 text-indigo-600",
  sky: "bg-sky-100 text-sky-600",
  emerald: "bg-emerald-100 text-emerald-600",
  amber: "bg-amber-100 text-amber-700",
  rose: "bg-rose-100 text-rose-600",
  violet: "bg-violet-100 text-violet-600",
  fuchsia: "bg-fuchsia-100 text-fuchsia-600",
};

const TINT_HEAD: Record<Tint, string> = {
  neutral: "from-neutral-50",
  indigo: "from-indigo-50/70",
  sky: "from-sky-50/70",
  emerald: "from-emerald-50/70",
  amber: "from-amber-50/70",
  rose: "from-rose-50/70",
  violet: "from-violet-50/70",
  fuchsia: "from-fuchsia-50/70",
};

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-neutral-200/80 bg-white shadow-sm overflow-hidden ${className}`}>
      {children}
    </div>
  );
}

export function CardHead({
  icon, title, tint = "neutral", sub, right, onClick, chevron,
}: {
  icon: ReactNode;
  title: ReactNode;
  tint?: Tint;
  sub?: ReactNode;
  right?: ReactNode;
  onClick?: () => void;
  chevron?: boolean | null; // true = aufgeklappt, false = zu, null/undefined = kein Chevron
}) {
  const inner = (
    <>
      <div className="flex items-center gap-2.5 min-w-0">
        <span className={`h-7 w-7 shrink-0 rounded-lg grid place-items-center ${TINT_CHIP[tint]}`}>{icon}</span>
        <div className="min-w-0 text-left">
          <div className="text-sm font-semibold text-neutral-800 truncate">{title}</div>
          {sub && <div className="text-[11px] text-neutral-400 truncate">{sub}</div>}
        </div>
      </div>
      <div className="flex items-center gap-2">
        {right}
        {chevron != null && (
          <svg className={`h-4 w-4 text-neutral-400 transition-transform ${chevron ? "rotate-180" : ""}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m6 9 6 6 6-6" /></svg>
        )}
      </div>
    </>
  );
  const cls = `w-full flex items-center justify-between gap-3 px-4 md:px-5 py-3 border-b border-neutral-100 bg-gradient-to-b ${TINT_HEAD[tint]} to-white`;
  return onClick ? (
    <button type="button" onClick={onClick} className={cls}>{inner}</button>
  ) : (
    <div className={cls}>{inner}</div>
  );
}

/** Kleines Label/Wert-Kästchen für Kennzahlen. */
export function Metric({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-neutral-400">{label}</div>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}
