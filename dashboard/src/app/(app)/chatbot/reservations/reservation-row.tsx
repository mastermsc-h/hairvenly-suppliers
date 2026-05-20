"use client";

import { useState, useTransition, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Send, Trash2, MessageSquare, X, Edit3, Save, Bot, User } from "lucide-react";
import {
  sendReservationNotification,
  cancelReservation,
  updateReservationNotes,
  deleteReservation,
} from "@/lib/actions/chat-reservations";

export interface Reservation {
  id: string;
  session_id: string | null;
  customer_name: string | null;
  channel: string | null;
  external_id: string | null;
  product_name: string;
  product_url: string | null;
  color: string | null;
  method: string | null;
  eta_hint: string | null;
  notes: string | null;
  status: "waiting" | "notified" | "cancelled";
  requested_at: string;
  notified_at: string | null;
  notification_message: string | null;
  cancel_reason: string | null;
  created_by_bot: boolean;
}

export default function ReservationRow({
  reservation: r,
  statusBadge,
}: {
  reservation: Reservation;
  statusBadge: { label: string; color: string };
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [showNotify, setShowNotify] = useState(false);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notes, setNotes] = useState(r.notes ?? "");
  // Stock-Scan-Ergebnis pro Reservierung — wird via Custom Event vom
  // StockCheckButton broadcasted, jede Row pickt sich nur ihren Eintrag.
  const [scanStatus, setScanStatus] = useState<"in_stock" | "unterwegs" | "out_of_stock" | "unknown" | null>(null);
  const [scanEta, setScanEta] = useState<string | null>(null);
  useEffect(() => {
    function onResults(e: Event) {
      const ce = e as CustomEvent<Array<{ reservationId: string; status: string; eta?: string }>>;
      const mine = ce.detail?.find(x => x.reservationId === r.id);
      if (mine) {
        setScanStatus(mine.status as typeof scanStatus);
        setScanEta(mine.eta || null);
      }
    }
    window.addEventListener("stock-scan-results", onResults);
    return () => window.removeEventListener("stock-scan-results", onResults);
  }, [r.id]);

  function handleDelete() {
    if (!confirm("Reservierung löschen?")) return;
    startTransition(async () => {
      await deleteReservation(r.id);
      router.refresh();
    });
  }

  function handleCancel() {
    const reason = prompt("Grund für Storno (optional):") ?? undefined;
    startTransition(async () => {
      await cancelReservation(r.id, reason);
      router.refresh();
    });
  }

  function handleSaveNotes() {
    startTransition(async () => {
      await updateReservationNotes(r.id, notes);
      setEditingNotes(false);
      router.refresh();
    });
  }

  const requested = new Date(r.requested_at);
  const requestedStr = `${requested.toLocaleDateString("de-DE")} ${requested.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`;

  return (
    <>
      <li className={`p-4 transition-colors ${scanStatus === "in_stock" ? "bg-green-50/60 hover:bg-green-50" : "hover:bg-neutral-50"}`}>
        {/* Stock-Scan-Badge — nur wenn der letzte Lager-Check ein Treffer war */}
        {scanStatus === "in_stock" && (
          <div className="mb-2 flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-green-600 text-white shadow-sm animate-pulse">
              ✅ Ware vorrätig!
            </span>
            <span className="text-[11px] text-green-700">→ jetzt benachrichtigen</span>
          </div>
        )}
        {scanStatus === "unterwegs" && (
          <div className="mb-2 flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium bg-amber-100 text-amber-800">
              🚚 Unterwegs{scanEta ? ` · ETA ${scanEta}` : ""}
            </span>
          </div>
        )}
        <div className="flex items-start gap-3 flex-wrap">
          <div className="flex-1 min-w-0">
            {/* Top: customer + channel + status */}
            <div className="flex items-center gap-2 mb-1 text-xs flex-wrap">
              <span className={`px-2 py-0.5 rounded-full font-medium ${statusBadge.color}`}>
                {statusBadge.label}
              </span>
              <span className="text-neutral-500">
                {r.channel === "instagram" ? "📷 Instagram" : r.channel === "whatsapp" ? "💬 WhatsApp" : "🌐 Web"}
              </span>
              {r.session_id && (
                <Link
                  href={`/chatbot/inbox/${r.session_id}`}
                  className="inline-flex items-center gap-1 text-blue-600 hover:underline"
                >
                  <MessageSquare size={11} /> Chat öffnen
                </Link>
              )}
              {r.created_by_bot && (
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
                {r.customer_name || <span className="text-neutral-400 font-normal">Unbekannt</span>}
              </span>
            </div>

            {/* Produkt */}
            <div className="text-sm text-neutral-700">
              <span className="font-medium">{r.product_name}</span>
              {(r.color || r.method) && (
                <span className="text-neutral-500"> — {[r.color, r.method].filter(Boolean).join(" / ")}</span>
              )}
              {r.product_url && (
                <a href={r.product_url} target="_blank" rel="noopener" className="text-blue-600 hover:underline text-xs ml-2">
                  🔗 Shop
                </a>
              )}
            </div>

            {/* ETA + Notes */}
            <div className="text-xs text-neutral-500 mt-1 space-y-0.5">
              {r.eta_hint && <div>⏱ Lieferung erwartet: {r.eta_hint}</div>}
              {r.status === "notified" && r.notified_at && (
                <div className="text-green-700">
                  ✓ Benachrichtigt am {new Date(r.notified_at).toLocaleDateString("de-DE")}{" "}
                  {new Date(r.notified_at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
                </div>
              )}
              {r.status === "cancelled" && r.cancel_reason && (
                <div className="text-neutral-500">Storno: {r.cancel_reason}</div>
              )}
              {editingNotes ? (
                <div className="flex gap-1 items-start mt-1">
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Notiz…"
                    rows={2}
                    className="flex-1 rounded border border-neutral-300 px-2 py-1 text-xs"
                  />
                  <button
                    onClick={handleSaveNotes}
                    disabled={pending}
                    className="bg-neutral-900 text-white rounded px-2 py-1 text-xs inline-flex items-center gap-1"
                  >
                    <Save size={11} /> OK
                  </button>
                  <button
                    onClick={() => { setEditingNotes(false); setNotes(r.notes ?? ""); }}
                    className="text-neutral-500 px-2 py-1 text-xs"
                  >
                    <X size={11} />
                  </button>
                </div>
              ) : (
                <div className="flex gap-1 items-center mt-0.5">
                  <span className="italic">{r.notes || "—"}</span>
                  <button
                    onClick={() => setEditingNotes(true)}
                    className="text-neutral-400 hover:text-neutral-700"
                    title="Notiz bearbeiten"
                  >
                    <Edit3 size={11} />
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-1.5 items-center">
            {r.status === "waiting" && (
              <>
                <button
                  onClick={() => setShowNotify(true)}
                  disabled={pending}
                  className="text-xs px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 inline-flex items-center gap-1 disabled:opacity-50 font-medium"
                >
                  <Send size={12} /> Jetzt benachrichtigen
                </button>
                <button
                  onClick={handleCancel}
                  disabled={pending}
                  className="text-xs px-2.5 py-1.5 rounded-lg border border-neutral-300 text-neutral-600 hover:bg-neutral-50 inline-flex items-center gap-1"
                >
                  <X size={11} /> Storno
                </button>
              </>
            )}
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

      {showNotify && (
        <NotifyDialog
          reservation={r}
          onClose={() => setShowNotify(false)}
          onSent={() => { setShowNotify(false); router.refresh(); }}
        />
      )}
    </>
  );
}

function NotifyDialog({
  reservation: r,
  onClose,
  onSent,
}: {
  reservation: Reservation;
  onClose: () => void;
  onSent: () => void;
}) {
  // Standard-Text clientseitig generieren (statt async server-call)
  const prod = [r.color, r.method].filter(Boolean).join(" ").trim() || r.product_name;
  const defaultText =
    `Hallo Liebes 💕\n\n` +
    `Gute Nachrichten — die ${prod} sind jetzt wieder da! 🥳\n\n` +
    (r.product_url ? `${r.product_url}\n\n` : "") +
    `Magst du sie noch? Sag Bescheid wenn ich dir weiterhelfen soll 🩷`;

  const [text, setText] = useState(defaultText);
  const [busy, setBusy] = useState(false);

  async function send() {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await sendReservationNotification(r.id, text.trim());
      onSent();
    } catch (e) {
      alert(`Senden fehlgeschlagen: ${(e as Error).message}`);
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-xl w-full p-5 space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-neutral-900">Benachrichtigung an {r.customer_name || "Kunde"} senden</h3>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700"><X size={18} /></button>
        </div>
        <div className="text-xs text-neutral-500">
          Produkt: <span className="font-medium text-neutral-700">{r.product_name}</span>
          {r.channel && <> · Channel: <span className="font-medium">{r.channel}</span></>}
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={8}
          className="w-full rounded-xl border border-neutral-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-none"
          disabled={busy}
        />
        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            disabled={busy}
            className="text-sm px-4 py-2 rounded-xl border border-neutral-300 text-neutral-600 hover:bg-neutral-50"
          >
            Abbrechen
          </button>
          <button
            onClick={send}
            disabled={busy || !text.trim()}
            className="bg-green-600 text-white rounded-xl px-4 py-2 hover:bg-green-700 disabled:opacity-40 inline-flex items-center gap-1 text-sm font-medium"
          >
            <Send size={14} /> {busy ? "Sende…" : "Jetzt senden"}
          </button>
        </div>
      </div>
    </div>
  );
}
