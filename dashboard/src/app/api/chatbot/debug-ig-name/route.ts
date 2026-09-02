import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

/**
 * TEMPORÄRE Diagnose: warum liefert der IG-Profil-Lookup keine Namen?
 * Gibt KEINE Kundendaten zurück — nur Token-Präsenz, HTTP-Status, Fehlermeldung
 * und ob name/username im Response vorhanden wären. Nach Diagnose wieder löschen.
 */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  const GRAPH_VERSION = "v21.0";

  // Eine echte IG-User-ID nehmen (aus einer Session ohne Namen)
  let igsid = url.searchParams.get("id") || "";
  if (!igsid) {
    const svc = createServiceClient();
    const { data } = await svc
      .from("chat_sessions")
      .select("external_id")
      .eq("channel", "instagram")
      .not("external_id", "is", null)
      .order("last_message_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    igsid = data?.external_id || "";
  }

  const out: Record<string, unknown> = {
    tokenPresent: !!token,
    tokenPrefix: token ? token.slice(0, 4) : null,
    tokenLen: token ? token.length : 0,
    igsidPresent: !!igsid,
  };
  if (!token || !igsid) return NextResponse.json(out);

  // Beide Hosts testen, um Host/Permission-Ursache zu trennen
  for (const host of ["https://graph.instagram.com", "https://graph.facebook.com"]) {
    try {
      const res = await fetch(`${host}/${GRAPH_VERSION}/${igsid}?fields=username,name&access_token=${encodeURIComponent(token)}`);
      const data = await res.json().catch(() => ({}));
      out[host] = {
        httpStatus: res.status,
        ok: res.ok,
        hasName: !!data?.name,
        hasUsername: !!data?.username,
        errorMessage: data?.error?.message ?? null,
        errorType: data?.error?.type ?? null,
        errorCode: data?.error?.code ?? null,
      };
    } catch (e) {
      out[host] = { fetchError: (e as Error).message };
    }
  }
  return NextResponse.json(out);
}
