/**
 * LIGHT Instagram-Sync — dünner Route-Wrapper um runIgLightSync().
 *
 * Die Kern-Logik liegt in @/lib/chatbot/ig-light-sync (damit sie auch
 * piggyback aus inbox-stats aufgerufen werden kann — Hobby-Plan hat keinen
 * 10-Minuten-Cron). Diese Route bleibt als manueller/externer Trigger erhalten.
 */
import { NextResponse } from "next/server";
import { runIgLightSync } from "@/lib/chatbot/ig-light-sync";

export async function GET() {
  return POST();
}

export async function POST() {
  const result = await runIgLightSync();
  const status = "error" in result
    ? (result.error === "Meta credentials missing" ? 500 : 502)
    : 200;
  return NextResponse.json(result, { status });
}
