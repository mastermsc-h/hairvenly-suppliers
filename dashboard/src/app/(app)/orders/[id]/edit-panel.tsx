"use client";

import { useState, useTransition } from "react";
import { Pencil, Trash2, X, Plus } from "lucide-react";
import { updateOrder, deleteOrder } from "@/lib/actions/orders";
import { ORDER_STATUSES, TAG_OPTIONS, type OrderWithTotals } from "@/lib/types";
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
  const [tags, setTags] = useState<string[]>(order.tags ?? []);
  const [customTag, setCustomTag] = useState("");

  function submit(formData: FormData) {
    // Remove existing tags and add current ones
    formData.delete("tags");
    tags.forEach((tag) => formData.append("tags", tag));
    setError(null);
    start(async () => {
      const res = await updateOrder(order.id, formData);
      if (res?.error) setError(res.error);
      else setOpen(false);
    });
  }

  function handleDelete() {
    if (!confirm(t(locale, "order.confirm_delete"))) return;
    start(async () => {
      const res = await deleteOrder(order.id);
      if (res?.error) setError(res.error);
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

      {isAdmin && (
        <Field label="Tags">
          <div className="flex flex-wrap gap-1.5 mb-2">
            {TAG_OPTIONS.map((tag) => (
              <button key={tag} type="button"
                onClick={() => setTags((prev) => prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag])}
                className={`px-2.5 py-1 rounded-full text-xs font-medium transition ${
                  tags.includes(tag) ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
                }`}>{tag}</button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5 mb-2">
            {tags.filter((t) => !(TAG_OPTIONS as readonly string[]).includes(t)).map((tag) => (
              <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-indigo-100 text-indigo-700">
                {tag}
                <button type="button" onClick={() => setTags((prev) => prev.filter((t) => t !== tag))} className="hover:text-red-600"><X size={10} /></button>
              </span>
            ))}
          </div>
          <div className="flex gap-1.5">
            <input value={customTag} onChange={(e) => setCustomTag(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); if (customTag.trim() && !tags.includes(customTag.trim())) { setTags((prev) => [...prev, customTag.trim()]); setCustomTag(""); } } }}
              placeholder="Eigenen Tag hinzufügen..."
              className="flex-1 rounded-lg border border-neutral-300 px-2.5 py-1.5 text-xs" />
            <button type="button"
              onClick={() => { if (customTag.trim() && !tags.includes(customTag.trim())) { setTags((prev) => [...prev, customTag.trim()]); setCustomTag(""); } }}
              className="px-2 py-1.5 rounded-lg bg-neutral-100 text-neutral-600 hover:bg-neutral-200 transition">
              <Plus size={12} />
            </button>
          </div>
        </Field>
      )}

      <Field label={t(locale, "order.field.notes")}>
        <textarea
          name="notes"
          rows={3}
          defaultValue={order.notes ?? ""}
          className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
        />
      </Field>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="flex items-center gap-2">
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
        {isAdmin && (
          <button
            type="button"
            onClick={handleDelete}
            disabled={pending}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg text-xs font-medium px-3 py-2 text-red-600 hover:bg-red-50 border border-red-200 transition disabled:opacity-50"
          >
            <Trash2 size={13} />
            {t(locale, "order.delete")}
          </button>
        )}
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
