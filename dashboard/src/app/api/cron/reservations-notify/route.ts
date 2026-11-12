import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { AUTO_NOTIFY_HOURS_BERLIN, berlinHour } from "@/lib/reservations/auto-notify";
import { runAutoNotify } from "@/lib/reservations/notify";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Automatische Wartelisten-Benachrichtigung, Mo–Sa 10:00 UTC = 11 Uhr Berlin
 * (Winter) bzw. 12 Uhr (Sommer) — nach dem Lager-Refresh 9–10 Uhr. `?force=1`
 * überspringt nur die Stundenprüfung (manueller Test) — das Sendefenster
 * Mo–Sa 9–19 Uhr und der Schalter (off/shadow/live) gelten immer.
 */
export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return NextResponse.json({ error: "CRON_SECRET not configured on server" }, { status: 500 });
  const valid = req.headers.get("authorization") === `Bearer ${expected}` || req.nextUrl.searchParams.get("token") === expected;
  if (!valid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const now = new Date();
  if (!AUTO_NOTIFY_HOURS_BERLIN.includes(berlinHour(now)) && req.nextUrl.searchParams.get("force") !== "1") {
    return NextResponse.json({ ok: true, skipped: `außerhalb der Versand-Stunde (${berlinHour(now)} Uhr Berlin)` });
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
