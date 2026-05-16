/**
 * GET  /api/chat/instagram/setup  — zeigt aktuellen Subscription-Status
 * POST /api/chat/instagram/setup  — abonniert die App für Instagram-Webhook-Events
 *
 * Nötig: META_PAGE_ACCESS_TOKEN + META_INSTAGRAM_USER_ID in ENV
 */
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const GRAPH_VERSION = "v21.0";
// Instagram Login Tokens (IGAA...) nutzen graph.instagram.com
// Page Access Tokens (EAA...) nutzen graph.facebook.com
const IG_HOST = "https://graph.instagram.com";

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

  // Token-Diagnose (gibt nur Prefix + Length zurück, NICHT vollen Token)
  const tokenInfo = {
    length: token.length,
    prefix: token.slice(0, 8),
    suffix: token.slice(-4),
    starts_with: token.startsWith("IGAA") ? "IGAA (Instagram Login Token)" :
                 token.startsWith("EAA") ? "EAA (Page/User Access Token)" :
                 "OTHER — wahrscheinlich falsches Format",
    has_whitespace: /\s/.test(token),
  };

  // Token-Format erkennen: IGAA → graph.instagram.com / EAA → graph.facebook.com
  const host = token.startsWith("IGAA") ? IG_HOST : "https://graph.facebook.com";

  // Test 1: /me
  const testMe = await fetch(
    `${host}/${GRAPH_VERSION}/me?fields=id,username,name&access_token=${encodeURIComponent(token)}`
  ).then(r => r.json()).catch(e => ({ error: e.message }));

  // Test 2: Direkt IG-User-Endpoint
  const testIg = await fetch(
    `${host}/${GRAPH_VERSION}/${igId}?fields=username,id&access_token=${encodeURIComponent(token)}`
  ).then(r => r.json()).catch(e => ({ error: e.message }));

  // Test 3: Subscriptions
  const testSubs = await fetch(
    `${host}/${GRAPH_VERSION}/${igId}/subscribed_apps?access_token=${encodeURIComponent(token)}`
  ).then(r => r.json()).catch(e => ({ error: e.message }));

  return NextResponse.json({
    ig_user_id: igId,
    token_info: tokenInfo,
    api_host: host,
    test_me: testMe,
    test_ig_user: testIg,
    test_subscriptions: testSubs,
  });
}

export async function POST() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "auth" }, { status: 401 });
  const igId = process.env.META_INSTAGRAM_USER_ID;
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  if (!igId || !token) return NextResponse.json({ error: "ENV missing" }, { status: 400 });

  // Subscribe — explizit subscribed_fields setzen
  const host = token.startsWith("IGAA") ? IG_HOST : "https://graph.facebook.com";
  const url = `${host}/${GRAPH_VERSION}/${igId}/subscribed_apps`;
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
