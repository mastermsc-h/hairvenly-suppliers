"use client";

import { useState, useTransition } from "react";
import { Check, X, UserCheck, Shield, Pencil } from "lucide-react";
import { approveUser, rejectUser, updateUser } from "@/lib/actions/auth";
import type { Supplier } from "@/lib/types";

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
}

const LANGUAGE_OPTIONS = [
  { value: "de", label: "\u{1F1E9}\u{1F1EA} Deutsch" },
  { value: "en", label: "\u{1F1EC}\u{1F1E7} English" },
  { value: "tr", label: "\u{1F1F9}\u{1F1F7} T\u00FCrk\u00E7e" },
] as const;

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
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [editing, setEditing] = useState(false);

  // Edit form state
  const [editUsername, setEditUsername] = useState(profile.username ?? "");
  const [editDisplayName, setEditDisplayName] = useState(profile.display_name ?? "");
  const [editLanguage, setEditLanguage] = useState(profile.language ?? "de");
  const [editSupplierId, setEditSupplierId] = useState(profile.supplier_id ?? "");

  function handleApprove() {
    setError(null);
    startTransition(async () => {
      const res = await approveUser(profile.id, supplierId || null);
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
    fd.set("supplier_id", editSupplierId);
    startTransition(async () => {
      const res = await updateUser(profile.id, fd);
      if (res?.error) setError(res.error);
      else setDone(true);
    });
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

  return (
    <div className={`px-5 py-4 flex items-center gap-4 ${pending ? "opacity-50" : ""}`}>
      {/* Info */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-neutral-900 truncate">
            {profile.display_name || profile.username || profile.email}
          </span>
          {profile.is_admin && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-50 text-indigo-700">
              <Shield size={10} /> Admin
            </span>
          )}
        </div>
        <div className="text-xs text-neutral-500 mt-0.5 flex items-center gap-2 flex-wrap">
          {profile.username && <span>@{profile.username}</span>}
          <span>{profile.email}</span>
          <span className="text-neutral-300">&middot;</span>
          <span>{created}</span>
          {!isPending && supplierName && (
            <>
              <span className="text-neutral-300">&middot;</span>
              <span className="text-indigo-600">{supplierName}</span>
            </>
          )}
          {!isPending && profile.language && (
            <>
              <span className="text-neutral-300">&middot;</span>
              <span>{langLabel}</span>
            </>
          )}
        </div>
      </div>

      {/* Actions */}
      {isPending ? (
        <div className="flex items-center gap-2 shrink-0">
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
      ) : (
        <div className="flex items-center gap-2 shrink-0">
          {profile.approved && !profile.is_admin && (
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
      )}

      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
