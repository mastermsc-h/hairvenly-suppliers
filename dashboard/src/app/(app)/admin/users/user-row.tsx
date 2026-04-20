"use client";

import { useState, useTransition } from "react";
import { Check, X, UserCheck, Shield, Pencil, Users, Building2, KeyRound } from "lucide-react";
import { approveUser, rejectUser, updateUser, resetPassword } from "@/lib/actions/auth";
import type { Supplier } from "@/lib/types";
import { FEATURE_KEYS } from "@/lib/types";

interface UserProfile {
  id: string;
  email: string;
  username: string | null;
  display_name: string | null;
  is_admin: boolean;
  approved: boolean;
  supplier_id: string | null;
  language: string;
  created_at: string;
  role: string;
  denied_features: string[];
}

const LANGUAGE_OPTIONS = [
  { value: "de", label: "\u{1F1E9}\u{1F1EA} Deutsch" },
  { value: "en", label: "\u{1F1EC}\u{1F1E7} English" },
  { value: "tr", label: "\u{1F1F9}\u{1F1F7} T\u00FCrk\u00E7e" },
] as const;

const ROLE_OPTIONS = [
  { value: "admin", label: "Admin", icon: Shield },
  { value: "employee", label: "Mitarbeiter", icon: Users },
  { value: "supplier", label: "Lieferant", icon: Building2 },
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

export default function UserRow({
  profile,
  suppliers,
  isPending,
}: {
  profile: UserProfile;
  suppliers: Supplier[];
  isPending: boolean;
}) {
  const [supplierId, setSupplierId] = useState(profile.supplier_id ?? "");
  const [pendingRole, setPendingRole] = useState<string>(profile.role || (profile.supplier_id ? "supplier" : "employee"));
  const [pendingDenied, setPendingDenied] = useState<string[]>(DEFAULT_EMPLOYEE_DENIED);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [editing, setEditing] = useState(false);

  // Edit form state
  const [editUsername, setEditUsername] = useState(profile.username ?? "");
  const [editDisplayName, setEditDisplayName] = useState(profile.display_name ?? "");
  const [editLanguage, setEditLanguage] = useState(profile.language ?? "de");
  const [editSupplierId, setEditSupplierId] = useState(profile.supplier_id ?? "");
  const [editRole, setEditRole] = useState(profile.role || "supplier");
  const [editDenied, setEditDenied] = useState<string[]>(profile.denied_features ?? []);
  const [newPassword, setNewPassword] = useState("");
  const [passwordMsg, setPasswordMsg] = useState<string | null>(null);

  function handleResetPassword() {
    if (!newPassword || newPassword.length < 6) {
      setPasswordMsg("Mind. 6 Zeichen");
      return;
    }
    setPasswordMsg(null);
    startTransition(async () => {
      const res = await resetPassword(profile.id, newPassword);
      if (res?.error) setPasswordMsg(res.error);
      else {
        setPasswordMsg("Passwort ge\u00E4ndert");
        setNewPassword("");
      }
    });
  }

  function handleApprove() {
    setError(null);
    const role = pendingRole;
    const denied = role === "employee" ? pendingDenied : [];
    const sid = role === "supplier" ? (supplierId || null) : null;
    startTransition(async () => {
      const res = await approveUser(profile.id, sid, role, denied);
      if (res?.error) setError(res.error);
      else setDone(true);
    });
  }

  function handleReject() {
    if (!confirm(`Benutzer "${profile.display_name || profile.username || profile.email}" wirklich ablehnen und l\u00F6schen?`))
      return;
    setError(null);
    startTransition(async () => {
      const res = await rejectUser(profile.id);
      if (res?.error) setError(res.error);
      else setDone(true);
    });
  }

  function handleEdit() {
    setEditUsername(profile.username ?? "");
    setEditDisplayName(profile.display_name ?? "");
    setEditLanguage(profile.language ?? "de");
    setEditSupplierId(profile.supplier_id ?? "");
    setEditRole(profile.role || "supplier");
    setEditDenied(profile.denied_features ?? []);
    setEditing(true);
    setError(null);
  }

  function handleCancelEdit() {
    setEditing(false);
    setError(null);
  }

  function handleSaveEdit() {
    setError(null);
    const fd = new FormData();
    fd.set("username", editUsername);
    fd.set("display_name", editDisplayName);
    fd.set("language", editLanguage);
    fd.set("supplier_id", editRole === "supplier" ? editSupplierId : "");
    fd.set("role", editRole);
    fd.set("denied_features", editRole === "employee" ? editDenied.join(",") : "");
    startTransition(async () => {
      const res = await updateUser(profile.id, fd);
      if (res?.error) setError(res.error);
      else setDone(true);
    });
  }

  function toggleDenied(feature: string, list: string[], setter: (v: string[]) => void) {
    setter(list.includes(feature) ? list.filter((f) => f !== feature) : [...list, feature]);
  }

  if (done) {
    return (
      <div className="px-5 py-4 text-sm text-neutral-400">
        {isPending ? "Erledigt \u2014 Seite neu laden f\u00FCr Aktualisierung" : "Aktualisiert"}
      </div>
    );
  }

  const created = new Date(profile.created_at).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  const supplierName = profile.supplier_id
    ? suppliers.find((s) => s.id === profile.supplier_id)?.name
    : null;

  const langLabel = LANGUAGE_OPTIONS.find((l) => l.value === profile.language)?.label ?? profile.language;

  const roleLabel = ROLE_OPTIONS.find((r) => r.value === profile.role)?.label ?? profile.role;
  const RoleIcon = ROLE_OPTIONS.find((r) => r.value === profile.role)?.icon ?? Users;

  // Inline edit mode for active users
  if (editing && !isPending) {
    return (
      <div className={`px-5 py-4 space-y-3 ${pending ? "opacity-50" : ""}`}>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs font-medium text-neutral-600">Benutzername</span>
            <input
              type="text"
              value={editUsername}
              onChange={(e) => setEditUsername(e.target.value)}
              className="mt-1 block w-full text-sm rounded-lg border border-neutral-300 px-3 py-1.5 bg-white"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-neutral-600">Anzeigename</span>
            <input
              type="text"
              value={editDisplayName}
              onChange={(e) => setEditDisplayName(e.target.value)}
              className="mt-1 block w-full text-sm rounded-lg border border-neutral-300 px-3 py-1.5 bg-white"
            />
          </label>
          <label className="block">
            <span className="text-xs font-medium text-neutral-600">Sprache</span>
            <select
              value={editLanguage}
              onChange={(e) => setEditLanguage(e.target.value)}
              className="mt-1 block w-full text-sm rounded-lg border border-neutral-300 px-3 py-1.5 bg-white"
            >
              {LANGUAGE_OPTIONS.map((l) => (
                <option key={l.value} value={l.value}>
                  {l.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="text-xs font-medium text-neutral-600">Rolle</span>
            <select
              value={editRole}
              onChange={(e) => setEditRole(e.target.value)}
              className="mt-1 block w-full text-sm rounded-lg border border-neutral-300 px-3 py-1.5 bg-white"
            >
              {ROLE_OPTIONS.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </label>
          {editRole === "supplier" && (
            <label className="block col-span-2">
              <span className="text-xs font-medium text-neutral-600">Lieferant</span>
              <select
                value={editSupplierId}
                onChange={(e) => setEditSupplierId(e.target.value)}
                className="mt-1 block w-full text-sm rounded-lg border border-neutral-300 px-3 py-1.5 bg-white"
              >
                <option value="">Kein Lieferant</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>

        {editRole === "employee" && (
          <div>
            <div className="text-xs font-medium text-neutral-600 mb-2">Berechtigungen</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {FEATURE_KEYS.map((key) => (
                <label
                  key={key}
                  className="flex items-center gap-2 text-sm cursor-pointer select-none"
                >
                  <input
                    type="checkbox"
                    checked={!editDenied.includes(key)}
                    onChange={() => toggleDenied(key, editDenied, setEditDenied)}
                    className="rounded border-neutral-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span className={editDenied.includes(key) ? "text-neutral-400" : "text-neutral-700"}>
                    {FEATURE_LABELS[key] ?? key}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        <div>
          <div className="text-xs font-medium text-neutral-600 mb-1.5">Passwort zurücksetzen</div>
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="Neues Passwort"
              className="text-sm rounded-lg border border-neutral-300 px-3 py-1.5 bg-white w-48"
            />
            <button
              onClick={handleResetPassword}
              disabled={pending || !newPassword}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-amber-600 text-white hover:bg-amber-700 transition disabled:opacity-50"
            >
              <KeyRound size={14} /> Zurücksetzen
            </button>
            {passwordMsg && (
              <span className={`text-xs ${passwordMsg.includes("ge\u00E4ndert") ? "text-emerald-600" : "text-red-600"}`}>
                {passwordMsg}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleSaveEdit}
            disabled={pending}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-700 transition"
          >
            <Check size={14} /> Speichern
          </button>
          <button
            onClick={handleCancelEdit}
            disabled={pending}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-neutral-100 text-neutral-700 hover:bg-neutral-200 transition"
          >
            <X size={14} /> Abbrechen
          </button>
          {error && <span className="text-xs text-red-600">{error}</span>}
        </div>
      </div>
    );
  }

  // Pending approval view
  if (isPending) {
    return (
      <div className={`px-5 py-4 space-y-3 ${pending ? "opacity-50" : ""}`}>
        <div className="flex items-center gap-4">
          <div className="flex-1 min-w-0">
            <div className="font-medium text-neutral-900 truncate">
              {profile.display_name || profile.username || profile.email}
            </div>
            <div className="text-xs text-neutral-500 mt-0.5 flex items-center gap-2 flex-wrap">
              {profile.username && <span>@{profile.username}</span>}
              <span>{profile.email}</span>
              <span className="text-neutral-300">&middot;</span>
              <span>{created}</span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <select
            value={pendingRole}
            onChange={(e) => setPendingRole(e.target.value)}
            className="text-xs rounded-lg border border-neutral-300 px-2 py-1.5 bg-white"
          >
            {ROLE_OPTIONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>

          {pendingRole === "supplier" && (
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className="text-xs rounded-lg border border-neutral-300 px-2 py-1.5 bg-white"
            >
              <option value="">Kein Lieferant</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          )}

          <button
            onClick={handleApprove}
            disabled={pending}
            title="Freigeben"
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-700 transition"
          >
            <Check size={14} /> Freigeben
          </button>
          <button
            onClick={handleReject}
            disabled={pending}
            title="Ablehnen & l\u00F6schen"
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-600 text-white hover:bg-red-700 transition"
          >
            <X size={14} /> Ablehnen
          </button>
        </div>

        {pendingRole === "employee" && (
          <div>
            <div className="text-xs font-medium text-neutral-600 mb-1.5">Berechtigungen</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
              {FEATURE_KEYS.map((key) => (
                <label
                  key={key}
                  className="flex items-center gap-2 text-xs cursor-pointer select-none"
                >
                  <input
                    type="checkbox"
                    checked={!pendingDenied.includes(key)}
                    onChange={() => toggleDenied(key, pendingDenied, setPendingDenied)}
                    className="rounded border-neutral-300 text-emerald-600 focus:ring-emerald-500"
                  />
                  <span className={pendingDenied.includes(key) ? "text-neutral-400" : "text-neutral-700"}>
                    {FEATURE_LABELS[key] ?? key}
                  </span>
                </label>
              ))}
            </div>
          </div>
        )}

        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>
    );
  }

  // Active user display
  return (
    <div className={`px-5 py-4 flex items-center gap-4 ${pending ? "opacity-50" : ""}`}>
      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-neutral-900 truncate">
            {profile.display_name || profile.username || profile.email}
          </span>
          <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium ${
            profile.role === "admin"
              ? "bg-indigo-50 text-indigo-700"
              : profile.role === "employee"
              ? "bg-amber-50 text-amber-700"
              : "bg-emerald-50 text-emerald-700"
          }`}>
            <RoleIcon size={10} /> {roleLabel}
          </span>
        </div>
        <div className="text-xs text-neutral-500 mt-0.5 flex items-center gap-2 flex-wrap">
          {profile.username && <span>@{profile.username}</span>}
          <span>{profile.email}</span>
          <span className="text-neutral-300">&middot;</span>
          <span>{created}</span>
          {supplierName && (
            <>
              <span className="text-neutral-300">&middot;</span>
              <span className="text-indigo-600">{supplierName}</span>
            </>
          )}
          {profile.language && (
            <>
              <span className="text-neutral-300">&middot;</span>
              <span>{langLabel}</span>
            </>
          )}
        </div>
        {profile.role === "employee" && profile.denied_features.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1">
            {profile.denied_features.map((f) => (
              <span key={f} className="inline-flex px-1.5 py-0.5 rounded text-[9px] font-medium bg-neutral-100 text-neutral-400">
                {FEATURE_LABELS[f] ?? f}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-2 shrink-0">
        {profile.approved && !profile.is_admin && profile.role !== "employee" && (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
            <UserCheck size={14} /> Freigegeben
          </span>
        )}
        <button
          onClick={handleEdit}
          disabled={pending}
          title="Bearbeiten"
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-neutral-100 text-neutral-700 hover:bg-neutral-200 transition"
        >
          <Pencil size={14} /> Bearbeiten
        </button>
      </div>

      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
