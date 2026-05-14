/**
 * GET    /api/chatbot/avatars
 * POST   /api/chatbot/avatars      Body: { name, personality, avatar_url?, weight?, active? }
 * PATCH  /api/chatbot/avatars      Body: { id, ...fields }
 * DELETE /api/chatbot/avatars?id=
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
  const svc = createServiceClient();
  const { data, error } = await svc
    .from("chatbot_avatars")
    .select("*")
    .order("name", { ascending: true });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ avatars: data });
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "auth" }, { status: 401 });
  const body = await req.json();
  if (!body.name?.trim() || !body.personality?.trim()) {
    return NextResponse.json({ error: "name + personality required" }, { status: 400 });
  }
  const svc = createServiceClient();
  const { data, error } = await svc.from("chatbot_avatars").insert({
    name:        body.name.trim(),
    personality: body.personality,
    avatar_url:  body.avatar_url || null,
    weight:      body.weight || 1,
    active:      body.active ?? true,
    notes:       body.notes || null,
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ avatar: data });
}

export async function PATCH(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "auth" }, { status: 401 });
  const body = await req.json();
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const svc = createServiceClient();
  const { id, ...updates } = body;
  const { data, error } = await svc
    .from("chatbot_avatars")
    .update(updates)
    .eq("id", id)
    .select()
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ avatar: data });
}

export async function DELETE(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "auth" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const svc = createServiceClient();
  const { error } = await svc.from("chatbot_avatars").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
