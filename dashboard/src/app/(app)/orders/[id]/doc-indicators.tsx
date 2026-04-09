"use client";

import { useState } from "react";
import { getSignedUrl } from "@/lib/actions/orders";
import type { OrderDocument } from "@/lib/types";

/**
 * Grüne Status-Pills für Dokument-Typen, bei denen die einzelne Datei selten direkt
 * geöffnet werden muss (Zoll, Waybill). Zeigt nur an, dass etwas vorhanden ist.
 * Klick öffnet die erste Datei (oder ein kleines Dropdown bei mehreren).
 */
export default function DocIndicators({ documents }: { documents: OrderDocument[] }) {
  const customs = documents.filter((d) => d.kind === "customs_document");
  const waybills = documents.filter((d) => d.kind === "waybill");

  if (customs.length === 0 && waybills.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-1.5">
      {customs.length > 0 && <Pill label="Zoll" docs={customs} />}
      {waybills.length > 0 && <Pill label="Waybill" docs={waybills} />}
    </div>
  );
}

function Pill({ label, docs }: { label: string; docs: OrderDocument[] }) {
  const [loading, setLoading] = useState(false);

  async function open(e: React.MouseEvent, path: string) {
    e.stopPropagation();
    e.preventDefault();
    setLoading(true);
    const url = await getSignedUrl(path);
    setLoading(false);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }

  const baseClass =
    "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100";

  if (docs.length === 1) {
    return (
      <button
        onClick={(e) => open(e, docs[0].file_path)}
        disabled={loading}
        title={`${label} öffnen`}
        className={baseClass}
      >
        ✓ {label}
      </button>
    );
  }

  return (
    <details className="relative" onClick={(e) => e.stopPropagation()}>
      <summary className={`list-none cursor-pointer ${baseClass}`}>
        ✓ {label} ({docs.length})
      </summary>
      <div className="absolute z-10 mt-1 bg-white border border-neutral-200 rounded-lg shadow-sm min-w-56 py-1">
        {docs.map((d) => (
          <button
            key={d.id}
            onClick={(e) => open(e, d.file_path)}
            className="block w-full text-left px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50 truncate"
          >
            {d.file_name}
          </button>
        ))}
      </div>
    </details>
  );
}
