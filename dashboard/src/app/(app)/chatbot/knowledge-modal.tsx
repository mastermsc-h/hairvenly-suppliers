"use client";

import { useTransition, useRef } from "react";
import { createChatbotEntry, updateChatbotEntry } from "@/lib/actions/chatbot";
import type { ChatbotEntry } from "@/lib/types";
import { X } from "lucide-react";

const TOPICS = [
  { value: "farbberatung", label: "Farbberatung" },
  { value: "preise", label: "Preise" },
  { value: "produkte", label: "Produkte" },
  { value: "lager", label: "Lager" },
  { value: "termine", label: "Termine" },
  { value: "versand", label: "Versand" },
  { value: "pflege", label: "Pflege" },
  { value: "reklamation", label: "Reklamation" },
  { value: "rabatt", label: "Rabatt" },
  { value: "modell", label: "Modell" },
  { value: "kooperation", label: "Kooperation" },
  { value: "gewerbe", label: "Gewerbe" },
  { value: "zahlung", label: "Zahlung" },
  { value: "anfaenger", label: "Anfänger" },
  { value: "smalltalk", label: "Smalltalk" },
  { value: "werbung", label: "Werbung" },
  { value: "gewinnspiel", label: "Gewinnspiel" },
  { value: "sonstiges", label: "Sonstiges" },
];

interface Props {
  entry?: ChatbotEntry | null;
  onClose: () => void;
}

export default function KnowledgeModal({ entry, onClose }: Props) {
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  const isEdit = !!entry;

  function handleSubmit(fd: FormData) {
    startTransition(async () => {
      if (isEdit) {
        await updateChatbotEntry(fd);
      } else {
        await createChatbotEntry(fd);
      }
      onClose();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-200">
          <h2 className="text-base font-semibold text-neutral-900">
            {isEdit ? "Eintrag bearbeiten" : "Neuer Eintrag"}
          </h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700">
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <form ref={formRef} action={handleSubmit} className="p-6 space-y-4">
          {isEdit && <input type="hidden" name="id" value={entry.id} />}

          {/* Topic + Score row */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide block mb-1">
                Thema
              </label>
              <select
                name="topic"
                defaultValue={entry?.topic ?? "sonstiges"}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
              >
                {TOPICS.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide block mb-1">
                Qualitäts-Score (1–5)
              </label>
              <select
                name="biz_score"
                defaultValue={String(entry?.biz_score ?? 3)}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
              >
                {[1, 2, 3, 4, 5].map((n) => (
                  <option key={n} value={String(n)}>{n}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Question */}
          <div>
            <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide block mb-1">
              Kundenfrage
            </label>
            <textarea
              name="question"
              required
              defaultValue={entry?.question ?? ""}
              rows={3}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900 resize-y"
              placeholder="Was der Kunde gefragt hat…"
            />
          </div>

          {/* Answer */}
          <div>
            <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide block mb-1">
              Antwort
            </label>
            <textarea
              name="answer"
              required
              defaultValue={entry?.answer ?? ""}
              rows={7}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900 resize-y"
              placeholder="Die ideale Antwort…"
            />
          </div>

          {/* Cluster (optional) */}
          <div>
            <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide block mb-1">
              Cluster-Label (optional)
            </label>
            <input
              type="text"
              name="cluster"
              defaultValue={entry?.cluster ?? ""}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
              placeholder="z.B. Farbberatung-Foto"
            />
          </div>

          {/* Conversion + Active toggles */}
          <div className="flex gap-6">
            <label className="flex items-center gap-2 cursor-pointer text-sm text-neutral-700">
              <input
                type="checkbox"
                name="conversion"
                value="true"
                defaultChecked={entry?.conversion ?? false}
                className="rounded border-neutral-300"
              />
              Conversion-Chat
            </label>
            {isEdit && (
              <label className="flex items-center gap-2 cursor-pointer text-sm text-neutral-700">
                <input
                  type="checkbox"
                  name="active"
                  value="true"
                  defaultChecked={entry?.active ?? true}
                  className="rounded border-neutral-300"
                />
                Aktiv
              </label>
            )}
          </div>

          {/* Buttons */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm rounded-lg border border-neutral-300 text-neutral-700 hover:bg-neutral-50"
            >
              Abbrechen
            </button>
            <button
              type="submit"
              disabled={pending}
              className="px-4 py-2 text-sm rounded-lg bg-neutral-900 text-white font-medium hover:bg-neutral-800 disabled:opacity-50"
            >
              {pending ? "Speichert…" : "Speichern"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
