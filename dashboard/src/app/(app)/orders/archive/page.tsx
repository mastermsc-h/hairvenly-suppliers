import Link from "next/link";
import { ArrowLeft, Archive as ArchiveIcon } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireProfile, hasFeature } from "@/lib/auth";
import { usd, date } from "@/lib/format";
import { type OrderWithTotals, type OrderDocument, type Supplier } from "@/lib/types";
import { t, type Locale } from "@/lib/i18n";
import QuickDocs from "../[id]/quick-docs";
import TrackingLink from "../../tracking-link";
import DocIndicators from "../[id]/doc-indicators";

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-neutral-100 text-neutral-700",
  sent_to_supplier: "bg-blue-50 text-blue-700",
  confirmed: "bg-indigo-50 text-indigo-700",
  in_production: "bg-amber-50 text-amber-700",
  ready_to_ship: "bg-purple-50 text-purple-700",
  shipped: "bg-cyan-50 text-cyan-700",
  in_customs: "bg-orange-50 text-orange-700",
  delivered: "bg-emerald-50 text-emerald-700",
  stocked: "bg-teal-50 text-teal-700",
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

export default async function OrdersArchivePage() {
  const profile = await requireProfile();
  const supabase = await createClient();
  const locale = (profile.language ?? "de") as Locale;
  const isSupplierRole = profile.role === "supplier";
  const mySupplierId = profile.supplier_id;

  const showAllDocs = hasFeature(profile, "documents") || isSupplierRole;
  const showPackingLists = hasFeature(profile, "packing_lists") || showAllDocs;
  const showDocs = showAllDocs || showPackingLists;
  const showInvoices = hasFeature(profile, "invoices") || isSupplierRole;

  // Scope to own supplier for supplier role
  let ordersQuery = supabase
    .from("orders_with_totals")
    .select("*")
    .in("status", ["stocked", "cancelled"]);
  if (isSupplierRole && mySupplierId) {
    ordersQuery = ordersQuery.eq("supplier_id", mySupplierId);
  }

  const [{ data: orders }, { data: suppliers }, { data: documents }] = await Promise.all([
    ordersQuery.order("order_date", { ascending: false }),
    supabase.from("suppliers").select("*").order("sort_order").order("name"),
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

  const supplierMap = new Map(supplierList.map((s) => [s.id, s] as const));

  const grouped = supplierList
    .map((s) => ({
      supplier: s,
      orders: list.filter((o) => o.supplier_id === s.id),
    }))
    .filter((g) => g.orders.length > 0);

  return (
    <div className="p-4 md:p-8 space-y-6 md:space-y-8 max-w-7xl">
      <div>
        <Link href="/orders" className="text-sm text-neutral-500 hover:text-neutral-900 inline-flex items-center gap-1">
          <ArrowLeft size={14} /> {t(locale, "nav.orders")}
        </Link>
      </div>
      <header className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900 inline-flex items-center gap-2">
            <ArchiveIcon size={22} /> {t(locale, "orders.archive")}
          </h1>
          <p className="text-sm text-neutral-500 mt-1">
            {list.length} {t(locale, "orders.archived_total")} · {grouped.length} {t(locale, "orders.suppliers")}
          </p>
        </div>
      </header>

      {list.length === 0 && (
        <div className="bg-white rounded-2xl border border-neutral-200 p-12 text-center text-neutral-500 text-sm">
          {t(locale, "orders.archive_empty")}
        </div>
      )}

      {grouped.map(({ supplier, orders: sOrders }) => {
        const stockedCount = sOrders.filter((o) => o.status === "stocked").length;
        const cancelledCount = sOrders.filter((o) => o.status === "cancelled").length;
        return (
          <section key={supplier.id} className="space-y-3">
            <div>
              <h2 className="text-lg font-semibold text-neutral-900">{supplier.name}</h2>
              <p className="text-xs text-neutral-500">
                {sOrders.length} {t(locale, "dashboard.orders_count")}
                {stockedCount > 0 && ` · ${stockedCount} ${t(locale, "order.status.stocked")}`}
                {cancelledCount > 0 && ` · ${cancelledCount} ${t(locale, "order.status.cancelled")}`}
              </p>
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
                          <div className="text-xs text-neutral-500 truncate max-w-xs">{o.description}</div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <StatusBadge status={o.status} locale={locale} />
                      </td>
                      <td className="px-4 py-3 text-neutral-700 align-top">
                        {date(o.eta)}
                        {o.tracking_number && (
                          <div className="mt-0.5">
                            <TrackingLink number={o.tracking_number} url={o.tracking_url} maxWidth={140} />
                          </div>
                        )}
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
                        <td className="px-4 py-3 text-right text-neutral-700">{usd(o.invoice_total)}</td>
                      )}
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
                        <div className="flex items-center gap-2 mt-1">
                          <StatusBadge status={o.status} locale={locale} />
                          {o.eta && <span className="text-xs text-neutral-500">{date(o.eta)}</span>}
                        </div>
                      </div>
                      {showInvoices && (
                        <div className="text-right shrink-0">
                          <div className="text-sm font-semibold text-neutral-900">{usd(o.invoice_total)}</div>
                        </div>
                      )}
                    </div>
                    {showDocs && (
                      <div className="flex flex-wrap items-center gap-1.5 mt-2">
                        <QuickDocs documents={visibleDocsFor(o.id)} compact paidTotal={o.paid_total} remainingBalance={o.remaining_balance} locale={locale} hideFinancials={!showInvoices} />
                        <DocIndicators documents={visibleDocsFor(o.id)} />
                      </div>
                    )}
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
