import { NextRequest, NextResponse } from "next/server";
import { erstelleBericht, speichereBericht } from "@/lib/cockpit/auffaelligkeiten";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Täglicher Auffälligkeiten-Bericht für den Startbildschirm (gegen Mittag deutscher Zeit). */
export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return NextResponse.json({ error: "CRON_SECRET not configured on server" }, { status: 500 });
  const valid = req.headers.get("authorization") === `Bearer ${expected}` || req.nextUrl.searchParams.get("token") === expected;
  if (!valid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const b = await erstelleBericht();
    await speichereBericht(b);
    const zusammen = { tag: b.tag, punkte: b.punkte.length, hoch: b.punkte.filter((p) => p.schwere === "hoch").length, fehler: b.fehler };
    console.log("[cron/auffaelligkeiten]", JSON.stringify(zusammen));
    return NextResponse.json(zusammen);
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error("[cron/auffaelligkeiten]", error);
    return NextResponse.json({ error }, { status: 500 });
  }
}
