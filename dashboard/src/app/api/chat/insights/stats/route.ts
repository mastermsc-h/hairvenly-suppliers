/**
 * GET /api/chat/insights/stats — Aggregat-Statistiken
 */
import { NextResponse } from "next/server";
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

  // RPC-Style: mehrere Aggregat-Abfragen
  const [total, byCluster, byBlocker, byQuality, byMember] = await Promise.all([
    svc.from("chatbot_insights").select("conversion, lost_deal_score, conversion_blocker"),
    svc.rpc("insights_by_cluster").then(r => r.error ? null : r.data),
    svc.rpc("insights_by_blocker").then(r => r.error ? null : r.data),
    svc.rpc("insights_by_quality").then(r => r.error ? null : r.data),
    svc.rpc("insights_by_member").then(r => r.error ? null : r.data),
  ]);

  // Falls RPCs nicht existieren → manuell aggregieren
  const all = total.data || [];
  const totalCount = all.length;
  const convCount  = all.filter(r => r.conversion === true).length;
  const lostDeals  = all.filter(r => r.lost_deal_score && r.lost_deal_score >= 6).length;
  const veryLost   = all.filter(r => r.lost_deal_score && r.lost_deal_score >= 8).length;
  const convRate   = totalCount > 0 ? (convCount * 100) / totalCount : 0;

  // Inline-Aggregat falls RPCs nicht existieren
  const buildGroup = async (column: string) => {
    const cols = `${column},conversion,lost_deal_score`;
    const { data } = await svc.from("chatbot_insights").select(cols as "*");
    const rec = (data || []) as unknown as Record<string, unknown>[];
    const map: Record<string, { total: number; conv: number; lost: number }> = {};
    for (const r of rec) {
      const key = r[column] as string;
      if (!key) continue;
      if (!map[key]) map[key] = { total: 0, conv: 0, lost: 0 };
      map[key].total++;
      if ((r as { conversion?: boolean }).conversion === true) map[key].conv++;
      if ((r as { lost_deal_score?: number }).lost_deal_score && (r as { lost_deal_score: number }).lost_deal_score >= 6) map[key].lost++;
    }
    return Object.entries(map).map(([k, v]) => ({
      key: k,
      total: v.total,
      conversion: v.conv,
      conversion_rate: v.total > 0 ? Math.round(v.conv * 1000 / v.total) / 10 : 0,
      lost_deals: v.lost,
      lost_rate: v.total > 0 ? Math.round(v.lost * 1000 / v.total) / 10 : 0,
    })).sort((a, b) => b.total - a.total);
  };

  // Objection-Counter
  const { data: allObj } = await svc.from("chatbot_insights").select("objections");
  const objCount: Record<string, number> = {};
  for (const r of allObj || []) {
    for (const o of (r.objections as string[] | null) || []) {
      objCount[o] = (objCount[o] || 0) + 1;
    }
  }
  const topObjections = Object.entries(objCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([k, v]) => ({ key: k, count: v }));

  return NextResponse.json({
    total: totalCount,
    conversion_count: convCount,
    conversion_rate: Math.round(convRate * 10) / 10,
    lost_deals: lostDeals,
    very_lost: veryLost,
    by_cluster: byCluster ?? await buildGroup("cluster"),
    by_blocker: byBlocker ?? await buildGroup("conversion_blocker"),
    by_quality: byQuality ?? await buildGroup("team_response_quality"),
    by_member:  byMember  ?? await buildGroup("team_member"),
    top_objections: topObjections,
  });
}
