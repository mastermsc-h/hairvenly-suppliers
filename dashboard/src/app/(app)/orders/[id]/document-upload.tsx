"use client";

import { useState, useTransition, useRef } from "react";
import { Upload } from "lucide-react";
import { uploadDocument } from "@/lib/actions/orders";
import { DOCUMENT_QUICK_KINDS, type DocumentKind } from "@/lib/types";
import { t, type Locale } from "@/lib/i18n";

export default function DocumentUpload({ orderId, locale }: { orderId: string; locale: Locale }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [kind, setKind] = useState<DocumentKind>("supplier_invoice");
  const fileRef = useRef<HTMLInputElement>(null);

  function onFileChange() {
    const file = fileRef.current?.files?.[0];
    if (!file) return;
    setError(null);
    const fd = new FormData();
    fd.set("kind", kind);
    fd.set("file", file);
    start(async () => {
      const res = await uploadDocument(orderId, fd);
      if (res?.error) setError(res.error);
      if (fileRef.current) fileRef.current.value = "";
    });
  }

  const kindLabel = t(locale, `doc.kind.${kind}`);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        {DOCUMENT_QUICK_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setKind(k)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium border transition ${
              kind === k
                ? "bg-neutral-900 text-white border-neutral-900"
                : "bg-white text-neutral-700 border-neutral-300 hover:bg-neutral-50"
            }`}
          >
            {t(locale, `doc.kind.${k}`)}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-3 text-sm">
        <label className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-indigo-600 text-white font-medium shadow-sm hover:bg-indigo-700 active:bg-indigo-800 cursor-pointer transition disabled:opacity-50">
          <Upload size={16} />
          <span>{pending ? t(locale, "doc.uploading") : `${t(locale, "doc.upload_as")} „${kindLabel}"`}</span>
          <input
            ref={fileRef}
            type="file"
            onChange={onFileChange}
            disabled={pending}
            className="hidden"
          />
        </label>
      </div>

      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
