"use client";

import { useState, useTransition } from "react";
import { Pencil } from "lucide-react";
import { updateOrder } from "@/lib/actions/orders";
import { ORDER_STATUSES, type OrderWithTotals } from "@/lib/types";
import { t, type Locale } from "@/lib/i18n";

export default function EditPanel({
  order,
  isAdmin,
  locale,
}: {
  order: OrderWithTotals;
  isAdmin: boolean;
  locale: Locale;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(formData: FormData) {
    setError(null);
    start(async () => {
      const res = await updateOrder(order.id, formData);
      if (res?.error) setError(res.error);
      else setOpen(false);
    });
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium border border-neutral-300 text-neutral-700 hover:bg-neutral-50 hover:border-neutral-400 transition"
      >
        <Pencil size={12} />
        {t(locale, "order.edit_button")}
      </button>
    );
  }

  return (
    <form action={submit} className="space-y-4 w-full">
      <h2 className="text-sm font-medium text-neutral-700 flex items-center gap-1.5">
        <Pencil size={13} className="text-neutral-400" />
        {t(locale, "order.edit_title")}
      </h2>

      <div className="grid grid-cols-2 gap-4 text-sm">
        {isAdmin && (
          <Field label={t(locale, "new_order.label")}>
            <input
              name="label"
              defaultValue={order.label}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2"
            />
          </Field>
        )}

        {isAdmin && (
          <Field label={t(locale, "new_order.order_date")}>
            <input
              name="order_date"
              type="date"
              defaultValue={order.order_date ?? ""}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2"
            />
          </Field>
        )}

        <Field label={t(locale, "order.field.status")}>
          <select
            name="status"
            defaultValue={order.status}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2"
          >
            {ORDER_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(locale, `order.status.${s}`)}
              </option>
            ))}
          </select>
        </Field>

        <Field label={t(locale, "order.field.eta")}>
          <input
            name="eta"
            type="date"
            defaultValue={order.eta ?? ""}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2"
          />
        </Field>

        <Field label={t(locale, "order.field.tracking_number")}>
          <input
            name="tracking_number"
            defaultValue={order.tracking_number ?? ""}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2"
          />
        </Field>

        <Field label={t(locale, "order.field.tracking_url")}>
          <input
            name="tracking_url"
            type="url"
            defaultValue={order.tracking_url ?? ""}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2"
          />
        </Field>

        <Field label={t(locale, "order.field.last_update")}>
          <input
            name="last_supplier_update"
            type="date"
            defaultValue={order.last_supplier_update ?? ""}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2"
          />
        </Field>

        {isAdmin && (
          <Field label={t(locale, "order.field.invoice_total")}>
            <input
              name="invoice_total"
              type="number"
              step="0.01"
              defaultValue={order.invoice_total ?? ""}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2"
            />
          </Field>
        )}

        {isAdmin && (
          <Field label={t(locale, "order.field.weight")}>
            <input
              name="weight_kg"
              type="number"
              step="0.001"
              defaultValue={order.weight_kg ?? ""}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2"
            />
          </Field>
        )}

        {isAdmin && (
          <Field label={t(locale, "order.field.packages")}>
            <input
              name="package_count"
              type="number"
              step="1"
              defaultValue={order.package_count ?? ""}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2"
            />
          </Field>
        )}
      </div>

      <Field label={t(locale, "order.field.notes")}>
        <textarea
          name="notes"
          rows={3}
          defaultValue={order.notes ?? ""}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
        />
      </Field>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={pending}
          className="rounded-lg bg-neutral-900 text-white text-sm font-medium px-4 py-2 hover:bg-neutral-800 disabled:opacity-50"
        >
          {pending ? t(locale, "order.saving") : t(locale, "order.save")}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-neutral-300 text-sm px-4 py-2 hover:bg-neutral-50"
        >
          {t(locale, "order.cancel")}
        </button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="block text-xs font-medium text-neutral-600 uppercase tracking-wide">
        {label}
      </label>
      {children}
    </div>
  );
}
