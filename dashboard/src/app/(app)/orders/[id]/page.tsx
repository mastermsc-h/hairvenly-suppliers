import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, Weight, Package as PackageIcon, DollarSign, CreditCard, Pencil, ChevronDown, FileSpreadsheet } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireProfile, hasFeature } from "@/lib/auth";
import { usd, date, dateTime } from "@/lib/format";
import {
  STATUS_LABELS,
  type OrderWithTotals,
  type Supplier,
  type Payment,
  type OrderDocument,
  type OrderEvent,
  type OrderItem,
} from "@/lib/types";
import { t, type Locale } from "@/lib/i18n";
import EditPanel from "./edit-panel";
import PaymentForm from "./payment-form";
import PaymentItem from "./payment-item";
import DocumentUpload from "./document-upload";
import DocumentItem from "./document-item";
import QuickDocs from "./quick-docs";
import BackLink from "./back-link";
import OrderItemsSection from "./order-items-section";
import StatusDropdown from "./status-dropdown";

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await requireProfile();
  const supabase = await createClient();
  const locale = (profile.language ?? "de") as Locale;

  const { data: order } = await supabase
    .from("orders_with_totals")
    .select("*")
    .eq("id", id)
    .single();
  if (!order) notFound();

  const o = order as OrderWithTotals;

  const [{ data: supplier }, { data: payments }, { data: documents }, { data: events }, { data: orderItems }] =
    await Promise.all([
      supabase.from("suppliers").select("*").eq("id", o.supplier_id).single(),
      supabase
        .from("payments")
        .select("*")
        .eq("order_id", id)
        .order("paid_at", { ascending: false }),
      supabase
        .from("documents")
        .select("*")
        .eq("order_id", id)
        .order("created_at", { ascending: false }),
      supabase
        .from("order_events")
        .select("*")
        .eq("order_id", id)
        .order("created_at", { ascending: false })
        .limit(50),
      supabase
        .from("order_items")
        .select("*")
        .eq("order_id", id)
        .order("created_at"),
    ]);

  const sup = supplier as Supplier | null;
  const pays = (payments ?? []) as Payment[];
  const docs = (documents ?? []) as OrderDocument[];
  const evs = (events ?? []) as OrderEvent[];
  const items = (orderItems ?? []) as OrderItem[];

  // Group order items by method + length
  const itemGroups: { label: string; items: OrderItem[] }[] = [];
  const groupMap = new Map<string, OrderItem[]>();
  for (const item of items) {
    const key = `${item.method_name}|${item.length_value}`;
    if (!groupMap.has(key)) groupMap.set(key, []);
    groupMap.get(key)!.push(item);
  }
  for (const [key, groupItems] of groupMap) {
    const [method, length] = key.split("|");
    itemGroups.push({ label: `${method} · ${length}`, items: groupItems });
  }
  const totalQty = items.reduce((s, i) => s + i.quantity, 0);

  // Payment-proof Nummerierung (älteste = Zahlung 1)
  const proofNumber = new Map<string, number>();
  docs
    .filter((d) => d.kind === "payment_proof")
    .slice()
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .forEach((d, i) => proofNumber.set(d.id, i + 1));

  // Resolve actor emails for the timeline
  const actorIds = Array.from(
    new Set(evs.map((e) => e.actor_id).filter((v): v is string => !!v)),
  );
  const actorMap = new Map<string, string>();
  if (actorIds.length > 0) {
    const { data: actors } = await supabase
      .from("profiles")
      .select("id, email")
      .in("id", actorIds);
    for (const a of (actors ?? []) as { id: string; email: string }[]) {
      actorMap.set(a.id, a.email.split("@")[0]);
    }
  }

  return (
    <div className="p-4 md:p-8 space-y-5 md:space-y-6 max-w-6xl">
      <div>
        <BackLink locale={locale} />
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 mt-2">
          <div className="min-w-0">
            <h1 className="text-xl md:text-2xl font-semibold text-neutral-900 break-words">{o.label}</h1>
            <p className="text-sm text-neutral-500 mt-1">
              {sup?.name} · {t(locale, "order.created")} {dateTime(o.created_at)}
            </p>
          </div>
          {profile.is_admin ? (
            <StatusDropdown orderId={o.id} currentStatus={o.status} locale={locale} />
          ) : (
            <span className="inline-flex px-3 py-1 rounded-full text-xs font-medium bg-neutral-100 text-neutral-700 self-start shrink-0">
              {t(locale, `order.status.${o.status}`)}
            </span>
          )}
        </div>
        {hasFeature(profile, "invoices") && (
          <div className="mt-4">
            <QuickDocs documents={docs} paidTotal={o.paid_total} remainingBalance={o.remaining_balance} locale={locale} hideFinancials={!hasFeature(profile, "invoices")} />
          </div>
        )}
      </div>

      <div className={`grid grid-cols-1 ${hasFeature(profile, "invoices") ? "lg:grid-cols-3" : ""} gap-6`}>
        <div className={`${hasFeature(profile, "invoices") ? "lg:col-span-2" : ""} space-y-6`}>
          {/* Details + Edit */}
          <section className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-medium text-neutral-700">{t(locale, "order.details")}</h2>
            </div>
            <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <Info label={t(locale, "order.description")} value={o.description ?? "—"} />
              <Info label={t(locale, "order.tags")} value={o.tags?.join(", ") || "—"} />
              <Info label={t(locale, "order.eta")} value={date(o.eta)} />
              <Info
                label={t(locale, "order.weight_packages")}
                value={
                  <span className="inline-flex items-center gap-1">
                    <Weight size={13} className="text-neutral-400" />
                    {o.weight_kg ?? "—"} kg
                    <span className="text-neutral-400 mx-0.5">/</span>
                    <PackageIcon size={13} className="text-neutral-400" />
                    {o.package_count ?? "—"}
                  </span>
                }
              />
              <Info
                label={t(locale, "order.tracking")}
                value={
                  o.tracking_number ? (
                    o.tracking_url ? (
                      <a
                        href={o.tracking_url}
                        target="_blank"
                        rel="noreferrer"
                        className="text-blue-600 hover:underline inline-flex items-center gap-1"
                      >
                        {o.tracking_number} <ExternalLink size={12} />
                      </a>
                    ) : (
                      o.tracking_number
                    )
                  ) : (
                    "—"
                  )
                }
              />
              <Info
                label={t(locale, "order.google_sheet")}
                value={
                  o.sheet_url ? (
                    <a
                      href={o.sheet_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-600 hover:underline inline-flex items-center gap-1"
                    >
                      {t(locale, "order.open_sheet")} <ExternalLink size={12} />
                    </a>
                  ) : (
                    "—"
                  )
                }
              />
              <Info label={t(locale, "order.last_supplier_update")} value={date(o.last_supplier_update)} />
              <Info label={t(locale, "order.notes")} value={o.notes ?? "—"} />
            </dl>
            <div className="mt-5 pt-4 border-t border-neutral-100 flex justify-end">
              <EditPanel order={o} isAdmin={profile.is_admin} locale={locale} />
            </div>
          </section>

          {/* Order Items (from Wizard) */}
          {items.length > 0 && (
            <OrderItemsSection
              items={items}
              itemGroups={itemGroups}
              totalQty={totalQty}
              locale={locale}
              sheetUrl={o.sheet_url}
              orderId={o.id}
              isAdmin={profile.is_admin}
            />
          )}

          {/* Documents */}
          {hasFeature(profile, "documents") && (() => {
            const financialKinds = ["supplier_invoice", "payment_proof"];
            const visibleDocs = hasFeature(profile, "invoices")
              ? docs
              : docs.filter((d) => !financialKinds.includes(d.kind));
            return (
              <section className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6">
                <h2 className="text-sm font-medium text-neutral-700 mb-4">{t(locale, "order.documents_title")}</h2>
                {hasFeature(profile, "invoices") && <DocumentUpload orderId={o.id} locale={locale} />}
                <ul className="mt-4 divide-y divide-neutral-100">
                  {visibleDocs.length === 0 && (
                    <li className="text-sm text-neutral-500 py-3">{t(locale, "order.no_documents_yet")}</li>
                  )}
                  {visibleDocs.map((d) => (
                    <DocumentItem
                      key={d.id}
                      orderId={o.id}
                      doc={d}
                      isAdmin={profile.is_admin}
                      locale={locale}
                      displayName={
                        proofNumber.has(d.id) ? `${t(locale, "payment.number")} ${proofNumber.get(d.id)}` : undefined
                      }
                    />
                  ))}
                </ul>
              </section>
            );
          })()}

          {/* Timeline */}
          <section className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6">
            <h2 className="text-sm font-medium text-neutral-700 mb-4">{t(locale, "order.timeline")}</h2>
            <ul className="space-y-3 text-sm">
              {evs.length === 0 && <li className="text-neutral-500">{t(locale, "order.no_events_yet")}</li>}
              {evs.map((e) => {
                const actor = e.actor_id ? actorMap.get(e.actor_id) : null;
                return (
                  <li key={e.id} className="flex gap-3">
                    <div className="w-2 h-2 rounded-full bg-neutral-300 mt-1.5 shrink-0" />
                    <div>
                      <div className="text-neutral-900">{e.message}</div>
                      <div className="text-xs text-neutral-500">
                        {dateTime(e.created_at)}
                        {actor && <> · {t(locale, "order.by")} <span className="text-neutral-700">{actor}</span></>}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>

        {/* Sidebar: Finance — hidden when invoices feature is denied */}
        {hasFeature(profile, "invoices") && (
          <aside className="space-y-6">
            <section className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6">
              <h2 className="text-sm font-medium text-neutral-700 mb-4 flex items-center gap-1.5">
                <DollarSign size={14} className="text-neutral-400" />
                {t(locale, "order.finance")}
              </h2>
              <dl className="space-y-2 text-sm">
                <Row label={t(locale, "order.invoice_amount")} value={usd(o.invoice_total)} />
                <Row label={t(locale, "order.goods")} value={usd(o.goods_value)} />
                <Row label={t(locale, "order.shipping")} value={usd(o.shipping_cost)} />
                <Row label={t(locale, "order.customs")} value={usd(o.customs_duty)} />
                <Row label={t(locale, "order.import_vat")} value={usd(o.import_vat)} />
                <div className="pt-2 mt-2 border-t border-neutral-100" />
                <Row label={t(locale, "order.landed_cost")} value={usd(o.landed_cost)} bold />
                <Row label={t(locale, "order.paid")} value={usd(o.paid_total)} />
                <Row label={t(locale, "order.remaining")} value={usd(o.remaining_balance)} bold />
              </dl>
            </section>

            <section className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6">
              <h2 className="text-sm font-medium text-neutral-700 mb-4 flex items-center gap-1.5">
                <CreditCard size={14} className="text-neutral-400" />
                {t(locale, "order.payments")}
              </h2>
              {profile.is_admin && <PaymentForm orderId={o.id} locale={locale} />}
              <ul className="mt-4 divide-y divide-neutral-100">
                {pays.length === 0 && (
                  <li className="text-sm text-neutral-500 py-3">{t(locale, "order.no_payments_yet")}</li>
                )}
                {pays.map((p) => (
                  <PaymentItem key={p.id} orderId={o.id} payment={p} isAdmin={profile.is_admin} locale={locale} />
                ))}
              </ul>
            </section>
          </aside>
        )}
      </div>
    </div>
  );
}

function Info({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-neutral-500 uppercase tracking-wide">{label}</dt>
      <dd className="text-neutral-900 mt-0.5">{value}</dd>
    </div>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-neutral-600">{label}</span>
      <span className={bold ? "font-semibold text-neutral-900" : "text-neutral-900"}>{value}</span>
    </div>
  );
}
