/**
 * GET    /api/chatbot/faq
 * POST   /api/chatbot/faq      Body: { topic, question, answer, slug?, order_idx?, notes? }
 * PATCH  /api/chatbot/faq      Body: { id, ...fields }
 * DELETE /api/chatbot/faq?id=
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

function slugify(text: string): string {
  return text.toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 50);
}

export async function GET() {
  const svc = createServiceClient();
  const { data, error } = await svc
    .from("chatbot_faq").select("*").order("order_idx").order("created_at");
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ faqs: data });
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "auth" }, { status: 401 });
  const body = await req.json();
  if (!body.topic?.trim() || !body.question?.trim() || !body.answer?.trim()) {
    return NextResponse.json({ error: "topic, question, answer required" }, { status: 400 });
  }
  const svc = createServiceClient();
  const slug = body.slug || slugify(body.question).slice(0, 40) + "_" + Date.now().toString(36);
  const { data, error } = await svc.from("chatbot_faq").insert({
    slug,
    topic:     body.topic.trim(),
    question:  body.question.trim(),
    answer:    body.answer.trim(),
    order_idx: body.order_idx ?? 999,
    notes:     body.notes || null,
    active:    body.active ?? true,
  }).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ faq: data });
}

export async function PATCH(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "auth" }, { status: 401 });
  const body = await req.json();
  if (!body.id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const svc = createServiceClient();
  const { id, ...updates } = body;
  const { data, error } = await svc
    .from("chatbot_faq").update(updates).eq("id", id).select().single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ faq: data });
}

export async function DELETE(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "auth" }, { status: 401 });
  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });
  const svc = createServiceClient();
  const { error } = await svc.from("chatbot_faq").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
