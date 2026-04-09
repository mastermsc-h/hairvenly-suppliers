"use client";

import { useState, useTransition } from "react";
import { Pencil, Trash2, X, Check } from "lucide-react";
import { updatePayment, deletePayment } from "@/lib/actions/orders";
import { usd, date } from "@/lib/format";
import type { Payment } from "@/lib/types";

export default function PaymentItem({
  orderId,
  payment,
  isAdmin,
}: {
  orderId: string;
  payment: Payment;
  isAdmin: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save(fd: FormData) {
    setError(null);
    start(async () => {
      const res = await updatePayment(orderId, payment.id, fd);
      if (res?.error) setError(res.error);
      else setEditing(false);
    });
  }

  function remove() {
    if (!confirm("Zahlung wirklich löschen?")) return;
    start(async () => {
      await deletePayment(orderId, payment.id);
    });
  }

  if (editing) {
    return (
      <li className="py-3">
        <form action={save} className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <input
              name="amount"
              type="number"
              step="0.01"
              defaultValue={payment.amount ?? ""}
              required
              className="rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
            />
            <input
              name="paid_at"
              type="date"
              defaultValue={payment.paid_at?.slice(0, 10)}
              className="rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
            />
          </div>
          <input
            name="method"
            defaultValue={payment.method ?? ""}
            placeholder="Methode"
            className="w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
          />
          <input
            name="note"
            defaultValue={payment.note ?? ""}
            placeholder="Notiz"
            className="w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
          />
          {error && <p className="text-xs text-red-600">{error}</p>}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={pending}
              className="inline-flex items-center gap-1 rounded-lg bg-neutral-900 text-white text-xs font-medium px-3 py-1.5 disabled:opacity-50"
            >
              <Check size={12} /> Speichern
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="inline-flex items-center gap-1 rounded-lg border border-neutral-300 text-xs px-3 py-1.5"
            >
              <X size={12} /> Abbrechen
            </button>
          </div>
        </form>
      </li>
    );
  }

  return (
    <li className="py-3 text-sm group">
      <div className="flex justify-between items-start">
        <span className="font-medium text-neutral-900">{usd(payment.amount)}</span>
        <div className="flex items-center gap-2">
          <span className="text-neutral-500">{date(payment.paid_at)}</span>
          {isAdmin && (
            <>
              <button
                onClick={() => setEditing(true)}
                title="Bearbeiten"
                className="text-neutral-400 hover:text-neutral-900"
              >
                <Pencil size={13} />
              </button>
              <button
                onClick={remove}
                disabled={pending}
                title="Löschen"
                className="text-neutral-400 hover:text-red-600"
              >
                <Trash2 size={13} />
              </button>
            </>
          )}
        </div>
      </div>
      {payment.method && <div className="text-xs text-neutral-500">{payment.method}</div>}
      {payment.note && <div className="text-xs text-neutral-500">{payment.note}</div>}
    </li>
  );
}
