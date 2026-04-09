import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink, Weight, Package as PackageIcon, DollarSign, CreditCard, Pencil } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { usd, date, dateTime } from "@/lib/format";
import {
  STATUS_LABELS,
  type OrderWithTotals,
  type Supplier,
  type Payment,
  type OrderDocument,
  type OrderEvent,
} from "@/lib/types";
import EditPanel from "./edit-panel";
import PaymentForm from "./payment-form";
import PaymentItem from "./payment-item";
import DocumentUpload from "./document-upload";
import DocumentItem from "./document-item";
import QuickDocs from "./quick-docs";
import BackLink from "./back-link";

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const profile = await requireProfile();
  const supabase = await createClient();

  const { data: order } = await supabase
    .from("orders_with_totals")
    .select("*")
    .eq("id", id)
    .single();
  if (!order) notFound();

  const o = order as OrderWithTotals;

  const [{ data: supplier }, { data: payments }, { data: documents }, { data: events }] =
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
    ]);

  const sup = supplier as Supplier | null;
  const pays = (payments ?? []) as Payment[];
  const docs = (documents ?? []) as OrderDocument[];
  const evs = (events ?? []) as OrderEvent[];

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
    <div className="p-8 space-y-6 max-w-6xl">
      <div>
        <BackLink />
        <div className="flex items-start justify-between mt-2">
          <div>
            <h1 className="text-2xl font-semibold text-neutral-900">{o.label}</h1>
            <p className="text-sm text-neutral-500 mt-1">
              {sup?.name} · erstellt {dateTime(o.created_at)}
            </p>
          </div>
          <span className="inline-flex px-3 py-1 rounded-full text-xs font-medium bg-neutral-100 text-neutral-700">
            {STATUS_LABELS[o.status]}
          </span>
        </div>
        <div className="mt-4">
          <QuickDocs documents={docs} paidTotal={o.paid_total} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Übersicht + Edit */}
          <section className="bg-white rounded-2xl border border-neutral-200 p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-medium text-neutral-700">Details</h2>
            </div>
            <dl className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm">
              <Info label="Beschreibung" value={o.description ?? "—"} />
              <Info label="Tags" value={o.tags?.join(", ") || "—"} />
              <Info label="Ankunft ca." value={date(o.eta)} />
              <Info
                label="Gewicht / Pakete"
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
                label="Tracking"
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
                label="Google Sheet"
                value={
                  o.sheet_url ? (
                    <a
                      href={o.sheet_url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-600 hover:underline inline-flex items-center gap-1"
                    >
                      öffnen <ExternalLink size={12} />
                    </a>
                  ) : (
                    "—"
                  )
                }
              />
              <Info label="Letztes Update vom Lieferant" value={date(o.last_supplier_update)} />
              <Info label="Notizen" value={o.notes ?? "—"} />
            </dl>
            <div className="mt-5 pt-4 border-t border-neutral-100 flex justify-end">
              <EditPanel order={o} isAdmin={profile.is_admin} />
            </div>
          </section>

          {/* Dokumente */}
          <section className="bg-white rounded-2xl border border-neutral-200 p-6">
            <h2 className="text-sm font-medium text-neutral-700 mb-4">Dokumente</h2>
            <DocumentUpload orderId={o.id} />
            <ul className="mt-4 divide-y divide-neutral-100">
              {docs.length === 0 && (
                <li className="text-sm text-neutral-500 py-3">Noch keine Dokumente.</li>
              )}
              {docs.map((d) => (
                <DocumentItem
                  key={d.id}
                  orderId={o.id}
                  doc={d}
                  isAdmin={profile.is_admin}
                  displayName={
                    proofNumber.has(d.id) ? `Zahlung ${proofNumber.get(d.id)}` : undefined
                  }
                />
              ))}
            </ul>
          </section>

          {/* Timeline */}
          <section className="bg-white rounded-2xl border border-neutral-200 p-6">
            <h2 className="text-sm font-medium text-neutral-700 mb-4">Verlauf</h2>
            <ul className="space-y-3 text-sm">
              {evs.length === 0 && <li className="text-neutral-500">Keine Einträge.</li>}
              {evs.map((e) => {
                const actor = e.actor_id ? actorMap.get(e.actor_id) : null;
                return (
                  <li key={e.id} className="flex gap-3">
                    <div className="w-2 h-2 rounded-full bg-neutral-300 mt-1.5 shrink-0" />
                    <div>
                      <div className="text-neutral-900">{e.message}</div>
                      <div className="text-xs text-neutral-500">
                        {dateTime(e.created_at)}
                        {actor && <> · von <span className="text-neutral-700">{actor}</span></>}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>

        {/* Sidebar: Geld */}
        <aside className="space-y-6">
          <section className="bg-white rounded-2xl border border-neutral-200 p-6">
            <h2 className="text-sm font-medium text-neutral-700 mb-4 flex items-center gap-1.5">
              <DollarSign size={14} className="text-neutral-400" />
              Finanzen
            </h2>
            <dl className="space-y-2 text-sm">
              <Row label="Rechnung" value={usd(o.invoice_total)} />
              <Row label="Ware" value={usd(o.goods_value)} />
              <Row label="Versand" value={usd(o.shipping_cost)} />
              <Row label="Zoll" value={usd(o.customs_duty)} />
              <Row label="EUSt" value={usd(o.import_vat)} />
              <div className="pt-2 mt-2 border-t border-neutral-100" />
              <Row label="Landed Cost" value={usd(o.landed_cost)} bold />
              <Row label="Bezahlt" value={usd(o.paid_total)} />
              <Row label="Offen" value={usd(o.remaining_balance)} bold />
            </dl>
          </section>

          <section className="bg-white rounded-2xl border border-neutral-200 p-6">
            <h2 className="text-sm font-medium text-neutral-700 mb-4 flex items-center gap-1.5">
              <CreditCard size={14} className="text-neutral-400" />
              Zahlungen
            </h2>
            {profile.is_admin && <PaymentForm orderId={o.id} />}
            <ul className="mt-4 divide-y divide-neutral-100">
              {pays.length === 0 && (
                <li className="text-sm text-neutral-500 py-3">Noch keine Zahlungen.</li>
              )}
              {pays.map((p) => (
                <PaymentItem key={p.id} orderId={o.id} payment={p} isAdmin={profile.is_admin} />
              ))}
            </ul>
          </section>
        </aside>
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
