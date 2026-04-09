"use client";

import { useState, useTransition, useRef } from "react";
import { addPayment } from "@/lib/actions/orders";

export default function PaymentForm({ orderId }: { orderId: string }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function submit(fd: FormData) {
    setError(null);
    start(async () => {
      const res = await addPayment(orderId, fd);
      if (res?.error) setError(res.error);
      else formRef.current?.reset();
    });
  }

  return (
    <form ref={formRef} action={submit} className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <input
          name="amount"
          type="number"
          step="0.01"
          placeholder="Betrag USD"
          required
          className="rounded-lg border border-neutral-300 px-3 py-2 text-sm"
        />
        <input
          name="paid_at"
          type="date"
          defaultValue={new Date().toISOString().slice(0, 10)}
          className="rounded-lg border border-neutral-300 px-3 py-2 text-sm"
        />
      </div>
      <input
        name="method"
        placeholder="z.B. Sparkasse Überweisung"
        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
      />
      <input
        name="note"
        placeholder="Notiz (optional)"
        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
      />
      {error && <p className="text-xs text-red-600">{error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-lg bg-neutral-900 text-white text-sm font-medium py-2 hover:bg-neutral-800 disabled:opacity-50"
      >
        {pending ? "Hinzufügen…" : "Zahlung hinzufügen"}
      </button>
    </form>
  );
}
