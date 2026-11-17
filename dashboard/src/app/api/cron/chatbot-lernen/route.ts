import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { runLearningCycle } from "@/lib/chatbot/learning";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Nächtliche Lernschleife: Bot-Entwürfe mit der echten Team-Antwort
 * verknüpfen und vergleichen → Wissens-Vorschläge auf /chatbot/lernen.
 */
export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  if (!expected) return NextResponse.json({ error: "CRON_SECRET not configured on server" }, { status: 500 });
  const valid = req.headers.get("authorization") === `Bearer ${expected}` || req.nextUrl.searchParams.get("token") === expected;
  if (!valid) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const result = await runLearningCycle(createServiceClient());
    revalidatePath("/chatbot/lernen");
    console.log("[cron/chatbot-lernen]", JSON.stringify(result));
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    console.error("[cron/chatbot-lernen] failed:", error);
    return NextResponse.json({ ok: false, error }, { status: 500 });
  }
}
