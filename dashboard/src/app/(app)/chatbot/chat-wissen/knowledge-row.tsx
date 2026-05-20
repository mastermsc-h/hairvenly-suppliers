"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, User, MessageCircle, Sparkles } from "lucide-react";
import type { KnowledgeEntry } from "./page";

export default function KnowledgeRow({ entry }: { entry: KnowledgeEntry }) {
  const [open, setOpen] = useState(false);
  const preview = entry.answer.replace(/\s+/g, " ").slice(0, 180);
  const needsExpand = entry.answer.length > 180 || entry.facts.length > 0;

  return (
    <div className="bg-white rounded-xl border border-neutral-200 hover:border-purple-300 transition p-4 space-y-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex gap-2 text-sm">
            <User size={14} className="text-neutral-400 shrink-0 mt-0.5" />
            <span className="text-neutral-700 line-clamp-2">{entry.question}</span>
          </div>
          <div className={`flex gap-2 text-sm ${open ? "" : "line-clamp-3"}`}>
            <MessageCircle size={14} className="text-pink-500 shrink-0 mt-0.5" />
            <span className="text-neutral-800 whitespace-pre-wrap">
              {open ? entry.answer : preview + (entry.answer.length > 180 ? "…" : "")}
            </span>
          </div>
          {open && entry.facts.length > 0 && (
            <div className="rounded-lg bg-purple-50 border border-purple-100 p-3">
              <div className="flex items-center gap-1.5 text-xs font-medium text-purple-700 mb-1.5">
                <Sparkles size={11} /> Fakten
              </div>
              <ul className="space-y-1 text-xs text-purple-900 list-disc list-inside">
                {entry.facts.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
            </div>
          )}
        </div>
        {needsExpand && (
          <button
            onClick={() => setOpen(o => !o)}
            className="text-neutral-400 hover:text-neutral-700 shrink-0"
            title={open ? "Einklappen" : "Volle Antwort"}
          >
            {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        )}
      </div>
      <div className="flex items-center gap-1.5 flex-wrap pt-1 border-t border-neutral-100">
        <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
          entry.source === "v2" ? "bg-purple-100 text-purple-700" : "bg-neutral-100 text-neutral-600"
        }`} title={entry.source === "v2" ? "Destilliert v2 (höhere Qualität)" : "Roh v1 (Original-Cluster)"}>
          {entry.source.toUpperCase()}
        </span>
        <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-amber-100 text-amber-700">
          {entry.topic}
        </span>
        {entry.conversion && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full font-medium bg-green-100 text-green-700">
            ✓ converted
          </span>
        )}
        {[...new Set(entry.tags)].slice(0, 10).map(t => (
          <span key={t} className="text-[10px] px-1.5 py-0.5 rounded-full bg-neutral-100 text-neutral-600">
            {t}
          </span>
        ))}
        {entry.biz_score >= 4 && (
          <span className="text-[10px] text-neutral-400 ml-auto" title="Qualitäts-Score">
            ★{entry.biz_score}/5
          </span>
        )}
      </div>
    </div>
  );
}
