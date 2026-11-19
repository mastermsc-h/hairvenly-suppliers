import { NextRequest, NextResponse } from "next/server";
import { sammleBeitraege } from "@/lib/marketing-kanaele";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Sammelt Beiträge (Instagram inkl. Storys, YouTube, Blog). Zweimal täglich, damit keine 24-h-Story verloren geht. */
export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return NextResponse.json({ error: "CRON_SECRET not configured on server" }, { status: 500 });
  const valid = req.headers.get("authorization") === `Bearer ${expected}` || req.nextUrl.searchParams.get("token") === expected;
  if (!valid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const r = await sammleBeitraege();
  console.log("[cron/marketing-kanaele]", JSON.stringify(r));
  return NextResponse.json(r, { status: r.fehler.length && !r.neu ? 207 : 200 });
}
