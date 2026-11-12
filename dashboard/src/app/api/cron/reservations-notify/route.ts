import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { AUTO_NOTIFY_HOUR_BERLIN, berlinHour } from "@/lib/reservations/auto-notify";
import { runAutoNotify } from "@/lib/reservations/notify";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Automatische Wartelisten-Benachrichtigung, Mo–Sa 11 Uhr Berlin.
 * Vercel-Cron läuft in UTC → feuert 09:00 + 10:00 UTC, gearbeitet wird nur in
 * dem Lauf, der in Berlin 11 Uhr ist (Sommer- wie Winterzeit). `?force=1`
 * überspringt nur diese Stundenprüfung (manueller Test) — das Sendefenster
 * Mo–Sa 9–19 Uhr und der Schalter (off/shadow/live) gelten immer.
 */
export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return NextResponse.json({ error: "CRON_SECRET not configured on server" }, { status: 500 });
  const valid = req.headers.get("authorization") === `Bearer ${expected}` || req.nextUrl.searchParams.get("token") === expected;
  if (!valid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const now = new Date();
  if (berlinHour(now) !== AUTO_NOTIFY_HOUR_BERLIN && req.nextUrl.searchParams.get("force") !== "1") {
    return NextResponse.json({ ok: true, skipped: `nicht ${AUTO_NOTIFY_HOUR_BERLIN} Uhr Berlin (${berlinHour(now)} Uhr)` });
  }

  try {
    const run = await runAutoNotify(createServiceClient(), now);
    revalidatePath("/chatbot/reservations");
    console.log("[cron/reservations-notify]", JSON.stringify(run));
    return NextResponse.json({ ok: true, ...run });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error("[cron/reservations-notify] failed:", error);
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
