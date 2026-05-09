"use client";

import { useState, useTransition } from "react";
import { Plus, Eye, EyeOff, Save, X } from "lucide-react";
import {
  createSalonEmployee,
  setSalonEmployeeActive,
  updateSalonEmployee,
} from "@/lib/actions/salon";
import { useRouter } from "next/navigation";

interface Emp {
  id: string;
  name: string;
  pin: string;
  color: string | null;
  active: boolean;
}

const COLORS = [
  { name: "Rosa", v: "bg-rose-700" },
  { name: "Bernstein", v: "bg-amber-700" },
  { name: "Smaragd", v: "bg-emerald-700" },
  { name: "Himmel", v: "bg-sky-700" },
  { name: "Violett", v: "bg-violet-700" },
  { name: "Fuchsia", v: "bg-fuchsia-700" },
  { name: "Tuerkis", v: "bg-teal-700" },
  { name: "Orange", v: "bg-orange-700" },
];

export default function EmployeeManager({ employees }: { employees: Emp[] }) {
  const [showPin, setShowPin] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const router = useRouter();

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button
          onClick={() => setAdding(true)}
          className="bg-neutral-900 text-white rounded-lg px-4 py-2 text-sm font-medium flex items-center gap-2"
        >
          <Plus size={16} /> Neuer Mitarbeiter
        </button>
      </div>

      {adding && <NewEmployeeForm onDone={() => { setAdding(false); router.refresh(); }} />}

      <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50">
            <tr>
              <th className="text-left px-4 py-2 text-xs uppercase text-neutral-500">Name</th>
              <th className="text-left px-4 py-2 text-xs uppercase text-neutral-500">PIN</th>
              <th className="text-left px-4 py-2 text-xs uppercase text-neutral-500">Farbe</th>
              <th className="text-left px-4 py-2 text-xs uppercase text-neutral-500">Status</th>
              <th className="text-right px-4 py-2 text-xs uppercase text-neutral-500">Aktion</th>
            </tr>
          </thead>
          <tbody>
            {employees.length === 0 && (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-neutral-500">
                  Noch keine Mitarbeiter angelegt
                </td>
              </tr>
            )}
            {employees.map((e) =>
              editing === e.id ? (
                <EditRow
                  key={e.id}
                  emp={e}
                  onCancel={() => setEditing(null)}
                  onSaved={() => {
                    setEditing(null);
                    router.refresh();
                  }}
                />
              ) : (
                <tr key={e.id} className="border-t border-neutral-100">
                  <td className="px-4 py-3 font-medium">{e.name}</td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => setShowPin((s) => ({ ...s, [e.id]: !s[e.id] }))}
                      className="flex items-center gap-2 text-neutral-700 hover:text-neutral-900"
                    >
                      <span className="font-mono">{showPin[e.id] ? e.pin : "••••"}</span>
                      {showPin[e.id] ? <EyeOff size={14} /> : <Eye size={14} />}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    {e.color && <div className={`${e.color} w-6 h-6 rounded`} />}
                  </td>
                  <td className="px-4 py-3">
                    {e.active ? (
                      <span className="text-emerald-700 text-xs font-medium">Aktiv</span>
                    ) : (
                      <span className="text-neutral-500 text-xs">Inaktiv</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right space-x-2">
                    <button
                      onClick={() => setEditing(e.id)}
                      className="text-sm text-neutral-700 hover:text-neutral-900"
                    >
                      Bearbeiten
                    </button>
                    <ToggleActive id={e.id} active={e.active} />
                  </td>
                </tr>
              ),
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NewEmployeeForm({ onDone }: { onDone: () => void }) {
  const [name, setName] = useState("");
  const [pin, setPin] = useState("");
  const [color, setColor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await createSalonEmployee({ name, pin, color: color ?? undefined });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onDone();
    });
  }

  return (
    <form onSubmit={submit} className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div>
          <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide">Name</label>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900 outline-none"
          />
        </div>
        <div>
          <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide">PIN (4-6 Ziffern)</label>
          <input
            value={pin}
            onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            inputMode="numeric"
            pattern="\d{4,6}"
            required
            className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900 outline-none font-mono"
          />
        </div>
      </div>
      <div>
        <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide">Farbe (optional)</label>
        <div className="mt-1 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setColor(null)}
            className={`px-3 py-1 text-xs rounded ${color === null ? "bg-neutral-900 text-white" : "bg-neutral-100"}`}
          >
            keine
          </button>
          {COLORS.map((c) => (
            <button
              key={c.v}
              type="button"
              onClick={() => setColor(c.v)}
              className={`${c.v} text-white text-xs px-3 py-1 rounded ${color === c.v ? "ring-2 ring-neutral-900" : ""}`}
            >
              {c.name}
            </button>
          ))}
        </div>
      </div>
      {error && <div className="text-rose-600 text-sm">{error}</div>}
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onDone} className="text-sm text-neutral-600">Abbrechen</button>
        <button
          type="submit"
          disabled={pending}
          className="bg-neutral-900 text-white rounded-lg px-4 py-2 text-sm font-medium flex items-center gap-2"
        >
          <Save size={14} /> {pending ? "..." : "Speichern"}
        </button>
      </div>
    </form>
  );
}

function EditRow({ emp, onCancel, onSaved }: { emp: Emp; onCancel: () => void; onSaved: () => void }) {
  const [name, setName] = useState(emp.name);
  const [pin, setPin] = useState(emp.pin);
  const [color, setColor] = useState<string | null>(emp.color);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    setError(null);
    start(async () => {
      const res = await updateSalonEmployee({ id: emp.id, name, pin, color: color ?? undefined });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      onSaved();
    });
  }

  return (
    <tr className="border-t border-neutral-100 bg-neutral-50">
      <td className="px-4 py-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          className="w-full rounded border border-neutral-300 px-2 py-1 text-sm"
        />
      </td>
      <td className="px-4 py-2">
        <input
          value={pin}
          onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
          inputMode="numeric"
          className="w-24 rounded border border-neutral-300 px-2 py-1 text-sm font-mono"
        />
      </td>
      <td className="px-4 py-2">
        <select
          value={color ?? ""}
          onChange={(e) => setColor(e.target.value || null)}
          className="rounded border border-neutral-300 px-2 py-1 text-sm"
        >
          <option value="">— keine —</option>
          {COLORS.map((c) => (
            <option key={c.v} value={c.v}>
              {c.name}
            </option>
          ))}
        </select>
      </td>
      <td className="px-4 py-2 text-xs text-neutral-500">{emp.active ? "Aktiv" : "Inaktiv"}</td>
      <td className="px-4 py-2 text-right space-x-2">
        {error && <span className="text-rose-600 text-xs">{error}</span>}
        <button onClick={save} disabled={pending} className="text-sm text-neutral-900 font-medium">
          <Save size={14} className="inline" /> Speichern
        </button>
        <button onClick={onCancel} className="text-sm text-neutral-500">
          <X size={14} className="inline" />
        </button>
      </td>
    </tr>
  );
}

function ToggleActive({ id, active }: { id: string; active: boolean }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <button
      disabled={pending}
      onClick={() =>
        start(async () => {
          await setSalonEmployeeActive({ id, active: !active });
          router.refresh();
        })
      }
      className="text-sm text-neutral-700 hover:text-neutral-900"
    >
      {active ? "Deaktivieren" : "Aktivieren"}
    </button>
  );
}
