import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  cronCollectionSync,
  cronRevenueSync,
  cronRefundsSync,
  cronRepurchaseCompute,
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
  const startedAt = new Date().toISOString();
  const skip = req.nextUrl.searchParams.get("skip")?.split(",") ?? [];
  const results: Record<string, unknown> = { startedAt };

  if (!skip.includes("collections")) {
    results.collections = await cronCollectionSync(supabase);
  }
  if (!skip.includes("revenue")) {
    results.revenue = await cronRevenueSync(supabase);
  }
  if (!skip.includes("refunds")) {
    results.refunds = await cronRefundsSync(supabase);
  }
  if (!skip.includes("repurchase")) {
    results.repurchase = await cronRepurchaseCompute(supabase);
  }

  results.finishedAt = new Date().toISOString();
  return NextResponse.json(results);
}
