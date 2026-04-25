import { NextResponse } from "next/server";
import { requireProfile, hasFeature } from "@/lib/auth";
import { fetchRecentPaidOrders } from "@/lib/shopify";
import { ensureOrderPackQr } from "@/lib/actions/pack";

export const runtime = "nodejs";
export const maxDuration = 60;

const BATCH_LIMIT = 50; // max orders pro request — bleibt unter 60s timeout
const CONCURRENCY = 5;  // shopify rate-limit ~100 pkt/sek, mutations ~10pkt → 5 parallel safe

async function processConcurrently<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  async function next(): Promise<void> {
    while (cursor < items.length) {
      const idx = cursor++;
      results[idx] = await worker(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => next()));
  return results;
}

/**
 * Manueller Backfill — generiert QR-SVG-Metafield für bezahlte Orders ohne QR.
 * Parallel mit 5 concurrent. Limit 50 orders/request → mehrmals klicken für mehr.
 */
export async function POST() {
  try {
    const profile = await requireProfile();
    if (!hasFeature(profile, "shipping")) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const orders = await fetchRecentPaidOrders(30, 250);
    const ordersWithoutQr = orders.filter((o) => !o.hasPackQr);
    const todo = ordersWithoutQr.slice(0, BATCH_LIMIT);

    const results = await processConcurrently(todo, CONCURRENCY, async (o) => {
      const r = await ensureOrderPackQr(o.name, o.id);
      return { name: o.name, ...r };
    });

    const processed = results.filter((r) => r.success).length;
    const errors = results.filter((r) => !r.success);
    const sampleErrors = errors.slice(0, 3).map((e) => `${e.name}: ${e.error}`);
    const remaining = ordersWithoutQr.length - todo.length;

    return NextResponse.json({
      total: todo.length,
      processed,
      errors: errors.length,
      remaining,
      totalRecentOrders: orders.length,
      ordersWithoutQrTotal: ordersWithoutQr.length,
      sampleErrors,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
