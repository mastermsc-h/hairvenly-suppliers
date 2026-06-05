"use client";

import { useState, useTransition } from "react";
import { Pencil, X, Trash2, Loader2 } from "lucide-react";
import { updateInboundDelivery, deleteInboundDelivery } from "@/lib/actions/inbound";
import type { InboundDelivery } from "@/lib/types";

export default function EditPanel({ delivery: d }: { delivery: InboundDelivery }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [deletePending, startDelete] = useTransition();

  function handleSave(formData: FormData) {
    formData.set("id", d.id);
    startTransition(async () => {
      await updateInboundDelivery(formData);
      setOpen(false);
    });
  }

  function handleDelete() {
    if (!confirm(`Wareneingang "${d.label || d.id}" und alle Positionen löschen?`)) return;
    startDelete(() => deleteInboundDelivery(d.id));
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm font-medium bg-neutral-100 hover:bg-neutral-200 text-neutral-700"
      >
        <Pencil size={14} /> Bearbeiten
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-xl w-full max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-neutral-200">
              <h3 className="font-semibold text-neutral-900">Wareneingang bearbeiten</h3>
              <button type="button" onClick={() => setOpen(false)} className="p-1 rounded hover:bg-neutral-100">
                <X size={18} className="text-neutral-500" />
              </button>
            </div>
            <form action={handleSave} className="p-5 space-y-4">
              <div>
                <label className="block text-xs font-medium text-neutral-600 uppercase tracking-wide mb-1">Bezeichnung</label>
                <input
                  name="label"
                  type="text"
                  defaultValue={d.label ?? ""}
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-neutral-600 uppercase tracking-wide mb-1">Tracking-Nummer</label>
                  <input name="tracking_number" type="text" defaultValue={d.tracking_number ?? ""} className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-600 uppercase tracking-wide mb-1">Tracking-URL</label>
                  <input name="tracking_url" type="url" defaultValue={d.tracking_url ?? ""} className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900" />
                </div>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-neutral-600 uppercase tracking-wide mb-1">ETA</label>
                  <input name="eta" type="date" defaultValue={d.eta ?? ""} className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-600 uppercase tracking-wide mb-1">Verschickt</label>
                  <input name="shipped_at" type="date" defaultValue={d.shipped_at ?? ""} className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-neutral-600 uppercase tracking-wide mb-1">Angekommen</label>
                  <input name="arrived_at" type="date" defaultValue={d.arrived_at ?? ""} className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900" />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-neutral-600 uppercase tracking-wide mb-1">Notizen</label>
                <textarea name="notes" rows={3} defaultValue={d.notes ?? ""} className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900" />
              </div>
              <div className="flex items-center justify-between pt-2">
                <button
                  type="button"
                  onClick={handleDelete}
                  disabled={deletePending}
                  className="inline-flex items-center gap-1 px-3 py-2 rounded-lg text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  {deletePending ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                  Löschen
                </button>
                <div className="flex gap-2">
                  <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 rounded-lg text-sm font-medium bg-neutral-100 hover:bg-neutral-200 text-neutral-700">
                    Abbrechen
                  </button>
                  <button
                    type="submit"
                    disabled={pending}
                    className="inline-flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium bg-neutral-900 hover:bg-neutral-800 text-white disabled:opacity-50"
                  >
                    {pending && <Loader2 size={14} className="animate-spin" />}
                    Speichern
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}
