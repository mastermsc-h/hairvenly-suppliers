/**
 * LIGHT Instagram-Sync — pollt NUR `unread_count` für aktive Sessions.
 * Läuft regelmäßig per Vercel-Cron (alle 30 Min).
 *
 * Unterschied zu /api/chatbot/sync-instagram (manueller Klick):
 * - Holt KEINE Messages (sonst teuer)
 * - Holt nur conversations[].unread_count + participants
 * - Aktualisiert chat_sessions.ig_unread_count
 *
 * Zweck: Dashboard zeigt aktuellen IG-Stand auch wenn MA in der IG-App
 * was als ungelesen markiert hat (Divergenz-Banner pro Session).
 *
 * Architektur: Dashboard ist Master, aber wir lesen IG passiv mit, damit
 * Divergenzen sichtbar werden.
 */
import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";

const GRAPH_VERSION = "v22.0";

interface GraphConversation {
  id: string;
  unread_count?: number;
  participants?: {
    data: { id: string; name?: string; username?: string }[];
  };
}

export async function GET() {
  return POST();
}

export async function POST() {
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  const igUserId = process.env.META_INSTAGRAM_USER_ID;
  if (!token || !igUserId) {
    return NextResponse.json({ error: "Meta credentials missing" }, { status: 500 });
  }

  const host = token.startsWith("IGAA") ? "https://graph.instagram.com" : "https://graph.facebook.com";
  // Nur 100 letzte conversations — reicht für aktive Sessions
  const url = `${host}/${GRAPH_VERSION}/${igUserId}/conversations?platform=instagram` +
    `&fields=id,unread_count,participants&limit=100&access_token=${encodeURIComponent(token)}`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    if (!res.ok) {
      console.warn("[sync-light] Graph API error:", data.error?.message);
      return NextResponse.json({ error: "Graph API failed", details: data.error?.message }, { status: 502 });
    }

    const convos = (data.data || []) as GraphConversation[];
    const svc = createServiceClient();
    let updated = 0;
    let divergenceDetected = 0;

    for (const convo of convos) {
      const participants = convo.participants?.data || [];
      const customer = participants.find(p => p.id !== igUserId);
      if (!customer?.id) continue;
      const igUnread = typeof convo.unread_count === "number" ? convo.unread_count : 0;

      // Aktuellen DB-Stand holen, nur updaten wenn anders (spart Schreibzugriffe)
      const { data: existing } = await svc
        .from("chat_sessions")
        .select("id, ig_unread_count, last_seen_by_agent_at, last_customer_msg_at")
        .eq("channel", "instagram")
        .eq("external_id", customer.id)
        .maybeSingle();
      if (!existing) continue; // keine Session → existiert noch nicht, full-sync würde sie anlegen

      if (existing.ig_unread_count !== igUnread) {
        await svc.from("chat_sessions")
          .update({ ig_unread_count: igUnread })
          .eq("id", existing.id);
        updated++;
        // Divergenz erkennen: IG sagt unread, Dashboard sagt "gesehen seit lange"
        if (igUnread > 0 && existing.last_seen_by_agent_at &&
            existing.last_customer_msg_at &&
            new Date(existing.last_seen_by_agent_at) >= new Date(existing.last_customer_msg_at)) {
          divergenceDetected++;
        }
      }
    }

    return NextResponse.json({
      conversations_seen: convos.length,
      sessions_updated: updated,
      divergence_detected: divergenceDetected,
    });
  } catch (e) {
    console.error("[sync-light] uncaught:", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
