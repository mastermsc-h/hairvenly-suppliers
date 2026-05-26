"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { X, Save } from "lucide-react";
import { updateAppointmentRequest } from "@/lib/actions/chat-appointments";
import { SERVICE_TYPE_LABELS, type AppointmentServiceType } from "@/lib/appointments-constants";

interface Props {
  appointmentId: string;
  initial: {
    serviceType: AppointmentServiceType;
    requestedDate: string;
    requestedTime: string;
    notes: string;
  };
  onClose: () => void;
}

export default function AppointmentFormModal({ appointmentId, initial, onClose }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [serviceType, setServiceType] = useState<AppointmentServiceType>(initial.serviceType);
  const [requestedDate, setRequestedDate] = useState<string>(initial.requestedDate);
  const [requestedTime, setRequestedTime] = useState<string>(initial.requestedTime);
  const [notes, setNotes] = useState<string>(initial.notes);

  function handleSave() {
    startTransition(async () => {
      try {
        await updateAppointmentRequest(appointmentId, {
          serviceType,
          requestedDate: requestedDate || null,
          requestedTime: requestedTime || null,
          notes: notes || null,
        });
        onClose();
        router.refresh();
      } catch (e) {
        alert(`Speichern fehlgeschlagen: ${(e as Error).message}`);
      }
    });
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-neutral-900">Termin-Anfrage bearbeiten</h3>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700"><X size={18} /></button>
        </div>

        <div>
          <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide block mb-1">Service-Typ *</label>
          <select
            value={serviceType}
            onChange={(e) => setServiceType(e.target.value as AppointmentServiceType)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900 bg-white"
          >
            {(Object.keys(SERVICE_TYPE_LABELS) as AppointmentServiceType[]).map(k => (
              <option key={k} value={k}>{SERVICE_TYPE_LABELS[k]}</option>
            ))}
          </select>
        </div>

        <div>
          <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide block mb-1">Wunsch-Datum <span className="text-neutral-400 normal-case">(optional)</span></label>
          <input
            type="date"
            value={requestedDate}
            onChange={(e) => setRequestedDate(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900"
          />
        </div>

        <div>
          <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide block mb-1">Wunsch-Zeit <span className="text-neutral-400 normal-case">(z.B. „vormittags", „ab 14 Uhr")</span></label>
          <input
            type="text"
            value={requestedTime}
            onChange={(e) => setRequestedTime(e.target.value)}
            placeholder="vormittags / ab 14 Uhr / abends"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900"
          />
        </div>

        <div>
          <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide block mb-1">Notizen</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="z.B. Kundin hat dünnes Haar, will mehr Volumen"
            className="w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900 resize-none"
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} disabled={pending} className="text-sm px-4 py-2 rounded-lg border border-neutral-300 text-neutral-600 hover:bg-neutral-50">Abbrechen</button>
          <button
            onClick={handleSave}
            disabled={pending}
            className="bg-neutral-900 text-white font-medium rounded-lg px-4 py-2 text-sm inline-flex items-center gap-1.5 disabled:opacity-50"
          >
            <Save size={14} /> {pending ? "Speichere…" : "Speichern"}
          </button>
        </div>
      </div>
    </div>
  );
}
