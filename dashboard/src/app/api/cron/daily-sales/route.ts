import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { syncVariantDailySales } from "@/lib/daily-sales";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

/** Schreibt die letzten Tage neu (fängt Bestellbearbeitungen und Stornos nachträglich ab). */
const RESYNC_DAYS = 4;

export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return NextResponse.json({ error: "CRON_SECRET not configured on server" }, { status: 500 });
  const authHeader = req.headers.get("authorization");
  const queryToken = req.nextUrl.searchParams.get("token");
  if (authHeader !== `Bearer ${expected}` && queryToken !== expected) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const days = Math.min(120, Math.max(1, Number(req.nextUrl.searchParams.get("days")) || RESYNC_DAYS));
  const since = new Date(Date.now() - days * 864e5).toISOString().slice(0, 10);
  try {
    const result = await syncVariantDailySales(createServiceClient(), since, Date.now() + 50_000);
    return NextResponse.json({ since, ...result }, { status: result.complete ? 200 : 206 });
  } catch (e) {
    return NextResponse.json({ since, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
