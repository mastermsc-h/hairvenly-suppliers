/**
 * GET /api/chat/guardian/cron
 *
 * Wird von Vercel Cron alle 30 Min aufgerufen.
 * Auth: Vercel setzt automatisch `Authorization: Bearer ${CRON_SECRET}`.
 */
import { NextRequest, NextResponse } from "next/server";
import { runGuardianScan } from "@/lib/chatbot/guardian";

export const dynamic = "force-dynamic";
export const maxDuration = 300; // 5 Min Timeout — Wächter kann lange brauchen

export async function GET(req: NextRequest) {
  // Vercel-Cron-Auth
  const authHeader = req.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Sessions der letzten 2 Stunden scannen (häufiger, kleinere Mengen)
  const result = await runGuardianScan({ hours: 2, limit: 30 });
  return NextResponse.json({ ...result, source: "cron" });
}
