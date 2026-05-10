import { requireFeature } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import StatistikClient from "./statistik-client";
import type { FeatureKey } from "@/lib/types";

export const dynamic = "force-dynamic";
const SALON_FEATURE = "salon" as FeatureKey;

type Quick = "today" | "7d" | "30d" | "month" | "all";

interface ResolvedRange {
  start: Date | null;
  end: Date | null;
  label: string;
  /** Aktuell aktive Quick-Auswahl (oder null wenn month/custom) */
  quick: Quick | null;
  /** YYYY-MM bei month-picker */
  month: string | null;
  /** Custom from/to */
  from: string | null;
  to: string | null;
}

function isoDay(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function resolveRange(sp: { range?: string; month?: string; from?: string; to?: string }): ResolvedRange {
  const now = new Date();

  // 1) custom from/to (Prio)
  if (sp.from || sp.to) {
    const start = sp.from ? new Date(sp.from + "T00:00:00") : null;
    const end = sp.to ? new Date(sp.to + "T23:59:59.999") : null;
    const label = `${sp.from ?? "…"} bis ${sp.to ?? "…"}`;
    return { start, end, label, quick: null, month: null, from: sp.from ?? null, to: sp.to ?? null };
  }

  // 2) month YYYY-MM
  if (sp.month && /^\d{4}-\d{2}$/.test(sp.month)) {
    const [y, m] = sp.month.split("-").map((s) => parseInt(s, 10));
    const start = new Date(y, m - 1, 1, 0, 0, 0);
    const end = new Date(y, m, 0, 23, 59, 59, 999); // letzter Tag des Monats
    const label = start.toLocaleDateString("de-DE", { month: "long", year: "numeric" });
    return { start, end, label, quick: null, month: sp.month, from: null, to: null };
  }

  // 3) Quick
  const quick: Quick = (["today", "7d", "30d", "month", "all"].includes(sp.range ?? "")
    ? sp.range
    : "30d") as Quick;
  if (quick === "today") {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return { start: d, end: null, label: "Heute", quick, month: null, from: null, to: null };
  }
  if (quick === "7d") {
    return {
      start: new Date(now.getTime() - 7 * 86400000),
      end: null,
      label: "Letzte 7 Tage",
      quick,
      month: null,
      from: null,
      to: null,
    };
  }
  if (quick === "30d") {
    return {
      start: new Date(now.getTime() - 30 * 86400000),
      end: null,
      label: "Letzte 30 Tage",
      quick,
      month: null,
      from: null,
      to: null,
    };
  }
  if (quick === "month") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    return {
      start,
      end: null,
      label: start.toLocaleDateString("de-DE", { month: "long", year: "numeric" }),
      quick,
      month: null,
      from: null,
      to: null,
    };
  }
  return { start: null, end: null, label: "Alle Zeit", quick, month: null, from: null, to: null };
}

export default async function SalonStatistikPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; month?: string; from?: string; to?: string }>;
}) {
  await requireFeature(SALON_FEATURE);
  const sp = await searchParams;
  const r = resolveRange(sp);

  const svc = createServiceClient();
  let q = svc
    .from("salon_entnahmen")
    .select(
      "id, employee_id, taken_at, status, used_grams, rest_grams, pack_grams, category, length_cm, color, product_title, variant_title, salon_employees(name)",
    )
    .order("taken_at", { ascending: true });
  if (r.start) q = q.gte("taken_at", r.start.toISOString());
  if (r.end) q = q.lte("taken_at", r.end.toISOString());

  // verfuegbare Monate fuer den Picker (alle Monate mit mind. 1 Entnahme)
  const { data: monthRows } = await svc
    .from("salon_entnahmen")
    .select("taken_at")
    .order("taken_at", { ascending: false })
    .limit(2000);
  const monthSet = new Set<string>();
  for (const m of monthRows ?? []) {
    const ts = (m as { taken_at: string }).taken_at;
    monthSet.add(ts.slice(0, 7)); // YYYY-MM
  }
  // Fallback: aktueller + letzte 11 Monate, damit Picker nicht leer ist
  const now = new Date();
  for (let i = 0; i < 12; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    monthSet.add(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  }
  const availableMonths = [...monthSet].sort().reverse();

  const [{ data: rows }, { data: emps }] = await Promise.all([
    q,
    svc.from("salon_employees").select("id, name"),
  ]);

  return (
    <StatistikClient
      filter={{
        label: r.label,
        quick: r.quick,
        month: r.month,
        from: r.from,
        to: r.to,
        availableMonths,
        defaultFrom: r.start ? isoDay(r.start) : "",
        defaultTo: r.end ? isoDay(r.end) : isoDay(new Date()),
      }}
      rows={(rows ?? []).map((r) => ({
        id: r.id as string,
        employeeId: r.employee_id as string,
        employeeName:
          (r.salon_employees as unknown as { name: string } | null)?.name ?? "?",
        takenAt: r.taken_at as string,
        status: r.status as string,
        usedGrams: r.used_grams ?? 0,
        restGrams: r.rest_grams ?? 0,
        packGrams: r.pack_grams as number,
        category: r.category as string,
        lengthCm: r.length_cm ?? null,
        color: r.color ?? null,
        productTitle: r.product_title as string,
        variantTitle: r.variant_title ?? null,
      }))}
      employees={(emps ?? []).map((e) => ({ id: e.id, name: e.name }))}
    />
  );
}
