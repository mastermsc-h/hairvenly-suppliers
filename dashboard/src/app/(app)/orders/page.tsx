import Link from "next/link";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { usd, date } from "@/lib/format";
import { STATUS_LABELS, type OrderWithTotals, type OrderDocument, type Supplier } from "@/lib/types";
import QuickDocs from "./[id]/quick-docs";
import DocIndicators from "./[id]/doc-indicators";

export default async function OrdersPage() {
  const profile = await requireProfile();
  const supabase = await createClient();

  const [{ data: orders }, { data: suppliers }, { data: documents }] = await Promise.all([
    supabase
      .from("orders_with_totals")
      .select("*")
      .order("created_at", { ascending: false }),
    supabase.from("suppliers").select("*").order("sort_order").order("name"),
    supabase
      .from("documents")
      .select("*")
      .in("kind", ["supplier_invoice", "payment_proof", "customs_document", "waybill"]),
  ]);

  const list = (orders ?? []) as OrderWithTotals[];
  const supplierList = (suppliers ?? []) as Supplier[];
  const docsByOrder = new Map<string, OrderDocument[]>();
  for (const d of (documents ?? []) as OrderDocument[]) {
    const arr = docsByOrder.get(d.order_id) ?? [];
    arr.push(d);
    docsByOrder.set(d.order_id, arr);
  }

  // Gruppiere Bestellungen nach Lieferant; Lieferanten ohne Bestellungen werden nicht angezeigt.
  const grouped = supplierList
    .map((s) => ({
      supplier: s,
      orders: list.filter((o) => o.supplier_id === s.id),
    }))
    .filter((g) => g.orders.length > 0);

  return (
    <div className="p-8 space-y-8 max-w-7xl">
      <header className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">Bestellungen</h1>
          <p className="text-sm text-neutral-500 mt-1">
            {list.length} insgesamt · {grouped.length} Lieferanten
          </p>
        </div>
        {profile.is_admin && (
          <Link
            href="/orders/new"
            className="inline-flex items-center gap-2 bg-neutral-900 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-neutral-800 transition"
          >
            <Plus size={16} /> Neue Bestellung
          </Link>
        )}
      </header>

      {list.length === 0 && (
        <div className="bg-white rounded-2xl border border-neutral-200 p-12 text-center text-neutral-500 text-sm">
          Noch keine Bestellungen.
        </div>
      )}

      {grouped.map(({ supplier, orders }) => {
        const open = orders.reduce((sum, o) => sum + Number(o.remaining_balance ?? 0), 0);
        const invoiced = orders.reduce((sum, o) => sum + Number(o.invoice_total ?? 0), 0);
        return (
          <section key={supplier.id} className="space-y-3">
            <div className="flex items-end justify-between">
              <div>
                <h2 className="text-lg font-semibold text-neutral-900">{supplier.name}</h2>
                <p className="text-xs text-neutral-500">
                  {orders.length} Bestellungen · Rechnung {usd(invoiced)} · Offen {usd(open)}
                </p>
              </div>
              {supplier.price_list_url && (
                <a
                  href={supplier.price_list_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-blue-600 hover:underline"
                >
                  Preisliste öffnen →
                </a>
              )}
            </div>

            <div className="bg-white rounded-2xl border border-neutral-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">Label</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium">Ankunft ca.</th>
                    <th className="px-4 py-3 font-medium">Dokumente</th>
                    <th className="px-4 py-3 font-medium text-right">Rechnung</th>
                    <th className="px-4 py-3 font-medium text-right">Offen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {orders.map((o) => (
                    <tr key={o.id} className="hover:bg-neutral-50">
                      <td className="px-4 py-3">
                        <Link
                          href={`/orders/${o.id}`}
                          className="font-medium text-neutral-900 hover:underline"
                        >
                          {o.label}
                        </Link>
                        {o.description && (
                          <div className="text-xs text-neutral-500 truncate max-w-xs">
                            {o.description}
                          </div>
                        )}
                        {(() => {
                          const inv = (docsByOrder.get(o.id) ?? []).find(
                            (d) => d.kind === "supplier_invoice",
                          );
                          return inv ? (
                            <div className="text-[10px] text-neutral-400 truncate max-w-[200px] leading-tight">
                              {inv.file_name}
                            </div>
                          ) : null;
                        })()}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={o.status} />
                      </td>
                      <td className="px-4 py-3 text-neutral-700">{date(o.eta)}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <QuickDocs documents={docsByOrder.get(o.id) ?? []} compact paidTotal={o.paid_total} />
                          <DocIndicators documents={docsByOrder.get(o.id) ?? []} />
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right text-neutral-700">
                        {usd(o.invoice_total)}
                      </td>
                      <td className="px-4 py-3 text-right font-medium text-neutral-900">
                        {usd(o.remaining_balance)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}

function StatusBadge({ status }: { status: keyof typeof STATUS_LABELS }) {
  const colors: Record<string, string> = {
    draft: "bg-neutral-100 text-neutral-700",
    sent_to_supplier: "bg-blue-50 text-blue-700",
    confirmed: "bg-indigo-50 text-indigo-700",
    in_production: "bg-amber-50 text-amber-700",
    ready_to_ship: "bg-purple-50 text-purple-700",
    shipped: "bg-cyan-50 text-cyan-700",
    in_customs: "bg-orange-50 text-orange-700",
    delivered: "bg-emerald-50 text-emerald-700",
    cancelled: "bg-red-50 text-red-700",
  };
  return (
    <span
      className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${colors[status] ?? "bg-neutral-100"}`}
    >
      {STATUS_LABELS[status]}
    </span>
  );
}
