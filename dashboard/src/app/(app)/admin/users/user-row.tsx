"use client";

import { useState, useTransition } from "react";
import { Check, X, UserCheck, Shield } from "lucide-react";
import { approveUser, rejectUser } from "@/lib/actions/auth";
import type { Supplier } from "@/lib/types";

interface UserProfile {
  id: string;
  email: string;
  username: string | null;
  display_name: string | null;
  is_admin: boolean;
  approved: boolean;
  supplier_id: string | null;
  created_at: string;
}

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

  function handleApprove() {
    setError(null);
    startTransition(async () => {
      const res = await approveUser(profile.id, supplierId || null);
      if (res?.error) setError(res.error);
      else setDone(true);
    });
  }

  function handleReject() {
    if (!confirm(`Benutzer "${profile.display_name || profile.username || profile.email}" wirklich ablehnen und löschen?`))
      return;
    setError(null);
    startTransition(async () => {
      const res = await rejectUser(profile.id);
      if (res?.error) setError(res.error);
      else setDone(true);
    });
  }

  if (done) {
    return (
      <div className="px-5 py-4 text-sm text-neutral-400">
        {isPending ? "Erledigt — Seite neu laden für Aktualisierung" : "Aktualisiert"}
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
          <span className="text-neutral-300">·</span>
          <span>{created}</span>
          {!isPending && supplierName && (
            <>
              <span className="text-neutral-300">·</span>
              <span className="text-indigo-600">{supplierName}</span>
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
            title="Ablehnen & löschen"
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-600 text-white hover:bg-red-700 transition"
          >
            <X size={14} /> Ablehnen
          </button>
        </div>
      ) : (
        <div className="shrink-0">
          {profile.approved && !profile.is_admin && (
            <span className="inline-flex items-center gap-1 text-xs text-emerald-600">
              <UserCheck size={14} /> Freigegeben
            </span>
          )}
        </div>
      )}

      {error && <span className="text-xs text-red-600">{error}</span>}
    </div>
  );
}
