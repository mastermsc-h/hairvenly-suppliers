"use client";

import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { useCallback, useState } from "react";
import { Search } from "lucide-react";
import KnowledgeModal from "./knowledge-modal";

const TOPICS = [
  { value: "", label: "Alle Themen" },
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

export default function KnowledgeFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [showAddModal, setShowAddModal] = useState(false);

  const update = useCallback(
    (key: string, value: string) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value) {
        params.set(key, value);
      } else {
        params.delete(key);
      }
      router.push(`${pathname}?${params.toString()}`);
    },
    [router, pathname, searchParams]
  );

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        {/* Search */}
        <div className="relative flex-1 min-w-[200px] max-w-xs">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input
            type="text"
            defaultValue={searchParams.get("q") ?? ""}
            onChange={(e) => update("q", e.target.value)}
            placeholder="Suche in Fragen & Antworten…"
            className="w-full pl-8 pr-3 py-2 text-sm rounded-lg border border-neutral-300 focus:outline-none focus:ring-2 focus:ring-neutral-900"
          />
        </div>

        {/* Topic filter */}
        <select
          defaultValue={searchParams.get("topic") ?? ""}
          onChange={(e) => update("topic", e.target.value)}
          className="py-2 px-3 text-sm rounded-lg border border-neutral-300 focus:outline-none focus:ring-2 focus:ring-neutral-900"
        >
          {TOPICS.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>

        {/* Active filter */}
        <label className="flex items-center gap-2 text-sm text-neutral-600 cursor-pointer select-none">
          <input
            type="checkbox"
            defaultChecked={searchParams.get("active") === "1"}
            onChange={(e) => update("active", e.target.checked ? "1" : "")}
            className="rounded border-neutral-300"
          />
          Nur aktive
        </label>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Add button */}
        <button
          onClick={() => setShowAddModal(true)}
          className="bg-neutral-900 text-white text-sm font-medium rounded-lg px-4 py-2 hover:bg-neutral-800 transition-colors"
        >
          + Eintrag hinzufügen
        </button>
      </div>

      {showAddModal && (
        <KnowledgeModal onClose={() => setShowAddModal(false)} />
      )}
    </>
  );
}
