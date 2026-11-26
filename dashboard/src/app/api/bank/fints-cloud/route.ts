import { NextRequest, NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Freigabe erneuern wartet bis ~4 Min. auf die pushTAN-Bestätigung (Python-Funktion: 300 s)
export const maxDuration = 300;

/**
 * Steuerung des Cloud-Bank-Abrufs (Python-Funktion api/fints.py) aus dem Dashboard.
 *  GET  → Status je Bank (nur Status, nie Zustand/PIN)
 *  POST {bank, action: "renew" | "reset_auth"} → an die Python-Funktion weiterreichen
 * Nur Admins. Die Python-Funktion selbst akzeptiert nur Bearer CRON_SECRET.
 */

const BANKEN = [
  { key: "sparkasse", name: "Sparkasse" },
  { key: "targobank", name: "Targobank" },
] as const;

async function istAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return false;
  const { data: profile } = await supabase.from("profiles").select("is_admin, role").eq("id", user.id).single();
  return !!profile?.is_admin && profile.role !== "supplier";
}

function eingerichtet(key: string) {
  const k = key.toUpperCase();
  return !!(process.env.FINTS_PRODUCT_ID && process.env[`FINTS_${k}_USER`] && process.env[`FINTS_${k}_PIN`]);
}

export async function GET() {
  if (!(await istAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const sb = createServiceClient();
  const { data } = await sb.from("bank_fints_cloud").select("bank, status, updated_at");
  const rows = new Map((data ?? []).map((r) => [r.bank as string, r]));
  return NextResponse.json({
    aus: (process.env.FINTS_CLOUD ?? "on").toLowerCase() === "off",
    banken: BANKEN.map((b) => {
      const st = ((rows.get(b.key)?.status ?? {}) as Record<string, unknown>);
      return {
        key: b.key,
        name: b.name,
        eingerichtet: eingerichtet(b.key),
        needs_tan: !!st.needs_tan,
        auth_failed: !!st.auth_failed,
        last_success_at: (st.last_success_at as string) ?? null,
        last_error: (st.last_error as string) ?? null,
      };
    }),
  });
}

export async function POST(req: NextRequest) {
  if (!(await istAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, message: "CRON_SECRET fehlt bei Vercel." }, { status: 503 });
  let body: { bank?: string; action?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (!BANKEN.some((b) => b.key === body.bank) || !["renew", "reset_auth"].includes(body.action ?? "")) {
    return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });
  }
  try {
    const res = await fetch(`${new URL(req.url).origin}/api/fints`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
      body: JSON.stringify({ action: body.action, bank: body.bank }),
      signal: AbortSignal.timeout(295_000),
    });
    const json = await res.json().catch(() => ({ ok: false, message: `Antwort ${res.status}` }));
    return NextResponse.json(json, { status: res.ok ? 200 : 502 });
  } catch (e) {
    return NextResponse.json({ ok: false, message: `Bank-Funktion nicht erreichbar: ${e instanceof Error ? e.message : String(e)}` }, { status: 502 });
  }
}
