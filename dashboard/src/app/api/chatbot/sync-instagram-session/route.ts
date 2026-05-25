/**
 * Per-Session Backfill von Instagram-Conversation-Historie.
 *
 * Mitarbeiter:innen klicken im Inbox-Detail auf "Ältere Nachrichten laden",
 * der Endpoint holt die nächsten ~50 älteren Messages aus Instagram und
 * mergt sie in chat_messages. Mehrfach klickbar — paginiert via gecachter
 * Meta-paging-URL in chat_sessions.ig_messages_next_url.
 *
 * POST /api/chatbot/sync-instagram-session
 * Body: { sessionId: string }
 *
 * Zero-Regression:
 *   - Nur additiv (insert if not exists via external_id)
 *   - Bei API-Fehler: 502 mit Fehlermeldung, keine DB-Korruption
 *   - Existierende sync-instagram-Route bleibt unberührt
 */
import { NextRequest, NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

const GRAPH_VERSION = "v21.0";
const BACKFILL_LIMIT = 50;
export const maxDuration = 60;

interface GraphMessage {
  id: string;
  created_time?: string;
  from?: { id: string; username?: string; name?: string };
  message?: string;
  attachments?: { data?: { image_data?: { url?: string }; file_url?: string; type?: string }[] };
}
interface GraphPaging { next?: string; cursors?: { before?: string; after?: string } }
interface GraphMessagesEdge { data?: GraphMessage[]; paging?: GraphPaging }
interface GraphConversationNode { id?: string; messages?: GraphMessagesEdge }

export async function POST(req: NextRequest) {
  try {
    const profile = await requireProfile().catch(() => null);
    if (!profile) return NextResponse.json({ error: "auth" }, { status: 401 });
    if (!profile.is_admin) return NextResponse.json({ error: "admin only" }, { status: 403 });

    const body = await req.json().catch(() => ({}));
    const sessionId = String(body.sessionId || "").trim();
    if (!sessionId) return NextResponse.json({ error: "sessionId fehlt" }, { status: 400 });

    const token   = process.env.META_PAGE_ACCESS_TOKEN;
    const igUserId = process.env.META_INSTAGRAM_USER_ID;
    if (!token || !igUserId) {
      return NextResponse.json({ error: "Meta-Credentials fehlen (env)" }, { status: 500 });
    }
    const host = token.startsWith("IGAA") ? "https://graph.instagram.com" : "https://graph.facebook.com";

    const svc = createServiceClient();
    const { data: session } = await svc
      .from("chat_sessions")
      .select("id, channel, external_id, ig_conversation_id, ig_messages_next_url")
      .eq("id", sessionId)
      .maybeSingle();
    if (!session) return NextResponse.json({ error: "Session nicht gefunden" }, { status: 404 });
    if (session.channel !== "instagram") {
      return NextResponse.json({ error: "Backfill nur für Instagram-Sessions implementiert. WhatsApp folgt." }, { status: 400 });
    }
    if (!session.external_id) {
      return NextResponse.json({ error: "Session hat keine Instagram-User-ID (external_id)" }, { status: 400 });
    }

    // ── 1. Conversation-ID auflösen (falls noch nicht gecached) ──
    let convoId = session.ig_conversation_id as string | null;
    if (!convoId) {
      const resolveUrl = `${host}/${GRAPH_VERSION}/${igUserId}/conversations?platform=instagram` +
        `&user_id=${encodeURIComponent(session.external_id)}` +
        `&access_token=${encodeURIComponent(token)}`;
      const r = await fetch(resolveUrl);
      const j = await r.json().catch(() => null);
      if (!r.ok || !j?.data?.[0]?.id) {
        return NextResponse.json({
          error: "Konnte Conversation nicht auflösen",
          details: j?.error?.message || `HTTP ${r.status}`,
        }, { status: 502 });
      }
      convoId = j.data[0].id as string;
      await svc.from("chat_sessions").update({ ig_conversation_id: convoId }).eq("id", sessionId);
    }

    // ── 2. Messages-Edge abrufen ──
    // Erster Backfill: /{convoId}?fields=messages.limit(50){...} → kriegt latest + paging
    // Folge-Backfill: direkt die gespeicherte paging.next URL nutzen (enthält schon den Cursor)
    let messagesUrl: string;
    let hasStoredNext = false;
    if (session.ig_messages_next_url && session.ig_messages_next_url.length > 5) {
      messagesUrl = session.ig_messages_next_url;
      hasStoredNext = true;
    } else if (session.ig_messages_next_url === "") {
      return NextResponse.json({
        messages_created: 0,
        messages_skipped: 0,
        has_more: false,
        note: "Keine älteren Nachrichten mehr verfügbar bei Instagram.",
      });
    } else {
      // Erster Backfill — nutze die conversation-node mit messages-edge
      messagesUrl = `${host}/${GRAPH_VERSION}/${convoId}` +
        `?fields=messages.limit(${BACKFILL_LIMIT}){id,created_time,from,message,attachments}` +
        `&access_token=${encodeURIComponent(token)}`;
    }

    const msgRes = await fetch(messagesUrl);
    const msgText = await msgRes.text();
    let msgJson: { messages?: GraphMessagesEdge; data?: GraphMessage[]; paging?: GraphPaging; error?: { message?: string } };
    try { msgJson = JSON.parse(msgText); } catch {
      return NextResponse.json({ error: "Graph API non-JSON", details: msgText.slice(0,400) }, { status: 502 });
    }
    if (!msgRes.ok) {
      return NextResponse.json({
        error: "Graph API Fehler",
        details: msgJson.error?.message || `HTTP ${msgRes.status}`,
      }, { status: 502 });
    }

    // Response-Shape unterscheidet sich:
    // - Erster Call (conversation node mit fields=messages.limit): res.messages.data + res.messages.paging
    // - Folge-Call (direkter Edge): res.data + res.paging
    const messages: GraphMessage[] = hasStoredNext
      ? (msgJson.data || [])
      : (msgJson.messages?.data || []);
    const paging: GraphPaging | undefined = hasStoredNext
      ? msgJson.paging
      : msgJson.messages?.paging;

    // ── 3. In DB inserten (Dedup via external_id) ──
    const { data: existing } = await svc
      .from("chat_messages")
      .select("external_id")
      .eq("session_id", sessionId)
      .not("external_id", "is", null);
    const existingIds = new Set((existing || []).map(m => m.external_id));

    let inserted = 0;
    let skipped = 0;
    for (const m of messages) {
      if (!m.id || existingIds.has(m.id)) { skipped++; continue; }
      const fromIsUs = m.from?.id === igUserId;
      const role = fromIsUs ? "human_agent" : "user";
      const attData = m.attachments?.data || [];
      const attachments = attData.map(a => ({
        type: a.type || (a.image_data ? "image" : "file"),
        url: a.image_data?.url || a.file_url || "",
      })).filter(a => a.url);
      const content = m.message || (attachments.length > 0 ? "[Foto]" : "");
      if (!content && attachments.length === 0) continue;
      await svc.from("chat_messages").insert({
        session_id: sessionId,
        role,
        content,
        attachments,
        external_id: m.id,
        created_at: m.created_time || new Date().toISOString(),
      });
      inserted++;
    }

    // ── 4. Pagination-State updaten ──
    // Wenn Meta uns ein paging.next gibt, gibt es noch ältere Messages — speichern.
    // Wenn nicht: leerer String als "exhausted"-Marker.
    const nextUrl = paging?.next || "";
    await svc.from("chat_sessions")
      .update({ ig_messages_next_url: nextUrl })
      .eq("id", sessionId);

    return NextResponse.json({
      messages_created: inserted,
      messages_skipped: skipped,
      has_more: !!nextUrl,
      total_returned: messages.length,
    });
  } catch (e) {
    console.error("[sync-instagram-session] uncaught:", e);
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
