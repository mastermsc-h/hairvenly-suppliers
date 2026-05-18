/**
 * Meta Webhook — empfängt Instagram-DMs + WhatsApp-Nachrichten
 *
 * Setup (einmalig):
 *  1. Meta Developer App erstellen
 *  2. Instagram + WhatsApp Products hinzufügen
 *  3. Webhook URL: https://suppliers.hairvenly.de/api/webhooks/meta
 *  4. Verify Token: gleicher wert wie META_VERIFY_TOKEN env-var
 *  5. Webhook fields subscriben: messages, messaging_postbacks
 *
 * GET  — Verification-Challenge bei Webhook-Setup
 * POST — Eingehende Nachrichten (Instagram + WhatsApp via Meta Cloud API)
 */
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { verifyMetaSignature, getInstagramUsername, sendInstagramMessage } from "@/lib/messaging/meta";

// Vercel-Function-Timeout auf 60s setzen (Default = 10s zu kurz für Bot+Tools)
export const maxDuration = 60;

// GET: Webhook-Verification von Meta beim Setup
export async function GET(req: NextRequest) {
  const params = req.nextUrl.searchParams;
  const mode = params.get("hub.mode");
  const token = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");
  if (mode === "subscribe" && token === process.env.META_VERIFY_TOKEN) {
    return new NextResponse(challenge, { status: 200 });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

// POST: Eingehende Events von Meta
export async function POST(req: NextRequest) {
  const rawBody = await req.text();
  const signature = req.headers.get("x-hub-signature-256");

  // DEBUG: log entire payload
  console.log("[meta-webhook] POST received, body length:", rawBody.length);
  console.log("[meta-webhook] payload:", rawBody.slice(0, 2000));

  // Signature verifizieren (Production)
  const sigOk = await verifyMetaSignature(rawBody, signature);
  if (!sigOk && process.env.NODE_ENV === "production") {
    console.warn("[meta-webhook] invalid signature — proceeding anyway for debugging");
    // return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let payload: MetaPayload;
  try { payload = JSON.parse(rawBody) as MetaPayload; }
  catch (e) {
    console.error("[meta-webhook] invalid JSON:", e);
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }

  console.log("[meta-webhook] parsed, object:", payload.object, "entries:", payload.entry?.length);

  // WICHTIG: in Serverless await statt fire-and-forget — sonst wird Function
  // beendet bevor die DB-Inserts durchgelaufen sind.
  // Meta erlaubt bis zu 20s Response-Zeit, also unproblematisch.
  try {
    await processEvents(payload);
  } catch (e) {
    console.error("[meta-webhook] process error:", e);
  }

  return NextResponse.json({ received: true });
}

// ── Event-Verarbeitung ────────────────────────────────────────────────────────

interface MetaPayload {
  object?: string;          // "instagram" | "whatsapp_business_account" | "page"
  entry?: Array<{
    id?: string;
    time?: number;
    messaging?: Array<MessagingItem>;  // Instagram + Page
    changes?: Array<{
      value?: WhatsAppValue;
      field?: string;
    }>;
  }>;
}

interface MessagingItem {
  sender?: { id: string };
  recipient?: { id: string };
  timestamp?: number;
  message?: { mid?: string; text?: string; attachments?: Array<{ type: string; payload?: { url?: string } }> };
}

interface WhatsAppValue {
  messaging_product?: string;
  metadata?: { phone_number_id?: string; display_phone_number?: string };
  contacts?: Array<{ profile?: { name?: string }; wa_id?: string }>;
  messages?: Array<{
    id?: string;
    from?: string;
    timestamp?: string;
    type?: string;
    text?: { body?: string };
  }>;
}

async function processEvents(payload: MetaPayload) {
  const obj = payload.object;
  console.log("[meta-webhook] processEvents, object:", obj);
  for (const entry of payload.entry || []) {
    console.log("[meta-webhook] entry:", JSON.stringify(entry).slice(0, 500));
    // Instagram (object="instagram") + Page-Messenger (object="page") → entry.messaging[]
    if (Array.isArray(entry.messaging)) {
      for (const m of entry.messaging) {
        await handleInstagramOrMessenger(m, obj === "page" ? "messenger" : "instagram");
      }
    }
    // WhatsApp → entry.changes[].value.messages
    if (Array.isArray(entry.changes)) {
      for (const ch of entry.changes) {
        if (ch.field === "messages" && ch.value?.messages) {
          for (const m of ch.value.messages) {
            await handleWhatsApp(m, ch.value);
          }
        }
      }
    }
  }
}

async function handleInstagramOrMessenger(m: MessagingItem, source: "instagram" | "messenger") {
  if (!m.sender?.id) return;
  const attachments = (m.message?.attachments || []).map(a => ({
    type: a.type, url: a.payload?.url || "",
  }));
  const hasText = !!m.message?.text;
  const hasAttachments = attachments.length > 0;
  // FIX: vorher droppten wir Foto-only-DMs. Jetzt: durchlassen wenn Text ODER Anhang da
  if (!hasText && !hasAttachments) return;

  const senderId = m.sender.id;
  // Wenn nur Foto ohne Text: synthetischen Platzhalter — Vision-LLM erkennt Bild selbst
  const text = m.message?.text || (hasAttachments ? "[Foto]" : "");
  const channel = source === "instagram" ? "instagram" : "web";

  let customerName: string | undefined;
  if (source === "instagram") {
    const username = await getInstagramUsername(senderId);
    if (username) customerName = `@${username}`;
  }

  await routeIncoming({
    channel,
    externalId: senderId,
    text,
    customerName,
    attachments,
    messageMid: m.message?.mid,
  });
}

async function handleWhatsApp(m: NonNullable<WhatsAppValue["messages"]>[number], value: WhatsAppValue) {
  if (!m.from) return;
  const text = m.text?.body || `[${m.type || "Nachricht"}]`;
  await routeIncoming({
    channel: "whatsapp",
    externalId: m.from,
    text,
    customerName: value.contacts?.[0]?.profile?.name,
    messageMid: m.id,
  });
}

// ── Routing in unsere Session-Pipeline ───────────────────────────────────────

async function routeIncoming(opts: {
  channel: "instagram" | "whatsapp" | "web";
  externalId: string;
  text: string;
  attachments?: { type: string; url: string }[];
  customerName?: string;
  messageMid?: string;
}) {
  const svc = createServiceClient();

  // Session per (channel, external_id) finden oder erstellen
  let { data: session } = await svc
    .from("chat_sessions")
    .select("*")
    .eq("channel", opts.channel)
    .eq("external_id", opts.externalId)
    .maybeSingle();

  if (!session) {
    // Avatar zufällig wählen (gewichtet, nur aktive)
    const { data: avatars } = await svc.from("chatbot_avatars").select("name, weight").eq("active", true);
    const list = avatars || [];
    const total = list.reduce((s, a) => s + (a.weight || 1), 0);
    let r = Math.random() * (total || 1);
    let picked = list[0]?.name || "Lara";
    for (const a of list) {
      r -= (a.weight || 1);
      if (r <= 0) { picked = a.name; break; }
    }
    const { data: created } = await svc.from("chat_sessions").insert({
      channel: opts.channel,
      external_id: opts.externalId,
      customer_name: opts.customerName,
      bot_signature_name: picked,
      status: "active",
    }).select().single();
    session = created;
  }

  if (!session) return;

  // Message speichern + Zeitstempel merken (für Debounce-Check)
  const myMsgTimestamp = new Date().toISOString();
  if (opts.messageMid) {
    // Dedup: wenn dieselbe MID schon gespeichert (z.B. Meta sendet Webhook 2x), skip
    const { data: dup } = await svc.from("chat_messages")
      .select("id").eq("session_id", session.id).eq("external_id", opts.messageMid).maybeSingle();
    if (dup) { console.log(`[meta-webhook] dup mid ${opts.messageMid} — skip`); return; }
  }
  await svc.from("chat_messages").insert({
    session_id: session.id,
    role: "user",
    content: opts.text,
    attachments: opts.attachments || [],
    external_id: opts.messageMid || null,
  });

  // Session updaten
  await svc.from("chat_sessions").update({
    last_message_at: myMsgTimestamp,
    last_customer_msg_at: myMsgTimestamp,
    customer_name: session.customer_name || opts.customerName || null,
  }).eq("id", session.id);

  // Auto-Klassifikation der Session (fire-and-forget) — bei jedem Eingang erneut
  // damit sich die Kategorie an aktuelle Themen anpasst.
  (async () => {
    try {
      const { classifySession } = await import("@/lib/chatbot/classify");
      await classifySession(session.id);
    } catch (e) { console.warn("[meta-webhook] classify fail:", (e as Error).message); }
  })();

  // Letzte gespeicherte User-Message holen — als Trigger für ggf. Entwurf
  const { data: lastUserMsg } = await svc.from("chat_messages")
    .select("id").eq("session_id", session.id).eq("role", "user")
    .order("created_at", { ascending: false }).limit(1).single();

  // Bot-Modus auswerten — 'auto' = senden, 'assisted' = Entwurf, 'off' = nichts
  const botMode = session.bot_mode || (session.bot_auto_reply ? "auto" : "off");
  if ((botMode === "auto" || botMode === "assisted") && session.status === "active") {
    try {
      // ── DEBOUNCE ──
      // Warte 4 Sekunden bevor du antwortest. Falls in der Zwischenzeit eine
      // neuere Nachricht reinkommt, lass DEREN Webhook antworten (dieser hier skipped).
      // → Kunde schreibt 3 kurze Nachrichten hintereinander = 1 Bot-Antwort auf
      //   alle drei zusammen, nicht 3 einzelne Antworten.
      const DEBOUNCE_MS = 6000;
      await new Promise(r => setTimeout(r, DEBOUNCE_MS));

      const { data: refreshed } = await svc
        .from("chat_sessions")
        .select("last_customer_msg_at, status, bot_mode, bot_auto_reply")
        .eq("id", session.id)
        .single();

      // Neuere Kundennachricht eingegangen? → wir antworten NICHT, die andere Webhook tut's
      if (refreshed?.last_customer_msg_at && refreshed.last_customer_msg_at > myMsgTimestamp) {
        console.log(`[meta-webhook] debounce: newer message arrived (${refreshed.last_customer_msg_at} > ${myMsgTimestamp}), skipping`);
        return;
      }
      // Status hat sich geändert (z.B. Mitarbeiter hat übernommen)?
      const curMode = refreshed?.bot_mode || (refreshed?.bot_auto_reply ? "auto" : "off");
      if (refreshed?.status !== "active" || (curMode !== "auto" && curMode !== "assisted")) {
        console.log(`[meta-webhook] debounce: session no longer active+bot, skipping`);
        return;
      }
      // Alles klar → Bot generiert
      await triggerBotResponse(session.id, opts.channel, opts.externalId, curMode, lastUserMsg?.id);
    } catch (e) {
      console.error("[meta-webhook] bot reply failed:", e);
    }
  }
}

// Bot-Antwort generieren + an Channel senden ODER als Entwurf speichern (assisted mode)
async function triggerBotResponse(
  sessionId: string,
  channel: string,
  externalId: string,
  mode: string,
  triggerMessageId?: string,
) {
  const { respondAsBot } = await import("@/lib/chatbot/respond");
  // assisted=true → respondAsBot soll NICHT in chat_messages speichern, sondern nur Text+Tools zurückgeben
  const result = await respondAsBot(sessionId, { assisted: mode === "assisted" });
  if (!result.success || !result.text) {
    console.error("[meta-webhook] bot response failed:", result.error);
    return;
  }

  if (mode === "assisted") {
    // Entwurf in chat_drafts speichern — NICHT senden
    const svc = createServiceClient();
    await svc.from("chat_drafts").insert({
      session_id:    sessionId,
      original_text: result.text,
      tool_calls:    result.toolCalls && result.toolCalls.length > 0 ? result.toolCalls : null,
      tool_results:  result.toolResults && result.toolResults.length > 0 ? result.toolResults : null,
      trigger_message_id: triggerMessageId || null,
      status:        "pending",
    });
    console.log(`[meta-webhook] draft created for session ${sessionId}`);
    return;
  }

  // mode = 'auto' → direkt senden
  if (channel === "instagram") {
    const sendResult = await sendInstagramMessage(externalId, result.text);
    console.log("[meta-webhook] IG reply sent:", sendResult);
  }
  // whatsapp: später analog
}
