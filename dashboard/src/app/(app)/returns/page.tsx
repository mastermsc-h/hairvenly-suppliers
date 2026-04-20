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

  // Load per-collection monthly sales (tax-exclusive netto basis).
  // We aggregate two series: "extensions only" (KPI_EXCLUDED filtered out) and
  // "all collections" (raw sum). The chart offers a toggle between both.
  const { data: collectionSales } = await supabase
    .from("shopify_collection_sales")
    .select("month, collection_title, gross_revenue, order_count");

  // initiated_at / month columns are stored as DATE (no timezone). Extract
  // year-month verbatim — previous "day > 20 → next month" compensation was
  // wrong for DATE columns and caused refunds on the 21st-31st to be
  // attributed to the following month.
  const normalizeMonth = (raw: unknown): string | null => {
    if (!raw) return null;
    const m = String(raw).match(/^(\d{4})-(\d{2})/);
    if (!m) return null;
    return `${m[1]}-${m[2]}-01`;
  };

  // Collections excluded from the "Extensions" series (non-extension products).
  const KPI_EXCLUDED = new Set([
    "Extensions Zubehör", "Blessed Haarpflege", "Sonstige Haarpflege",
    "Haarpflegeprodukte", "Accessoires", "Unassigned",
    "Newest Products", "Newest", "Neuste Produkte",
    "Hairvenly Extension Schulungen", "Best Selling Products",
  ]);

  // Monthly revenue — extensions-only + all
  const revenueExt = new Map<string, number>();
  const revenueAll = new Map<string, number>();
  const orderCountMap = new Map<string, number>();
  for (const row of (collectionSales ?? []) as { month: string; collection_title: string; gross_revenue: number | string; order_count: number | string }[]) {
    const monthKey = normalizeMonth(row.month);
    if (!monthKey) continue;
    const val = Number(row.gross_revenue);
    revenueAll.set(monthKey, (revenueAll.get(monthKey) ?? 0) + val);
    if (!KPI_EXCLUDED.has(row.collection_title)) {
      revenueExt.set(monthKey, (revenueExt.get(monthKey) ?? 0) + val);
    }
    orderCountMap.set(monthKey, (orderCountMap.get(monthKey) ?? 0) + Number(row.order_count ?? 0));
  }

  // Monthly refunds — both series aggregated from the SAME source
  // (return_items) so Gesamt is always ≥ Extensions-only.
  const refundAll = new Map<string, number>();
  const refundExt = new Map<string, number>();
  const returnInitiatedByReturnId = new Map<string, string>();
  for (const r of returnsAll) {
    if (r.initiated_at) returnInitiatedByReturnId.set(r.id, r.initiated_at);
  }
  for (const it of itemsAll) {
    const init = returnInitiatedByReturnId.get(it.return_id);
    if (!init) continue;
    const key = normalizeMonth(init);
    if (!key) continue;
    const val = Number(it.refund_amount ?? 0);
    refundAll.set(key, (refundAll.get(key) ?? 0) + val);
    if (!(it.collection_title && KPI_EXCLUDED.has(it.collection_title))) {
      refundExt.set(key, (refundExt.get(key) ?? 0) + val);
    }
  }
  // monthlyRefundsRaw is still loaded but no longer used — kept alive to
  // avoid dead-data warning; remove the query if future cleanup is done.
  void monthlyRefundsRaw;

  // Detect incomplete months by order count (uses all-sales order_count)
  const orderCounts = Array.from(orderCountMap.values()).filter((n) => n > 0).sort((a, b) => a - b);
  const median = orderCounts.length > 0 ? orderCounts[Math.floor(orderCounts.length / 2)] : 0;
  const minExpected = median * 0.3;

  const allMonths = Array.from(new Set<string>([
    ...revenueAll.keys(), ...refundAll.keys(), ...refundExt.keys(),
  ])).sort();
  const monthlyChartData: MonthlyData[] = [];
  let skipLeading = true;
  for (const m of allMonths) {
    const oc = orderCountMap.get(m) ?? 0;
    if (skipLeading && oc > 0 && oc < minExpected) continue;
    skipLeading = false;
    monthlyChartData.push({
      month: m,
      revenueExt: revenueExt.get(m) ?? 0,
      revenueAll: revenueAll.get(m) ?? 0,
      refundExt: refundExt.get(m) ?? 0,
      refundAll: refundAll.get(m) ?? 0,
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
