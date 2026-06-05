import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronLeft, Truck, Calendar, ExternalLink, Package, Pencil } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { loadCatalog } from "@/lib/actions/catalog";
import { date as fmtDate } from "@/lib/format";
import type { InboundDelivery, InboundDeliveryItem, Supplier } from "@/lib/types";
import AddItemForm from "./add-item-form";
import RemoveItemButton from "./remove-item-button";
import EditPanel from "./edit-panel";

export const dynamic = "force-dynamic";

function deriveStatus(d: InboundDelivery): { label: string; cls: string } {
  if (d.arrived_at) return { label: "angekommen", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" };
  if (d.shipped_at) return { label: "unterwegs", cls: "bg-cyan-50 text-cyan-700 border-cyan-200" };
  if (d.tracking_number) return { label: "versandbereit", cls: "bg-orange-50 text-orange-700 border-orange-200" };
  return { label: "angekündigt", cls: "bg-neutral-100 text-neutral-600 border-neutral-200" };
}

export default async function InboundDeliveryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await requireProfile();
  const supabase = await createClient();

  const { data: deliveryRaw } = await supabase
    .from("inbound_deliveries")
    .select("*")
    .eq("id", id)
    .single();
  if (!deliveryRaw) notFound();
  const d = deliveryRaw as InboundDelivery;

  const [{ data: itemsRaw }, { data: supplierRaw }] = await Promise.all([
    supabase
      .from("inbound_delivery_items")
      .select("*")
      .eq("inbound_delivery_id", id)
      .order("created_at"),
    supabase.from("suppliers").select("*").eq("id", d.supplier_id).single(),
  ]);
  const items = (itemsRaw ?? []) as InboundDeliveryItem[];
  const supplier = supplierRaw as Supplier | null;

  const catalog = profile.is_admin || profile.role === "supplier" ? await loadCatalog(d.supplier_id) : [];

  const st = deriveStatus(d);
  const label = d.label || `Wareneingang ${fmtDate(d.created_at)}`;
  const totalG = items.reduce((sum, it) => sum + Number(it.quantity || 0), 0);

  // Group items by method
  const grouped = new Map<string, InboundDeliveryItem[]>();
  for (const it of items) {
    const key = `${it.method_name} · ${it.length_value}`;
    const arr = grouped.get(key) ?? [];
    arr.push(it);
    grouped.set(key, arr);
  }

  return (
    <div className="max-w-5xl mx-auto py-6 px-4">
      <Link href="/inbound-deliveries" className="inline-flex items-center gap-1 text-sm text-neutral-600 hover:text-neutral-900 mb-4">
        <ChevronLeft size={14} /> Wareneingänge
      </Link>

      <section className="bg-white rounded-2xl border border-neutral-200 p-6 mb-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-2">
              <Truck size={20} className="text-purple-600" />
              <h1 className="text-xl font-semibold text-neutral-900">{label}</h1>
              <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium border ${st.cls}`}>
                {st.label}
              </span>
            </div>
            <p className="text-sm text-neutral-500">{supplier?.name ?? "—"}</p>
          </div>
          {profile.is_admin && <EditPanel delivery={d} />}
        </div>

        <dl className="grid grid-cols-2 md:grid-cols-4 gap-4 mt-5 pt-5 border-t border-neutral-100">
          <Info label="ETA" value={d.eta ? <span className="inline-flex items-center gap-1"><Calendar size={12} className="text-neutral-400" />{fmtDate(d.eta)}</span> : "—"} />
          <Info label="Verschickt" value={d.shipped_at ? fmtDate(d.shipped_at) : "—"} />
          <Info label="Angekommen" value={d.arrived_at ? fmtDate(d.arrived_at) : "—"} />
          <Info
            label="Tracking"
            value={
              d.tracking_url ? (
                <a href={d.tracking_url} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline inline-flex items-center gap-1">
                  {d.tracking_number || "öffnen"} <ExternalLink size={11} />
                </a>
              ) : (
                d.tracking_number ?? "—"
              )
            }
          />
        </dl>

        {d.notes && (
          <div className="mt-4 pt-4 border-t border-neutral-100">
            <div className="text-xs font-medium text-neutral-500 uppercase tracking-wide mb-1">Notiz</div>
            <p className="text-sm text-neutral-700 whitespace-pre-wrap">{d.notes}</p>
          </div>
        )}
      </section>

      <section className="bg-white rounded-2xl border border-neutral-200 p-6">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-medium text-neutral-700">Positionen aus Lieferschein</h2>
            <p className="text-xs text-neutral-500 mt-0.5">
              {items.length} {items.length === 1 ? "Position" : "Positionen"} · {totalG} g gesamt
            </p>
          </div>
        </div>

        {profile.is_admin && catalog.length > 0 && (
          <div className="mb-4">
            <AddItemForm deliveryId={d.id} catalog={catalog} />
          </div>
        )}

        {items.length === 0 ? (
          <p className="text-sm text-neutral-500 py-4 text-center">
            Noch keine Positionen erfasst. Trag oben ein was im Lieferschein steht.
          </p>
        ) : (
          <div className="divide-y divide-neutral-100">
            {[...grouped.entries()].map(([groupKey, groupItems]) => (
              <div key={groupKey} className="py-3">
                <div className="text-xs font-semibold text-neutral-500 uppercase tracking-wide mb-2">{groupKey}</div>
                {groupItems.map((it) => (
                  <div key={it.id} className="flex items-center justify-between gap-2 py-1.5 px-2 hover:bg-neutral-50/50 rounded">
                    <div className="flex-1 flex items-center gap-2 text-sm">
                      <Package size={12} className="text-neutral-400" />
                      <span className="font-medium text-neutral-900">#{it.color_name}</span>
                      {!it.color_id && (
                        <span className="text-[10px] px-1 py-px rounded bg-amber-50 text-amber-700 border border-amber-200">kein Katalog-Match</span>
                      )}
                      <span className="text-neutral-500">{it.quantity} {it.unit}</span>
                      {it.notes && <span className="text-xs text-neutral-400 italic">· {it.notes}</span>}
                    </div>
                    {profile.is_admin && <RemoveItemButton itemId={it.id} deliveryId={d.id} />}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}

        <div className="mt-5 pt-4 border-t border-neutral-100">
          <p className="text-xs text-neutral-500">
            <strong>Phase 1:</strong> Nur erfassen. Auto-Zuordnung zu Bestellungen folgt in Phase 2 (FIFO + Mengen-Match).
          </p>
        </div>
      </section>
    </div>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs font-medium text-neutral-500 uppercase tracking-wide">{label}</dt>
      <dd className="text-sm text-neutral-900 mt-0.5">{value}</dd>
    </div>
  );
}
