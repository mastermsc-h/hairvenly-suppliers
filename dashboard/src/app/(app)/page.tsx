import Link from "next/link";
import { ExternalLink, Package, Wallet, Plus } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { usd, date } from "@/lib/format";
import { type OrderWithTotals, type OrderDocument, type Supplier } from "@/lib/types";
import { buildMonthlyStats } from "@/lib/stats";
import { t, type Locale } from "@/lib/i18n";
import QuickDocs from "./orders/[id]/quick-docs";
import DocIndicators from "./orders/[id]/doc-indicators";
import AvatarUpload from "./avatar-upload";
import OverviewDoc from "./overview-doc";
import SupplierCard from "./supplier-card";
import SupplierList from "./supplier-list";
import SupplierProfile from "./supplier-profile";
import StatusDropdown from "./orders/[id]/status-dropdown";
import { VolumeChart, DebtChart } from "./charts";
import SupplierKgBars, { type SupplierKgRow } from "./supplier-kg-bars";
import { publicAvatarUrl, publicOverviewUrl } from "@/lib/storage";

export default async function DashboardPage() {
  const profile = await requireProfile();
  const supabase = await createClient();
  const locale = (profile.language ?? "de") as Locale;

  const [{ data: orders }, { data: suppliers }, { data: documents }, { data: payments }] =
    await Promise.all([
      supabase
        .from("orders_with_totals")
        .select("*")
        .order("created_at", { ascending: false }),
      supabase.from("suppliers").select("*").order("sort_order").order("name"),
      supabase
        .from("documents")
        .select("*")
        .in("kind", ["supplier_invoice", "payment_proof", "customs_document", "waybill", "order_overview"]),
      supabase.from("payments").select("paid_at, amount"),
    ]);

  const list = (orders ?? []) as OrderWithTotals[];
  const supplierList = (suppliers ?? []) as Supplier[];
  const docsByOrder = new Map<string, OrderDocument[]>();
  for (const d of (documents ?? []) as OrderDocument[]) {
    const arr = docsByOrder.get(d.order_id) ?? [];
    arr.push(d);
    docsByOrder.set(d.order_id, arr);
  }

  const totalOpen = list.reduce((sum, o) => sum + Number(o.remaining_balance ?? 0), 0);
  const activeOrders = list.filter(
    (o) => o.status !== "delivered" && o.status !== "cancelled",
  ).length;

  // Kg pro Lieferant: gesamt bestellt + davon unterwegs
  const kgRows: SupplierKgRow[] = supplierList
    .map((s) => {
      const mine = list.filter((o) => o.supplier_id === s.id && o.status !== "cancelled");
      const total = mine.reduce((sum, o) => sum + Number(o.weight_kg ?? 0), 0);
      const transit = mine
        .filter(
          (o) =>
            o.status === "shipped" ||
            o.status === "in_customs" ||
            !!o.tracking_number,
        )
        .reduce((sum, o) => sum + Number(o.weight_kg ?? 0), 0);
      return { name: s.name, total, transit };
    })
    .filter((r) => r.total > 0);

  const monthly = buildMonthlyStats(
    list.map((o) => ({ created_at: o.created_at, invoice_total: o.invoice_total })),
    (payments ?? []) as { paid_at: string; amount: number | null }[],
    12,
  );

  return (
    <div className="p-4 md:p-8 space-y-6 md:space-y-8 max-w-7xl">
      <header>
        <h1 className="text-2xl font-semibold text-neutral-900">{t(locale, "nav.overview")}</h1>
        <p className="text-sm text-neutral-500 mt-1">{t(locale, "dashboard.subtitle")}</p>
      </header>

      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Stat
          label={t(locale, "dashboard.active_orders")}
          value={activeOrders.toString()}
          icon={<Package size={18} />}
          color="indigo"
        />
        <Stat
          label={profile.is_admin ? t(locale, "dashboard.open_debt") : t(locale, "dashboard.open_amount")}
          value={usd(totalOpen)}
          icon={<Wallet size={18} />}
          color="rose"
        />
        {profile.is_admin && (
          <div className="sm:col-span-2 bg-white rounded-2xl border border-neutral-200 p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <div className="text-xs text-neutral-500 uppercase tracking-wide">
                {t(locale, "dashboard.kg_per_supplier")}
              </div>
              <div className="flex items-center gap-3 text-[10px] text-neutral-500">
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-sm bg-indigo-200" /> {t(locale, "dashboard.ordered_total")}
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-sm bg-indigo-600" /> {t(locale, "dashboard.in_transit")}
                </span>
              </div>
            </div>
            <SupplierKgBars rows={kgRows} />
          </div>
        )}
      </section>

      <section>
        <h2 className="text-lg font-semibold text-neutral-900 mb-1">{t(locale, "dashboard.orders_per_supplier")}</h2>
        <p className="text-xs text-neutral-500 mb-4">
          {t(locale, "dashboard.orders_subtitle")}
        </p>

        <SupplierList
          isAdmin={profile.is_admin}
          items={supplierList.map((s) => {
            const sOrders = list.filter((o) => o.supplier_id === s.id);
            const openOrders = sOrders
              .filter((o) => o.status !== "delivered" && o.status !== "cancelled")
              .sort((a, b) => {
                const da = a.order_date ?? a.created_at;
                const db = b.order_date ?? b.created_at;
                return db.localeCompare(da);
              });
            const open = sOrders.reduce((sum, o) => sum + Number(o.remaining_balance ?? 0), 0);
            const invoiced = sOrders.reduce((sum, o) => sum + Number(o.invoice_total ?? 0), 0);

            const avatarUrl = publicAvatarUrl(s.avatar_path);
            const overviewUrl = publicOverviewUrl(s.overview_doc_path);
            const showOverview = profile.is_admin || s.overview_visible_to_supplier;

            const header = (
              <div className="px-3 py-3 md:px-4 md:py-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <AvatarUpload
                    supplierId={s.id}
                    url={avatarUrl}
                    name={s.name}
                    isAdmin={profile.is_admin}
                  />
                  <div className="min-w-0">
                    <SupplierProfile supplier={s} isAdmin={profile.is_admin}>
                      <div className="font-semibold text-neutral-900 truncate">{s.name}</div>
                    </SupplierProfile>
                    <div className="text-xs text-neutral-500 mt-0.5">
                      {sOrders.length} {t(locale, "dashboard.orders_count")} · {openOrders.length} {t(locale, "dashboard.active_count")} · {t(locale, "dashboard.invoice_label")}{" "}
                      {usd(invoiced)}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-4 sm:gap-5 shrink-0 pl-12 sm:pl-0">
                  {showOverview && (
                    <OverviewDoc
                      supplierId={s.id}
                      url={overviewUrl}
                      path={s.overview_doc_path}
                      label={s.overview_doc_label}
                      visibleToSupplier={s.overview_visible_to_supplier}
                      isAdmin={profile.is_admin}
                      locale={locale}
                    />
                  )}
                  <div className="text-right">
                    <div className="text-[10px] text-neutral-500 uppercase tracking-wide">{t(locale, "dashboard.open_label")}</div>
                    <div className={`text-xl font-semibold ${open > 0 ? "text-rose-600" : "text-neutral-900"}`}>
                      {usd(open)}
                    </div>
                  </div>
                </div>
              </div>
            );

            const addBtn = (
              <div className="px-4 md:px-5 py-2 border-t border-neutral-100 bg-neutral-50/40">
                <Link
                  href={`/orders/new?supplier_id=${s.id}`}
                  className="inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-indigo-700"
                >
                  <Plus size={14} /> {t(locale, "dashboard.new_order")}
                </Link>
              </div>
            );

            const body =
              openOrders.length === 0 ? (
                <>
                  <div className="px-4 md:px-5 py-6 text-center text-sm text-neutral-400 border-t border-neutral-100">
                    {t(locale, "dashboard.no_active_orders")}
                  </div>
                  {addBtn}
                </>
              ) : (
                <div className="border-t border-neutral-100">
                  {/* Desktop table */}
                  <table className="hidden md:table w-full text-sm">
                    <thead className="bg-neutral-50/60 text-left text-xs uppercase text-neutral-500">
                      <tr>
                        <th className="px-5 py-2.5 font-medium">{t(locale, "table.label")}</th>
                        <th className="px-5 py-2.5 font-medium">{t(locale, "table.status")}</th>
                        <th className="px-5 py-2.5 font-medium">{t(locale, "table.eta")}</th>
                        <th className="px-5 py-2.5 font-medium">{t(locale, "table.documents")}</th>
                        <th className="px-5 py-2.5 font-medium text-right">{t(locale, "table.invoice")}</th>
                        <th className="px-5 py-2.5 font-medium text-right">{t(locale, "table.open")}</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-neutral-100">
                      {openOrders.map((o) => (
                        <tr key={o.id} className="hover:bg-indigo-50/30 transition">
                          <td className="px-5 py-2.5">
                            <Link
                              href={`/orders/${o.id}`}
                              className="font-medium text-indigo-700 hover:text-indigo-900 hover:underline"
                            >
                              {o.label}
                            </Link>
                            <div className="flex items-center gap-1.5 mt-0.5">
                              {(o.tags ?? []).map((tag: string) => (
                                <span key={tag} className="inline-flex px-1.5 py-0.5 rounded text-[9px] font-medium bg-neutral-100 text-neutral-500">
                                  {tag}
                                </span>
                              ))}
                              {(() => {
                                const inv = (docsByOrder.get(o.id) ?? []).find(
                                  (d) => d.kind === "supplier_invoice",
                                );
                                return inv ? (
                                  <span className="text-[9px] text-neutral-300 truncate max-w-[150px]">
                                    {inv.file_name}
                                  </span>
                                ) : null;
                              })()}
                            </div>
                          </td>
                          <td className="px-5 py-2.5">
                            {profile.is_admin ? (
                              <StatusDropdown orderId={o.id} currentStatus={o.status} locale={locale} />
                            ) : (
                              <StatusBadge status={o.status} locale={locale} />
                            )}
                          </td>
                          <td className="px-5 py-2.5 text-neutral-700">{date(o.eta)}</td>
                          <td className="px-5 py-2.5">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <QuickDocs documents={docsByOrder.get(o.id) ?? []} compact paidTotal={o.paid_total} locale={locale} />
                              <DocIndicators documents={docsByOrder.get(o.id) ?? []} />
                            </div>
                          </td>
                          <td className="px-5 py-2.5 text-right text-neutral-700">
                            {usd(o.invoice_total)}
                          </td>
                          <td className="px-5 py-2.5 text-right font-medium text-neutral-900">
                            {usd(o.remaining_balance)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {/* Mobile card list */}
                  <div className="md:hidden divide-y divide-neutral-100">
                    {openOrders.map((o) => (
                      <Link key={o.id} href={`/orders/${o.id}`} className="block px-4 py-3 hover:bg-indigo-50/30 active:bg-indigo-50/50 transition">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="font-medium text-indigo-700 text-sm truncate">{o.label}</div>
                            {(o.tags ?? []).length > 0 && (
                              <div className="flex gap-1 mt-0.5">
                                {(o.tags as string[]).map((tag: string) => (
                                  <span key={tag} className="inline-flex px-1.5 py-0.5 rounded text-[9px] font-medium bg-neutral-100 text-neutral-500">{tag}</span>
                                ))}
                              </div>
                            )}
                            <div className="flex items-center gap-2 mt-1">
                              {profile.is_admin ? (
                                <StatusDropdown orderId={o.id} currentStatus={o.status} locale={locale} />
                              ) : (
                                <StatusBadge status={o.status} locale={locale} />
                              )}
                              {o.eta && <span className="text-xs text-neutral-500">{date(o.eta)}</span>}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className="text-sm font-semibold text-neutral-900">{usd(o.remaining_balance)}</div>
                            <div className="text-[10px] text-neutral-500">{usd(o.invoice_total)}</div>
                          </div>
                        </div>
                        <div className="flex flex-wrap items-center gap-1.5 mt-2">
                          <QuickDocs documents={docsByOrder.get(o.id) ?? []} compact paidTotal={o.paid_total} locale={locale} />
                          <DocIndicators documents={docsByOrder.get(o.id) ?? []} />
                        </div>
                      </Link>
                    ))}
                  </div>
                  {addBtn}
                </div>
              );

            const footer = (
              <div className="px-4 md:px-5 py-3 border-t border-neutral-100 flex flex-wrap items-center gap-2 md:gap-3 text-xs bg-neutral-50/40">
                {s.price_list_url ? (
                  <a
                    href={s.price_list_url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-indigo-600 hover:text-indigo-800 font-medium"
                  >
                    {t(locale, "dashboard.price_list")} <ExternalLink size={12} />
                  </a>
                ) : (
                  <span className="text-neutral-400">{t(locale, "dashboard.no_price_list")}</span>
                )}
                <span className="text-neutral-300">·</span>
                <button
                  disabled
                  title="Phase 2"
                  className="text-neutral-400 cursor-not-allowed"
                >
                  🔍 {t(locale, "dashboard.scan_invoice")}
                </button>
              </div>
            );

            return {
              id: s.id,
              node: (
                <SupplierCard
                  key={s.id}
                  supplierId={s.id}
                  header={header}
                  body={body}
                  footer={footer}
                />
              ),
            };
          })}
        />
      </section>

      {profile.is_admin && (
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <ChartCard title={t(locale, "dashboard.volume_title")} subtitle={t(locale, "dashboard.volume_subtitle")}>
            <VolumeChart data={monthly} />
          </ChartCard>
          <ChartCard title={t(locale, "dashboard.debt_title")} subtitle={t(locale, "dashboard.debt_subtitle")}>
            <DebtChart data={monthly} />
          </ChartCard>
        </section>
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  icon,
  color,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  color: "indigo" | "rose" | "emerald" | "amber";
}) {
  const colors = {
    indigo: "bg-indigo-50 text-indigo-600",
    rose: "bg-rose-50 text-rose-600",
    emerald: "bg-emerald-50 text-emerald-600",
    amber: "bg-amber-50 text-amber-600",
  } as const;
  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="text-xs text-neutral-500 uppercase tracking-wide">{label}</div>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${colors[color]}`}>
          {icon}
        </div>
      </div>
      <div className="mt-2 text-2xl font-semibold text-neutral-900">{value}</div>
    </div>
  );
}

function ChartCard({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-5 shadow-sm">
      <div className="mb-4">
        <h3 className="text-sm font-semibold text-neutral-900">{title}</h3>
        <p className="text-xs text-neutral-500">{subtitle}</p>
      </div>
      {children}
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
      className={`inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium ${STATUS_COLORS[status] ?? "bg-neutral-100"}`}
    >
      {t(locale, `order.status.${status}`)}
    </span>
  );
}
