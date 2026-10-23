import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { cronKundenSync } from "@/lib/kunden-analyse";

// Eigene Route statt /api/cron/refresh: dessen 60s-Budget ist schon ausgereizt.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json({ error: "CRON_SECRET not configured on server" }, { status: 500 });
  }
  const authHeader = req.headers.get("authorization");
  const queryToken = req.nextUrl.searchParams.get("token");
  if (authHeader !== `Bearer ${expected}` && queryToken !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedMs = Date.now();
  const result = await cronKundenSync(createServiceClient(), startedMs + 45_000);
  console.log("[cron/kunden-sync]", JSON.stringify(result));
  return NextResponse.json({ ...result, elapsedMs: Date.now() - startedMs });
}
