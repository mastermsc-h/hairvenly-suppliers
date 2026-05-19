import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getInstagramUserInfo } from "@/lib/messaging/meta";

export const dynamic = "force-dynamic";

/**
 * Holt für alle Instagram-Sessions ohne customer_full_name den echten Namen
 * via Graph API und schreibt ihn nach. Auch customer_name wird ergänzt wenn
 * leer. Idempotent — kann beliebig oft aufgerufen werden.
 *
 * Aufruf: GET /api/chatbot/backfill-customer-names?limit=100
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = Math.min(Number(url.searchParams.get("limit") || 100), 500);
  const svc = createServiceClient();
  const { data: sessions } = await svc
    .from("chat_sessions")
    .select("id, external_id, customer_name, customer_full_name")
    .eq("channel", "instagram")
    .is("customer_full_name", null)
    .not("external_id", "is", null)
    .order("last_message_at", { ascending: false })
    .limit(limit);

  let updated = 0;
  let failed = 0;
  const errors: string[] = [];

  for (const s of sessions || []) {
    try {
      const info = await getInstagramUserInfo(s.external_id!);
      if (!info) { failed++; continue; }
      const patch: { customer_full_name?: string; customer_name?: string } = {};
      if (info.name) patch.customer_full_name = info.name;
      if (info.username && !s.customer_name) patch.customer_name = `@${info.username}`;
      if (Object.keys(patch).length === 0) { failed++; continue; }
      await svc.from("chat_sessions").update(patch).eq("id", s.id);
      updated++;
    } catch (e) {
      failed++;
      errors.push(`${s.id}: ${(e as Error).message}`);
    }
  }

  return NextResponse.json({
    scanned: sessions?.length || 0,
    updated,
    failed,
    errors: errors.slice(0, 10),
  });
}
