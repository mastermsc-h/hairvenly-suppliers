"use client";

import { useState, useEffect } from "react";
import { FileText, Receipt, X } from "lucide-react";
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
  const proofNumber = new Map<string, number>();
  [...proofsRaw]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .forEach((d, i) => proofNumber.set(d.id, i + 1));
  const proofs = proofsRaw.map((d) => ({
    ...d,
    file_name: `${t(locale, "payment.number")} ${proofNumber.get(d.id)}`,
  }));

  const [preview, setPreview] = useState<{ url: string; title: string; isImage: boolean } | null>(null);

  return (
    <div className="flex flex-wrap gap-2 items-start">
      <div className="flex flex-col">
        <QuickGroup
          icon={<Receipt size={14} />}
          label={t(locale, "doc.open_invoice")}
          shortLabel={t(locale, "doc.invoice_short")}
          empty={t(locale, "doc.no_invoice")}
          docs={invoices}
          compact={compact}
          mode="open"
        />
        {!compact && invoices.length > 0 && (
          <div className="mt-1 text-[10px] text-neutral-400 max-w-[220px] truncate leading-tight">
            {invoices.map((d) => d.file_name).join(", ")}
          </div>
        )}
      </div>
      <QuickGroup
        icon={<FileText size={14} />}
        label={t(locale, "doc.open_proof")}
        shortLabel={t(locale, "doc.proof_short")}
        empty={t(locale, "doc.no_proof")}
        docs={proofs}
        compact={compact}
        mode="preview"
        onPreview={setPreview}
        titleOverride={
          paidTotal != null && paidTotal > 0
            ? `${t(locale, "doc.already_paid")}: ${fmtUsd(Number(paidTotal))}`
            : undefined
        }
      />

      {preview && (
        <Lightbox
          url={preview.url}
          title={preview.title}
          isImage={preview.isImage}
          onClose={() => setPreview(null)}
        />
      )}
    </div>
  );
}

function Lightbox({
  url,
  title,
  isImage,
  onClose,
}: {
  url: string;
  title: string;
  isImage: boolean;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  return (
    <div
      onClick={onClose}
      className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6 cursor-zoom-out"
    >
      <button
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        className="absolute top-4 right-4 text-white/80 hover:text-white p-2 z-10"
        aria-label="Close"
      >
        <X size={24} />
      </button>
      <div className="absolute top-4 left-6 text-white/90 text-sm font-medium">{title}</div>

      <div
        onClick={(e) => e.stopPropagation()}
        className="cursor-default max-w-full max-h-full flex items-center justify-center"
      >
        {isImage ? (
          /* eslint-disable-next-line @next/next/no-img-element */
          <img
            src={url}
            alt={title}
            className="max-w-full max-h-[85vh] object-contain rounded-lg shadow-2xl"
          />
        ) : (
          <iframe
            src={url}
            title={title}
            className="w-[90vw] h-[85vh] max-w-5xl rounded-lg shadow-2xl bg-white"
          />
        )}
      </div>
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
  mode = "open",
  onPreview,
}: {
  icon: React.ReactNode;
  label: string;
  shortLabel: string;
  empty: string;
  docs: OrderDocument[];
  compact: boolean;
  titleOverride?: string;
  mode?: "open" | "preview";
  onPreview?: (p: { url: string; title: string; isImage: boolean }) => void;
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

  function isImagePath(path: string) {
    return /\.(png|jpe?g|gif|webp|svg|bmp|heic|heif)$/i.test(path);
  }

  async function handleClick(e: React.MouseEvent, doc: OrderDocument) {
    e.stopPropagation();
    e.preventDefault();
    setLoading(true);
    const url = await getSignedUrl(doc.file_path);
    setLoading(false);
    if (!url) return;

    if (mode === "preview" && onPreview) {
      onPreview({ url, title: doc.file_name, isImage: isImagePath(doc.file_path) });
    } else {
      window.open(url, "_blank", "noopener,noreferrer");
    }
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
          onClick={(e) => handleClick(e, docs[0])}
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
            onClick={(e) => handleClick(e, d)}
            className="block w-full text-left px-3 py-1.5 text-xs text-neutral-700 hover:bg-neutral-50 truncate"
          >
            {d.file_name}
          </button>
        ))}
      </div>
    </details>
  );
}
