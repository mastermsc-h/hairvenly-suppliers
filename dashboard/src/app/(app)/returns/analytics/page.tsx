import { createClient } from "@/lib/supabase/server";
import { requireProfile, hasFeature } from "@/lib/auth";
import { t, type Locale } from "@/lib/i18n";
import { redirect } from "next/navigation";
import ReturnsAnalytics from "./returns-analytics";

export default async function ReturnsAnalyticsPage() {
  const profile = await requireProfile();
  if (!hasFeature(profile, "returns")) redirect("/");
  const supabase = await createClient();
  const locale = (profile.language ?? "de") as Locale;

  // Paginated fetch helpers (Supabase caps each query at 1000 rows)
  async function fetchAllReturns() {
    const all: { return_type: string; status: string; handler: string | null; initiated_at: string | null; refund_amount: number | null; reason: string | null }[] = [];
    const pageSize = 1000;
    for (let from = 0; from < 100000; from += pageSize) {
      const { data } = await supabase
        .from("returns")
        .select("return_type, status, handler, initiated_at, refund_amount, reason")
        .range(from, from + pageSize - 1);
      if (!data || data.length === 0) break;
      all.push(...data);
      if (data.length < pageSize) break;
    }
    return all;
  }

  async function fetchAllItemsWithType() {
    const all: { return_id: string; product_type: string | null; length: string | null; origin: string | null; quantity: number | null; refund_amount: number | null; collection_title: string | null; returns: { return_type: string; initiated_at: string | null; reason: string | null } | null }[] = [];
    const pageSize = 1000;
    for (let from = 0; from < 100000; from += pageSize) {
      const { data } = await supabase
        .from("return_items")
        .select("return_id, product_type, length, origin, quantity, refund_amount, collection_title, returns!inner(return_type, initiated_at, reason)")
        .not("product_type", "is", null)
        .range(from, from + pageSize - 1);
      if (!data || data.length === 0) break;
      for (const row of data as unknown as Array<{ return_id: string; product_type: string | null; length: string | null; origin: string | null; quantity: number | null; refund_amount: number | string | null; collection_title: string | null; returns: { return_type: string; initiated_at: string | null; reason: string | null } | { return_type: string; initiated_at: string | null; reason: string | null }[] | null }>) {
        const joined = Array.isArray(row.returns) ? row.returns[0] : row.returns;
        all.push({
          return_id: row.return_id,
          product_type: row.product_type,
          length: row.length,
          origin: row.origin,
          quantity: row.quantity,
          refund_amount: row.refund_amount != null ? Number(row.refund_amount) : null,
          collection_title: row.collection_title,
          returns: joined ?? null,
        });
      }
      if (data.length < pageSize) break;
    }
    return all;
  }

  const [
    { data: summaryData },
    { data: byReasonData },
    returnsRaw,
    { data: monthlyRevenue },
    itemsWithType,
  ] = await Promise.all([
    supabase.from("v_returns_summary").select("*").order("month", { ascending: true }),
    supabase.from("v_returns_by_reason").select("*"),
    fetchAllReturns(),
    supabase.from("shopify_monthly_revenue").select("gross_revenue"),
    fetchAllItemsWithType(),
  ]);

  const summary = (summaryData ?? []) as { month: string; return_type: string; total: number; resolved: number; total_refund: number | string }[];
  const byReason = (byReasonData ?? []) as { reason: string; return_type: string; cnt: number }[];

  // Flatten joined data into a simple shape
  const itemsByType = itemsWithType.map((i) => ({
    return_id: i.return_id,
    product_type: i.product_type ?? "",
    length: i.length ?? "",
    origin: i.origin ?? "",
    quantity: i.quantity ?? 1,
    refund_amount: i.refund_amount ?? 0,
    collection_title: i.collection_title ?? "",
    return_type: i.returns?.return_type ?? "return",
    initiated_at: i.returns?.initiated_at ?? null,
    reason: i.returns?.reason ?? null,
  }));

  // Load collection sales for rate calculation — include month for period filtering
  const { data: collectionSalesRaw } = await supabase
    .from("shopify_collection_sales")
    .select("month, collection_title, gross_revenue, item_count, order_count");

  // Total gross sales = sum of line-item gross_revenue from shopify_collection_sales
  // (this is "Gross Sales" — original price × qty, BEFORE shipping/tax/discounts,
  // same basis as Shopify's gross_sales metric). The monthly_revenue table stores
  // order totals which include shipping/tax and are NOT comparable.
  // Exclude non-extension collections to match Shopify's "Extensions only" view.
  const EXCLUDED_FROM_TOTALS = new Set([
    "Extensions Zubehör", "Blessed Haarpflege", "Sonstige Haarpflege",
    "Haarpflegeprodukte", "Accessoires", "Unassigned",
    "Newest Products", "Newest", "Neuste Produkte",
  ]);
  const totalRevenue = ((collectionSalesRaw ?? []) as { collection_title: string; gross_revenue: number | string }[])
    .filter((r) => !EXCLUDED_FROM_TOTALS.has(r.collection_title))
    .reduce((sum, r) => sum + Number(r.gross_revenue ?? 0), 0);

  // Load sync coverage window (from/to) based on Shopify-imported returns
  const { data: coverageFromRow } = await supabase
    .from("returns")
    .select("initiated_at")
    .not("shopify_order_id", "is", null)
    .order("initiated_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  const { data: coverageToRow } = await supabase
    .from("returns")
    .select("initiated_at")
    .not("shopify_order_id", "is", null)
    .order("initiated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const { data: lastSyncRow } = await supabase
    .from("return_events")
    .select("created_at")
    .eq("event_type", "shopify_sync")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const syncInfo = {
    coverageFrom: (coverageFromRow?.initiated_at as string | undefined) ?? null,
    coverageTo: (coverageToRow?.initiated_at as string | undefined) ?? null,
    lastSyncAt: (lastSyncRow?.created_at as string | undefined) ?? null,
  };

  const excludedList = Array.from(EXCLUDED_FROM_TOTALS);

  // Pass raw monthly rows so client can filter by period
  const collectionSalesArr = ((collectionSalesRaw ?? []) as { month: string; collection_title: string; gross_revenue: number | string; item_count: number; order_count: number }[]).map((r) => ({
    month: String(r.month).slice(0, 10),
    collection_title: r.collection_title,
    revenue: Number(r.gross_revenue ?? 0),
    orders: Number(r.order_count ?? 0),
    items: Number(r.item_count ?? 0),
  }));

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-7xl">
      <header>
        <h1 className="text-2xl font-semibold text-neutral-900">
          {t(locale, "returns.analytics_title")}
        </h1>
        <p className="text-sm text-neutral-500 mt-1">
          {t(locale, "returns.analytics_subtitle")}
        </p>
      </header>

      <ReturnsAnalytics
        summary={summary}
        byReason={byReason}
        itemsByType={itemsByType}
        returns={returnsRaw}
        totalRevenue={totalRevenue}
        collectionSales={collectionSalesArr}
        syncInfo={syncInfo}
        excludedCollections={excludedList}
        locale={locale}
      />
    </div>
  );
}
