/**
 * GET  /api/chat/instagram/setup  — zeigt aktuellen Subscription-Status
 * POST /api/chat/instagram/setup  — abonniert die App für Instagram-Webhook-Events
 *
 * Nötig: META_PAGE_ACCESS_TOKEN + META_INSTAGRAM_USER_ID in ENV
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const GRAPH_VERSION = "v21.0";

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
  const igId = process.env.META_INSTAGRAM_USER_ID;
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  if (!igId || !token) {
    return NextResponse.json({
      error: "ENV missing",
      META_INSTAGRAM_USER_ID: !!igId,
      META_PAGE_ACCESS_TOKEN: !!token,
    }, { status: 400 });
  }
  // Prüfe Subscriptions
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${igId}/subscribed_apps?access_token=${token}`;
  const res = await fetch(url);
  const data = await res.json();
  return NextResponse.json({
    ig_user_id: igId,
    has_token: !!token,
    subscribed_apps: data,
  });
}

export async function POST() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "auth" }, { status: 401 });
  const igId = process.env.META_INSTAGRAM_USER_ID;
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  if (!igId || !token) return NextResponse.json({ error: "ENV missing" }, { status: 400 });

  // Subscribe — explizit subscribed_fields setzen
  const url = `https://graph.facebook.com/${GRAPH_VERSION}/${igId}/subscribed_apps`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      subscribed_fields: "messages,messaging_postbacks,messaging_seen,messaging_optins",
      access_token: token,
    }),
  });
  const data = await res.json();
  return NextResponse.json({ subscribed: res.ok, response: data });
}
