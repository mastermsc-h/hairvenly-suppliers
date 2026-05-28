import { requireProfile } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { ArrowUpRightFromSquare } from "lucide-react";
import SyncTreatwellButton from "./sync-treatwell-button";

export const dynamic = "force-dynamic";

const BOOKING_URL =
  "https://buchung.treatwell.de/ort/hairvenly-extensions-hair-studio/";

interface ServiceRow {
  id: string;
  category: string;
  service: string;
  price_min: number | null;
  price_max: number | null;
  duration_min: number | null;
  notes: string | null;
  display_order: number;
  active: boolean;
  updated_at: string | null;
}

export default async function SalonPricesPage() {
  const profile = await requireProfile();
  if (!profile.is_admin) {
    return <div className="p-8 text-neutral-500">Nur für Admins.</div>;
  }
  const svc = createServiceClient();
  const { data } = await svc
    .from("salon_services")
    .select(
      "id, category, service, price_min, price_max, duration_min, notes, display_order, active, updated_at"
    )
    .order("active", { ascending: false })
    .order("display_order", { ascending: true });
  const rows = (data || []) as ServiceRow[];
  const active = rows.filter((r) => r.active);
  const inactive = rows.filter((r) => !r.active);
  const latestUpdate = rows.reduce<string | null>((acc, r) => {
    if (!r.updated_at) return acc;
    return acc && acc > r.updated_at ? acc : r.updated_at;
  }, null);

  // Gruppiere für Anzeige
  const byCategory = new Map<string, ServiceRow[]>();
  for (const r of active) {
    if (!byCategory.has(r.category)) byCategory.set(r.category, []);
    byCategory.get(r.category)!.push(r);
  }

  return (
    <div className="p-4 md:p-6 max-w-6xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-lg font-semibold text-neutral-900">
            Salon-Preise (Treatwell)
          </h1>
          <p className="text-sm text-neutral-600 mt-0.5">
            Datenquelle für das <code className="text-xs bg-neutral-100 px-1 py-0.5 rounded">get_salon_service_price</code>-Bot-Tool.
            Wird aus Treatwell automatisch sync't.
          </p>
          <a
            href={BOOKING_URL}
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1 text-xs text-blue-700 hover:underline mt-1"
          >
            <ArrowUpRightFromSquare size={11} />
            Treatwell-Seite öffnen
          </a>
        </div>
        <div className="flex flex-col items-end gap-1.5">
          <SyncTreatwellButton />
          {latestUpdate && (
            <div className="text-[11px] text-neutral-500">
              Zuletzt aktualisiert:{" "}
              {new Date(latestUpdate).toLocaleString("de-DE", {
                day: "2-digit",
                month: "2-digit",
                year: "2-digit",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </div>
          )}
        </div>
      </div>

      {/* KPI-Strip */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
          <div className="text-xs text-neutral-500 uppercase tracking-wide">
            Aktive Services
          </div>
          <div className="text-2xl font-semibold text-neutral-900 mt-1">
            {active.length}
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
          <div className="text-xs text-neutral-500 uppercase tracking-wide">
            Kategorien
          </div>
          <div className="text-2xl font-semibold text-neutral-900 mt-1">
            {byCategory.size}
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
          <div className="text-xs text-neutral-500 uppercase tracking-wide">
            Deaktivierte (Historie)
          </div>
          <div className="text-2xl font-semibold text-neutral-500 mt-1">
            {inactive.length}
          </div>
        </div>
      </div>

      {/* Service-Tabellen pro Kategorie */}
      <div className="space-y-4">
        {[...byCategory.entries()].map(([cat, items]) => (
          <div
            key={cat}
            className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden"
          >
            <div className="px-4 py-2.5 border-b border-neutral-100 bg-neutral-50 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-neutral-800">{cat}</h2>
              <span className="text-xs text-neutral-500">
                {items.length} Service{items.length === 1 ? "" : "s"}
              </span>
            </div>
            <table className="w-full text-sm">
              <thead className="text-xs text-neutral-500 uppercase tracking-wide">
                <tr className="text-left">
                  <th className="px-4 py-2 font-medium">Service</th>
                  <th className="px-4 py-2 font-medium text-right">Preis</th>
                  <th className="px-4 py-2 font-medium text-right">Dauer</th>
                </tr>
              </thead>
              <tbody>
                {items.map((r) => (
                  <tr
                    key={r.id}
                    className="border-t border-neutral-100 hover:bg-neutral-50/60"
                  >
                    <td className="px-4 py-2 text-neutral-900">{r.service}</td>
                    <td className="px-4 py-2 text-right text-neutral-800">
                      {r.price_min == null
                        ? "—"
                        : r.price_max != null && r.price_max !== r.price_min
                        ? `${r.price_min}–${r.price_max} €`
                        : `${r.price_min} €`}
                    </td>
                    <td className="px-4 py-2 text-right text-neutral-600">
                      {r.duration_min == null ? "—" : `${r.duration_min} Min`}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {/* Deaktivierte (collapsible) */}
      {inactive.length > 0 && (
        <details className="bg-white rounded-2xl border border-neutral-200 shadow-sm">
          <summary className="px-4 py-2.5 cursor-pointer text-sm font-medium text-neutral-600 hover:bg-neutral-50">
            ⛔ Deaktivierte Services ({inactive.length}) — z.B. weil sie bei
            Treatwell entfernt wurden
          </summary>
          <table className="w-full text-sm">
            <thead className="text-xs text-neutral-500 uppercase tracking-wide bg-neutral-50">
              <tr className="text-left">
                <th className="px-4 py-2 font-medium">Kategorie</th>
                <th className="px-4 py-2 font-medium">Service</th>
                <th className="px-4 py-2 font-medium text-right">Letzter Preis</th>
              </tr>
            </thead>
            <tbody>
              {inactive.map((r) => (
                <tr
                  key={r.id}
                  className="border-t border-neutral-100 text-neutral-500"
                >
                  <td className="px-4 py-2">{r.category}</td>
                  <td className="px-4 py-2">{r.service}</td>
                  <td className="px-4 py-2 text-right">
                    {r.price_min == null
                      ? "—"
                      : r.price_max != null && r.price_max !== r.price_min
                      ? `${r.price_min}–${r.price_max} €`
                      : `${r.price_min} €`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
    </div>
  );
}
