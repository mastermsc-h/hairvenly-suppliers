/**
 * POST /api/chat/follow-ups/skip
 * Body: { sessionId }
 * Markiert Session als 'skipped' damit sie nicht mehr in der Liste auftaucht.
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles").select("is_admin").eq("id", user.id).single();
  return profile?.is_admin ? user : null;
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "auth" }, { status: 401 });
  const { sessionId } = await req.json();
  if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });

  const svc = createServiceClient();
  await svc.from("chat_sessions").update({
    follow_up_status:  "skipped",
    follow_up_sent_at: new Date().toISOString(),
  }).eq("id", sessionId);

  return NextResponse.json({ ok: true });
}
