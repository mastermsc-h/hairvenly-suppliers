/**
 * GET /api/chat/insights
 *
 * Query Params:
 *  - cluster        Filter nach Cluster
 *  - team_member    Filter nach Mitarbeiter
 *  - min_lost       Mindest-Lost-Deal-Score (z.B. 6)
 *  - conversion     'true' | 'false'
 *  - blocker        Filter nach Conversion-Blocker
 *  - quality        Filter nach team_response_quality
 *  - limit          (default 100, max 500)
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

export async function GET(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "auth" }, { status: 401 });

  const url = req.nextUrl;
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "100"), 500);
  const cluster   = url.searchParams.get("cluster");
  const member    = url.searchParams.get("team_member");
  const minLost   = url.searchParams.get("min_lost");
  const conv      = url.searchParams.get("conversion");
  const blocker   = url.searchParams.get("blocker");
  const quality   = url.searchParams.get("quality");

  const svc = createServiceClient();

  let q = svc.from("chatbot_insights").select(`
    id, source_chat_id, cluster, main_request, objections, team_response_quality,
    conversion, conversion_blocker, lost_deal_score, team_member,
    good_phrases, bad_phrases, summary
  `).order("lost_deal_score", { ascending: false }).limit(limit);

  if (cluster && cluster !== "all") q = q.eq("cluster", cluster);
  if (member && member !== "all")   q = q.eq("team_member", member);
  if (minLost)                       q = q.gte("lost_deal_score", parseInt(minLost));
  if (conv === "true")               q = q.eq("conversion", true);
  if (conv === "false")              q = q.eq("conversion", false);
  if (blocker && blocker !== "all")  q = q.eq("conversion_blocker", blocker);
  if (quality && quality !== "all")  q = q.eq("team_response_quality", quality);

  const { data: insights, error } = await q;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ insights: insights ?? [] });
}
