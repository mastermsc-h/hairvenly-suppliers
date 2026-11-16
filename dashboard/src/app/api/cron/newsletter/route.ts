import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { syncNewsletter } from "@/lib/newsletter";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Täglicher Newsletter-Abgleich (Bestand + Bewegungen der letzten Tage). ?voll=1 = ganzer Verlauf (~30 s). */
export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return NextResponse.json({ error: "CRON_SECRET not configured on server" }, { status: 500 });
  const valid = req.headers.get("authorization") === `Bearer ${expected}` || req.nextUrl.searchParams.get("token") === expected;
  if (!valid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const res = await syncNewsletter(createServiceClient(), { voll: req.nextUrl.searchParams.get("voll") === "1", deadlineMs: Date.now() + 52_000 });
    console.log("[cron/newsletter]", JSON.stringify(res));
    return NextResponse.json(res);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error("[cron/newsletter]", error);
    return NextResponse.json({ error }, { status: 500 });
  }
}
