import { requireFeature } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Users, AlertTriangle, Layers, TrendingUp } from "lucide-react";
import type { FeatureKey } from "@/lib/types";

export const dynamic = "force-dynamic";

const SALON_FEATURE = "salon" as FeatureKey;

export default async function SalonAdminPage() {
  await requireFeature(SALON_FEATURE);
  const svc = createServiceClient();

  const todayStart = new Date();
  todayStart.setHours(0, 0, 0, 0);
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const [
    { data: openEntries, count: openCount },
    { data: todayEntries },
    { data: monthEntries },
    { data: looseStock },
    { count: empCount },
    { data: shopifyFailures },
  ] = await Promise.all([
    svc
      .from("salon_entnahmen")
      .select("id, taken_at, product_title, variant_title, pack_grams, note, salon_employees(name)", {
        count: "exact",
      })
      .eq("status", "open")
      .order("taken_at", { ascending: true })
      .limit(50),
    svc
      .from("salon_entnahmen")
      .select("id, used_grams, status, taken_at, salon_employees(name)")
      .gte("taken_at", todayStart.toISOString()),
    svc
      .from("salon_entnahmen")
      .select("id, used_grams, status, taken_at, employee_id, salon_employees(name)")
      .gte("taken_at", monthStart.toISOString()),
    svc
      .from("salon_loose_stock")
      .select("*")
      .order("total_grams", { ascending: false })
      .limit(20),
    svc.from("salon_employees").select("id", { count: "exact", head: true }).eq("active", true),
    svc
      .from("salon_entnahmen")
      .select("id, taken_at, product_title, variant_title, note, salon_employees(name)")
      .not("note", "is", null)
      .order("taken_at", { ascending: false })
      .limit(20),
  ]);

  const todayUsed = (todayEntries ?? []).reduce((sum, e) => sum + (e.used_grams ?? 0), 0);
  const todayPacks = (todayEntries ?? []).length;

  // Verbrauch pro Mitarbeiter (Monat)
  const perEmployee = new Map<string, { name: string; used: number; packs: number }>();
  for (const r of monthEntries ?? []) {
    const empId = (r as { employee_id: string }).employee_id ?? "?";
    const name = (r.salon_employees as unknown as { name: string } | null)?.name ?? "?";
    const cur = perEmployee.get(empId) ?? { name, used: 0, packs: 0 };
    cur.used += r.used_grams ?? 0;
    cur.packs += 1;
    perEmployee.set(empId, cur);
  }
  const perEmployeeList = [...perEmployee.values()].sort((a, b) => b.used - a.used);

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Salon-Verbrauch</h1>
          <p className="text-sm text-neutral-500">Live-Daten vom Friseur-iPad</p>
        </div>
        <div className="flex gap-2">
          <Link
            href="/salon-admin/mitarbeiter"
            className="bg-neutral-900 text-white rounded-lg px-4 py-2 text-sm font-medium flex items-center gap-2"
          >
            <Users size={16} /> Mitarbeiter ({empCount ?? 0})
          </Link>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Kpi label="Heute Packs raus" value={`${todayPacks}`} icon={<Layers size={18} />} />
        <Kpi label="Heute verbraucht" value={`${todayUsed} g`} icon={<TrendingUp size={18} />} />
        <Kpi label="Offene Entnahmen" value={`${openCount ?? 0}`} icon={<AlertTriangle size={18} />} accent={openCount && openCount > 0 ? "warn" : undefined} />
        <Kpi label="Loose-Stock-Buckets" value={`${(looseStock ?? []).length}`} icon={<Layers size={18} />} />
      </div>

      {/* Shopify-Sync-Probleme */}
      {(shopifyFailures ?? []).length > 0 && (
        <div className="bg-rose-50 border border-rose-300 rounded-2xl p-4 md:p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <AlertTriangle size={18} className="text-rose-700" />
            <div className="text-base font-semibold text-rose-900">Shopify-Sync-Probleme</div>
            <span className="ml-auto text-xs text-rose-700">
              {shopifyFailures!.length} Eintrag/Einträge
            </span>
          </div>
          <div className="text-xs text-rose-800 mb-3">
            Diese Entnahmen wurden in der DB gespeichert, aber Shopify konnte den Lagerbestand nicht
            anpassen. Bitte Fehlertext prüfen und manuell in Shopify korrigieren oder die Ursache fixen.
          </div>
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-rose-700">
              <tr>
                <th className="text-left py-2">Mitarbeiter</th>
                <th className="text-left py-2">Produkt</th>
                <th className="text-left py-2">Wann</th>
                <th className="text-left py-2">Fehler</th>
              </tr>
            </thead>
            <tbody>
              {shopifyFailures!.map((f) => (
                <tr key={f.id} className="border-t border-rose-200">
                  <td className="py-2">
                    {(f.salon_employees as unknown as { name: string } | null)?.name ?? "?"}
                  </td>
                  <td className="py-2">
                    {f.product_title}
                    {f.variant_title && <span className="text-rose-700"> · {f.variant_title}</span>}
                  </td>
                  <td className="py-2 text-rose-700">
                    {new Date(f.taken_at as string).toLocaleString("de-DE", {
                      day: "2-digit",
                      month: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="py-2 text-rose-900 font-mono text-xs">{f.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Offene Entnahmen */}
      <Card title="Offene Entnahmen (FIFO)" subtitle="Pack ist raus, Reste noch nicht zurueck">
        {(openEntries ?? []).length === 0 ? (
          <div className="text-sm text-neutral-500">Keine offenen Entnahmen 🎉</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-neutral-500">
              <tr>
                <th className="text-left py-2">Mitarbeiter</th>
                <th className="text-left py-2">Produkt</th>
                <th className="text-left py-2">Variante</th>
                <th className="text-right py-2">Pack</th>
                <th className="text-right py-2">Entnommen</th>
              </tr>
            </thead>
            <tbody>
              {openEntries!.map((e) => {
                const ageHours = (Date.now() - new Date(e.taken_at).getTime()) / 3600000;
                const old = ageHours > 24;
                return (
                  <tr key={e.id} className="border-t border-neutral-100">
                    <td className="py-2 font-medium">
                      {(e.salon_employees as unknown as { name: string } | null)?.name ?? "?"}
                    </td>
                    <td className="py-2">{e.product_title}</td>
                    <td className="py-2 text-neutral-500">{e.variant_title ?? "—"}</td>
                    <td className="py-2 text-right">{e.pack_grams}g</td>
                    <td className={`py-2 text-right ${old ? "text-rose-600 font-medium" : "text-neutral-500"}`}>
                      vor {Math.round(ageHours)}h
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Card>

      {/* Pro-Mitarbeiter Verbrauch (Monat) */}
      <Card title="Verbrauch pro Mitarbeiter" subtitle="Aktueller Monat">
        {perEmployeeList.length === 0 ? (
          <div className="text-sm text-neutral-500">Noch keine Daten diesen Monat</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-neutral-500">
              <tr>
                <th className="text-left py-2">Mitarbeiter</th>
                <th className="text-right py-2">Packs</th>
                <th className="text-right py-2">Verbraucht</th>
              </tr>
            </thead>
            <tbody>
              {perEmployeeList.map((e, i) => (
                <tr key={i} className="border-t border-neutral-100">
                  <td className="py-2 font-medium">{e.name}</td>
                  <td className="py-2 text-right">{e.packs}</td>
                  <td className="py-2 text-right">{e.used} g</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>

      {/* Loose-Stock-Wand */}
      <Card title="Loose-Stock-Wand" subtitle="Reste, die zu neuen Packs zusammengelegt werden koennen">
        {(looseStock ?? []).length === 0 ? (
          <div className="text-sm text-neutral-500">Aktuell keine Reste</div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {looseStock!.map((s) => {
              const target = s.pack_target_grams ?? 25;
              const pct = Math.min(100, Math.round((s.total_grams / target) * 100));
              const ready = s.total_grams >= target;
              return (
                <div
                  key={s.id}
                  className={`rounded-xl border p-3 ${ready ? "border-emerald-300 bg-emerald-50" : "border-neutral-200 bg-white"}`}
                >
                  <div className="text-sm font-medium leading-tight">{s.product_title}</div>
                  {s.variant_title && <div className="text-xs text-neutral-500">{s.variant_title}</div>}
                  <div className="mt-2 text-xs text-neutral-500 capitalize">{s.category}</div>
                  <div className="mt-2 flex items-center gap-2">
                    <div className="flex-1 h-2 bg-neutral-200 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${ready ? "bg-emerald-500" : "bg-amber-500"}`}
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className={`text-xs font-medium tabular-nums ${ready ? "text-emerald-700" : ""}`}>
                      {s.total_grams}/{target}g
                    </div>
                  </div>
                  {ready && (
                    <div className="mt-2 text-xs font-medium text-emerald-700">
                      ✓ Bereit fuer Pack-Wiedereinlagerung
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm">
      <div className="mb-3">
        <div className="text-base font-semibold">{title}</div>
        {subtitle && <div className="text-xs text-neutral-500">{subtitle}</div>}
      </div>
      {children}
    </div>
  );
}

function Kpi({
  label,
  value,
  icon,
  accent,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  accent?: "warn";
}) {
  return (
    <div
      className={`rounded-2xl border p-4 shadow-sm ${
        accent === "warn" ? "bg-amber-50 border-amber-200" : "bg-white border-neutral-200"
      }`}
    >
      <div className="flex items-center gap-2 text-xs uppercase tracking-wide text-neutral-500">
        {icon}
        {label}
      </div>
      <div className="text-2xl font-bold mt-2">{value}</div>
    </div>
  );
}
