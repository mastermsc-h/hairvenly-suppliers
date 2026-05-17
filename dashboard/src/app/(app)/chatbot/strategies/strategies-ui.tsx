"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Edit3, Trash2, X, Save, Target, Power } from "lucide-react";

interface Strategy {
  id: string;
  name: string;
  trigger: string;
  steps: string;
  active: boolean;
  priority: number;
  updated_at: string;
}

export default function StrategiesUI() {
  const [list, setList] = useState<Strategy[]>([]);
  const [editing, setEditing] = useState<Strategy | null>(null);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/chatbot/strategies");
    const data = await res.json();
    setList(data.strategies || []);
    setLoading(false);
  }, []);
  useEffect(() => { load(); }, [load]);

  async function save(s: Partial<Strategy> & { id?: string }) {
    const method = s.id ? "PATCH" : "POST";
    const res = await fetch("/api/chatbot/strategies", {
      method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(s),
    });
    if (!res.ok) { alert((await res.json()).error); return; }
    load(); setEditing(null); setCreating(false);
  }

  async function remove(id: string, name: string) {
    if (!confirm(`Strategie "${name}" löschen?`)) return;
    await fetch(`/api/chatbot/strategies?id=${id}`, { method: "DELETE" });
    load();
  }

  async function toggle(s: Strategy) {
    await save({ id: s.id, active: !s.active });
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Target size={20} className="text-purple-700" />
          <h1 className="text-xl font-semibold text-neutral-900">Verkaufs-Strategien</h1>
          <span className="text-sm text-neutral-500 ml-2">
            Strukturierte Empfehlungs-Pfade für typische Beratungs-Szenarien
          </span>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="bg-neutral-900 text-white rounded-lg px-4 py-2 text-sm hover:bg-neutral-800 inline-flex items-center gap-1.5"
        >
          <Plus size={14} /> Neue Strategie
        </button>
      </div>

      <div className="bg-purple-50 border border-purple-200 rounded-xl p-3 text-xs text-purple-900">
        💡 Der Bot bekommt diese Strategien bei jedem Chat-Aufruf im System-Prompt mit.
        Bei passendem Szenario folgt er den Schritten der Strategie statt frei zu entscheiden.
        Höhere <strong>Priorität</strong> bedeutet: kommt zuerst im Prompt.
      </div>

      {loading ? (
        <div className="text-center py-12 text-neutral-400">Lade…</div>
      ) : list.length === 0 ? (
        <div className="text-center py-12 text-neutral-400">
          Noch keine Strategien angelegt. Klick &ldquo;Neue Strategie&rdquo;.
        </div>
      ) : (
        <div className="space-y-3">
          {list.map(s => (
            <div key={s.id} className={`bg-white rounded-2xl border shadow-sm p-5 ${s.active ? "border-neutral-200" : "border-neutral-200 opacity-60"}`}>
              <div className="flex items-start justify-between gap-3 mb-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="font-semibold text-neutral-900">{s.name}</h3>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${s.active ? "bg-green-100 text-green-700" : "bg-neutral-100 text-neutral-500"}`}>
                      {s.active ? "aktiv" : "inaktiv"}
                    </span>
                    <span className="text-[10px] text-neutral-400">Prio {s.priority}</span>
                  </div>
                  <p className="text-xs text-purple-700 mt-1 italic">
                    Trigger: {s.trigger}
                  </p>
                </div>
                <div className="flex gap-1">
                  <button onClick={() => setEditing(s)} className="text-xs px-2 py-1.5 rounded-lg border border-neutral-300 hover:bg-neutral-50 inline-flex items-center gap-1">
                    <Edit3 size={11} /> Bearbeiten
                  </button>
                  <button onClick={() => toggle(s)} className={`text-xs px-2 py-1.5 rounded-lg inline-flex items-center gap-1 ${s.active ? "border border-neutral-300 hover:bg-neutral-50" : "bg-green-600 text-white hover:bg-green-700"}`}>
                    <Power size={11} /> {s.active ? "Aus" : "An"}
                  </button>
                  <button onClick={() => remove(s.id, s.name)} className="text-xs px-2 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 inline-flex items-center gap-1">
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
              <details className="mt-2">
                <summary className="text-xs text-neutral-500 cursor-pointer">Empfehlungs-Schritte anzeigen</summary>
                <pre className="mt-2 text-xs bg-neutral-50 rounded-lg p-3 whitespace-pre-wrap font-sans text-neutral-700">{s.steps}</pre>
              </details>
            </div>
          ))}
        </div>
      )}

      {(editing || creating) && (
        <Editor
          strategy={editing}
          onClose={() => { setEditing(null); setCreating(false); }}
          onSave={save}
        />
      )}
    </div>
  );
}

function Editor({ strategy, onClose, onSave }: {
  strategy: Strategy | null;
  onClose: () => void;
  onSave: (s: Partial<Strategy> & { id?: string }) => void;
}) {
  const [name, setName] = useState(strategy?.name || "");
  const [trigger, setTrigger] = useState(strategy?.trigger || "");
  const [steps, setSteps] = useState(strategy?.steps || "");
  const [priority, setPriority] = useState(strategy?.priority || 50);
  const [active, setActive] = useState(strategy?.active ?? true);

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-3xl w-full shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-neutral-200 flex items-center justify-between">
          <h2 className="font-semibold text-neutral-900">
            {strategy ? `Strategie bearbeiten: ${strategy.name}` : "Neue Strategie"}
          </h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide block mb-1">
                Name *
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="z.B. Feines welliges Haar, lang, schwarz"
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide block mb-1">
                Priorität (1–100)
              </label>
              <input
                type="number" min={1} max={100} value={priority}
                onChange={(e) => setPriority(parseInt(e.target.value) || 50)}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide block mb-1">
              Trigger * <span className="text-neutral-400 font-normal">(Wann gilt diese Strategie?)</span>
            </label>
            <input
              value={trigger}
              onChange={(e) => setTrigger(e.target.value)}
              placeholder="z.B. Kundin mit feinem welligem Haar, möchte langes Haar (55cm), sucht schwarz"
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide block mb-1">
              Empfehlungs-Schritte * <span className="text-neutral-400 font-normal">(Markdown möglich)</span>
            </label>
            <textarea
              value={steps}
              onChange={(e) => setSteps(e.target.value)}
              rows={14}
              placeholder={`**Reihenfolge:**\n1. Erste Wahl: ...\n2. Wenn nicht da: ...\n3. Notfall: ...`}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm font-mono"
            />
          </div>
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            <span>Aktiv (Bot bekommt sie im Prompt mit)</span>
          </label>
        </div>
        <div className="px-5 py-3 bg-neutral-50 border-t border-neutral-200 flex justify-end gap-2">
          <button onClick={onClose} className="text-sm px-4 py-2 rounded-lg border border-neutral-300 hover:bg-neutral-50">
            Abbrechen
          </button>
          <button
            onClick={() => onSave({ id: strategy?.id, name, trigger, steps, priority, active })}
            disabled={!name.trim() || !trigger.trim() || !steps.trim()}
            className="text-sm px-4 py-2 rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-40 inline-flex items-center gap-1.5"
          >
            <Save size={14} /> Speichern
          </button>
        </div>
      </div>
    </div>
  );
}
