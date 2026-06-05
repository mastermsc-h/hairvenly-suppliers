import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { date as fmtDate } from "@/lib/format";
import { Truck, Calendar, Plus, Package } from "lucide-react";
import type { InboundDelivery } from "@/lib/types";
import LieferscheinCheck from "./lieferschein-check";

type SupplierLite = { id: string; name: string; region: string | null };

export const dynamic = "force-dynamic";

function deriveStatus(d: InboundDelivery): { label: string; cls: string } {
  if (d.arrived_at) return { label: "angekommen", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" };
  if (d.shipped_at) return { label: "unterwegs", cls: "bg-cyan-50 text-cyan-700 border-cyan-200" };
  if (d.tracking_number) return { label: "versandbereit", cls: "bg-orange-50 text-orange-700 border-orange-200" };
  return { label: "angekündigt", cls: "bg-neutral-100 text-neutral-600 border-neutral-200" };
}

export default async function InboundDeliveriesPage({
  searchParams,
}: {
  searchParams: Promise<{ supplier?: string }>;
}) {
  const profile = await requireProfile();
  const supabase = await createClient();
  const { supplier: supplierFilter } = await searchParams;

  let deliveriesQuery = supabase.from("inbound_deliveries").select("*").order("created_at", { ascending: false });
  if (supplierFilter) deliveriesQuery = deliveriesQuery.eq("supplier_id", supplierFilter);

  const [{ data: deliveriesData }, { data: suppliersData }, { data: itemCounts }] = await Promise.all([
    deliveriesQuery,
    supabase.from("suppliers").select("id, name, region").order("sort_order").order("name"),
    supabase.from("inbound_delivery_items").select("inbound_delivery_id, quantity"),
  ]);

  const deliveries = (deliveriesData ?? []) as InboundDelivery[];
  const suppliers = (suppliersData ?? []) as SupplierLite[];
  const suppliersById = new Map(suppliers.map((s) => [s.id, s]));

  // Aggregate items per delivery
  const itemStats = new Map<string, { count: number; totalG: number }>();
  for (const it of (itemCounts ?? []) as { inbound_delivery_id: string; quantity: number }[]) {
    const cur = itemStats.get(it.inbound_delivery_id) ?? { count: 0, totalG: 0 };
    cur.count++;
    cur.totalG += Number(it.quantity || 0);
    itemStats.set(it.inbound_delivery_id, cur);
  }

  // Restrict suppliers list for supplier-role profiles
  const usableSuppliers = profile.role === "supplier" && profile.supplier_id
    ? suppliers.filter((s) => s.id === profile.supplier_id)
    : suppliers;

  return (
    <div className="max-w-6xl mx-auto py-6 px-4">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">
            Wareneingänge
            {supplierFilter && (
              <span className="ml-2 text-base font-normal text-neutral-500">
                — {suppliersById.get(supplierFilter)?.name ?? "?"}
              </span>
            )}
          </h1>
          <p className="text-sm text-neutral-500 mt-1">
            Physische Sendungen — eine Sendung kann mehrere Bestellungen abdecken
            {supplierFilter && (
              <Link href="/inbound-deliveries" className="ml-2 text-xs text-blue-600 hover:underline">alle anzeigen</Link>
            )}
          </p>
        </div>
        {profile.is_admin && (
          <div className="flex items-center gap-2">
            <LieferscheinCheck suppliers={usableSuppliers.map((s) => ({ id: s.id, name: s.name }))} />
            <Link
              href="/inbound-deliveries/new"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800"
            >
              <Plus size={16} /> Neuer Wareneingang
            </Link>
          </div>
        )}
      </div>

      {deliveries.length === 0 ? (
        <div className="bg-white rounded-2xl border border-neutral-200 p-10 text-center">
          <Truck size={32} className="mx-auto text-neutral-300 mb-3" />
          <p className="text-neutral-500 text-sm">Noch keine Wareneingänge erfasst.</p>
          {profile.is_admin && (
            <Link
              href="/inbound-deliveries/new"
              className="inline-flex items-center gap-2 mt-4 px-4 py-2 rounded-lg bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800"
            >
              <Plus size={16} /> Ersten Wareneingang anlegen
            </Link>
          )}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-neutral-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-neutral-600">
              <tr className="text-left">
                <th className="px-5 py-3 font-medium">Wareneingang</th>
                <th className="px-5 py-3 font-medium">Lieferant</th>
                <th className="px-5 py-3 font-medium">Status</th>
                <th className="px-5 py-3 font-medium">ETA</th>
                <th className="px-5 py-3 font-medium">Tracking</th>
                <th className="px-5 py-3 font-medium text-right">Positionen</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {deliveries.map((d) => {
                const sup = suppliersById.get(d.supplier_id);
                const st = deriveStatus(d);
                const stats = itemStats.get(d.id);
                const label = d.label || `Wareneingang ${fmtDate(d.created_at)}`;
                return (
                  <tr key={d.id} className="hover:bg-neutral-50/60">
                    <td className="px-5 py-3">
                      <Link href={`/inbound-deliveries/${d.id}`} className="text-indigo-700 font-medium hover:underline">
                        {label}
                      </Link>
                    </td>
                    <td className="px-5 py-3 text-neutral-700">{sup?.name ?? "—"}</td>
                    <td className="px-5 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border ${st.cls}`}>
                        {st.label}
                      </span>
                    </td>
                    <td className="px-5 py-3 text-neutral-700">
                      {d.eta ? (
                        <span className="inline-flex items-center gap-1">
                          <Calendar size={12} className="text-neutral-400" />
                          {fmtDate(d.eta)}
                        </span>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-5 py-3 text-neutral-700">
                      {d.tracking_url ? (
                        <a href={d.tracking_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">
                          {d.tracking_number || "→"}
                        </a>
                      ) : (
                        d.tracking_number ?? "—"
                      )}
                    </td>
                    <td className="px-5 py-3 text-right text-neutral-700">
                      {stats ? (
                        <span className="inline-flex items-center gap-1">
                          <Package size={12} className="text-neutral-400" />
                          {stats.count} · {stats.totalG} g
                        </span>
                      ) : (
                        <span className="text-neutral-400">leer</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {usableSuppliers.length === 0 && profile.role === "supplier" && (
        <p className="text-sm text-amber-700 mt-4">Dein Lieferanten-Account ist noch nicht zugewiesen.</p>
      )}
    </div>
  );
}
