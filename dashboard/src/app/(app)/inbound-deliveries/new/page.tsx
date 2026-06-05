import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { ChevronLeft } from "lucide-react";
import { createInboundDelivery } from "@/lib/actions/inbound";
import type { Supplier } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function NewInboundDeliveryPage() {
  const profile = await requireProfile();
  const supabase = await createClient();

  const { data: suppliersData } = await supabase
    .from("suppliers")
    .select("id, name")
    .order("sort_order")
    .order("name");
  const suppliers = (suppliersData ?? []) as Pick<Supplier, "id" | "name">[];

  const usableSuppliers = profile.role === "supplier" && profile.supplier_id
    ? suppliers.filter((s) => s.id === profile.supplier_id)
    : suppliers;

  return (
    <div className="max-w-2xl mx-auto py-6 px-4">
      <Link href="/inbound-deliveries" className="inline-flex items-center gap-1 text-sm text-neutral-600 hover:text-neutral-900 mb-4">
        <ChevronLeft size={14} /> Wareneingänge
      </Link>

      <div className="bg-white rounded-2xl border border-neutral-200 p-6">
        <h1 className="text-xl font-semibold text-neutral-900 mb-1">Neuer Wareneingang</h1>
        <p className="text-sm text-neutral-500 mb-5">
          Erstmal nur die Sendung anlegen. Positionen aus dem Lieferschein trägst du danach im Detail ein.
        </p>

        <form action={createInboundDelivery} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-neutral-600 uppercase tracking-wide mb-1">Lieferant *</label>
            <select
              name="supplier_id"
              required
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900"
              defaultValue={usableSuppliers.length === 1 ? usableSuppliers[0].id : ""}
            >
              <option value="" disabled>— wählen —</option>
              {usableSuppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-neutral-600 uppercase tracking-wide mb-1">Bezeichnung</label>
            <input
              name="label"
              type="text"
              placeholder="z.B. Ebru 30.05.2026"
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900"
            />
            <p className="text-xs text-neutral-500 mt-1">Optional. Leerlassen → wird aus Datum generiert.</p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-neutral-600 uppercase tracking-wide mb-1">Tracking-Nummer</label>
              <input name="tracking_number" type="text" className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900" />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-600 uppercase tracking-wide mb-1">Tracking-URL</label>
              <input name="tracking_url" type="url" placeholder="https://…" className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900" />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-xs font-medium text-neutral-600 uppercase tracking-wide mb-1">ETA</label>
              <input name="eta" type="date" className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900" />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-600 uppercase tracking-wide mb-1">Verschickt am</label>
              <input name="shipped_at" type="date" className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900" />
            </div>
            <div>
              <label className="block text-xs font-medium text-neutral-600 uppercase tracking-wide mb-1">Angekommen am</label>
              <input name="arrived_at" type="date" className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-neutral-600 uppercase tracking-wide mb-1">Notizen</label>
            <textarea
              name="notes"
              rows={3}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Link href="/inbound-deliveries" className="px-4 py-2 rounded-lg text-sm font-medium bg-neutral-100 hover:bg-neutral-200 text-neutral-700">
              Abbrechen
            </Link>
            <button type="submit" className="px-4 py-2 rounded-lg text-sm font-medium bg-neutral-900 text-white hover:bg-neutral-800">
              Anlegen
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
