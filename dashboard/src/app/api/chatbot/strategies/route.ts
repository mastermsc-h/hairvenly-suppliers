/**
 * /api/chatbot/strategies
 *  GET    — alle Strategien (sortiert nach priority desc)
 *  POST   — Body: { name, trigger, steps, priority?, active? }
 *  PATCH  — Body: { id, ...fields }
 *  DELETE — Query: ?id=
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

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "auth" }, { status: 401 });
  const svc = createServiceClient();
  const { data, error } = await svc.from("chatbot_strategies")
    .select("*").order("priority", { ascending: false });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ strategies: data });
}

export async function POST(req: NextRequest) {
  const user = await requireAdmin();
  if (!user) return NextResponse.json({ error: "auth" }, { status: 401 });
  const body = await req.json();
  if (!body.name?.trim() || !body.trigger?.trim() || !body.steps?.trim()) {
    return NextResponse.json({ error: "name + trigger + steps required" }, { status: 400 });
  }
  const svc = createServiceClient();
  const { data, error } = await svc.from("chatbot_strategies").insert({
    name: body.name.trim(),
    trigger: body.trigger.trim(),
    steps: body.steps,
    priority: body.priority ?? 50,
    active: body.active ?? true,
    created_by: user.id,
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ strategy: data });
}

export async function PATCH(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "auth" }, { status: 401 });
  const body = await req.json();
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const { id, ...updates } = body;
  const svc = createServiceClient();
  const { data, error } = await svc.from("chatbot_strategies")
    .update(updates).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ strategy: data });
}

export async function DELETE(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "auth" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const svc = createServiceClient();
  await svc.from("chatbot_strategies").delete().eq("id", id);
  return NextResponse.json({ ok: true });
}
