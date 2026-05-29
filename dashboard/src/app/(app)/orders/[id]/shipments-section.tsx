"use client";

import { useState, useTransition, useRef } from "react";
import { Package, Plus, X, Check, Pencil, Trash2, Truck, ExternalLink, Calendar } from "lucide-react";
import { createShipment, updateShipment, deleteShipment } from "@/lib/actions/shipments";
import { date } from "@/lib/format";
import type { OrderShipment, OrderItem, OrderDocument } from "@/lib/types";

export default function ShipmentsSection({
  orderId,
  shipments,
  items,
  documents,
  canEdit,
}: {
  orderId: string;
  shipments: OrderShipment[];
  items: OrderItem[];
  documents: OrderDocument[];
  canEdit: boolean;
}) {
  const [creating, setCreating] = useState(false);

  // Items not yet assigned to any shipment
  const unassignedCount = items.filter((i) => !i.shipment_id).length;

  return (
    <section className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-medium text-neutral-700 inline-flex items-center gap-1.5">
          <Truck size={14} className="text-neutral-400" />
          Teillieferungen
          {shipments.length > 0 && (
            <span className="ml-1 text-[10px] text-neutral-400">({shipments.length})</span>
          )}
        </h2>
        {canEdit && (
          <button
            type="button"
            onClick={() => setCreating(true)}
            className="inline-flex items-center gap-1 text-xs font-medium px-3 py-1.5 rounded-lg border border-neutral-300 text-neutral-700 hover:bg-neutral-50 transition"
          >
            <Plus size={12} /> Neue Teillieferung
          </button>
        )}
      </div>

      {creating && (
        <ShipmentForm
          orderId={orderId}
          items={items.filter((i) => !i.shipment_id)}
          onClose={() => setCreating(false)}
        />
      )}

      {shipments.length === 0 && !creating && (
        <p className="text-xs text-neutral-400 italic">
          Noch keine Teillieferungen angelegt.
          {items.length > 0 && ` (${items.length} Positionen offen)`}
        </p>
      )}

      <div className="space-y-3 mt-3">
        {shipments.map((s, idx) => {
          const shipmentItems = items.filter((i) => i.shipment_id === s.id);
          const shipmentDocs = documents.filter((d) => d.shipment_id === s.id);
          return (
            <ShipmentCard
              key={s.id}
              shipment={s}
              fallbackLabel={`Teillieferung ${idx + 1}`}
              items={shipmentItems}
              documents={shipmentDocs}
              canEdit={canEdit}
            />
          );
        })}
      </div>

      {shipments.length > 0 && unassignedCount > 0 && (
        <p className="text-[11px] text-neutral-400 italic mt-3">
          {unassignedCount} Positionen noch nicht zu einer Teillieferung zugeordnet.
        </p>
      )}
    </section>
  );
}

