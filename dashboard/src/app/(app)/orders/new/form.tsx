"use client";

import { useActionState } from "react";
import { createOrder } from "@/lib/actions/orders";
import { TAG_OPTIONS, type Supplier } from "@/lib/types";

type State = { error?: string } | undefined;

export default function NewOrderForm({ suppliers }: { suppliers: Supplier[] }) {
  const [state, action, pending] = useActionState<State, FormData>(
    async (prev, fd) => createOrder(prev, fd) as Promise<State>,
    undefined,
  );

  return (
    <form action={action} className="space-y-5 bg-white border border-neutral-200 rounded-2xl p-6">
      <Field label="Lieferant" required>
        <select
          name="supplier_id"
          required
          defaultValue=""
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
        >
          <option value="" disabled>
            Wählen…
          </option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>

      <Field label="Label" required>
        <input
          name="label"
          required
          placeholder="z.B. Amanda Bestellung KW42"
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
        />
      </Field>

      <Field label="Beschreibung">
        <textarea
          name="description"
          rows={2}
          placeholder="Was ist im Paket? z.B. Extensions + Kleber"
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
        />
      </Field>

      <Field label="Tags">
        <div className="flex flex-wrap gap-3">
          {TAG_OPTIONS.map((t) => (
            <label key={t} className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" name="tags" value={t} className="rounded" />
              {t}
            </label>
          ))}
        </div>
      </Field>

      <Field label="Google Sheet Link">
        <input
          name="sheet_url"
          type="url"
          placeholder="https://docs.google.com/spreadsheets/…"
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label="Rechnungsbetrag (USD)">
          <input
            name="invoice_total"
            type="number"
            step="0.01"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Ankunft ca.">
          <input
            name="eta"
            type="date"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Warenwert (USD)">
          <input
            name="goods_value"
            type="number"
            step="0.01"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Versandkosten (USD)">
          <input
            name="shipping_cost"
            type="number"
            step="0.01"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Zoll (USD)">
          <input
            name="customs_duty"
            type="number"
            step="0.01"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
        </Field>
        <Field label="EUSt (USD)">
          <input
            name="import_vat"
            type="number"
            step="0.01"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Gewicht (kg)">
          <input
            name="weight_kg"
            type="number"
            step="0.01"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Anzahl Pakete">
          <input
            name="package_count"
            type="number"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Tracking-Nummer">
          <input
            name="tracking_number"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
        </Field>
        <Field label="Tracking-URL">
          <input
            name="tracking_url"
            type="url"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
        </Field>
      </div>

      <Field label="Notizen">
        <textarea
          name="notes"
          rows={3}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
        />
      </Field>

      {state?.error && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">
          {state.error}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className="rounded-lg bg-neutral-900 text-white text-sm font-medium px-5 py-2.5 hover:bg-neutral-800 disabled:opacity-50 transition"
      >
        {pending ? "Speichern…" : "Bestellung anlegen"}
      </button>
    </form>
  );
}

function Field({
  label,
  required,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-neutral-700">
        {label}
        {required && <span className="text-red-500"> *</span>}
      </label>
      {children}
    </div>
  );
}
