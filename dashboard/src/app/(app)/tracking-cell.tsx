"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { Plus, X, Check } from "lucide-react";
import { updateOrder } from "@/lib/actions/orders";
import { t, type Locale } from "@/lib/i18n";

export default function TrackingCell({
  orderId,
  number,
  url,
  canEdit,
  maxWidth = 140,
  locale = "de",
}: {
  orderId: string;
  number: string | null;
  url: string | null;
  canEdit: boolean;
  maxWidth?: number;
  locale?: Locale;
}) {
  const [editing, setEditing] = useState(false);
  const [num, setNum] = useState(number ?? "");
  const [trackUrl, setTrackUrl] = useState(url ?? "");
  const [pending, start] = useTransition();
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editing) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setEditing(false);
        setNum(number ?? "");
        setTrackUrl(url ?? "");
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [editing, number, url]);

  function save(e?: React.FormEvent) {
    e?.preventDefault();
    const fd = new FormData();
    fd.set("tracking_number", num);
    fd.set("tracking_url", trackUrl);
    start(async () => {
      await updateOrder(orderId, fd);
      setEditing(false);
    });
  }

  function stop(e: React.SyntheticEvent) {
    e.stopPropagation();
  }

  // Display (no tracking yet)
  if (!number && !editing) {
    if (!canEdit) return null;
    return (
      <div className="mt-0.5">
        <button
          type="button"
          onClick={(e) => { stop(e); setEditing(true); }}
          className="text-[10px] text-neutral-400 hover:text-indigo-600 inline-flex items-center gap-0.5"
        >
          <Plus size={10} /> {t(locale, "order.add_tracking")}
        </button>
      </div>
    );
  }

  // Display (has tracking)
  if (number && !editing) {
    return (
      <div className="mt-0.5 flex items-center gap-1">
        {url ? (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            onClick={stop}
            className="text-[10px] text-blue-600 hover:underline truncate inline-block"
            style={{ maxWidth }}
            title={number}
          >
            {number}
          </a>
        ) : (
          <span
            className="text-[10px] text-neutral-500 truncate inline-block"
            style={{ maxWidth }}
            title={number}
          >
            {number}
          </span>
        )}
        {canEdit && (
          <button
            type="button"
            onClick={(e) => { stop(e); setEditing(true); }}
            className="text-[10px] text-neutral-300 hover:text-neutral-700"
            title={t(locale, "common.edit")}
          >
            ✎
          </button>
        )}
      </div>
    );
  }

  // Edit form
  return (
    <div
      ref={wrapRef}
      onClick={stop}
      className="mt-0.5 flex flex-col gap-1 bg-white border border-neutral-300 rounded-md p-1.5 shadow-sm"
      style={{ minWidth: 200, maxWidth: 260 }}
    >
      <input
        autoFocus
        value={num}
        onChange={(e) => setNum(e.target.value)}
        placeholder={t(locale, "order.field.tracking_number")}
        className="text-[11px] px-1.5 py-1 rounded border border-neutral-200 focus:border-neutral-500 outline-none"
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setEditing(false);
        }}
      />
      <input
        value={trackUrl}
        onChange={(e) => setTrackUrl(e.target.value)}
        placeholder={t(locale, "order.field.tracking_url")}
        type="url"
        className="text-[11px] px-1.5 py-1 rounded border border-neutral-200 focus:border-neutral-500 outline-none"
        onKeyDown={(e) => {
          if (e.key === "Enter") save();
          if (e.key === "Escape") setEditing(false);
        }}
      />
      <div className="flex items-center gap-1 justify-end">
        <button
          type="button"
          onClick={() => setEditing(false)}
          disabled={pending}
          className="text-[10px] text-neutral-500 hover:text-neutral-900 px-1 py-0.5"
        >
          <X size={11} />
        </button>
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="text-[10px] text-white bg-neutral-900 hover:bg-neutral-800 rounded px-1.5 py-0.5 inline-flex items-center gap-0.5 disabled:opacity-50"
        >
          <Check size={11} /> {t(locale, "order.save")}
        </button>
      </div>
    </div>
  );
}
