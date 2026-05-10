import { requireFeature } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import StatistikClient from "./statistik-client";
import type { FeatureKey } from "@/lib/types";

export const dynamic = "force-dynamic";
const SALON_FEATURE = "salon" as FeatureKey;

type Range = "today" | "7d" | "30d" | "month" | "all";

function rangeStart(range: Range): Date | null {
  const now = new Date();
  if (range === "today") {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    return d;
  }
  if (range === "7d") return new Date(now.getTime() - 7 * 86400000);
  if (range === "30d") return new Date(now.getTime() - 30 * 86400000);
  if (range === "month") {
    const d = new Date(now.getFullYear(), now.getMonth(), 1);
    return d;
  }
  return null;
}

export default async function SalonStatistikPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string }>;
}) {
  await requireFeature(SALON_FEATURE);
  const sp = await searchParams;
  const range: Range = (["today", "7d", "30d", "month", "all"].includes(sp.range ?? "")
    ? sp.range
    : "30d") as Range;

  const svc = createServiceClient();
  const start = rangeStart(range);

  let q = svc
    .from("salon_entnahmen")
    .select(
      "id, employee_id, taken_at, status, used_grams, rest_grams, pack_grams, category, length_cm, color, product_title, variant_title, salon_employees(name)",
    )
    .order("taken_at", { ascending: true });
  if (start) q = q.gte("taken_at", start.toISOString());

  const [{ data: rows }, { data: emps }] = await Promise.all([
    q,
    svc.from("salon_employees").select("id, name"),
  ]);

  return (
    <StatistikClient
      range={range}
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
