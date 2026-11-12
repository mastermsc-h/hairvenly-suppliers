import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { runReservationStockCheck } from "@/lib/reservations/stock-check";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Täglicher Lager-Check der Chatbot-Warteliste (morgens). Speichert pro
 * wartender Reservierung den Lager-Status → Sidebar-Badge „wieder auf Lager"
 * + Hervorhebung auf /chatbot/reservations. Sendet NICHTS an Kundinnen —
 * die Benachrichtigung bleibt 1-Klick durch Mitarbeiter.
 */
export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return NextResponse.json({ error: "CRON_SECRET not configured on server" }, { status: 500 });
  const valid = req.headers.get("authorization") === `Bearer ${expected}` || req.nextUrl.searchParams.get("token") === expected;
  if (!valid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const { counts, newlyInStock, results } = await runReservationStockCheck(createServiceClient());
    revalidatePath("/chatbot/reservations");
    console.log("[cron/reservations-check]", JSON.stringify({ checked: results.length, counts, newlyInStock }));
    return NextResponse.json({ ok: true, checked: results.length, counts, newlyInStock });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error("[cron/reservations-check] failed:", error);
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
