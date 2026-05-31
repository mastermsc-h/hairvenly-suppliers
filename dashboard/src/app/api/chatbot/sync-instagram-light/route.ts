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
        .select("id, ig_unread_count, last_seen_by_agent_at, last_opened_by_agent_at, last_customer_msg_at, status")
        .eq("channel", "instagram")
        .eq("external_id", customer.id)
        .maybeSingle();
      if (!existing) continue; // keine Session → existiert noch nicht, full-sync würde sie anlegen

      if (existing.ig_unread_count !== igUnread) {
        const update: Record<string, unknown> = { ig_unread_count: igUnread };

        // ── IG → DASHBOARD: ungelesen + unerledigt syncen ───────────────
        // User-Anweisung 2026-05-30: Wenn auf IG eine Nachricht (wieder) auf
        // UNGELESEN gestellt wird, soll das Dashboard das übernehmen:
        //   (a) Session als UNGELESEN markieren (blauer Punkt + Zu-tun)
        //   (b) Falls erledigt/geschlossen → wieder als UNERLEDIGT öffnen.
        //
        // Wir spiegeln exakt den markSessionUnread-Zustand: BEIDE Timestamps
        // auf den Sentinel (1970) → isExplicitlyNotDone feuert robust,
        // unabhängig davon wer zuletzt geschrieben hat (überschreibt den
        // ourTurn-Guard). Plus Reopen falls status=closed.
        //
        // 10-Min-Grace: nur wenn die letzte Dashboard-"gesehen"-Aktion alt
        // genug ist (verhindert Race mit einem mark_seen, das noch nicht zu
        // IG propagiert ist und dort fälschlich noch als unread erscheint).
        const FLAG_SENTINEL = "1970-01-01T00:00:00Z";
        const seenAt = existing.last_seen_by_agent_at;
        const alreadyUnread = !!seenAt && new Date(seenAt).getFullYear() < 2000;
        const seenAge = seenAt ? Date.now() - new Date(seenAt).getTime() : Infinity;
        const TEN_MIN_MS = 10 * 60 * 1000;
        if (igUnread > 0 && !alreadyUnread && seenAge > TEN_MIN_MS) {
          update.last_seen_by_agent_at = FLAG_SENTINEL;
          update.last_opened_by_agent_at = FLAG_SENTINEL;
          if (existing.status === "closed") update.status = "active"; // reopen = unerledigt
          divergenceDetected++;
          console.log(`[sync-light] Session ${existing.id.slice(0,8)} → IG-unread: ungelesen+unerledigt (war status=${existing.status}, seenAge=${seenAge === Infinity ? "∞" : Math.round(seenAge/60000)+"min"})`);
        }

        await svc.from("chat_sessions").update(update).eq("id", existing.id);
        updated++;
      }
    }

    return NextResponse.json({
      conversations_seen: convos.length,
      sessions_updated: updated,
      sessions_reactivated_from_ig: divergenceDetected,
    });
  } catch (e) {
    console.error("[sync-light] uncaught:", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
