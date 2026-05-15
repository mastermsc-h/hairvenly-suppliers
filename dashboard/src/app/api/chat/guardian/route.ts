/**
 * GET  /api/chat/guardian      — Liste der offenen Alerts
 * POST /api/chat/guardian      — Wächter-Scan triggern
 * PATCH /api/chat/guardian     — Alert resolved/dismissed markieren
 */
import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { runGuardianScan } from "@/lib/chatbot/guardian";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles").select("is_admin").eq("id", user.id).single();
  return profile?.is_admin ? user : null;
}

export async function GET(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "auth" }, { status: 401 });
  const status = req.nextUrl.searchParams.get("status") || "open";
  const svc = createServiceClient();
  let q = svc.from("chatbot_guardian_alerts")
    .select(`
      id, session_id, severity, alert_type, team_member,
      description, suggestion, status, created_at,
      session:chat_sessions!chatbot_guardian_alerts_session_id_fkey(channel, bot_signature_name)
    `)
    .order("created_at", { ascending: false })
    .limit(200);
  if (status === "open") q = q.in("status", ["new", "acknowledged"]);
  else if (status !== "all") q = q.eq("status", status);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ alerts: data || [] });
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "auth" }, { status: 401 });
  const url = req.nextUrl;
  const hours = parseInt(url.searchParams.get("hours") || "24");
  const limit = parseInt(url.searchParams.get("limit") || "50");
  const result = await runGuardianScan({ hours, limit });
  return NextResponse.json(result);
}

export async function PATCH(req: NextRequest) {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const body = await req.json();
  if (!body.id || !body.status) {
    return NextResponse.json({ error: "id + status required" }, { status: 400 });
  }
  const svc = createServiceClient();
  const updates: Record<string, string | null> = { status: body.status };
  if (body.status === "resolved" || body.status === "dismissed") {
    updates.resolved_by = user.id;
    updates.resolved_at = new Date().toISOString();
  }
  const { error } = await svc.from("chatbot_guardian_alerts").update(updates).eq("id", body.id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
