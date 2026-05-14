"use client";

import { useState, useEffect, useCallback } from "react";
import { Plus, Trash2, Edit3, Save, X, Users, Image as ImageIcon } from "lucide-react";

interface Avatar {
  id: string;
  name: string;
  avatar_url: string | null;
  personality: string;
  active: boolean;
  weight: number;
  notes: string | null;
  updated_at: string;
}

export default function AvatarsUI() {
  const [avatars, setAvatars] = useState<Avatar[]>([]);
  const [editing, setEditing] = useState<Avatar | null>(null);
  const [creating, setCreating] = useState(false);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/chatbot/avatars");
    const data = await res.json();
    setAvatars(data.avatars || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save(avatar: Partial<Avatar> & { id?: string }) {
    const method = avatar.id ? "PATCH" : "POST";
    const res = await fetch("/api/chatbot/avatars", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(avatar),
    });
    if (res.ok) {
      load();
      setEditing(null);
      setCreating(false);
    } else {
      const err = await res.json();
      alert(`Fehler: ${err.error}`);
    }
  }

  async function remove(id: string, name: string) {
    if (!confirm(`Avatar "${name}" wirklich löschen?`)) return;
    await fetch(`/api/chatbot/avatars?id=${id}`, { method: "DELETE" });
    load();
  }

  async function toggleActive(a: Avatar) {
    await save({ id: a.id, active: !a.active });
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Users size={20} className="text-neutral-700" />
          <h1 className="text-xl font-semibold text-neutral-900">Bot-Avatars</h1>
          <span className="text-sm text-neutral-500 ml-2">
            Persönlichkeiten die Ava annimmt — jede mit eigenem Stil
          </span>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="bg-neutral-900 text-white rounded-lg px-4 py-2 text-sm hover:bg-neutral-800 inline-flex items-center gap-1.5"
        >
          <Plus size={14} /> Neuer Avatar
        </button>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-3 text-xs text-amber-900">
        💡 Bei jedem neuen Chat wird zufällig (gewichtet) ein <strong>aktiver</strong> Avatar gewählt.
        Der Bot übernimmt dann diese Persönlichkeit für die ganze Session. Höheres Gewicht = öfter gewählt.
      </div>

      {loading ? (
        <div className="text-center text-neutral-400 py-12">Lade…</div>
      ) : avatars.length === 0 ? (
        <div className="text-center text-neutral-400 py-12">Noch keine Avatars angelegt.</div>
      ) : (
        <div className="grid md:grid-cols-2 gap-4">
          {avatars.map(a => (
            <div
              key={a.id}
              className={`bg-white rounded-2xl border shadow-sm p-5 ${
                a.active ? "border-neutral-200" : "border-neutral-200 opacity-60"
              }`}
            >
              <div className="flex items-start gap-3 mb-3">
                <div className="w-12 h-12 rounded-full bg-pink-100 flex-shrink-0 overflow-hidden flex items-center justify-center">
                  {a.avatar_url ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.avatar_url} alt={a.name} className="w-full h-full object-cover" />
                  ) : (
                    <ImageIcon size={18} className="text-pink-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <h3 className="font-semibold text-neutral-900">{a.name}</h3>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${
                      a.active ? "bg-green-100 text-green-700" : "bg-neutral-100 text-neutral-500"
                    }`}>
                      {a.active ? "aktiv" : "inaktiv"}
                    </span>
                    <span className="text-[10px] text-neutral-400">Gewicht {a.weight}</span>
                  </div>
                  <p className="text-xs text-neutral-500 mt-0.5">
                    {a.personality.slice(0, 120)}…
                  </p>
                </div>
              </div>
              <div className="flex gap-2 pt-3 border-t border-neutral-100">
                <button
                  onClick={() => setEditing(a)}
                  className="text-xs px-3 py-1.5 rounded-lg border border-neutral-300 hover:bg-neutral-50 inline-flex items-center gap-1"
                >
                  <Edit3 size={11} /> Bearbeiten
                </button>
                <button
                  onClick={() => toggleActive(a)}
                  className={`text-xs px-3 py-1.5 rounded-lg ${
                    a.active
                      ? "border border-neutral-300 text-neutral-600 hover:bg-neutral-50"
                      : "bg-green-600 text-white hover:bg-green-700"
                  }`}
                >
                  {a.active ? "Deaktivieren" : "Aktivieren"}
                </button>
                <button
                  onClick={() => remove(a.id, a.name)}
                  className="text-xs px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 inline-flex items-center gap-1 ml-auto"
                >
                  <Trash2 size={11} /> Löschen
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {(editing || creating) && (
        <AvatarEditor
          avatar={editing}
          onClose={() => { setEditing(null); setCreating(false); }}
          onSave={save}
        />
      )}
    </div>
  );
}

function AvatarEditor({
  avatar, onClose, onSave,
}: {
  avatar: Avatar | null;
  onClose: () => void;
  onSave: (a: Partial<Avatar> & { id?: string }) => void;
}) {
  const [name, setName] = useState(avatar?.name || "");
  const [personality, setPersonality] = useState(avatar?.personality || "");
  const [avatarUrl, setAvatarUrl] = useState(avatar?.avatar_url || "");
  const [weight, setWeight] = useState(avatar?.weight || 1);
  const [active, setActive] = useState(avatar?.active ?? true);
  const [notes, setNotes] = useState(avatar?.notes || "");

  function submit() {
    if (!name.trim() || !personality.trim()) {
      alert("Name und Persönlichkeit sind Pflicht");
      return;
    }
    onSave({
      id: avatar?.id,
      name: name.trim(),
      personality,
      avatar_url: avatarUrl || null,
      weight,
      active,
      notes: notes || null,
    });
  }

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-neutral-200 flex items-center justify-between">
          <h2 className="font-semibold text-neutral-900">
            {avatar ? `Avatar bearbeiten: ${avatar.name}` : "Neuer Avatar"}
          </h2>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-4 max-h-[70vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide block mb-1">
                Name *
              </label>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="z.B. Larissa"
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide block mb-1">
                Gewicht (Auswahl-Häufigkeit)
              </label>
              <input
                type="number" min={1} max={10}
                value={weight}
                onChange={(e) => setWeight(parseInt(e.target.value) || 1)}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide block mb-1">
              Avatar-Bild URL (optional)
            </label>
            <input
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              placeholder="https://…"
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide block mb-1">
              Persönlichkeit *
            </label>
            <p className="text-[11px] text-neutral-500 mb-2">
              Beschreibe wie diese Avatar-Persönlichkeit antwortet: Länge, Wärme, Emojis, Verkaufsstil.
              Der Bot übernimmt diese Eigenschaften in jeder Session mit diesem Avatar.
            </p>
            <textarea
              value={personality}
              onChange={(e) => setPersonality(e.target.value)}
              rows={8}
              placeholder="z.B. 'Larissa antwortet warm und etwas ausführlicher (3–5 Sätze), nutzt 2–3 Emojis pro Nachricht (🩷💕✨), wirkt mütterlich…'"
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900 font-mono"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide block mb-1">
              Notizen (intern, optional)
            </label>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="z.B. 'wird in Hochzeits-Kampagne verwendet'"
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            />
          </div>
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            <span>Aktiv (wird in zufälliger Auswahl berücksichtigt)</span>
          </label>
        </div>
        <div className="px-5 py-3 bg-neutral-50 border-t border-neutral-200 flex justify-end gap-2">
          <button onClick={onClose} className="text-sm px-4 py-2 rounded-lg border border-neutral-300 hover:bg-neutral-50">
            Abbrechen
          </button>
          <button
            onClick={submit}
            className="text-sm px-4 py-2 rounded-lg bg-neutral-900 text-white hover:bg-neutral-800 inline-flex items-center gap-1.5"
          >
            <Save size={14} /> Speichern
          </button>
        </div>
      </div>
    </div>
  );
}