function ShipmentCard({
  shipment,
  fallbackLabel,
  items,
  documents,
  canEdit,
}: {
  shipment: OrderShipment;
  fallbackLabel: string;
  items: OrderItem[];
  documents: OrderDocument[];
  canEdit: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const totalQty = items.reduce((s, i) => s + i.quantity, 0);
  const totalUnit = items[0]?.unit ?? "";

  function handleDelete() {
    if (!confirm("Teillieferung wirklich löschen? Die Bestellpositionen werden wieder als nicht zugeordnet markiert.")) return;
    start(async () => {
      await deleteShipment(shipment.id);
    });
  }

  if (editing) {
    return (
      <ShipmentEditForm
        shipment={shipment}
        onClose={() => setEditing(false)}
      />
    );
  }

  return (
    <div className="border border-purple-200 bg-purple-50/30 rounded-xl p-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-semibold text-purple-900 inline-flex items-center gap-1.5">
            <Package size={13} className="text-purple-600" />
            {shipment.label || fallbackLabel}
          </div>
          <div className="text-[10px] text-purple-700/70 mt-0.5 flex flex-wrap gap-2">
            {shipment.shipped_at && (
              <span className="inline-flex items-center gap-0.5">
                <Truck size={9} /> verschickt {date(shipment.shipped_at)}
              </span>
            )}
            {shipment.eta && (
              <span className="inline-flex items-center gap-0.5">
                <Calendar size={9} /> ETA {date(shipment.eta)}
              </span>
            )}
            {shipment.arrived_at && (
              <span className="inline-flex items-center gap-0.5 text-emerald-700">
                <Check size={9} /> angekommen {date(shipment.arrived_at)}
              </span>
            )}
          </div>
        </div>
        {canEdit && (
          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="p-1 text-purple-600 hover:text-purple-900 hover:bg-purple-100 rounded"
              title="Bearbeiten"
            >
              <Pencil size={12} />
            </button>
            <button
              type="button"
              onClick={handleDelete}
              disabled={pending}
              className="p-1 text-purple-400 hover:text-red-600 hover:bg-red-50 rounded"
              title="Löschen"
            >
              <Trash2 size={12} />
            </button>
          </div>
        )}
      </div>

      {shipment.tracking_number && (
        <div className="text-[11px]">
          {shipment.tracking_url ? (
            <a
              href={shipment.tracking_url}
              target="_blank"
              rel="noreferrer"
              className="text-blue-700 hover:underline inline-flex items-center gap-0.5"
            >
              {shipment.tracking_number} <ExternalLink size={10} />
            </a>
          ) : (
            <span className="text-purple-800">{shipment.tracking_number}</span>
          )}
        </div>
      )}

      {items.length > 0 && (
        <details className="text-[11px]">
          <summary className="cursor-pointer text-purple-700 hover:text-purple-900">
            {items.length} Positionen · {totalQty} {totalUnit}
          </summary>
          <ul className="mt-1.5 pl-3 space-y-0.5 text-neutral-700">
            {items.map((i) => (
              <li key={i.id} className="text-[10px]">
                {i.method_name} · {i.length_value} · {i.color_name}
                <span className="ml-1 text-neutral-400">— {i.quantity} {i.unit}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {documents.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1 border-t border-purple-100">
          <span className="text-[10px] text-purple-600 font-medium">Dokumente:</span>
          {documents.map((d) => (
            <span
              key={d.id}
              className="text-[10px] text-purple-700 inline-flex items-center gap-0.5 bg-white border border-purple-200 rounded px-1.5 py-0.5"
              title={d.file_name}
            >
              📎 {d.file_name.length > 24 ? d.file_name.slice(0, 22) + "…" : d.file_name}
            </span>
          ))}
        </div>
      )}

      {shipment.notes && (
        <div className="text-[11px] text-neutral-600 whitespace-pre-wrap border-t border-purple-100 pt-2">
          {shipment.notes}
        </div>
      )}
    </div>
  );
}

function ShipmentForm({
  orderId,
  items,
  onClose,
}: {
  orderId: string;
  items: OrderItem[];
  onClose: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
  const formRef = useRef<HTMLFormElement>(null);

  function submit(fd: FormData) {
    setError(null);
    selectedItems.forEach((id) => fd.append("item_ids", id));
    start(async () => {
      const res = await createShipment(orderId, fd);
      if (res?.error) setError(res.error);
      else onClose();
    });
  }

  function toggleItem(id: string) {
    setSelectedItems((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  return (
    <form
      ref={formRef}
      action={submit}
      className="border border-neutral-300 bg-white rounded-xl p-3 space-y-2 mb-3"
    >
      <div className="grid grid-cols-2 gap-2">
        <Field label="Bezeichnung (optional)">
          <input
            name="label"
            placeholder="z.B. Teil 1"
            className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-xs"
          />
        </Field>
        <Field label="Tracking-Nummer">
          <input
            name="tracking_number"
            className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-xs"
          />
        </Field>
        <Field label="Tracking-URL">
          <input
            name="tracking_url"
            type="url"
            placeholder="https://…"
            className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-xs"
          />
        </Field>
        <Field label="Verschickt am">
          <input
            name="shipped_at"
            type="date"
            className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-xs"
          />
        </Field>
        <Field label="ETA / Voraussichtliche Ankunft">
          <input
            name="eta"
            type="date"
            className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-xs"
          />
        </Field>
        <Field label="Notizen">
          <input
            name="notes"
            placeholder="Optional"
            className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-xs"
          />
        </Field>
      </div>

      {items.length > 0 && (
        <div className="border border-neutral-200 rounded-md p-2 max-h-48 overflow-y-auto">
          <div className="text-[11px] font-medium text-neutral-600 mb-1">
            Welche Bestellpositionen gehören zu dieser Teillieferung?
          </div>
          <div className="space-y-0.5">
            {items.map((i) => (
              <label
                key={i.id}
                className="flex items-center gap-2 text-[11px] hover:bg-neutral-50 px-1 py-0.5 rounded cursor-pointer"
              >
                <input
                  type="checkbox"
                  checked={selectedItems.has(i.id)}
                  onChange={() => toggleItem(i.id)}
                  className="rounded"
                />
                <span className="flex-1 truncate">
                  {i.method_name} · {i.length_value} · {i.color_name}
                </span>
                <span className="text-neutral-400">{i.quantity} {i.unit}</span>
              </label>
            ))}
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="flex items-center gap-2 justify-end">
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 text-xs rounded-md border border-neutral-300 hover:bg-neutral-50"
        >
          <X size={11} className="inline" /> Abbrechen
        </button>
        <button
          type="submit"
          disabled={pending}
          className="px-3 py-1.5 text-xs rounded-md bg-purple-700 text-white hover:bg-purple-800 disabled:opacity-50 inline-flex items-center gap-1"
        >
          <Check size={11} /> {pending ? "Speichern…" : "Anlegen"}
        </button>
      </div>
    </form>
  );
}

function ShipmentEditForm({
  shipment,
  onClose,
}: {
  shipment: OrderShipment;
  onClose: () => void;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function submit(fd: FormData) {
    setError(null);
    start(async () => {
      const res = await updateShipment(shipment.id, fd);
      if (res?.error) setError(res.error);
      else onClose();
    });
  }

  return (
    <form action={submit} className="border border-purple-300 bg-purple-50/30 rounded-xl p-3 space-y-2 mb-3">
      <div className="grid grid-cols-2 gap-2">
        <Field label="Bezeichnung">
          <input
            name="label"
            defaultValue={shipment.label ?? ""}
            className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-xs"
          />
        </Field>
        <Field label="Tracking-Nummer">
          <input
            name="tracking_number"
            defaultValue={shipment.tracking_number ?? ""}
            className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-xs"
          />
        </Field>
        <Field label="Tracking-URL">
          <input
            name="tracking_url"
            type="url"
            defaultValue={shipment.tracking_url ?? ""}
            className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-xs"
          />
        </Field>
        <Field label="Verschickt am">
          <input
            name="shipped_at"
            type="date"
            defaultValue={shipment.shipped_at ?? ""}
            className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-xs"
          />
        </Field>
        <Field label="ETA">
          <input
            name="eta"
            type="date"
            defaultValue={shipment.eta ?? ""}
            className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-xs"
          />
        </Field>
        <Field label="Angekommen am">
          <input
            name="arrived_at"
            type="date"
            defaultValue={shipment.arrived_at ?? ""}
            className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-xs"
          />
        </Field>
      </div>
      <Field label="Notizen">
        <textarea
          name="notes"
          defaultValue={shipment.notes ?? ""}
          rows={2}
          className="w-full rounded-md border border-neutral-300 px-2 py-1.5 text-xs"
        />
      </Field>
      {error && <p className="text-xs text-red-600">{error}</p>}
      <div className="flex items-center gap-2 justify-end">
        <button
          type="button"
          onClick={onClose}
          className="px-3 py-1.5 text-xs rounded-md border border-neutral-300 hover:bg-neutral-50"
        >
          Abbrechen
        </button>
        <button
          type="submit"
          disabled={pending}
          className="px-3 py-1.5 text-xs rounded-md bg-purple-700 text-white hover:bg-purple-800 disabled:opacity-50"
        >
          {pending ? "Speichern…" : "Speichern"}
        </button>
      </div>
    </form>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-0.5">
      <label className="block text-[10px] font-medium text-neutral-600 uppercase tracking-wide">
        {label}
      </label>
      {children}
    </div>
  );
}
