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
  message?: {
    mid?: string;
    text?: string;
    is_deleted?: boolean;             // Recall-Event: IG-User hat Nachricht zurückgerufen
    is_unsupported?: boolean;
    is_echo?: boolean;                // wir selbst haben gesendet (über IG-App o.ä.)
    attachments?: Array<{ type: string; payload?: { url?: string } }>;
  };
  // Alternative Recall-Form (manchmal): message_deletes mit mids[]
  message_deletes?: { mids?: string[] };
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

  // ── RECALL / DELETION events ────────────────────────────────────────────
  // Variante A: message.is_deleted = true mit message.mid
  if (m.message?.is_deleted && m.message?.mid) {
    const svc = createServiceClient();
    const { error } = await svc.from("chat_messages")
      .update({ deleted_at: new Date().toISOString() })
      .eq("external_id", m.message.mid)
      .is("deleted_at", null);
    console.log(`[meta-webhook] recall: mid=${m.message.mid} ${error ? "ERR " + error.message : "marked deleted"}`);
    return;
  }
  // Variante B: message_deletes.mids[] (Bulk)
  if (m.message_deletes?.mids && m.message_deletes.mids.length > 0) {
    const svc = createServiceClient();
    const { error } = await svc.from("chat_messages")
      .update({ deleted_at: new Date().toISOString() })
      .in("external_id", m.message_deletes.mids)
      .is("deleted_at", null);
    console.log(`[meta-webhook] recall bulk: ${m.message_deletes.mids.length} mids ${error ? "ERR " + error.message : "marked deleted"}`);
    return;
  }

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

  // ── ECHO: wir selbst haben über die IG-App eine Nachricht gesendet ──
  // Sender ist unser eigener IG-Account (META_INSTAGRAM_USER_ID).
  // → Als human_agent-Message speichern, NICHT als user-Message,
  //   damit Inbox-Verlauf konsistent bleibt.
  const igUserId = process.env.META_INSTAGRAM_USER_ID;
  if (m.message?.is_echo || (igUserId && senderId === igUserId)) {
    if (!m.recipient?.id) return;
    const svc = createServiceClient();
    const { data: session } = await svc.from("chat_sessions")
      .select("id").eq("channel", "instagram").eq("external_id", m.recipient.id).maybeSingle();
    if (!session) {
      console.log(`[meta-webhook] echo to ${m.recipient.id} but no session — ignoring`);
      return;
    }
    // Dedup-Check 1: MID schon gespeichert?
    if (m.message?.mid) {
      const { data: dup } = await svc.from("chat_messages")
        .select("id").eq("session_id", session.id).eq("external_id", m.message.mid).maybeSingle();
      if (dup) return;
    }

    // CLAIM-LOGIK: Wenn wir gerade (letzte 120s) selbst eine assistant- oder human_agent-
    // Message in diese Session gesendet haben OHNE external_id, dann ist dieser Echo
    // höchstwahrscheinlich genau diese Message zurück von Meta. Statt eine neue Zeile
    // einzufügen → hänge die MID an die bestehende Zeile (Dedup statt Duplikat).
    const cutoff = new Date(Date.now() - 120_000).toISOString();
    const { data: recentSelf } = await svc.from("chat_messages")
      .select("id")
      .eq("session_id", session.id)
      .in("role", ["assistant", "human_agent"])
      .is("external_id", null)
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (recentSelf) {
      await svc.from("chat_messages")
        .update({ external_id: m.message?.mid || null })
        .eq("id", recentSelf.id);
      console.log(`[meta-webhook] echo: claimed existing row ${recentSelf.id} (mid=${m.message?.mid})`);
      return;
    }

    // Fallback: Echo kommt rein, ohne dass wir gerade selbst gesendet haben
    // → echte manuelle IG-App-Antwort von außerhalb. Als human_agent speichern.
    await svc.from("chat_messages").insert({
      session_id:  session.id,
      role:        "human_agent",
      content:     text,
      attachments: attachments,
      external_id: m.message?.mid || null,
    });
    await svc.from("chat_sessions").update({
      last_message_at: new Date().toISOString(),
    }).eq("id", session.id);
    console.log(`[meta-webhook] echo: stored as human_agent (external) in session ${session.id}`);
    return;
  }

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
    // Globaler Default-Bot-Modus aus chatbot_settings
    const { data: settings } = await svc
      .from("chatbot_settings")
      .select("default_bot_mode")
      .eq("id", 1)
      .maybeSingle();
    const defaultMode = (settings?.default_bot_mode || "off") as "auto" | "assisted" | "off";

    const { data: created } = await svc.from("chat_sessions").insert({
      channel: opts.channel,
      external_id: opts.externalId,
      customer_name: opts.customerName,
      bot_signature_name: picked,
      status: "active",
      bot_mode: defaultMode,
      bot_auto_reply: defaultMode === "auto",
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
    .is("deleted_at", null)
    .order("created_at", { ascending: false }).limit(1).single();

  // Bot-Modus auswerten — 'auto' = senden, 'assisted' = Entwurf, 'off' = nichts
  const botMode = session.bot_mode || (session.bot_auto_reply ? "auto" : "off");
  // ── SELF-DM-GUARD ──
  // Wenn die Session-Customer-ID identisch mit unserer eigenen IG-User-ID ist,
  // ist das ein Self-DM-Loop (Bot würde sich selbst antworten). Bot NIE triggern.
  const ourIgId = process.env.META_INSTAGRAM_USER_ID;
  if (ourIgId && session.external_id === ourIgId) {
    console.log(`[meta-webhook] SELF-DM detected (session ${session.id}) — bot triggers skipped`);
    return;
  }

  // ── AUTO-RESPOND-OVERRIDE für Standard-Eröffnungen ──
  // Auch bei bot_mode='off' antworten wir automatisch wenn die Kundennachricht
  // ein klares Standard-Muster ist: generische Info-Anfrage ohne Kontext,
  // oder Farbberatungs-Wunsch ohne Foto. In beiden Fällen reagiert der Bot
  // mit einem höflichen Opener der die Konversation für den Menschen vorbereitet.
  let effectiveBotMode = botMode;
  let autoOverrideType: "intro" | "color_no_photo" | null = null;
  if (botMode === "off" && session.status === "active") {
    autoOverrideType = detectAutoRespondType(opts.text, opts.attachments || []);
    if (autoOverrideType) {
      effectiveBotMode = "auto";
      console.log(`[meta-webhook] auto-respond override (${autoOverrideType}) for session ${session.id} despite mode=off`);
    }
  }

  if ((effectiveBotMode === "auto" || effectiveBotMode === "assisted") && session.status === "active") {
    try {
      // ── SMART DEBOUNCE ──
      // Default 6s. Aber: wenn die letzte Bot-/Mitarbeiter-Nachricht mehrere
      // Fragen enthielt (mind. 2 "?"), erwartet sie ein längeren Tipp-Vorgang
      // von der Kundin → wir warten länger (bis 45s), damit Bursts erfasst
      // werden und Bot nicht halb-Antworten generiert.
      const { data: lastBot } = await svc.from("chat_messages")
        .select("content, role").eq("session_id", session.id)
        .in("role", ["assistant", "human_agent"])
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(1).maybeSingle();
      const questionCount = (lastBot?.content || "").match(/\?/g)?.length || 0;
      // Kurze Customer-Messages (z.B. "?", "ja", "ok") brauchen KEINEN langen
      // Tipp-Puffer — der Bot soll schnell antworten.
      const customerMsgShort = (opts.text || "").trim().length <= 30;
      const DEBOUNCE_MS = (questionCount >= 2 && !customerMsgShort) ? 45_000 : 6_000;
      console.log(`[meta-webhook] debounce ${DEBOUNCE_MS}ms (last bot ?-count=${questionCount}, customer-len=${(opts.text || "").length})`);
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
      // Bei Auto-Respond-Override darf curMode auch 'off' sein — wir antworten trotzdem.
      const effectiveCurMode = autoOverrideType && curMode === "off" ? "auto" : curMode;
      if (refreshed?.status !== "active" || (effectiveCurMode !== "auto" && effectiveCurMode !== "assisted")) {
        console.log(`[meta-webhook] debounce: session no longer active+bot, skipping`);
        return;
      }
      // Alles klar → Bot generiert (Auto-Respond-Override forciert curMode='auto')
      await triggerBotResponse(session.id, opts.channel, opts.externalId, effectiveCurMode, lastUserMsg?.id);
    } catch (e) {
      console.error("[meta-webhook] bot reply failed:", e);
    }
  }
}

/**
 * Erkennt Standard-Eröffnungs-Patterns die der Bot AUTOMATISCH beantworten kann,
 * auch wenn die Session auf bot_mode='off' steht. Spart der Mitarbeiterin
 * generische Antworten und bereitet die Konversation vor.
 */
function detectAutoRespondType(text: string, attachments: { type: string; url: string }[]): "intro" | "color_no_photo" | null {
  const t = (text || "").toLowerCase().trim();
  const hasImages = attachments.some(a => a.type === "image" && a.url);
  if (t.length === 0) return null;

  // Pattern A: generische Info-Anfrage ohne konkreten Kontext (zu kurz für klare Beratung)
  const introPatterns = [
    /\b(mehr\s+info|kann\s+ich.{0,15}info|könnte\s+ich.{0,15}info|hätte\s+gern.{0,15}info|info[s]?\s+(?:bekommen|kriegen|haben|hätte))/,
    /\b(hierzu|dazu)\s+(?:mehr|noch|weitere)\b.*info/,
    /^(hallo|hi|hey|servus|moin)[\s!.?]*$/,
    /^(hallo|hi|hey)[\s,!]+(?:könnte|kannst du|kann ich|hast du)\b.{0,40}\b(info|hilfe|fragen?)/,
    /\binteressiere mich(?!\s+für\s+(?:tape|bonding|tressen|clip|verlängerung|verdichtung|haarvenly|extension|65|55|45|85|60|150g|175g|100g))/,
  ];
  if (introPatterns.some(p => p.test(t))) return "intro";

  // Pattern B: Farbberatungs-Wunsch OHNE Foto
  if (!hasImages) {
    const colorPatterns = [
      /\bwelche\s+farbe.*(?:passt|empf|ratet|nehme|kaufe|für\s+mich)/,
      /\bfarb(?:e|en)?\s*beratung/,
      /\bkannst\s+du\s+mir.{0,20}farbe.{0,15}(?:empfehl|sag|raten)/,
      /\bwelche\s+(?:nuance|farbe).*meinem?\s+haar/,
      /\b(weiß|wei[ßs])\s+nicht.{0,15}welche\s+farbe/,
      /\bhilf(?:e|st)?.{0,10}farbwahl/,
    ];
    if (colorPatterns.some(p => p.test(t))) return "color_no_photo";
  }

  return null;
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

  // mode = 'auto' → senden, ggf. in mehrere IG-Messages splitten wenn > 700 Zeichen
  if (channel === "instagram") {
    const { splitLongMessage } = await import("@/lib/chatbot/respond");
    const parts = splitLongMessage(result.text);
    const svc = createServiceClient();
    let firstMid: string | undefined;
    for (let i = 0; i < parts.length; i++) {
      const sendResult = await sendInstagramMessage(externalId, parts[i]);
      console.log(`[meta-webhook] IG reply sent (${i + 1}/${parts.length}):`, sendResult);
      if (i === 0 && sendResult.success && sendResult.message_id) {
        firstMid = sendResult.message_id;
      }
      if (i < parts.length - 1) await new Promise(r => setTimeout(r, 600));
    }
    // MID an die assistant-Zeile hängen (nur ein Eintrag in der DB, eine MID — Echo-Dedup)
    if (firstMid && result.insertedMessageId) {
      await svc.from("chat_messages")
        .update({ external_id: firstMid })
        .eq("id", result.insertedMessageId);
    }
  }
  // whatsapp: später analog
}
