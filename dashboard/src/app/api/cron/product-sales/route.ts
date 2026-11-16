import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { createServiceClient } from "@/lib/supabase/server";
import { cronProductSalesSync } from "@/lib/cron-tasks";

// Eigene Route: im Sammel-Cron /api/cron/refresh lief der Produkt-Sync hinter dem Wiederkauf-
// Schritt, der das Zeitbudget bis zum Ende ausschöpft → seit August 2026 jede Nacht übersprungen.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

function gleich(a: string, b: string): boolean {
  const x = crypto.createHash("sha256").update(a).digest();
  const y = crypto.createHash("sha256").update(b).digest();
  return crypto.timingSafeEqual(x, y);
}

/**
 * Täglich: Produkt-Verkäufe des aktuellen und des Vormonats (Nenner der Retourenquote je Produkt).
 * Optional ?monate=N (1–3). Auth: Bearer CRON_SECRET (Vercel-Cron) oder Bearer SUPABASE_SERVICE_ROLE_KEY.
 */
export async function GET(req: NextRequest) {
  const given = (req.headers.get("authorization") ?? "").replace(/^Bearer /, "");
  const secrets = [process.env.CRON_SECRET, process.env.SUPABASE_SERVICE_ROLE_KEY].filter(Boolean) as string[];
  if (!given || !secrets.some((s) => gleich(given, s))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const n = Math.min(3, Math.max(1, Number(req.nextUrl.searchParams.get("monate")) || 1));
  const started = Date.now();
  const res = await cronProductSalesSync(createServiceClient(), n);
  console.log("[cron/product-sales]", JSON.stringify(res));
  return NextResponse.json({ ...res, monate: n, elapsedMs: Date.now() - started }, { status: res.error ? 500 : 200 });
}
