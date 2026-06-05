"use client";

import { useTransition } from "react";
import { Trash2, Loader2 } from "lucide-react";
import { removeInboundItem } from "@/lib/actions/inbound";

export default function RemoveItemButton({ itemId, deliveryId }: { itemId: string; deliveryId: string }) {
  const [pending, startTransition] = useTransition();
  function remove() {
    if (!confirm("Position entfernen?")) return;
    startTransition(() => removeInboundItem(itemId, deliveryId));
  }
  return (
    <button
      type="button"
      onClick={remove}
      disabled={pending}
      className="p-1 rounded text-neutral-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-50"
      title="Entfernen"
    >
      {pending ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />}
    </button>
  );
}
