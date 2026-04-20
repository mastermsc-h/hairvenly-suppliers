"use client";

import { useState, useTransition } from "react";
import { Plus, X, UserPlus } from "lucide-react";
import { createUser } from "@/lib/actions/auth";
import type { Supplier } from "@/lib/types";
import { FEATURE_KEYS } from "@/lib/types";

const ROLE_OPTIONS = [
  { value: "employee", label: "Mitarbeiter" },
  { value: "supplier", label: "Lieferant" },
  { value: "admin", label: "Admin" },
] as const;

const FEATURE_LABELS: Record<string, string> = {
  prices: "Preistabellen",
  debt: "Schulden / Offene Betr\u00E4ge",
  invoices: "Rechnungen / EK-Preise",
  documents: "Dokumente (Bestellungen)",
  overview_docs: "\u00DCbersicht hochladen",
  suppliers: "Lieferanten-Verwaltung",
  users: "Benutzer-Verwaltung",
  wizard: "Neue Bestellung (Wizard)",
  catalog: "Farbcodes / Produktkatalog",
  stock: "Produktlager",
  charts: "Dashboard-Charts",
  supplier_kg: "Kg pro Lieferant",
  finances: "Finanzen",
};

const DEFAULT_EMPLOYEE_DENIED = ["prices", "debt", "invoices", "documents", "overview_docs"];

export default function CreateUserForm({ suppliers }: { suppliers: Supplier[] }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState("employee");
  const [supplierId, setSupplierId] = useState("");
  const [denied, setDenied] = useState<string[]>(DEFAULT_EMPLOYEE_DENIED);

  function reset() {
    setUsername("");
    setEmail("");
    setDisplayName("");
    setPassword("");
    setRole("employee");
    setSupplierId("");
    setDenied(DEFAULT_EMPLOYEE_DENIED);
    setError(null);
    setSuccess(false);
  }

  function handleSubmit() {
    setError(null);
    const fd = new FormData();
    fd.set("username", username);
    fd.set("email", email);
    fd.set("display_name", displayName);
    fd.set("password", password);
    fd.set("role", role);
    fd.set("supplier_id", role === "supplier" ? supplierId : "");
    fd.set("denied_features", role === "employee" ? denied.join(",") : "");
    startTransition(async () => {
      const res = await createUser(fd);
      if (res?.error) {
        setError(res.error);
      } else {
        setSuccess(true);
        setTimeout(() => {
          reset();
          setOpen(false);
        }, 1500);
      }
    });
  }

  function toggleDenied(feature: string) {
    setDenied((prev) =>
      prev.includes(feature) ? prev.filter((f) => f !== feature) : [...prev, feature],
    );
  }

  if (!open) {
    return (
      <button
        onClick={() => { reset(); setOpen(true); }}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-neutral-900 text-white hover:bg-neutral-800 transition"
      >
        <Plus size={16} /> Neuen Benutzer anlegen
      </button>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-neutral-900 flex items-center gap-2">
          <UserPlus size={16} /> Neuen Benutzer anlegen
        </h3>
        <button onClick={() => setOpen(false)} className="text-neutral-400 hover:text-neutral-600">
          <X size={16} />
        </button>
      </div>

      <div className={`px-5 py-4 space-y-4 ${pending ? "opacity-50 pointer-events-none" : ""}`}>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-medium text-neutral-600">Benutzername *</span>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="z.B. thao"
              className="mt-1 block w-full text-sm rounded-lg border border-neutral-300 px-3 py-2 bg-white focus:ring-2 focus:ring-neutral-900"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-neutral-600">Anzeigename</span>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="z.B. Thao Nguyen"
              className="mt-1 block w-full text-sm rounded-lg border border-neutral-300 px-3 py-2 bg-white focus:ring-2 focus:ring-neutral-900"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-neutral-600">E-Mail *</span>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="thao@example.com"
              className="mt-1 block w-full text-sm rounded-lg border border-neutral-300 px-3 py-2 bg-white focus:ring-2 focus:ring-neutral-900"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-neutral-600">Passwort *</span>
            <input
              type="text"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Mind. 6 Zeichen"
              className="mt-1 block w-full text-sm rounded-lg border border-neutral-300 px-3 py-2 bg-white focus:ring-2 focus:ring-neutral-900"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-neutral-600">Rolle</span>
            <select
              value={role}
              onChange={(e) => setRole(e.target.value)}
              className="mt-1 block w-full text-sm rounded-lg border border-neutral-300 px-3 py-2 bg-white focus:ring-2 focus:ring-neutral-900"
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select>
          </label>
          {role === "supplier" && (
            <label className="block">
              <span className="text-xs font-medium text-neutral-600">Lieferant</span>
              <select
                value={supplierId}
                onChange={(e) => setSupplierId(e.target.value)}
                className="mt-1 block w-full text-sm rounded-lg border border-neutral-300 px-3 py-2 bg-white focus:ring-2 focus:ring-neutral-900"
              >
                <option value="">Kein Lieferant</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
          )}
        </div>

        {role === "employee" && (
          <div>
            <div className="text-xs font-medium text-neutral-600 mb-2">Berechtigungen</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {FEATURE_KEYS.map((key) => (
                <label key={key} className="flex items-center gap-2 text-sm cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={!denied.includes(key)}
                    onChange={() => toggleDenied(key)}
                    className="rounded border-neutral-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span className={denied.includes(key) ? "text-neutral-400" : "text-neutral-700"}>
                    {FEATURE_LABELS[key] ?? key}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        {error && <div className="text-sm text-red-600">{error}</div>}
        {success && <div className="text-sm text-emerald-600">Benutzer erfolgreich angelegt!</div>}

        <div className="flex items-center gap-2">
          <button
            onClick={handleSubmit}
            disabled={pending}
            className="inline-flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium bg-neutral-900 text-white hover:bg-neutral-800 transition disabled:opacity-50"
          >
            <UserPlus size={14} /> Anlegen
          </button>
          <button
            onClick={() => setOpen(false)}
            disabled={pending}
            className="inline-flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium bg-neutral-100 text-neutral-700 hover:bg-neutral-200 transition"
          >
            Abbrechen
          </button>
        </div>
      </div>
    </div>
  );
}
