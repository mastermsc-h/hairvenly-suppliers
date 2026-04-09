"use client";

import { useState } from "react";
import { FileText, Receipt } from "lucide-react";
import { getSignedUrl } from "@/lib/actions/orders";
import type { OrderDocument } from "@/lib/types";
import { t, type Locale } from "@/lib/i18n";

const fmtUsd = (n: number) =>
  new Intl.NumberFormat("de-DE", { style: "currency", currency: "USD" }).format(n);

export default function QuickDocs({
  documents,
  compact = false,
  paidTotal,
  locale = "de",
}: {
  documents: OrderDocument[];
  compact?: boolean;
  paidTotal?: number | null;
  locale?: Locale;
}) {
  const invoices = documents.filter((d) => d.kind === "supplier_invoice");
  const proofsRaw = documents.filter((d) => d.kind === "payment_proof");
  // Nummerierung in chronologischer Reihenfolge (älteste = Zahlung 1)
  const proofNumber = new Map<string, number>();
  [...proofsRaw]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .forEach((d, i) => proofNumber.set(d.id, i + 1));
  const proofs = proofsRaw.map((d) => ({
    ...d,
    file_name: `${t(locale, "payment.number")} ${proofNumber.get(d.id)}`,
  }));

  return (
    <div className="flex flex-wrap gap-2 items-start">
      <div className="flex flex-col">
        <QuickGroup
          icon={<Receipt size={compact ? 14 : 14} />}
          label={t(locale, "doc.open_invoice")}
          shortLabel={t(locale, "doc.invoice_short")}
          empty={t(locale, "doc.no_invoice")}
          docs={invoices}
          compact={compact}
        />
        {!compact && invoices.length > 0 && (
          <div className="mt-1 text-[10px] text-neutral-400 max-w-[220px] truncate leading-tight">
            {invoices.map((d) => d.file_name).join(", ")}
          </div>
        )}
      </div>
      <QuickGroup
        icon={<FileText size={compact ? 14 : 14} />}
        label={t(locale, "doc.open_proof")}
        shortLabel={t(locale, "doc.proof_short")}
        empty={t(locale, "doc.no_proof")}
        docs={proofs}
        compact={compact}
        titleOverride={
          paidTotal != null && paidTotal > 0
            ? `${t(locale, "doc.already_paid")}: ${fmtUsd(Number(paidTotal))}`
            : undefined
        }
      />
    </div>
  );
}

function QuickGroup({
  icon,
  label,
  shortLabel,
  empty,
  docs,
  compact,
  titleOverride,
}: {
  icon: React.ReactNode;
  label: string;
  shortLabel: string;
  empty: string;
  docs: OrderDocument[];
  compact: boolean;
  titleOverride?: string;
}) {
  const tooltip = titleOverride ?? label;
  const [loading, setLoading] = useState(false);

  const baseClass = compact
    ? "inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs"
    : "inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium";

  if (docs.length === 0) {
    if (compact) return null;
    return (
      <span
        className={`${baseClass} border border-dashed border-neutral-300 text-neutral-400`}
      >
        {icon} {empty}
      </span>
    );
  }

  async function openOne(e: React.MouseEvent, path: string) {
    e.stopPropagation();
    e.preventDefault();
    setLoading(true);
    const url = await getSignedUrl(path);
    setLoading(false);
    if (url) window.open(url, "_blank", "noopener,noreferrer");
  }

  const tooltipEl = titleOverride ? (
    <span
      className="pointer-events-none absolute left-1/2 -translate-x-1/2 -top-8 whitespace-nowrap rounded-md bg-neutral-900 text-white text-[11px] font-medium px-2 py-1 shadow-lg opacity-0 group-hover:opacity-100 transition-opacity duration-75 z-20"
    >
      {titleOverride}
    </span>
  ) : null;

  if (docs.length === 1) {
    return (
      <span className="relative group inline-flex">
        <button
          onClick={(e) => openOne(e, docs[0].file_path)}
          disabled={loading}
          title={titleOverride ? undefined : tooltip}
          className={`${baseClass} bg-white border border-neutral-300 text-neutral-700 hover:bg-neutral-50 disabled:opacity-50`}
        >
          {icon} {compact ? shortLabel : label}
        </button>
        {tooltipEl}
      </span>
    );
  }

  return (
    <details className="relative group" onClick={(e) => e.stopPropagation()}>
      <summary
        title={titleOverride ? undefined : tooltip}
        className={`list-none cursor-pointer ${baseClass} bg-white border border-neutral-300 text-neutral-700 hover:bg-neutral-50`}
      >
        {icon} {compact ? shortLabel : label} ({docs.length})
      </summary>
      {tooltipEl}
      <div className="absolute z-10 mt-1 bg-white border border-neutral-200 rounded-lg shadow-sm min-w-56 py-1">
        {docs.map((d) => (
          <button
            key={d.id}
            onClick={(e) => openOne(e, d.file_path)}
            className="block w-full text-left px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50 truncate"
          >
            {d.file_name}
          </button>
        ))}
      </div>
    </details>
  );
}
