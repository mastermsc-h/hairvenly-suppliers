"use client";

import { useState, useEffect } from "react";
import { ChevronDown } from "lucide-react";

/**
 * Wrapper, der den Lieferanten-Card-Inhalt einklappbar macht.
 * Header (children[0]) bleibt immer sichtbar, Body (children[1]) wird ein-/ausgeklappt.
 * Default: aufgeklappt. Status persistiert in localStorage pro Lieferant.
 */
export default function SupplierCard({
  supplierId,
  header,
  body,
  footer,
}: {
  supplierId: string;
  header: React.ReactNode;
  body: React.ReactNode;
  footer?: React.ReactNode;
}) {
  // Start both SSR and initial client render with the same value to avoid
  // hydration mismatches, then read the persisted state on mount.
  const [open, setOpen] = useState(true);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    try {
      const v = window.localStorage.getItem(`supplier-card:${supplierId}`);
      if (v !== null) setOpen(v === "1");
    } catch {}
    setHydrated(true);
  }, [supplierId]);

  function toggle() {
    setOpen((v) => {
      const next = !v;
      try {
        window.localStorage.setItem(`supplier-card:${supplierId}`, next ? "1" : "0");
      } catch {}
      return next;
    });
  }

  return (
    <div className="bg-white rounded-2xl border border-neutral-200 overflow-hidden shadow-sm">
      <div className="flex items-stretch">
        <button
          onClick={toggle}
          suppressHydrationWarning
          aria-label={hydrated ? (open ? "Einklappen" : "Ausklappen") : undefined}
          className="px-2 text-neutral-400 hover:text-neutral-900 hover:bg-neutral-50 transition flex items-center"
        >
          <ChevronDown
            size={18}
            className={`transition-transform ${open ? "" : "-rotate-90"}`}
          />
        </button>
        <div className="flex-1 min-w-0">{header}</div>
      </div>
      {open && (
        <div>
          {body}
          {footer}
        </div>
      )}
    </div>
  );
}
