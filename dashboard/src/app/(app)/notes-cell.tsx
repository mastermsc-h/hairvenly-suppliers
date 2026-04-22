"use client";

import { useState, useTransition, useRef, useEffect } from "react";
import { Plus, X, Check, Pencil } from "lucide-react";
import { updateOrder } from "@/lib/actions/orders";
import { t, type Locale } from "@/lib/i18n";

export default function NotesCell({
  orderId,
  notes,
  canEdit,
  locale = "de",
}: {
  orderId: string;
  notes: string | null;
  canEdit: boolean;
  locale?: Locale;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(notes ?? "");
  const [pending, start] = useTransition();
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!editing) return;
    const onDocClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setEditing(false);
        setValue(notes ?? "");
      }
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, [editing, notes]);

  function stop(e: React.SyntheticEvent) {
    e.stopPropagation();
  }

  function save(e?: React.FormEvent) {
    e?.preventDefault();
    const fd = new FormData();
    fd.set("notes", value);
    start(async () => {
      await updateOrder(orderId, fd);
      setEditing(false);
    });
  }

  if (editing) {
    return (
      <div ref={wrapRef} onClick={stop} className="inline-block">
        <div
          className="bg-white border border-neutral-300 rounded-md p-1.5 shadow-sm flex flex-col gap-1"
          style={{ minWidth: 220 }}
        >
          <textarea
            autoFocus
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={t(locale, "order.field.notes")}
            rows={3}
            className="text-[11px] px-1.5 py-1 rounded border border-neutral-200 focus:border-neutral-500 outline-none resize-y min-h-[60px]"
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) save();
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
      </div>
    );
  }

  if (!notes) {
    if (!canEdit) return <span className="text-xs text-neutral-300">—</span>;
    return (
      <button
        type="button"
        onClick={(e) => { stop(e); setEditing(true); }}
        className="text-[10px] text-neutral-400 hover:text-indigo-600 inline-flex items-center gap-0.5"
      >
        <Plus size={10} /> {t(locale, "notes.add")}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => { stop(e); if (canEdit) setEditing(true); }}
      className={`text-xs text-neutral-700 text-left max-w-[180px] whitespace-pre-wrap break-words leading-tight inline-flex items-start gap-1 ${canEdit ? "hover:text-neutral-900 cursor-pointer" : "cursor-default"}`}
      title={canEdit ? t(locale, "common.edit") : undefined}
    >
      <span className="line-clamp-3">{notes}</span>
      {canEdit && <Pencil size={10} className="text-neutral-300 shrink-0 mt-0.5" />}
    </button>
  );
}
