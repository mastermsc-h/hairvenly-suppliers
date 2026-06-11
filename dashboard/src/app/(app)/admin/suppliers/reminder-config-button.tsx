"use client";

import { useState, useTransition } from "react";
import { Bell, X, Loader2 } from "lucide-react";
import { updateSupplierBasic } from "@/lib/actions/suppliers";

interface Props {
  supplierId: string;
  supplierName: string;
  enabled: boolean;
  startDate: string | null;
  intervalDays: number;
  lastReminded: string | null;
}

function dePreview(startDate: string | null, intervalDays: number): string {
  if (!startDate) return "—";
  const start = new Date(startDate + "T00:00:00Z");
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const diff = Math.floor((today.getTime() - start.getTime()) / 86400000);
  if (diff < 0) {
    return `nächste Bestellung: ${start.toLocaleDateString("de-DE")}`;
  }
  const k = Math.floor(diff / intervalDays);
  const cycle = new Date(start);
  cycle.setUTCDate(cycle.getUTCDate() + k * intervalDays);
  const next = new Date(cycle);
  next.setUTCDate(next.getUTCDate() + intervalDays);
  return `aktueller Zyklus: ${cycle.toLocaleDateString("de-DE")} · nächster: ${next.toLocaleDateString("de-DE")}`;
}

export default function ReminderConfigButton(props: Props) {
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState(props.enabled);
  const [startDate, setStartDate] = useState(props.startDate ?? "");
  const [interval, setInterval] = useState(String(props.intervalDays || 14));
  const [pending, startTransition] = useTransition();
  const [err, setErr] = useState<string | null>(null);

  function save() {
    setErr(null);
    const fd = new FormData();
    fd.set("name", props.supplierName);
    if (enabled) fd.set("order_cycle_enabled", "on");
    else fd.set("order_cycle_enabled", "");
    fd.set("order_cycle_start_date", startDate);
    fd.set("order_cycle_interval_days", interval);
    startTransition(async () => {
      const res = await updateSupplierBasic(props.supplierId, fd);
      if (res?.error) setErr(res.error);
      else setOpen(false);
    });
  }

  const preview = dePreview(startDate || null, Number(interval) || 14);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`p-1.5 rounded transition ${props.enabled ? "text-amber-600 hover:bg-amber-50" : "text-neutral-400 hover:bg-neutral-100"}`}
        title={props.enabled ? "Bestell-Reminder aktiv — konfigurieren" : "Bestell-Reminder einrichten"}
      >
        <Bell size={14} fill={props.enabled ? "currentColor" : "none"} />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setOpen(false)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-neutral-200">
              <h3 className="font-semibold text-neutral-900 inline-flex items-center gap-2">
                <Bell size={16} /> Bestell-Reminder · {props.supplierName}
              </h3>
              <button type="button" onClick={() => setOpen(false)} className="p-1 rounded hover:bg-neutral-100">
                <X size={18} className="text-neutral-500" />
              </button>
            </div>
            <div className="p-5 space-y-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={enabled}
                  onChange={(e) => setEnabled(e.target.checked)}
                  className="rounded"
                />
                <span className="font-medium text-neutral-900">Reminder-Mail aktiv</span>
              </label>
              <p className="text-xs text-neutral-500 -mt-2 pl-6">
                Alle Admins / Mitarbeiter mit Bestell-Recht bekommen täglich um 12:00 eine Mail, sobald ein neuer Zyklus fällig ist — bis eine Bestellung angelegt wurde.
              </p>

              <div>
                <label className="block text-xs font-medium text-neutral-600 uppercase tracking-wide mb-1">Anker-Datum</label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900"
                />
                <p className="text-xs text-neutral-500 mt-1">
                  Ab diesem Datum läuft das Raster (z.B. 1. eines Monats). Das nächste Zyklus-Datum ist Anker + Intervall.
                </p>
              </div>

              <div>
                <label className="block text-xs font-medium text-neutral-600 uppercase tracking-wide mb-1">Intervall (Tage)</label>
                <input
                  type="number"
                  min={1}
                  value={interval}
                  onChange={(e) => setInterval(e.target.value)}
                  className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900"
                />
                <p className="text-xs text-neutral-500 mt-1">Standard 14 = alle 2 Wochen.</p>
              </div>

              <div className="bg-neutral-50 border border-neutral-200 rounded p-2 text-xs text-neutral-700">
                <strong>Vorschau:</strong> {preview}
                {props.lastReminded && (
                  <div className="mt-1 text-neutral-500">Letzte Reminder-Mail: {new Date(props.lastReminded).toLocaleDateString("de-DE")}</div>
                )}
              </div>

              {err && <div className="text-xs text-red-600">{err}</div>}

              <div className="flex justify-end gap-2 pt-2 border-t border-neutral-100">
                <button type="button" onClick={() => setOpen(false)} className="px-4 py-2 rounded-lg text-sm font-medium bg-neutral-100 hover:bg-neutral-200 text-neutral-700">
                  Abbrechen
                </button>
                <button
                  type="button"
                  onClick={save}
                  disabled={pending}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-neutral-900 hover:bg-neutral-800 text-white disabled:opacity-50"
                >
                  {pending && <Loader2 size={14} className="animate-spin" />}
                  Speichern
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
