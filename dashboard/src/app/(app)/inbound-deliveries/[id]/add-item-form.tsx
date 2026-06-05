"use client";

import { useMemo, useState, useTransition } from "react";
import { Plus, Loader2 } from "lucide-react";
import { addInboundItem } from "@/lib/actions/inbound";
import type { CatalogMethod } from "@/lib/types";

interface Props {
  deliveryId: string;
  catalog: CatalogMethod[];
}

export default function AddItemForm({ deliveryId, catalog }: Props) {
  const [methodId, setMethodId] = useState("");
  const [lengthId, setLengthId] = useState("");
  const [colorId, setColorId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, startTransition] = useTransition();

  const method = useMemo(() => catalog.find((m) => m.id === methodId) ?? null, [catalog, methodId]);
  const length = useMemo(() => method?.lengths.find((l) => l.id === lengthId) ?? null, [method, lengthId]);
  const color = useMemo(() => length?.colors.find((c) => c.id === colorId) ?? null, [length, colorId]);

  function reset() {
    setMethodId(""); setLengthId(""); setColorId(""); setQuantity(""); setNotes("");
  }

  function submit() {
    if (!method || !length || !color || !quantity) return;
    const fd = new FormData();
    fd.set("inbound_delivery_id", deliveryId);
    fd.set("method_name", method.name);
    fd.set("length_value", length.value);
    fd.set("color_name", color.name_hairvenly);
    fd.set("color_id", color.id);
    fd.set("quantity", quantity);
    fd.set("unit", length.unit || "g");
    fd.set("notes", notes);
    startTransition(async () => {
      await addInboundItem(fd);
      reset();
    });
  }

  const canSubmit = !!(method && length && color && Number(quantity) > 0);

  return (
    <div className="bg-purple-50/30 border border-purple-200 rounded-lg p-4">
      <div className="text-sm font-medium text-purple-900 mb-3">Position hinzufügen</div>
      <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
        <select
          value={methodId}
          onChange={(e) => { setMethodId(e.target.value); setLengthId(""); setColorId(""); }}
          className="rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900 md:col-span-1"
        >
          <option value="">Methode…</option>
          {catalog.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>

        <select
          value={lengthId}
          onChange={(e) => { setLengthId(e.target.value); setColorId(""); }}
          disabled={!method}
          className="rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900 disabled:bg-neutral-100 md:col-span-1"
        >
          <option value="">Länge…</option>
          {method?.lengths.map((l) => <option key={l.id} value={l.id}>{l.value}</option>)}
        </select>

        <select
          value={colorId}
          onChange={(e) => setColorId(e.target.value)}
          disabled={!length}
          className="rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900 disabled:bg-neutral-100 md:col-span-2"
        >
          <option value="">Farbe…</option>
          {length?.colors.map((c) => <option key={c.id} value={c.id}>{c.name_hairvenly}</option>)}
        </select>

        <input
          type="number"
          min={1}
          value={quantity}
          onChange={(e) => setQuantity(e.target.value)}
          placeholder={`Menge (${length?.unit || "g"})`}
          className="rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900 md:col-span-1"
        />

        <button
          type="button"
          onClick={submit}
          disabled={!canSubmit || pending}
          className="inline-flex items-center justify-center gap-1 px-3 py-2 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-white text-sm font-medium disabled:opacity-50 md:col-span-1"
        >
          {pending ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
          Hinzufügen
        </button>
      </div>

      <input
        type="text"
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        placeholder="Notiz (optional)"
        className="mt-2 w-full rounded-lg border border-neutral-300 px-3 py-1.5 text-xs focus:ring-2 focus:ring-neutral-900"
      />
    </div>
  );
}
