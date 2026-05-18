/**
 * Backfill / Sync Instagram-Conversations aus Graph API in die Dashboard-Inbox.
 *
 * Holt alle Conversations + Messages und legt fehlende Sessions / Messages
 * in chat_sessions + chat_messages an. Bestehende Sessions werden NICHT
 * doppelt erzeugt; bestehende Messages NICHT doppelt eingefügt (Dedup über
 * external mid).
 *
 * POST /api/chatbot/sync-instagram
 * Optional Query: ?limit=50 (Anzahl Conversations) — default 100
 *
 * NICHT gestartet werden Bot-Antworten (Auto-Reply). Reine Daten-Sync.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { getInstagramUsername } from "@/lib/messaging/meta";

const GRAPH_VERSION = "v21.0";
export const maxDuration = 60;

interface GraphMessage {
  id: string;
  created_time?: string;
  from?: { id: string; username?: string; name?: string };
  to?: { data?: { id?: string; username?: string }[] };
  message?: string;
  attachments?: { data?: { image_data?: { url?: string }; file_url?: string; type?: string }[] };
}

interface GraphConversation {
  id: string;
  updated_time?: string;
  participants?: { data?: { id: string; username?: string; name?: string }[] };
  messages?: { data?: GraphMessage[]; paging?: { next?: string } };
}

export async function POST(req: NextRequest) {
  try {
    let profile;
    try {
      profile = await requireProfile();
    } catch (e) {
      return NextResponse.json({ error: "auth", details: (e as Error).message }, { status: 401 });
    }
    if (!profile.is_admin) {
      return NextResponse.json({ error: "admin only" }, { status: 403 });
    }

    const url = new URL(req.url);
    const convoLimit = Math.min(Number(url.searchParams.get("limit") || 50), 200);

    const token   = process.env.META_PAGE_ACCESS_TOKEN;
    const igUserId = process.env.META_INSTAGRAM_USER_ID;
    if (!token || !igUserId) {
      return NextResponse.json({ error: "META_PAGE_ACCESS_TOKEN / META_INSTAGRAM_USER_ID fehlt" }, { status: 500 });
    }
    const host = token.startsWith("IGAA") ? "https://graph.instagram.com" : "https://graph.facebook.com";

    // 1. Conversations holen
    console.log(`[sync-instagram] fetching conversations from ${host}, limit=${convoLimit}`);
    const convoUrl = `${host}/${GRAPH_VERSION}/${igUserId}/conversations?platform=instagram` +
      `&fields=id,updated_time,participants,messages.limit(25){id,created_time,from,to,message,attachments}` +
      `&limit=${convoLimit}&access_token=${encodeURIComponent(token)}`;
    let convoRes: Response;
    try {
      convoRes = await fetch(convoUrl);
    } catch (e) {
      return NextResponse.json({ error: "fetch failed", details: (e as Error).message }, { status: 502 });
    }
    const convoText = await convoRes.text();
    let convoJson: { data?: GraphConversation[]; error?: { message?: string } };
    try {
      convoJson = JSON.parse(convoText);
    } catch {
      return NextResponse.json({
        error: "Graph API gab kein JSON zurück",
        details: convoText.slice(0, 500),
        status: convoRes.status,
      }, { status: 502 });
    }
    if (!convoRes.ok) {
      return NextResponse.json({
        error: "Graph API Fehler",
        details: convoJson.error?.message || `HTTP ${convoRes.status}`,
        full: convoJson,
      }, { status: 502 });
    }

    const convos = (convoJson.data || []) as GraphConversation[];
    console.log(`[sync-instagram] got ${convos.length} conversations`);

  const svc = createServiceClient();
  let createdSessions = 0;
  let createdMessages = 0;
  let skippedExisting = 0;
  const errors: string[] = [];

  for (const convo of convos) {
    try {
      // Anderen Teilnehmer (=Kunde) raussuchen — nicht uns selbst
      const participants = convo.participants?.data || [];
      const customer = participants.find(p => p.id !== igUserId);
      if (!customer?.id) {
        errors.push(`convo ${convo.id}: kein Customer-Participant gefunden`);
        continue;
      }

      // Session per (channel, external_id) finden oder erstellen
      const { data: existing } = await svc
        .from("chat_sessions")
        .select("id, customer_name")
        .eq("channel", "instagram")
        .eq("external_id", customer.id)
        .maybeSingle();

      let sessionId: string;
      if (existing) {
        sessionId = existing.id;
      } else {
        // Username holen falls nicht im Participant — manchmal nur ID
        let displayName: string | undefined;
        if (customer.username) displayName = `@${customer.username}`;
        else if (customer.name) displayName = customer.name;
        else {
          const u = await getInstagramUsername(customer.id);
          if (u) displayName = `@${u}`;
        }

        // Avatar zufällig gewichtet
        const { data: avatars } = await svc.from("chatbot_avatars")
          .select("name, weight").eq("active", true);
        const list = avatars || [];
        const total = list.reduce((s, a) => s + (a.weight || 1), 0);
        let r = Math.random() * (total || 1);
        let picked = list[0]?.name || "Lara";
        for (const a of list) { r -= (a.weight || 1); if (r <= 0) { picked = a.name; break; } }

        const { data: created } = await svc.from("chat_sessions").insert({
          channel: "instagram",
          external_id: customer.id,
          customer_name: displayName,
          bot_signature_name: picked,
          status: "active",
          bot_mode: "off",           // wichtig: kein Auto-Reply auf Historie
          bot_auto_reply: false,
        }).select().single();
        if (!created) {
          errors.push(`convo ${convo.id}: Session-Insert fehlgeschlagen`);
          continue;
        }
        sessionId = created.id;
        createdSessions++;
      }

      // Messages dieser Conversation
      const msgs = convo.messages?.data || [];
      // Chronologisch sortieren (Graph liefert i.d.R. neueste zuerst)
      msgs.sort((a, b) =>
        (a.created_time || "").localeCompare(b.created_time || "")
      );

      // Bereits gespeicherte Message-IDs für Dedup
      const { data: existingMsgs } = await svc.from("chat_messages")
        .select("external_id").eq("session_id", sessionId).not("external_id", "is", null);
      const existingExtIds = new Set((existingMsgs || []).map(m => m.external_id));

      let lastMsgTime: string | undefined;
      for (const m of msgs) {
        if (!m.id || existingExtIds.has(m.id)) {
          skippedExisting++;
          continue;
        }
        const fromIsUs = m.from?.id === igUserId;
        const role = fromIsUs ? "assistant" : "user";

        // Attachments aufbereiten — IG liefert image_data.url oder file_url
        const attachData = m.attachments?.data || [];
        const attachments = attachData.map(a => ({
          type: a.type || (a.image_data ? "image" : "file"),
          url: a.image_data?.url || a.file_url || "",
        })).filter(a => a.url);

        const content = m.message || (attachments.length > 0 ? "[Foto]" : "");
        if (!content && attachments.length === 0) continue;

        await svc.from("chat_messages").insert({
          session_id:   sessionId,
          role,
          content,
          attachments,
          external_id:  m.id,
          created_at:   m.created_time || new Date().toISOString(),
        });
        createdMessages++;
        if (m.created_time && (!lastMsgTime || m.created_time > lastMsgTime)) {
          lastMsgTime = m.created_time;
        }
      }

      // Session last_message_at aktualisieren
      if (lastMsgTime) {
        await svc.from("chat_sessions").update({
          last_message_at: lastMsgTime,
          last_customer_msg_at: lastMsgTime,
        }).eq("id", sessionId);
      }
    } catch (e) {
      errors.push(`convo ${convo.id}: ${(e as Error).message}`);
    }
  }

    return NextResponse.json({
      conversations_seen:    convos.length,
      sessions_created:      createdSessions,
      messages_created:      createdMessages,
      messages_skipped:      skippedExisting,
      errors,
    });
  } catch (e) {
    console.error("[sync-instagram] uncaught:", e);
    return NextResponse.json({
      error: "uncaught",
      details: (e as Error).message,
      stack: (e as Error).stack?.slice(0, 1000),
    }, { status: 500 });
  }
}
