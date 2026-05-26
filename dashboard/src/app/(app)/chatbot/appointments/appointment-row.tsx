"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Check, X, MessageSquare, Bot, User, Edit3, CalendarCheck, RotateCw, Trash2 } from "lucide-react";
import {
  confirmAppointment,
  rescheduleAppointment,
  cancelAppointment,
  completeAppointment,
  deleteAppointment,
} from "@/lib/actions/chat-appointments";
import type { AppointmentServiceType, AppointmentStatus } from "@/lib/appointments-constants";
import AppointmentFormModal from "./appointment-form-modal";

export interface Appointment {
  id: string;
  session_id: string | null;
  customer_name: string | null;
  channel: string | null;
  external_id: string | null;
  service_type: AppointmentServiceType;
  requested_date: string | null;
  requested_time: string | null;
  notes: string | null;
  status: AppointmentStatus;
  confirmed_at: string | null;
  confirmed_date: string | null;
  cancelled_at: string | null;
  cancel_reason: string | null;
  completed_at: string | null;
  requested_at: string;
  created_by_bot: boolean;
}

export default function AppointmentRow({
  appointment: a,
  statusBadge,
  serviceLabels,
}: {
  appointment: Appointment;
  statusBadge: { label: string; color: string };
  serviceLabels: Record<AppointmentServiceType, string>;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showConfirm, setShowConfirm] = useState(false);
  const [showEdit, setShowEdit] = useState(false);

  function handleCancel() {
    const reason = prompt("Grund für Storno (optional):") ?? undefined;
    startTransition(async () => {
      await cancelAppointment(a.id, reason);
      router.refresh();
    });
  }

  function handleReschedule() {
    const newDate = prompt("Neues Wunsch-Datum (YYYY-MM-DD, optional):") ?? undefined;
    startTransition(async () => {
      await rescheduleAppointment(a.id, newDate || undefined);
      router.refresh();
    });
  }

  function handleComplete() {
    if (!confirm("Termin als 'stattgefunden' markieren?")) return;
    startTransition(async () => {
      await completeAppointment(a.id);
      router.refresh();
    });
  }

  function handleDelete() {
    if (!confirm("Termin-Anfrage löschen?")) return;
    startTransition(async () => {
      await deleteAppointment(a.id);
      router.refresh();
    });
  }

  const requested = new Date(a.requested_at);
  const requestedStr = `${requested.toLocaleDateString("de-DE")} ${requested.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`;

  return (
    <>
      <li className="p-4 hover:bg-neutral-50">
        <div className="flex items-start gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            {/* Top: Status + Channel + Chat-Link */}
            <div className="flex items-center gap-2 mb-1 text-xs flex-wrap">
              <span className={`px-2 py-0.5 rounded-full font-medium ${statusBadge.color}`}>
                {statusBadge.label}
              </span>
              <span className="text-neutral-500">
                {a.channel === "instagram" ? "📷 Instagram" : a.channel === "whatsapp" ? "💬 WhatsApp" : "🌐 Web"}
              </span>
              {a.session_id && (
                <Link
                  href={`/chatbot/inbox/${a.session_id}`}
                  className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                >
                  <MessageSquare size={11} /> Chat öffnen
                </Link>
              )}
              {a.created_by_bot && (
                <span className="inline-flex items-center gap-1 bg-pink-50 text-pink-700 px-1.5 py-0.5 rounded-full text-[10px]">
                  <Bot size={10} /> Bot-Anlage
                </span>
              )}
              <span className="text-neutral-400 ml-auto">{requestedStr}</span>
            </div>

            {/* Customer */}
            <div className="flex items-center gap-2 mb-1">
              <User size={14} className="text-neutral-400" />
              <span className="text-sm font-semibold text-neutral-900">
                {a.customer_name || <span className="text-neutral-400 font-normal">Unbekannt</span>}
              </span>
            </div>

            {/* Service */}
            <div className="text-sm text-neutral-800">
              <span className="font-medium">{serviceLabels[a.service_type] || a.service_type}</span>
              {(a.requested_date || a.requested_time) && (
                <span className="text-neutral-500 ml-1">
                  — {[a.requested_date, a.requested_time].filter(Boolean).join(" · ")}
                </span>
              )}
            </div>

            {/* Confirmed Slot */}
            {a.confirmed_date && (
              <div className="text-xs text-green-700 mt-0.5">
                ✓ Bestätigt für {new Date(a.confirmed_date).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" })}
              </div>
            )}

            {/* Notes / Storno-Reason / Completed */}
            <div className="text-xs text-neutral-500 mt-0.5 space-y-0.5">
              {a.notes && <div className="italic">{a.notes}</div>}
              {a.status === "cancelled" && a.cancel_reason && (
                <div className="text-neutral-500">Storno: {a.cancel_reason}</div>
              )}
              {a.status === "completed" && a.completed_at && (
                <div className="text-neutral-600">Stattgefunden am {new Date(a.completed_at).toLocaleDateString("de-DE")}</div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-1.5 items-center flex-wrap">
            {(a.status === "pending" || a.status === "rescheduled") && (
              <>
                <button
                  onClick={() => setShowConfirm(true)}
                  disabled={pending}
                  className="text-xs px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 inline-flex items-center gap-1 disabled:opacity-50 font-medium"
                >
                  <CalendarCheck size={12} /> Bestätigen
                </button>
                <button
                  onClick={handleReschedule}
                  disabled={pending}
                  className="text-xs px-2.5 py-1.5 rounded-lg border border-neutral-300 text-neutral-600 hover:bg-neutral-50 inline-flex items-center gap-1"
                >
                  <RotateCw size={11} /> Verschieben
                </button>
              </>
            )}
            {a.status === "confirmed" && (
              <button
                onClick={handleComplete}
                disabled={pending}
                className="text-xs px-2.5 py-1.5 rounded-lg border border-green-300 text-green-700 hover:bg-green-50 inline-flex items-center gap-1"
              >
                <Check size={11} /> Erledigt
              </button>
            )}
            {(a.status === "pending" || a.status === "rescheduled" || a.status === "confirmed") && (
              <button
                onClick={handleCancel}
                disabled={pending}
                className="text-xs px-2.5 py-1.5 rounded-lg border border-neutral-300 text-neutral-600 hover:bg-neutral-50 inline-flex items-center gap-1"
              >
                <X size={11} /> Storno
              </button>
            )}
            <button
              onClick={() => setShowEdit(true)}
              disabled={pending}
              title="Felder bearbeiten"
              className="text-neutral-400 hover:text-neutral-700 p-1.5"
            >
              <Edit3 size={13} />
            </button>
            <button
              onClick={handleDelete}
              disabled={pending}
              title="Löschen"
              className="text-neutral-400 hover:text-red-600 p-1.5"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      </li>

      {showConfirm && (
        <ConfirmDialog
          appointment={a}
          onClose={() => setShowConfirm(false)}
          onConfirmed={() => { setShowConfirm(false); router.refresh(); }}
        />
      )}
      {showEdit && (
        <AppointmentFormModal
          appointmentId={a.id}
          initial={{
            serviceType: a.service_type,
            requestedDate: a.requested_date || "",
            requestedTime: a.requested_time || "",
            notes: a.notes || "",
          }}
          onClose={() => setShowEdit(false)}
        />
      )}
    </>
  );
}

function ConfirmDialog({
  appointment: a,
  onClose,
  onConfirmed,
}: {
  appointment: Appointment;
  onClose: () => void;
  onConfirmed: () => void;
}) {
  // Default: gewünschtes Datum + 14:00, sonst nächste Woche
  const defaultDate = a.requested_date ? `${a.requested_date}T14:00` : (() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return `${d.toISOString().slice(0, 10)}T14:00`;
  })();
  const [confirmedDate, setConfirmedDate] = useState<string>(defaultDate);
  const [message, setMessage] = useState<string>(
    `Hallo Liebes 💕\n\nDein Termin ist bestätigt! ✨\n\nGenauer Termin: [HIER PRÜFEN]\n\nFreuen uns auf dich 🥰`
  );
  const [busy, setBusy] = useState(false);

  async function handleConfirm() {
    if (!confirmedDate || busy) return;
    setBusy(true);
    try {
      await confirmAppointment(a.id, new Date(confirmedDate).toISOString(), message.trim() || undefined);
      onConfirmed();
    } catch (e) {
      alert(`Bestätigung fehlgeschlagen: ${(e as Error).message}`);
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-xl w-full p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-neutral-900">Termin bestätigen</h3>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700"><X size={18} /></button>
        </div>
        <div className="text-xs text-neutral-500">
          Kundin: <span className="font-medium text-neutral-700">{a.customer_name || "Unbekannt"}</span>
        </div>

        <div>
          <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide block mb-1">Bestätigter Termin</label>
          <input
            type="datetime-local"
            value={confirmedDate}
            onChange={(e) => setConfirmedDate(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900"
          />
        </div>

        <div>
          <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide block mb-1">
            Bestätigungs-Nachricht <span className="text-neutral-400 normal-case">(optional, wird an Kundin gesendet)</span>
          </label>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            rows={6}
            className="w-full rounded-xl border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900 resize-none"
          />
          <div className="text-[10px] text-neutral-400 mt-1">Leer lassen = nur intern bestätigen, keine Nachricht senden</div>
        </div>

        <div className="flex justify-end gap-2">
          <button onClick={onClose} disabled={busy} className="text-sm px-4 py-2 rounded-lg border border-neutral-300 text-neutral-600 hover:bg-neutral-50">Abbrechen</button>
          <button
            onClick={handleConfirm}
            disabled={busy || !confirmedDate}
            className="bg-green-600 text-white rounded-lg px-4 py-2 hover:bg-green-700 disabled:opacity-40 inline-flex items-center gap-1.5 text-sm font-medium"
          >
            <CalendarCheck size={14} /> {busy ? "Bestätige…" : "Termin bestätigen"}
          </button>
        </div>
      </div>
    </div>
  );
}
