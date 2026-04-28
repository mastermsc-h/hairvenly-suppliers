import Link from "next/link";
import { Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireProfile, hasFeature } from "@/lib/auth";
import { usd, date } from "@/lib/format";
import { type OrderWithTotals, type OrderDocument, type Supplier } from "@/lib/types";
import { t, type Locale } from "@/lib/i18n";
import QuickDocs from "./[id]/quick-docs";
import TrackingLink from "../tracking-link";
import TrackingCell from "../tracking-cell";
import NotesCell from "../notes-cell";
import StatusDropdown from "./[id]/status-dropdown";
import DocIndicators from "./[id]/doc-indicators";

export default async function OrdersPage() {
  const profile = await requireProfile();
  const supabase = await createClient();
  const locale = (profile.language ?? "de") as Locale;
  const isSupplierRole = profile.role === "supplier";
  const mySupplierId = profile.supplier_id;
  // Suppliers always see their own documents and invoices
  const showAllDocs = hasFeature(profile, "documents") || isSupplierRole;
  const showPackingLists = hasFeature(profile, "packing_lists") || showAllDocs;
  const showDocs = showAllDocs || showPackingLists;
  const showInvoices = hasFeature(profile, "invoices") || isSupplierRole;
  const canEditOrder = profile.is_admin || isSupplierRole;

  // Scope queries to own supplier for supplier role
  let ordersQuery = supabase.from("orders_with_totals").select("*");
  let suppliersQuery = supabase.from("suppliers").select("*");
  if (isSupplierRole && mySupplierId) {
    ordersQuery = ordersQuery.eq("supplier_id", mySupplierId);
    suppliersQuery = suppliersQuery.eq("id", mySupplierId);
  }

  const [{ data: orders }, { data: suppliers }, { data: documents }] = await Promise.all([
    ordersQuery.order("created_at", { ascending: false }),
    suppliersQuery.order("sort_order").order("name"),
    supabase
      .from("documents")
      .select("*")
      .in("kind", ["supplier_invoice", "payment_proof", "customs_document", "waybill", "order_overview", "packing_details"]),
  ]);

  const list = (orders ?? []) as OrderWithTotals[];
  const supplierList = (suppliers ?? []) as Supplier[];
  const docsByOrder = new Map<string, OrderDocument[]>();
  for (const d of (documents ?? []) as OrderDocument[]) {
    const arr = docsByOrder.get(d.order_id) ?? [];
    arr.push(d);
    docsByOrder.set(d.order_id, arr);
  }

  function visibleDocsFor(orderId: string) {
    const all = docsByOrder.get(orderId) ?? [];
    if (showAllDocs) return all;
    if (showPackingLists) return all.filter((d) => d.kind === "packing_details");
    return [];
  }

  // Sort by order_date desc, then created_at desc
  const sorted = [...list].sort((a, b) => {
    const da = a.order_date ?? a.created_at;
    const db = b.order_date ?? b.created_at;
    return db.localeCompare(da);
  });

  const grouped = supplierList
    .map((s) => ({
      supplier: s,
      orders: sorted.filter((o) => o.supplier_id === s.id),
    }))
    .filter((g) => g.orders.length > 0);

  return (
    <div className="p-4 md:p-8 space-y-6 md:space-y-8 max-w-7xl">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">{t(locale, "nav.orders")}</h1>
          <p className="text-sm text-neutral-500 mt-1">
            {list.length} {t(locale, "orders.total")} · {grouped.length} {t(locale, "orders.suppliers")}
          </p>
        </div>
        {profile.is_admin && (
          <Link
            href="/orders/new"
            className="inline-flex items-center gap-2 bg-neutral-900 text-white text-sm font-medium px-4 py-2 rounded-lg hover:bg-neutral-800 transition"
          >
            <Plus size={16} /> {t(locale, "dashboard.new_order")}
          </Link>
        )}
      </header>

      {list.length === 0 && (
        <div className="bg-white rounded-2xl border border-neutral-200 p-12 text-center text-neutral-500 text-sm">
          {t(locale, "orders.no_orders")}
        </div>
      )}

      {grouped.map(({ supplier, orders: sOrders }) => {
        const open = sOrders.reduce((sum, o) => sum + Number(o.remaining_balance ?? 0), 0);
        const invoiced = sOrders.reduce((sum, o) => sum + Number(o.invoice_total ?? 0), 0);
        return (
          <section key={supplier.id} className="space-y-3">
            <div className="flex items-end justify-between">
              <div>
                <h2 className="text-lg font-semibold text-neutral-900">{supplier.name}</h2>
                <p className="text-xs text-neutral-500">
                  {sOrders.length} {t(locale, "dashboard.orders_count")} · {t(locale, "dashboard.invoice_label")} {usd(invoiced)} · {t(locale, "dashboard.open_label")} {usd(open)}
                </p>
              </div>
              {supplier.price_list_url && (
                <a
                  href={supplier.price_list_url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs text-blue-600 hover:underline"
                >
                  {t(locale, "dashboard.price_list")} →
                </a>
              )}
            </div>

            <div className="bg-white rounded-2xl border border-neutral-200 overflow-hidden">
              {/* Desktop table */}
              <table className="hidden md:table w-full text-sm">
                <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500">
                  <tr>
                    <th className="px-4 py-3 font-medium">{t(locale, "table.label")}</th>
                    <th className="px-4 py-3 font-medium">{t(locale, "table.status")}</th>
                    <th className="px-4 py-3 font-medium">{t(locale, "table.eta")}</th>
                    {showDocs && <th className="px-4 py-3 font-medium">{t(locale, "table.documents")}</th>}
                    {showInvoices && <th className="px-4 py-3 font-medium text-right">{t(locale, "table.invoice")}</th>}
                    {showInvoices && <th className="px-4 py-3 font-medium text-right">{t(locale, "table.open")}</th>}
                    <th className="px-4 py-3 font-medium">{t(locale, "table.notes")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {sOrders.map((o) => (
                    <tr key={o.id} className="odd:bg-white even:bg-neutral-50/60 hover:bg-indigo-50/40 transition">
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
                        {showDocs && (() => {
                          const inv = visibleDocsFor(o.id).find(
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
                        {canEditOrder ? (
                          <StatusDropdown orderId={o.id} currentStatus={o.status} locale={locale} />
                        ) : (
                          <StatusBadge status={o.status} locale={locale} />
                        )}
                      </td>
                      <td className="px-4 py-3 text-neutral-700 align-top">
                        {date(o.eta)}
                        <TrackingCell
                          orderId={o.id}
                          number={o.tracking_number}
                          url={o.tracking_url}
                          canEdit={canEditOrder}
                          maxWidth={140}
                          locale={locale}
                        />
                      </td>
                      {showDocs && (
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <QuickDocs documents={visibleDocsFor(o.id)} compact paidTotal={o.paid_total} remainingBalance={o.remaining_balance} locale={locale} hideFinancials={!showInvoices} />
                            <DocIndicators documents={visibleDocsFor(o.id)} />
                          </div>
                        </td>
                      )}
                      {showInvoices && (
                        <td className="px-4 py-3 text-right text-neutral-700">
                          {usd(o.invoice_total)}
                        </td>
                      )}
                      {showInvoices && (
                        <td className="px-4 py-3 text-right font-medium text-neutral-900">
                          {usd(o.remaining_balance)}
                        </td>
                      )}
                      <td className="px-4 py-3 align-top">
                        <NotesCell
                          orderId={o.id}
                          notes={o.notes}
                          canEdit={canEditOrder}
                          locale={locale}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {/* Mobile card list */}
              <div className="md:hidden divide-y divide-neutral-100">
                {sOrders.map((o) => (
                  <Link key={o.id} href={`/orders/${o.id}`} className="block px-4 py-3 odd:bg-white even:bg-neutral-50/60 hover:bg-indigo-50/40 active:bg-indigo-50/60 transition">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="font-medium text-neutral-900 text-sm truncate">{o.label}</div>
                        {o.description && (
                          <div className="text-xs text-neutral-500 truncate">{o.description}</div>
                        )}
                        <div className="flex items-center gap-2 mt-1">
                          {canEditOrder ? (
                            <StatusDropdown orderId={o.id} currentStatus={o.status} locale={locale} />
                          ) : (
                            <StatusBadge status={o.status} locale={locale} />
                          )}
                          {o.eta && <span className="text-xs text-neutral-500">{date(o.eta)}</span>}
                        </div>
                        <TrackingCell
                          orderId={o.id}
                          number={o.tracking_number}
                          url={o.tracking_url}
                          canEdit={canEditOrder}
                          maxWidth={200}
                          locale={locale}
                        />
                      </div>
                      {showInvoices && (
                        <div className="text-right shrink-0">
                          <div className="text-sm font-semibold text-neutral-900">{usd(o.remaining_balance)}</div>
                          <div className="text-[10px] text-neutral-500">{usd(o.invoice_total)}</div>
                        </div>
                      )}
                    </div>
                    {showDocs && (
                      <div className="flex flex-wrap items-center gap-1.5 mt-2">
                        <QuickDocs documents={visibleDocsFor(o.id)} compact paidTotal={o.paid_total} remainingBalance={o.remaining_balance} locale={locale} hideFinancials={!showInvoices} />
                        <DocIndicators documents={visibleDocsFor(o.id)} />
                      </div>
                    )}
                    <div className="mt-2">
                      <NotesCell
                        orderId={o.id}
                        notes={o.notes}
                        canEdit={canEditOrder}
                        locale={locale}
                      />
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </section>
        );
      })}
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
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

function StatusBadge({ status, locale }: { status: string; locale: Locale }) {
  return (
    <span
      className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[status] ?? "bg-neutral-100"}`}
    >
      {t(locale, `order.status.${status}`)}
    </span>
  );
}
