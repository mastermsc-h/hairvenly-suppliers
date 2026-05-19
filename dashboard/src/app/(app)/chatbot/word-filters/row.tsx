"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Check, X, Edit3 } from "lucide-react";
import { toggleWordFilter, updateWordFilterReplacement, deleteWordFilter } from "@/lib/actions/word-filters";

interface FilterRow {
  id: string;
  pattern: string;
  replacement: string;
  occurrences: number;
  active: boolean;
  auto_added: boolean;
  last_seen_at: string | null;
  notes: string;
}

export default function WordFilterRow({ filter }: { filter: FilterRow }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [editing, setEditing] = useState(false);
  const [replacement, setReplacement] = useState(filter.replacement);

  const handleToggle = () => {
    startTransition(async () => {
      await toggleWordFilter(filter.id, !filter.active);
      router.refresh();
    });
  };

  const handleSave = () => {
    startTransition(async () => {
      await updateWordFilterReplacement(filter.id, replacement);
      setEditing(false);
      router.refresh();
    });
  };

  const handleDelete = () => {
    if (!confirm(`Filter "${filter.pattern}" wirklich löschen?`)) return;
    startTransition(async () => {
      await deleteWordFilter(filter.id);
      router.refresh();
    });
  };

  return (
    <tr className={filter.active ? "bg-green-50/40" : ""}>
      <td className="px-4 py-2.5 font-medium text-neutral-900">{filter.pattern}</td>
      <td className="px-4 py-2.5 text-neutral-600">
        {editing ? (
          <input
            value={replacement}
            onChange={(e) => setReplacement(e.target.value)}
            placeholder="(weglassen)"
            onKeyDown={(e) => { if (e.key === "Enter") handleSave(); if (e.key === "Escape") setEditing(false); }}
            autoFocus
            className="w-full rounded-md border border-neutral-300 px-2 py-1 text-sm"
          />
        ) : (
          <span
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1 cursor-pointer hover:bg-neutral-100 rounded px-1"
          >
            {filter.replacement || <span className="text-neutral-400 italic">(weglassen)</span>}
            <Edit3 size={11} className="text-neutral-400" />
          </span>
        )}
      </td>
      <td className="px-4 py-2.5 text-right text-neutral-700">{filter.occurrences}</td>
      <td className="px-4 py-2.5 text-center">
        <button
          onClick={handleToggle}
          disabled={pending}
          title={filter.active ? "Klick zum Deaktivieren" : "Klick zum Aktivieren"}
          className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
            filter.active
              ? "bg-green-100 text-green-800"
              : "bg-amber-100 text-amber-800"
          }`}
        >
          {filter.active ? "Aktiv" : "Beobachtet"}
        </button>
        {filter.auto_added && (
          <div className="text-[9px] text-neutral-400 mt-0.5">auto</div>
        )}
      </td>
      <td className="px-4 py-2.5 text-right">
        {editing ? (
          <div className="inline-flex gap-1">
            <button onClick={handleSave} disabled={pending} className="text-emerald-600 hover:text-emerald-700"><Check size={14} /></button>
            <button onClick={() => { setEditing(false); setReplacement(filter.replacement); }} className="text-neutral-400 hover:text-neutral-600"><X size={14} /></button>
          </div>
        ) : (
          <button onClick={handleDelete} disabled={pending} className="text-neutral-400 hover:text-red-600">
            <Trash2 size={13} />
          </button>
        )}
      </td>
    </tr>
  );
}
