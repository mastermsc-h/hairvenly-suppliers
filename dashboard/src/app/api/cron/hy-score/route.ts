import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { cronStockSnapshot } from "@/lib/cron-tasks";
import { speichereHealthSnapshot } from "@/lib/health";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Täglicher HY-Score-Eintrag (abends, damit der Monatsletzte den Monat abschließt).
 * Eigener Cron: in /api/cron/refresh lief er hinter repurchase, das das Zeitbudget
 * bewusst ausschöpft → wurde jede Nacht übersprungen. Lager-Snapshot läuft hier
 * zusätzlich (upsert pro Tag), weil er dort aus demselben Grund Lücken hatte.
 */
export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return NextResponse.json({ error: "CRON_SECRET not configured on server" }, { status: 500 });
  const valid = req.headers.get("authorization") === `Bearer ${expected}` || req.nextUrl.searchParams.get("token") === expected;
  if (!valid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sb = createServiceClient();
  const stockSnapshot = await cronStockSnapshot(sb).catch((e) => ({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  const hyScore = await speichereHealthSnapshot(sb, { auto: true, note: "automatisch" }).catch((e) => ({
    ok: false,
    error: e instanceof Error ? e.message : String(e),
  }));
  console.log("[cron/hy-score]", JSON.stringify({ stockSnapshot, hyScore }));
  return NextResponse.json({ stockSnapshot, hyScore });
}
