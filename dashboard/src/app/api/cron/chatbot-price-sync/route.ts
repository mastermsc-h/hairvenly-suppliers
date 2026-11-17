import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { runPriceSync } from "@/lib/chatbot/price-sync-run";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Täglicher Preis-Abgleich Shopify → chatbot_prices (Quelle für get_price).
 * ?dry=1 → nur Report, nichts schreiben.
 */
export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return NextResponse.json({ error: "CRON_SECRET not configured on server" }, { status: 500 });
  const valid = req.headers.get("authorization") === `Bearer ${expected}` || req.nextUrl.searchParams.get("token") === expected;
  if (!valid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const report = await runPriceSync(createServiceClient(), { dryRun: req.nextUrl.searchParams.get("dry") === "1" });
    revalidatePath("/chatbot");
    const summary = { products: report.products, updated: report.updated, check: report.check, stale_faqs: report.stale_faqs.length };
    console.log("[cron/chatbot-price-sync]", JSON.stringify(summary));
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error("[cron/chatbot-price-sync] failed:", error);
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
