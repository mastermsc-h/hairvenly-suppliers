import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { syncInstagram } from "@/lib/instagram-statistik";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Täglicher Instagram-Abruf (Startbildschirm): letzte Tage neu laden (Instagram liefert mit Verzug),
 * Follower-Stand speichern, Demografie + Online-Zeiten aktualisieren.
 * Nachtragen: ?tage=400 (bis zu 730), läuft bis kurz vor dem Zeitlimit.
 */
export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return NextResponse.json({ error: "CRON_SECRET not configured on server" }, { status: 500 });
  const valid = req.headers.get("authorization") === `Bearer ${expected}` || req.nextUrl.searchParams.get("token") === expected;
  if (!valid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const tage = Number(req.nextUrl.searchParams.get("tage")) || 4;
  try {
    const res = await syncInstagram(createServiceClient(), { tage, deadlineMs: Date.now() + 50_000 });
    console.log("[cron/instagram]", JSON.stringify(res));
    return NextResponse.json(res);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error("[cron/instagram]", error);
    return NextResponse.json({ error }, { status: 500 });
  }
}
