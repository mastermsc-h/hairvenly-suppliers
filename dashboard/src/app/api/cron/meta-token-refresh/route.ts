import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { shouldRefresh } from "@/lib/messaging/token-refresh";
import { clearMetaTokenCache } from "@/lib/messaging/meta-token";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const GRAPH_VERSION = "v21.0";
const DAY_MS = 86400000;

/**
 * GET /api/cron/meta-token-refresh
 *
 * Täglich von Vercel Cron. Erneuert den Instagram Long-Lived Token VOR Ablauf
 * (ig_refresh_token, verlängert ~60 Tage) und legt ihn in der DB ab.
 * Auth: Authorization: Bearer <CRON_SECRET> ODER ?token=<CRON_SECRET>.
 * ?force=1 erzwingt einen Refresh (sofern Token ≥24h alt).
 */
export async function GET(req: NextRequest) {
  const expected = process.env.CRON_SECRET;
  const authHeader = req.headers.get("authorization");
  const queryToken = new URL(req.url).searchParams.get("token");
  if (expected && authHeader !== `Bearer ${expected}` && queryToken !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const force = new URL(req.url).searchParams.get("force") === "1";
  const now = new Date();
  const svc = createServiceClient();

  const { data: row } = await svc
    .from("meta_token")
    .select("access_token, expires_at, refreshed_at")
    .eq("id", 1)
    .maybeSingle();

  // 1) Noch kein DB-Token → aus Env seeden (frischer Token, noch nicht refreshbar)
  if (!row?.access_token) {
    const envToken = process.env.META_PAGE_ACCESS_TOKEN;
    if (!envToken) return NextResponse.json({ error: "kein Token in DB und kein META_PAGE_ACCESS_TOKEN in Env" }, { status: 500 });
    const expires_at = new Date(now.getTime() + 60 * DAY_MS).toISOString();
    await svc.from("meta_token").upsert({
      id: 1, access_token: envToken, token_type: "ig_long_lived",
      expires_at, refreshed_at: now.toISOString(), source: "env-seed", updated_at: now.toISOString(),
    });
    clearMetaTokenCache();
    return NextResponse.json({ seeded: true, source: "env", expires_at, note: "Token aus Env übernommen; Auto-Refresh startet, sobald er ≥24h alt ist." });
  }

  // 2) Refresh nötig?
  const refreshedAt = row.refreshed_at ? new Date(row.refreshed_at) : null;
  const expiresAt = row.expires_at ? new Date(row.expires_at) : null;
  if (!force && !shouldRefresh(now, refreshedAt, expiresAt)) {
    return NextResponse.json({
      refreshed: false, reason: "noch nicht nötig",
      expires_at: row.expires_at, refreshed_at: row.refreshed_at,
      days_remaining: expiresAt ? Math.round((expiresAt.getTime() - now.getTime()) / DAY_MS) : null,
    });
  }

  // 3) Refresh via ig_refresh_token
  try {
    const res = await fetch(
      `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${encodeURIComponent(row.access_token)}`,
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.access_token) {
      return NextResponse.json({
        refreshed: false, error: data?.error?.message || `HTTP ${res.status}`,
        hint: "Token evtl. noch <24h alt oder bereits abgelaufen — nächster Lauf versucht es erneut.",
      }, { status: 200 });
    }
    const expiresInSec = Number(data.expires_in) || 60 * 86400;
    const newExpires = new Date(now.getTime() + expiresInSec * 1000).toISOString();
    await svc.from("meta_token").update({
      access_token: data.access_token, token_type: data.token_type || "ig_long_lived",
      expires_at: newExpires, refreshed_at: now.toISOString(), source: "refresh", updated_at: now.toISOString(),
    }).eq("id", 1);
    clearMetaTokenCache();
    return NextResponse.json({ refreshed: true, expires_at: newExpires, days_valid: Math.round(expiresInSec / 86400) });
  } catch (e) {
    return NextResponse.json({ refreshed: false, error: (e as Error).message }, { status: 200 });
  }
}
