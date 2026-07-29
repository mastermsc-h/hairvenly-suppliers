import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  cronCollectionSync,
  cronRevenueSync,
  cronRefundsSync,
  cronRepurchaseCompute,
  cronProductSalesSync,
} from "@/lib/cron-tasks";

// Hobby plan timeout = 60s. If you upgrade to Pro you can bump this.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "CRON_SECRET not configured on server" }, { status: 500 });
  }

  // Vercel cron passes Authorization: Bearer <CRON_SECRET>
  const authHeader = req.headers.get("authorization");
  const queryToken = req.nextUrl.searchParams.get("token");
  const valid = authHeader === `Bearer ${expected}` || queryToken === expected;
  if (!valid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceClient();
  const startedMs = Date.now();
  const startedAt = new Date().toISOString();
  const skip = req.nextUrl.searchParams.get("skip")?.split(",") ?? [];
  const results: Record<string, unknown> = { startedAt };

  // Ordered by importance; each task is bounded so the whole run fits into
  // the 60s function limit. If we still approach the limit, remaining tasks
  // are skipped and reported instead of the route dying mid-task (which is
  // exactly what silently killed the nightly sync before this fix).
  const TIME_BUDGET_MS = 45_000;
  const overBudget = () => Date.now() - startedMs > TIME_BUDGET_MS;

  if (!skip.includes("refunds")) {
    results.refunds = await cronRefundsSync(supabase);
  }
  if (!skip.includes("collections")) {
    results.collections = overBudget()
      ? { skipped: "time budget exceeded" }
      : await cronCollectionSync(supabase);
  }
  if (!skip.includes("revenue")) {
    results.revenue = overBudget()
      ? { skipped: "time budget exceeded" }
      : await cronRevenueSync(supabase);
  }
  if (!skip.includes("repurchase")) {
    results.repurchase = overBudget()
      ? { skipped: "time budget exceeded" }
      : await cronRepurchaseCompute(supabase);
  }
  // Only the last 2 months — a full 12-month product-sales pass takes minutes
  // and would never finish inside the function limit. Older months stay as
  // written by scripts/sync-product-sales.mjs and don't change retroactively.
  if (!skip.includes("productsales")) {
    results.productSales = overBudget()
      ? { skipped: "time budget exceeded" }
      : await cronProductSalesSync(supabase, 2);
  }

  results.finishedAt = new Date().toISOString();
  results.elapsedMs = Date.now() - startedMs;
  console.log("[cron/refresh]", JSON.stringify(results));
  return NextResponse.json(results);
}
