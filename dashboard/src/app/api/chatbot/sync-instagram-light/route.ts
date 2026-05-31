/**
 * LIGHT Instagram-Sync — dünner Route-Wrapper um runIgLightSync().
 *
 * Die Kern-Logik liegt in @/lib/chatbot/ig-light-sync (damit sie auch
 * piggyback aus inbox-stats aufgerufen werden kann — Hobby-Plan hat keinen
 * 10-Minuten-Cron). Diese Route bleibt als manueller/externer Trigger erhalten.
 *
 * ⚠️ BEKANNTE LIMITATION (verifiziert 2026-05-31): Die Instagram-Login-Graph-
 * API (graph.instagram.com) liefert das Feld `unread_count` NICHT — bei allen
 * Conversations ist es null. Ein manuelles "als ungelesen markieren" in der
 * IG-App ist ein App-lokaler UI-Zustand, den Meta NICHT über die API
 * exponiert (auch updated_time ändert sich dadurch nicht). Daher kann der
 * Light-Sync ein IG-seitiges Mark-Unread NICHT erkennen. Neue eingehende
 * Kundennachrichten werden weiterhin zuverlässig per Webhook erkannt.
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
