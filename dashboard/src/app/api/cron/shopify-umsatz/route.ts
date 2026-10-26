import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { laufendeMonate, syncShopifyUmsatz } from "@/lib/shopify-umsatz";

// Eigene Route: im Sammel-Cron /api/cron/refresh wurde der Umsatz-Sync seit 03.09.2026
// regelmäßig wegen des Zeitbudgets übersprungen.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function gleich(a: string, b: string): boolean {
  const x = crypto.createHash("sha256").update(a).digest();
  const y = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(x, y);
}

/**
 * Täglich: aktueller + Vormonat. Optional ?monate=2025-07,2025-08 (Nachladen).
 * Auth: Bearer CRON_SECRET (Vercel-Cron) oder Bearer SUPABASE_SERVICE_ROLE_KEY (Wartung).
 */
export async function GET(req: NextRequest) {
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  const secrets = [process.env.CRON_SECRET, process.env.SUPABASE_SERVICE_ROLE_KEY].filter(Boolean) as string[];
  if (!given || !secrets.some((s) => gleich(given, s))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const param = req.nextUrl.searchParams.get("monate");
  const monate = param
    ? param.split(",").map((m) => m.trim()).filter((m) => /^\d{4}-\d{2}$/.test(m)).slice(0, 24)
    : laufendeMonate();
  const started = Date.now();
  try {
    const res = await syncShopifyUmsatz(monate, started + 50_000);
    console.log("[cron/shopify-umsatz]", JSON.stringify(res));
    return NextResponse.json({ ok: true, ...res, elapsedMs: Date.now() - started });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[cron/shopify-umsatz]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
