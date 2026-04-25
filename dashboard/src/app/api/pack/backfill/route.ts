import { NextResponse } from "next/server";
import { requireProfile, hasFeature } from "@/lib/auth";
import { fetchRecentPaidOrders } from "@/lib/shopify";
import { ensureOrderPackQr } from "@/lib/actions/pack";

export const runtime = "nodejs";
export const maxDuration = 60; // bis 60s — für viele Orders

/**
 * Manueller Backfill: generiert QR-SVG-Metafield für alle bezahlten Orders der
 * letzten 30 Tage, die noch keines haben. Wird vom "QR-Codes generieren"-Button
 * auf /pack getriggert.
 */
export async function POST() {
  const profile = await requireProfile();
  if (!hasFeature(profile, "shipping")) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    const orders = await fetchRecentPaidOrders(30, 250);
    const ordersWithoutQr = orders.filter((o) => !o.hasPackQr);

    let processed = 0;
    let errors = 0;
    const errorMessages: string[] = [];

    // Sequenziell um Shopify Rate-Limits zu respektieren (Throttle ~100 punkte/sek)
    // Jede Order-Mutation kostet ~10 Punkte → max ~10 orders/sek.
    for (const o of ordersWithoutQr) {
      const res = await ensureOrderPackQr(o.name, o.id);
      if (res.success) {
        processed++;
      } else {
        errors++;
        if (errorMessages.length < 5) {
          errorMessages.push(`${o.name}: ${res.error}`);
        }
      }
    }

    return NextResponse.json({
      total: ordersWithoutQr.length,
      totalRecentOrders: orders.length,
      processed,
      errors,
      sampleErrors: errorMessages,
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
