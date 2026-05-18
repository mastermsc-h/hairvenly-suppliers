/**
 * Einmaliger Backfill: klassifiziert alle Sessions OHNE category mit Haiku.
 * POST /api/chatbot/classify-backfill?limit=50
 * Admin only. Idempotent.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { classifySession } from "@/lib/chatbot/classify";

export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const profile = await requireProfile();
  if (!profile.is_admin) return NextResponse.json({ error: "admin only" }, { status: 403 });

  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") || 30), 60);
  const svc = createServiceClient();

  const { data: sessions } = await svc
    .from("chat_sessions")
    .select("id, customer_name")
    .is("category", null)
    .order("last_message_at", { ascending: false })
    .limit(limit);

  let classified = 0;
  const results: { id: string; customer: string | null; category: string | null }[] = [];
  for (const s of sessions || []) {
    try {
      const cat = await classifySession(s.id);
      results.push({ id: s.id, customer: s.customer_name, category: cat });
      if (cat) classified++;
    } catch (e) {
      results.push({ id: s.id, customer: s.customer_name, category: null });
      console.warn("[classify-backfill]", s.id, (e as Error).message);
    }
  }

  return NextResponse.json({
    processed: (sessions || []).length,
    classified,
    results,
  });
}
