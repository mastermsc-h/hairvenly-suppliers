"use client";

import { useState, useTransition } from "react";
import { Pencil, Trash2, Check, X } from "lucide-react";
import { updateSupplierBasic, deleteSupplier } from "@/lib/actions/suppliers";
import type { Supplier } from "@/lib/types";

export default function SupplierRow({ supplier }: { supplier: Supplier }) {
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState(false);

  const [name, setName] = useState(supplier.name);
  const [email, setEmail] = useState(supplier.email ?? "");
  const [phone, setPhone] = useState(supplier.phone ?? "");
  const [address, setAddress] = useState(supplier.address ?? "");
  const [sortOrder, setSortOrder] = useState(String(supplier.sort_order));

  function handleCancel() {
    setName(supplier.name);
    setEmail(supplier.email ?? "");
    setPhone(supplier.phone ?? "");
    setAddress(supplier.address ?? "");
    setSortOrder(String(supplier.sort_order));
    setEditing(false);
    setError(null);
  }

  function handleSave() {
    setError(null);
    const formData = new FormData();
    formData.set("name", name);
    formData.set("email", email);
    formData.set("phone", phone);
    formData.set("address", address);
    formData.set("sort_order", sortOrder);
    startTransition(async () => {
      const res = await updateSupplierBasic(supplier.id, formData);
      if (res?.error) setError(res.error);
      else setEditing(false);
    });
  }

  function handleDelete() {
    if (
      !confirm(
        `Lieferant "${supplier.name}" wirklich löschen? Dies ist nur möglich, wenn keine Bestellungen verknüpft sind.`,
      )
    )
      return;
    setError(null);
    startTransition(async () => {
      const res = await deleteSupplier(supplier.id);
      if (res?.error) setError(res.error);
      else setDeleted(true);
    });
  }

  if (deleted) {
    return (
      <tr>
        <td colSpan={6} className="px-5 py-4 text-sm text-neutral-400">
          Lieferant gelöscht — Seite neu laden für Aktualisierung
        </td>
      </tr>
    );
  }

  const created = new Date(supplier.created_at).toLocaleDateString("de-DE", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });

  if (editing) {
    return (
      <tr className={pending ? "opacity-50" : ""}>
        <td className="px-5 py-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
            placeholder="Name *"
            required
          />
        </td>
        <td className="px-5 py-3">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
            placeholder="E-Mail"
            type="email"
          />
        </td>
        <td className="px-5 py-3">
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
            placeholder="Telefon"
          />
        </td>
        <td className="px-5 py-3">
          <input
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
            className="w-20 mx-auto block rounded-lg border border-neutral-300 px-2 py-1.5 text-sm text-center"
            placeholder="0"
            type="number"
          />
        </td>
        <td className="px-5 py-3">
          <input
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
            placeholder="Adresse"
          />
        </td>
        <td className="px-5 py-3">
          <div className="flex items-center justify-end gap-2">
            <button
              onClick={handleSave}
              disabled={pending || !name.trim()}
              title="Speichern"
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-600 text-white hover:bg-emerald-700 transition disabled:opacity-50"
            >
              <Check size={14} /> Speichern
            </button>
            <button
              onClick={handleCancel}
              disabled={pending}
              title="Abbrechen"
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-neutral-200 text-neutral-700 hover:bg-neutral-300 transition"
            >
              <X size={14} /> Abbrechen
            </button>
          </div>
          {error && <p className="text-xs text-red-600 mt-1 text-right">{error}</p>}
        </td>
      </tr>
    );
  }

  return (
    <tr className={`hover:bg-neutral-50 transition ${pending ? "opacity-50" : ""}`}>
      <td className="px-5 py-3 font-medium text-neutral-900">{supplier.name}</td>
      <td className="px-5 py-3 text-neutral-600">{supplier.email ?? "—"}</td>
      <td className="px-5 py-3 text-neutral-600">{supplier.phone ?? "—"}</td>
      <td className="px-5 py-3 text-center text-neutral-600">{supplier.sort_order}</td>
      <td className="px-5 py-3 text-neutral-500">{created}</td>
      <td className="px-5 py-3">
        <div className="flex items-center justify-end gap-2">
          <button
            onClick={() => setEditing(true)}
            title="Bearbeiten"
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-neutral-100 text-neutral-700 hover:bg-neutral-200 transition"
          >
            <Pencil size={14} /> Bearbeiten
          </button>
          <button
            onClick={handleDelete}
            disabled={pending}
            title="Löschen"
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-50 text-red-700 hover:bg-red-100 transition"
          >
            <Trash2 size={14} /> Löschen
          </button>
        </div>
        {error && <p className="text-xs text-red-600 mt-1 text-right">{error}</p>}
      </td>
    </tr>
  );
}
