"use client";

import { useActionState, useState, useMemo } from "react";
import { createOrder } from "@/lib/actions/orders";
import { TAG_OPTIONS, type Supplier } from "@/lib/types";
import { t, type Locale } from "@/lib/i18n";

type State = { error?: string } | undefined;

export default function NewOrderForm({
  suppliers,
  locale = "de",
  preselectedSupplierId,
}: {
  suppliers: Supplier[];
  locale?: Locale;
  preselectedSupplierId?: string;
}) {
  const [state, action, pending] = useActionState<State, FormData>(
    async (prev, fd) => createOrder(prev, fd) as Promise<State>,
    undefined,
  );

  const today = new Date().toISOString().slice(0, 10);
  const [supplierId, setSupplierId] = useState(preselectedSupplierId ?? "");
  const [orderDate, setOrderDate] = useState(today);
  const [labelOverride, setLabelOverride] = useState("");

  const autoLabel = useMemo(() => {
    const sup = suppliers.find((s) => s.id === supplierId);
    if (!sup || !orderDate) return "";
    const d = new Date(orderDate + "T00:00:00");
    const dd = String(d.getDate()).padStart(2, "0");
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const yyyy = d.getFullYear();
    return `${sup.name} ${dd}-${mm}-${yyyy}`;
  }, [supplierId, orderDate, suppliers]);

  const effectiveLabel = labelOverride || autoLabel;

  return (
    <form action={action} className="space-y-5 bg-white border border-neutral-200 rounded-2xl p-6">
      <Field label={t(locale, "nav.supplier")} required>
        <select
          name="supplier_id"
          required
          value={supplierId}
          onChange={(e) => setSupplierId(e.target.value)}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
        >
          <option value="" disabled>
            {t(locale, "new_order.select_supplier")}
          </option>
          {suppliers.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label={t(locale, "new_order.order_date")} required>
          <input
            name="order_date"
            type="date"
            required
            value={orderDate}
            onChange={(e) => setOrderDate(e.target.value)}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
        </Field>
        <Field label={t(locale, "new_order.label")}>
          <input
            name="label"
            value={effectiveLabel}
            onChange={(e) => setLabelOverride(e.target.value)}
            onFocus={() => { if (!labelOverride) setLabelOverride(autoLabel); }}
            placeholder={autoLabel || t(locale, "new_order.label_placeholder")}
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
          {!labelOverride && autoLabel && (
            <p className="text-[10px] text-neutral-400 mt-0.5">{t(locale, "new_order.auto_generated")}</p>
          )}
        </Field>
      </div>

      <Field label={t(locale, "order.description")}>
        <textarea
          name="description"
          rows={2}
          placeholder={t(locale, "new_order.description_placeholder")}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
        />
      </Field>

      <Field label={t(locale, "order.tags")}>
        <div className="flex flex-wrap gap-3">
          {TAG_OPTIONS.map((tg) => (
            <label key={tg} className="inline-flex items-center gap-2 text-sm">
              <input type="checkbox" name="tags" value={tg} className="rounded" />
              {tg}
            </label>
          ))}
        </div>
      </Field>

      <Field label={t(locale, "order.google_sheet")}>
        <input
          name="sheet_url"
          type="url"
          placeholder="https://docs.google.com/spreadsheets/…"
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
        />
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field label={t(locale, "order.field.invoice_total")}>
          <input
            name="invoice_total"
            type="number"
            step="0.01"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
        </Field>
        <Field label={t(locale, "order.field.eta")}>
          <input
            name="eta"
            type="date"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
        </Field>
        <Field label={`${t(locale, "order.goods")} (USD)`}>
          <input
            name="goods_value"
            type="number"
            step="0.01"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
        </Field>
        <Field label={`${t(locale, "order.shipping")} (USD)`}>
          <input
            name="shipping_cost"
            type="number"
            step="0.01"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
        </Field>
        <Field label={`${t(locale, "order.customs")} (USD)`}>
          <input
            name="customs_duty"
            type="number"
            step="0.01"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
        </Field>
        <Field label={`${t(locale, "order.import_vat")} (USD)`}>
          <input
            name="import_vat"
            type="number"
            step="0.01"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
        </Field>
        <Field label={t(locale, "order.field.weight")}>
          <input
            name="weight_kg"
            type="number"
            step="0.01"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
        </Field>
        <Field label={t(locale, "order.field.packages")}>
          <input
            name="package_count"
            type="number"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
        </Field>
        <Field label={t(locale, "order.field.tracking_number")}>
          <input
            name="tracking_number"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
        </Field>
        <Field label={t(locale, "order.field.tracking_url")}>
          <input
            name="tracking_url"
            type="url"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
          />
        </Field>
      </div>

      <Field label={t(locale, "order.field.notes")}>
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
        {pending ? t(locale, "order.saving") : t(locale, "new_order.create")}
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
