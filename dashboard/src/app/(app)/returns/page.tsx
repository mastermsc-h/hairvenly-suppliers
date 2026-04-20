import { createClient } from "@/lib/supabase/server";
import { requireProfile, hasFeature } from "@/lib/auth";
import { t, type Locale } from "@/lib/i18n";
import { type Return, type ReturnItem } from "@/lib/types";
import { redirect } from "next/navigation";
import ReturnsList from "./returns-list";
import ReturnRateChart, { type MonthlyData } from "./return-rate-chart";

export default async function ReturnsPage() {
  const profile = await requireProfile();
  if (!hasFeature(profile, "returns")) redirect("/");
  const supabase = await createClient();
  const locale = (profile.language ?? "de") as Locale;

  // Helper: paginate to fetch ALL rows (Supabase caps single response at 1000)
  async function fetchAllReturns() {
    const all: Return[] = [];
    const pageSize = 1000;
    let from = 0;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { data, error } = await supabase
        .from("returns")
        .select("*")
        .order("initiated_at", { ascending: false })
        .order("created_at", { ascending: false })
        .range(from, from + pageSize - 1);
      if (error) break;
      const page = (data ?? []) as Return[];
      all.push(...page);
      if (page.length < pageSize) break;
      from += pageSize;
      if (from > 50000) break; // safety cap
    }
    return all;
  }

  async function fetchAllItems() {
    const all: ReturnItem[] = [];
    const pageSize = 1000;
    let from = 0;
    while (true) {
      const { data, error } = await supabase
        .from("return_items")
        .select("*")
        .range(from, from + pageSize - 1);
      if (error) break;
      const page = (data ?? []) as ReturnItem[];
      all.push(...page);
      if (page.length < pageSize) break;
      from += pageSize;
      if (from > 100000) break;
    }
    return all;
  }

  const [
    returnsAll,
    itemsAll,
    { data: catalogColors },
    { data: shopifyProducts },
    { data: lastSyncEvent },
    { data: syncCoverage },
    { data: monthlyRefundsRaw },
  ] = await Promise.all([
    fetchAllReturns(),
    fetchAllItems(),
    supabase.from("product_colors").select("name_hairvenly").order("name_hairvenly"),
    supabase.from("shopify_products").select("title").order("title"),
    supabase
      .from("return_events")
      .select("created_at")
      .eq("event_type", "shopify_sync")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("returns")
      .select("initiated_at")
      .not("shopify_order_id", "is", null)
      .order("initiated_at", { ascending: true })
      .limit(1),
    // Pre-aggregated monthly refund totals via view (no row limit issues)
    supabase.from("v_returns_summary").select("month, total_refund"),
  ]);

  const returns = returnsAll;
  const items = itemsAll;

  const { data: syncCoverageMax } = await supabase
    .from("returns")
    .select("initiated_at")
    .not("shopify_order_id", "is", null)
    .order("initiated_at", { ascending: false })
    .limit(1);

  // Exact count query (head-only, no rows transferred)
  const { count: exactCount } = await supabase
    .from("returns")
    .select("*", { count: "exact", head: true });

  // Load monthly revenue snapshot (include order_count to detect incomplete months)
  const { data: monthlyRevenue } = await supabase
    .from("shopify_monthly_revenue")
    .select("month, gross_revenue, order_count")
    .order("month", { ascending: true });

  // Both v_returns_summary.month and shopify_monthly_revenue.month are now
  // stored as text "YYYY-MM-01" to avoid timezone shifts. We still apply a
  // safety normalizer in case any legacy data comes through.
  const normalizeMonth = (raw: unknown): string | null => {
    if (!raw) return null;
    const s = String(raw);
    const m = s.match(/^(\d{4})-(\d{2})/);
    if (!m) return null;
    const dayMatch = s.match(/^\d{4}-\d{2}-(\d{2})/);
    const day = dayMatch ? parseInt(dayMatch[1], 10) : 1;
    let year = parseInt(m[1], 10);
    let month = parseInt(m[2], 10);
    // Compensate for TZ-shifted dates where day rolled back to end of previous month
    if (day > 20) {
      month += 1;
      if (month > 12) { month = 1; year += 1; }
    }
    return `${year}-${String(month).padStart(2, "0")}-01`;
  };

  // Aggregate refunds per month via the SQL view (bypasses row limit)
  const refundByMonth = new Map<string, number>();
  for (const row of (monthlyRefundsRaw ?? []) as { month: string; total_refund: number | string | null }[]) {
    const key = normalizeMonth(row.month);
    if (!key) continue;
    refundByMonth.set(key, (refundByMonth.get(key) ?? 0) + Number(row.total_refund ?? 0));
  }

  const monthlyChartData: MonthlyData[] = [];
  const revenueMap = new Map<string, number>();
  const orderCountMap = new Map<string, number>();
  for (const row of (monthlyRevenue ?? []) as { month: string; gross_revenue: number | string; order_count: number | string }[]) {
    const monthKey = normalizeMonth(row.month);
    if (!monthKey) continue;
    revenueMap.set(monthKey, Number(row.gross_revenue));
    orderCountMap.set(monthKey, Number(row.order_count));
  }
  // Detect incomplete months: drop any leading month whose order count is
  // less than 30% of the median → likely partial data from sync start.
  const orderCounts = Array.from(orderCountMap.values()).filter((n) => n > 0).sort((a, b) => a - b);
  const median = orderCounts.length > 0 ? orderCounts[Math.floor(orderCounts.length / 2)] : 0;
  const minExpected = median * 0.3;

  // Merge month keys from both revenue and refunds
  const allMonths = Array.from(new Set<string>([...revenueMap.keys(), ...refundByMonth.keys()])).sort();
  let skipLeading = true;
  for (const m of allMonths) {
    const oc = orderCountMap.get(m) ?? 0;
    // Skip leading months that have suspiciously low order count (incomplete sync)
    if (skipLeading && oc > 0 && oc < minExpected) continue;
    skipLeading = false;
    monthlyChartData.push({
      month: m,
      revenue: revenueMap.get(m) ?? 0,
      refund: refundByMonth.get(m) ?? 0,
    });
  }

  const syncInfo = {
    lastSyncAt: (lastSyncEvent?.created_at as string | undefined) ?? null,
    coverageFrom: (syncCoverage?.[0]?.initiated_at as string | undefined) ?? null,
    coverageTo: (syncCoverageMax?.[0]?.initiated_at as string | undefined) ?? null,
  };

  const list = (returns ?? []) as Return[];
  const allItems = (items ?? []) as ReturnItem[];

  // Build items lookup
  const itemsByReturn = new Map<string, ReturnItem[]>();
  for (const item of allItems) {
    const arr = itemsByReturn.get(item.return_id) ?? [];
    arr.push(item);
    itemsByReturn.set(item.return_id, arr);
  }

  const returnsWithItems = list.map((r) => ({
    ...r,
    items: itemsByReturn.get(r.id) ?? [],
  }));

  // Unique color names from catalog for dropdown
  const colorSet = new Set<string>();
  for (const c of catalogColors ?? []) {
    if (c.name_hairvenly) colorSet.add(c.name_hairvenly);
  }
  const colors = Array.from(colorSet).sort();

  // Unique Shopify product titles for searchable dropdown
  const productTitleSet = new Set<string>();
  for (const p of shopifyProducts ?? []) {
    if (p.title) productTitleSet.add(p.title);
  }
  const productTitles = Array.from(productTitleSet).sort();

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-7xl">
      <header>
        <h1 className="text-2xl font-semibold text-neutral-900">
          {t(locale, "returns.title")}
        </h1>
        <p className="text-sm text-neutral-500 mt-1">
          {exactCount ?? list.length} {t(locale, "returns.total")}
        </p>
      </header>

      <ReturnRateChart data={monthlyChartData} locale={locale} />

      <ReturnsList
        returns={returnsWithItems}
        locale={locale}
        isAdmin={profile.is_admin}
        catalogColors={colors}
        shopifyProductTitles={productTitles}
        syncInfo={syncInfo}
      />
    </div>
  );
}
