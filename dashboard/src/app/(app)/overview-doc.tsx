"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Image from "next/image";
import { FileText, Upload, X, Pencil, Eye, EyeOff } from "lucide-react";
import {
  uploadSupplierOverview,
  removeSupplierOverview,
  updateOverviewLabel,
  setOverviewVisibility,
} from "@/lib/actions/suppliers";

/**
 * Übersichts-Dokument eines Lieferanten (z.B. PDF/Bild der offenen Forderungen).
 * - Mini-Vorschau (Bild für Bilder, Icon für PDFs) + bearbeitbare Beschriftung
 * - Klick öffnet Lightbox (Bilder) oder neuen Tab (PDF)
 * - Admin: Upload, Beschriftung editieren, Sichtbarkeit für Lieferant toggeln, Löschen
 */
export default function OverviewDoc({
  supplierId,
  url,
  path,
  label,
  visibleToSupplier,
  isAdmin,
}: {
  supplierId: string;
  url: string | null;
  path: string | null;
  label: string | null;
  visibleToSupplier: boolean;
  isAdmin: boolean;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState(false);
  const [editing, setEditing] = useState(false);
  const [labelDraft, setLabelDraft] = useState(label ?? "");
  const fileRef = useRef<HTMLInputElement>(null);

  const isPdf = !!path && /\.pdf$/i.test(path);
  const isImage = !!path && /\.(png|jpe?g|gif|webp|svg|bmp|heic|heif)$/i.test(path);

  // Extract upload timestamp from path like "overview_xxx_1712345678901.ext"
  const updatedAt = (() => {
    if (!path) return null;
    const m = path.match(/_(\d{13})\./);
    if (!m) return null;
    const d = new Date(Number(m[1]));
    return d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" });
  })();

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setLightbox(false);
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [lightbox]);

  function onFileChange() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    start(async () => {
      const res = await uploadSupplierOverview(supplierId, fd);
      if (res?.error) setError(res.error);
      if (fileRef.current) fileRef.current.value = "";
    });
  }

  function open() {
    if (!url) return;
    if (isImage) setLightbox(true);
    else window.open(url, "_blank", "noopener,noreferrer");
  }

  function saveLabel() {
    start(async () => {
      await updateOverviewLabel(supplierId, labelDraft);
      setEditing(false);
    });
  }

  function toggleVisibility() {
    start(async () => {
      await setOverviewVisibility(supplierId, !visibleToSupplier);
    });
  }

  function remove() {
    start(async () => {
      await removeSupplierOverview(supplierId);
    });
  }

  // Empty State (Admin sieht Upload, Lieferant sieht nichts)
  if (!url) {
    if (!isAdmin) return null;
    return (
      <div className="flex items-center gap-2">
        <label className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium bg-white border border-dashed border-neutral-300 text-neutral-500 hover:bg-neutral-50 cursor-pointer">
          <Upload size={12} />
          {pending ? "Lade…" : "Übersicht hochladen"}
          <input
            ref={fileRef}
            type="file"
            accept="image/*,application/pdf"
            onChange={onFileChange}
            disabled={pending}
            className="hidden"
          />
        </label>
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2.5">
      {/* Vorschau */}
      <button
        onClick={open}
        title="Übersicht öffnen"
        className="relative w-11 h-11 rounded-lg overflow-hidden border border-neutral-200 hover:ring-2 hover:ring-neutral-900 transition shrink-0 bg-neutral-50 flex items-center justify-center"
      >
        {isImage && url ? (
          <Image src={url} alt="Übersicht" fill className="object-cover" unoptimized />
        ) : (
          <FileText size={20} className="text-neutral-500" />
        )}
      </button>

      {/* Beschriftung */}
      <div className="flex flex-col min-w-0">
        {editing && isAdmin ? (
          <div className="flex items-center gap-1">
            <input
              autoFocus
              value={labelDraft}
              onChange={(e) => setLabelDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") saveLabel();
                if (e.key === "Escape") {
                  setLabelDraft(label ?? "");
                  setEditing(false);
                }
              }}
              placeholder="z.B. Stand 8.4.26"
              className="text-xs px-2 py-1 rounded border border-neutral-300 w-32"
            />
            <button
              onClick={saveLabel}
              disabled={pending}
              className="text-xs text-neutral-900 font-medium px-1"
            >
              ✓
            </button>
          </div>
        ) : (
          <button
            onClick={() => isAdmin && setEditing(true)}
            className={`text-xs text-left truncate max-w-40 ${
              label ? "text-neutral-700" : "text-neutral-400 italic"
            } ${isAdmin ? "hover:text-neutral-900" : "cursor-default"}`}
            title={isAdmin ? "Beschriftung bearbeiten" : undefined}
          >
            {label || (isAdmin ? "Beschriftung +" : "Übersicht")}
          </button>
        )}

        {isAdmin && (
          <div className="flex items-center gap-1.5 mt-0.5">
            <label
              title="Ersetzen"
              className="text-[10px] text-neutral-400 hover:text-neutral-700 cursor-pointer"
            >
              ersetzen
              <input
                ref={fileRef}
                type="file"
                accept="image/*,application/pdf"
                onChange={onFileChange}
                disabled={pending}
                className="hidden"
              />
            </label>
            <span className="text-neutral-300 text-[10px]">·</span>
            <button
              onClick={toggleVisibility}
              title={
                visibleToSupplier
                  ? "Lieferant sieht das Dokument — klicken zum Ausblenden"
                  : "Für Lieferant ausgeblendet — klicken zum Einblenden"
              }
              className="text-[10px] text-neutral-400 hover:text-neutral-700 inline-flex items-center gap-0.5"
            >
              {visibleToSupplier ? <Eye size={10} /> : <EyeOff size={10} />}
              {visibleToSupplier ? "sichtbar" : "versteckt"}
            </button>
            <span className="text-neutral-300 text-[10px]">·</span>
            <button
              onClick={remove}
              title="Entfernen"
              className="text-[10px] text-neutral-400 hover:text-red-600"
            >
              löschen
            </button>
          </div>
        )}
        {updatedAt && (
          <div className="text-[9px] text-neutral-400 mt-0.5">
            Aktualisiert {updatedAt}
          </div>
        )}
      </div>

      {/* Lightbox für Bilder */}
      {lightbox && url && (
        <div
          onClick={() => setLightbox(false)}
          className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-6 cursor-zoom-out"
        >
          <button
            onClick={(e) => {
              e.stopPropagation();
              setLightbox(false);
            }}
            className="absolute top-4 right-4 text-white/80 hover:text-white p-2"
            aria-label="Schließen"
          >
            <X size={24} />
          </button>
          {label && (
            <div className="absolute top-4 left-6 text-white/90 text-sm font-medium">{label}</div>
          )}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={label ?? "Übersicht"}
            onClick={(e) => e.stopPropagation()}
            className="max-w-full max-h-full object-contain rounded-lg shadow-2xl cursor-default"
          />
        </div>
      )}
    </div>
  );
}
