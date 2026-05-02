"use client";

import { useState, useTransition, useCallback } from "react";
import { toggleChatbotEntry, deleteChatbotEntry } from "@/lib/actions/chatbot";
import type { ChatbotEntry } from "@/lib/types";
import { Pencil, Trash2, Check, X, ChevronDown, ChevronUp } from "lucide-react";
import KnowledgeModal from "./knowledge-modal";

const TOPIC_LABELS: Record<string, string> = {
  farbberatung: "Farbberatung",
  preise: "Preise",
  produkte: "Produkte",
  lager: "Lager",
  termine: "Termine",
  versand: "Versand",
  pflege: "Pflege",
  reklamation: "Reklamation",
  rabatt: "Rabatt",
  modell: "Modell",
  kooperation: "Kooperation",
  gewerbe: "Gewerbe",
  zahlung: "Zahlung",
  anfaenger: "Anfänger",
  smalltalk: "Smalltalk",
  werbung: "Werbung",
  gewinnspiel: "Gewinnspiel",
  sonstiges: "Sonstiges",
};

const TOPIC_COLORS: Record<string, string> = {
  farbberatung: "bg-purple-100 text-purple-700",
  preise: "bg-blue-100 text-blue-700",
  produkte: "bg-cyan-100 text-cyan-700",
  lager: "bg-yellow-100 text-yellow-700",
  termine: "bg-green-100 text-green-700",
  versand: "bg-orange-100 text-orange-700",
  pflege: "bg-teal-100 text-teal-700",
  reklamation: "bg-red-100 text-red-700",
  rabatt: "bg-pink-100 text-pink-700",
  modell: "bg-indigo-100 text-indigo-700",
  kooperation: "bg-violet-100 text-violet-700",
  gewerbe: "bg-amber-100 text-amber-700",
  zahlung: "bg-lime-100 text-lime-700",
  anfaenger: "bg-sky-100 text-sky-700",
  sonstiges: "bg-neutral-100 text-neutral-600",
};

function ScoreDots({ score }: { score: number }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((i) => (
        <span
          key={i}
          className={`w-2 h-2 rounded-full ${i <= score ? "bg-neutral-800" : "bg-neutral-200"}`}
        />
      ))}
    </div>
  );
}

function ExpandableText({ text, max = 120 }: { text: string; max?: number }) {
  const [open, setOpen] = useState(false);
  if (text.length <= max) return <span>{text}</span>;
  return (
    <span>
      {open ? text : text.slice(0, max) + "…"}
      <button
        onClick={() => setOpen((v) => !v)}
        className="ml-1 text-neutral-400 hover:text-neutral-700 inline-flex items-center gap-0.5"
      >
        {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
      </button>
    </span>
  );
}

interface Props {
  entries: ChatbotEntry[];
}

export default function KnowledgeTable({ entries }: Props) {
  const [editEntry, setEditEntry] = useState<ChatbotEntry | null>(null);
  const [pending, startTransition] = useTransition();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const handleToggle = useCallback((id: string, current: boolean) => {
    startTransition(() => {
      toggleChatbotEntry(id, !current);
    });
  }, []);

  const handleDelete = useCallback((id: string) => {
    if (!confirm("Eintrag wirklich löschen?")) return;
    setDeletingId(id);
    startTransition(async () => {
      await deleteChatbotEntry(id);
      setDeletingId(null);
    });
  }, []);

  if (entries.length === 0) {
    return (
      <div className="text-center py-16 text-neutral-400">
        Keine Einträge gefunden
      </div>
    );
  }

  return (
    <>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-neutral-200 text-xs font-medium text-neutral-500 uppercase tracking-wide">
              <th className="text-left py-3 px-4 w-32">Thema</th>
              <th className="text-left py-3 px-4">Frage</th>
              <th className="text-left py-3 px-4">Antwort</th>
              <th className="text-center py-3 px-3 w-20">Score</th>
              <th className="text-center py-3 px-3 w-16">Conv.</th>
              <th className="text-center py-3 px-3 w-16">Aktiv</th>
              <th className="text-right py-3 px-4 w-24">Aktion</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr
                key={e.id}
                className={`border-b border-neutral-100 hover:bg-neutral-50 transition-colors ${
                  !e.active ? "opacity-40" : ""
                } ${deletingId === e.id ? "opacity-30" : ""}`}
              >
                <td className="py-3 px-4">
                  <span
                    className={`inline-block text-xs font-medium px-2 py-0.5 rounded-full ${
                      TOPIC_COLORS[e.topic] ?? "bg-neutral-100 text-neutral-600"
                    }`}
                  >
                    {TOPIC_LABELS[e.topic] ?? e.topic}
                  </span>
                </td>
                <td className="py-3 px-4 text-neutral-700 max-w-[220px]">
                  <ExpandableText text={e.question} max={90} />
                </td>
                <td className="py-3 px-4 text-neutral-600 max-w-[320px]">
                  <ExpandableText text={e.answer} max={140} />
                </td>
                <td className="py-3 px-3 text-center">
                  <ScoreDots score={e.biz_score} />
                </td>
                <td className="py-3 px-3 text-center">
                  {e.conversion ? (
                    <Check size={14} className="text-green-600 mx-auto" />
                  ) : (
                    <X size={14} className="text-neutral-300 mx-auto" />
                  )}
                </td>
                <td className="py-3 px-3 text-center">
                  <button
                    onClick={() => handleToggle(e.id, e.active)}
                    disabled={pending}
                    className="cursor-pointer"
                    title={e.active ? "Deaktivieren" : "Aktivieren"}
                  >
                    {e.active ? (
                      <div className="w-8 h-4 bg-neutral-800 rounded-full flex items-center justify-end pr-0.5">
                        <div className="w-3 h-3 bg-white rounded-full" />
                      </div>
                    ) : (
                      <div className="w-8 h-4 bg-neutral-200 rounded-full flex items-center justify-start pl-0.5">
                        <div className="w-3 h-3 bg-white rounded-full" />
                      </div>
                    )}
                  </button>
                </td>
                <td className="py-3 px-4 text-right">
                  <div className="flex items-center justify-end gap-2">
                    <button
                      onClick={() => setEditEntry(e)}
                      className="text-neutral-400 hover:text-neutral-700 transition-colors"
                      title="Bearbeiten"
                    >
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => handleDelete(e.id)}
                      className="text-neutral-300 hover:text-red-500 transition-colors"
                      title="Löschen"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editEntry && (
        <KnowledgeModal
          entry={editEntry}
          onClose={() => setEditEntry(null)}
        />
      )}
    </>
  );
}
