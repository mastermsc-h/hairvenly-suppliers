"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Power, Check, AlertTriangle } from "lucide-react";
import { setProactiveKillSwitch } from "@/lib/actions/chatbot-settings";

interface Category {
  key: string;
  label: string;
  emoji: string;
  risky: boolean;
}

interface Props {
  initialEnabled: boolean;
  initialSafe: string[];
  categories: Category[];
}

export default function KillSwitchPanel({
  initialEnabled,
  initialSafe,
  categories,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [safe, setSafe] = useState<Set<string>>(new Set(initialSafe));
  const [dirty, setDirty] = useState(false);

  function toggleCategory(key: string) {
    const next = new Set(safe);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    setSafe(next);
    setDirty(true);
  }

  function setKillSwitch(value: boolean) {
    setEnabled(value);
    setDirty(true);
  }

  function save() {
    startTransition(async () => {
      try {
        await setProactiveKillSwitch({
          enabled,
          safeCategories: Array.from(safe),
        });
        setDirty(false);
        router.refresh();
      } catch (e) {
        alert(`Fehler: ${(e as Error).message}`);
      }
    });
  }

  return (
    <div className="space-y-4">
      {/* Kill-Switch */}
      <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm p-4">
        <div className="flex items-center gap-2 mb-2">
          <Power size={14} className="text-neutral-500" />
          <h2 className="text-sm font-semibold text-neutral-900">
            Globaler Kill-Switch
          </h2>
        </div>
        <p className="text-xs text-neutral-600 mb-3 leading-relaxed">
          <strong>Frei:</strong> Bot generiert proaktiv für ALLE Kategorien.<br />
          <strong>Eingeschränkt:</strong> Bot generiert nur in Kategorien, die
          unten als „sicher" markiert sind. Andere bleiben für die MA.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setKillSwitch(true)}
            className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border-2 transition ${
              enabled
                ? "bg-green-50 text-green-800 border-green-400"
                : "bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50"
            }`}
          >
            🟢 Frei (alle Kategorien)
          </button>
          <button
            type="button"
            onClick={() => setKillSwitch(false)}
            className={`flex-1 px-3 py-2 rounded-lg text-sm font-medium border-2 transition ${
              !enabled
                ? "bg-amber-50 text-amber-800 border-amber-400"
                : "bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50"
            }`}
          >
            🚧 Eingeschränkt (nur Whitelist)
          </button>
        </div>
      </div>

      {/* Whitelist */}
      <div
        className={`bg-white rounded-2xl border-2 shadow-sm p-4 ${
          enabled
            ? "border-neutral-100 opacity-60"
            : "border-amber-200"
        }`}
      >
        <div className="flex items-center justify-between gap-2 mb-2">
          <h2 className="text-sm font-semibold text-neutral-900">
            Sichere Kategorien (Whitelist)
          </h2>
          <span className="text-xs text-neutral-500">
            {safe.size} ausgewählt
          </span>
        </div>
        <p className="text-xs text-neutral-600 mb-3 leading-relaxed">
          {enabled
            ? "Nicht relevant, solange der Kill-Switch auf 'Frei' steht."
            : "Bot antwortet automatisch nur, wenn die Kategorie hier markiert ist. Heikle Kategorien (z.B. Reklamation, Termin, Modelle) bleiben bewusst für die MA — der Bot setzt nur das Tag und übergibt."}
        </p>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {categories.map((c) => {
            const isOn = safe.has(c.key);
            return (
              <button
                key={c.key}
                type="button"
                onClick={() => toggleCategory(c.key)}
                disabled={enabled}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg border-2 text-sm transition text-left ${
                  isOn
                    ? c.risky
                      ? "bg-rose-50 border-rose-400 text-rose-900"
                      : "bg-emerald-50 border-emerald-400 text-emerald-900"
                    : "bg-white border-neutral-200 text-neutral-700 hover:border-neutral-300"
                } ${enabled ? "cursor-not-allowed" : "cursor-pointer"}`}
              >
                <span className="text-base">{c.emoji}</span>
                <span className="flex-1 truncate">{c.label}</span>
                {isOn && <Check size={12} className="shrink-0" />}
                {c.risky && !isOn && (
                  <AlertTriangle
                    size={11}
                    className="text-amber-500 shrink-0"
                  />
                )}
              </button>
            );
          })}
        </div>
        <p className="text-[11px] text-neutral-500 mt-3 leading-relaxed">
          <AlertTriangle size={10} className="inline mr-1" /> = heikle
          Kategorie. Solche Antworten sollten in der Regel die MA selbst
          schreiben.
        </p>
      </div>

      {/* Save */}
      <div className="flex items-center gap-3 justify-end">
        {dirty && !pending && (
          <span className="text-xs text-amber-700">
            Ungespeicherte Änderungen
          </span>
        )}
        <button
          type="button"
          onClick={save}
          disabled={!dirty || pending}
          className={`px-4 py-2 rounded-lg text-sm font-medium border transition ${
            !dirty || pending
              ? "bg-neutral-100 text-neutral-400 border-neutral-200 cursor-not-allowed"
              : "bg-neutral-900 text-white border-neutral-900 hover:bg-neutral-800"
          }`}
        >
          {pending ? "Speichere …" : "Speichern"}
        </button>
      </div>
    </div>
  );
}
