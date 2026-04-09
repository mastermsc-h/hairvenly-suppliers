"use client";

import { useState, useTransition } from "react";
import { Plus, X } from "lucide-react";
import { createSupplier } from "@/lib/actions/suppliers";

export default function NewSupplierForm() {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const formData = new FormData(e.currentTarget);
    const form = e.currentTarget;
    startTransition(async () => {
      const res = await createSupplier(formData);
      if (res?.error) {
        setError(res.error);
      } else {
        form.reset();
        setOpen(false);
      }
    });
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-700 transition"
      >
        <Plus size={16} /> Neuer Lieferant
      </button>
    );
  }

  return (
    <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm p-5">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-neutral-900">Neuer Lieferant</h2>
        <button
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          className="p-1 rounded-lg hover:bg-neutral-100 transition text-neutral-500"
        >
          <X size={18} />
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-neutral-600 mb-1">
              Name <span className="text-red-500">*</span>
            </label>
            <input
              name="name"
              required
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              placeholder="Lieferantenname"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-600 mb-1">E-Mail</label>
            <input
              name="email"
              type="email"
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              placeholder="lieferant@beispiel.de"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-600 mb-1">Telefon</label>
            <input
              name="phone"
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
              placeholder="+49 ..."
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-neutral-600 mb-1">Reihenfolge</label>
            <input
              name="sort_order"
              type="number"
              defaultValue="0"
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-600 mb-1">Adresse</label>
          <input
            name="address"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
            placeholder="Straße, PLZ Ort, Land"
          />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex items-center gap-3">
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-emerald-600 text-white hover:bg-emerald-700 transition disabled:opacity-50"
          >
            <Plus size={16} /> Anlegen
          </button>
          <button
            type="button"
            onClick={() => {
              setOpen(false);
              setError(null);
            }}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-neutral-100 text-neutral-700 hover:bg-neutral-200 transition"
          >
            Abbrechen
          </button>
        </div>
      </form>
    </div>
  );
}
