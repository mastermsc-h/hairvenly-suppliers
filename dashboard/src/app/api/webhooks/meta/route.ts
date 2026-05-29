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

// Vercel Function Timeout — Bot-Generation mit Tool-Calls + Debounce kann
// bis zu 4 Min dauern. Default 60s killt die Function mitten in der
// Debounce-Wartezeit → kein Bot-Trigger. Mit Pro Plan erlaubt Vercel
// bis 300s (5 Min) maxDuration.
export const maxDuration = 300;
import { verifyMetaSignature, getInstagramUsername, getInstagramUserInfo, sendInstagramMessage } from "@/lib/messaging/meta";

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

  // STORY-REPLY: Instagram füllt message.reply_to.story.{id,url} wenn die
  // Kundin auf eine Story antwortet (Text-Reply auf Story-Sticker). Das ist
  // NICHT in attachments[], sondern in reply_to. Ohne den Kontext sieht der
  // MA nur "Heii ich hätte interesse" und versteht nicht worauf sie sich
  // bezieht. Wir hängen die Story als synthetische "story_reply"-Attachment an,
  // damit die UI eine Vorschau zeigen kann (User-Wunsch 2026-05-28).
  //
  // Hinweis: Meta-CDN-URLs sind signed + zeitlich begrenzt (~24-48h). Für
  // dauerhafte Persistenz müsste man die URL beim Empfang in Supabase
  // Storage spiegeln (separater Task).
  const replyToStory = (m.message as { reply_to?: { story?: { id?: string; url?: string } } } | undefined)?.reply_to?.story;
  if (replyToStory?.url) {
    attachments.push({ type: "story_reply", url: replyToStory.url });
    console.log(`[meta-webhook] story-reply detected (story_id=${replyToStory.id || "?"}) — attached for UI preview`);
  }

  const hasText = !!m.message?.text;
  const hasAttachments = attachments.length > 0;
  // FIX: vorher droppten wir Foto-only-DMs. Jetzt: durchlassen wenn Text ODER Anhang da
  if (!hasText && !hasAttachments) return;

  const senderId = m.sender.id;
  // Attachment-Typen unterscheiden für korrekten Synthese-Text.
  // Vision-LLM kann normale Bilder lesen (→ "[Foto]"), aber NICHT Audios/Videos
  // oder Einmal-Ansicht-Fotos (ephemeral, URL ist leer = Kundin hat View-Once
  // verwendet und wir sehen das Bild gar nicht).
  const allAudio = hasAttachments && attachments.every(a => a.type === "audio");
  const allVideo = hasAttachments && attachments.every(a => a.type === "video");
  const allEphemeral = hasAttachments && attachments.every(a => a.type === "ephemeral");
  const text = m.message?.text || (
    allEphemeral ? "[Einmal-Foto — nicht sichtbar]" :
    allAudio ? "[Audio]" :
    allVideo ? "[Video]" :
    hasAttachments ? "[Foto]" :
    ""
  );
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

    // SPLIT-CHUNK-CHECK: Lange Bot-Antworten werden in mehrere IG-Messages
    // gesplittet (siehe splitLongMessage). Jeder Chunk bekommt seine eigene Echo.
    // Die erste Echo claimed die assistant-Zeile, die zweite Echo würde sonst
    // als neue human_agent-Zeile gespeichert werden — das duplizierte die Antwort.
    // Fix: prüfen ob der Echo-Inhalt als Substring in einer kürzlich gesendeten
    // assistant/human_agent-Message vorkommt — wenn ja, ist's unser eigener Chunk.
    if (text && text.trim().length > 10) {
      const trimmed = text.trim();
      const cleanText = trimmed.replace(/\s+/g, " ").toLowerCase();
      const probeStart = cleanText.slice(0, 40);
      const probeEnd = cleanText.length > 60 ? cleanText.slice(-30) : null;
      const { data: recentOurs } = await svc.from("chat_messages")
        .select("id, content")
        .eq("session_id", session.id)
        .in("role", ["assistant", "human_agent"])
        .gte("created_at", cutoff)
        .order("created_at", { ascending: false })
        .limit(5);
      const isOwnChunk = (recentOurs || []).some(row => {
        const haystack = (row.content || "").replace(/\s+/g, " ").toLowerCase();
        return haystack.includes(probeStart) || (probeEnd ? haystack.includes(probeEnd) : false);
      });
      if (isOwnChunk) {
        console.log(`[meta-webhook] echo: detected own split-chunk (mid=${m.message?.mid}) — skip duplicate`);
        return;
      }
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
  let customerFullName: string | undefined;
  if (source === "instagram") {
    const info = await getInstagramUserInfo(senderId);
    if (info?.username) customerName = `@${info.username}`;
    if (info?.name) customerFullName = info.name;
  }

  // Reply-Threading: Instagram-DM-Reply-Funktion füllt message.reply_to.mid
  // mit der referenzierten Nachricht. Speichern wir, damit die UI über jeder
  // Bubble den "Antwort auf: …" Hinweis wie auf Instagram zeigen kann.
  const replyToMid =
    (m.message as { reply_to?: { mid?: string } } | undefined)?.reply_to?.mid;

  await routeIncoming({
    channel,
    externalId: senderId,
    text,
    customerName,
    customerFullName,
    attachments,
    messageMid: m.message?.mid,
    replyToMid,
  });
}

async function handleWhatsApp(m: NonNullable<WhatsAppValue["messages"]>[number], value: WhatsAppValue) {
  if (!m.from) return;
  const text = m.text?.body || `[${m.type || "Nachricht"}]`;
  // WhatsApp füllt context.id mit der referenzierten Message-ID bei Replies.
  const replyToMid = (m as { context?: { id?: string } }).context?.id;
  await routeIncoming({
    channel: "whatsapp",
    externalId: m.from,
    text,
    customerName: value.contacts?.[0]?.profile?.name,
    messageMid: m.id,
    replyToMid,
  });
}

// ── Routing in unsere Session-Pipeline ───────────────────────────────────────

async function routeIncoming(opts: {
  channel: "instagram" | "whatsapp" | "web";
  externalId: string;
  text: string;
  attachments?: { type: string; url: string }[];
  customerName?: string;
  customerFullName?: string;
  messageMid?: string;
  replyToMid?: string;
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
      customer_full_name: opts.customerFullName || null,
      bot_signature_name: picked,
      status: "active",
      bot_mode: defaultMode,
      bot_auto_reply: defaultMode === "auto",
    }).select().single();
    session = created;
  } else if (opts.customerFullName && !session.customer_full_name) {
    // Bestehende Session ohne Full-Name → backfilling beim nächsten Webhook-Hit
    await svc.from("chat_sessions").update({ customer_full_name: opts.customerFullName }).eq("id", session.id);
    session.customer_full_name = opts.customerFullName;
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
    reply_to_external_id: opts.replyToMid || null,
  });

  // Session updaten
  // ── REAKTIVIERUNG ──
  // Wenn die Session als "Erledigt" (closed) oder anders nicht-aktiv markiert war
  // und die Kundin schreibt erneut, wird sie automatisch wieder auf "active"
  // gesetzt. So triggert der Bot (sofern Mode != off & nicht human_only) wieder
  // und die Inbox zeigt sie wieder prominent.
  const wasInactive = session.status && session.status !== "active";
  await svc.from("chat_sessions").update({
    last_message_at: myMsgTimestamp,
    last_customer_msg_at: myMsgTimestamp,
    customer_name: session.customer_name || opts.customerName || null,
    ...(wasInactive ? { status: "active" } : {}),
  }).eq("id", session.id);
  if (wasInactive) {
    console.log(`[meta-webhook] Session ${session.id} REAKTIVIERT (war status=${session.status}) — Kundin hat erneut geschrieben`);
    session.status = "active";
  }

  // Auto-Klassifikation der Session — bei jedem Eingang erneut, damit sich die
  // Kategorie an aktuelle Themen anpasst. SYNCHRON awaited, weil der granulare
  // Kill-Switch (siehe weiter unten) die category braucht, um zu entscheiden ob
  // proaktive Bot-Generierung erlaubt ist (Whitelist: availability/general/
  // pricing/order_status). Ohne aktuelle Category würde der Kill-Switch sonst
  // konservativ blockieren und der Bot würde nie antworten.
  // Haiku-Call ist schnell (~300-600ms) — kein nennenswerter Webhook-Delay.
  let sessionCategory: string | null = (session as { category?: string | null }).category ?? null;
  try {
    const { classifySession } = await import("@/lib/chatbot/classify");
    const cat = await classifySession(session.id);
    if (cat) sessionCategory = cat;
  } catch (e) {
    console.warn("[meta-webhook] classify fail:", (e as Error).message);
  }

  // Letzte gespeicherte User-Message holen — als Trigger für ggf. Entwurf
  const { data: lastUserMsg } = await svc.from("chat_messages")
    .select("id").eq("session_id", session.id).eq("role", "user")
    .is("deleted_at", null)
    .order("created_at", { ascending: false }).limit(1).single();

  // Bot-Modus auswerten — 'auto' = senden, 'assisted' = Entwurf, 'off' = nichts
  const botMode = session.bot_mode || (session.bot_auto_reply ? "auto" : "off");
  // ── HUMAN-ONLY-GUARD ──
  // Mitarbeiterin hat die Session explizit als "Nur für Team" markiert →
  // Bot überspringt ALLES (auch Auto-Respond-Override, auch Drafts).
  if ((session as { human_only?: boolean }).human_only) {
    console.log(`[meta-webhook] session ${session.id} marked human_only — bot skipped completely`);
    return;
  }
  // ── SELF-DM-GUARD ──
  // Wenn die Session-Customer-ID identisch mit unserer eigenen IG-User-ID ist,
  // ist das ein Self-DM-Loop (Bot würde sich selbst antworten). Bot NIE triggern.
  const ourIgId = process.env.META_INSTAGRAM_USER_ID;
  if (ourIgId && session.external_id === ourIgId) {
    console.log(`[meta-webhook] SELF-DM detected (session ${session.id}) — bot triggers skipped`);
    return;
  }

  // ── MEDIEN-BYPASS (Audio / Video / Einmal-Foto) ──
  // Drei Medientypen kann der Bot nicht verarbeiten:
  //   1) Audio  — kann nicht abgehört werden
  //   2) Video  — kann nicht angesehen werden
  //   3) Ephemeral / Einmal-Foto — Kundin hat View-Once gewählt, das Bild
  //      ist nicht mehr aufrufbar (URL ist leer). Wir wollen sie freundlich
  //      bitten das Bild normal zu schicken, damit die Stylistin Farbberatung
  //      machen kann.
  const customerAttachments = opts.attachments || [];
  const customerSentAudio = customerAttachments.some(a => a.type === "audio");
  const customerSentVideo = customerAttachments.some(a => a.type === "video");
  const customerSentEphemeral = customerAttachments.some(a => a.type === "ephemeral");
  const noTextWithAudio = customerSentAudio && (!opts.text || /^\[Audio\]$/i.test(opts.text.trim()));
  const noTextWithVideo = customerSentVideo && (!opts.text || /^\[Video\]$/i.test(opts.text.trim()));
  const noTextWithEphemeral = customerSentEphemeral && (!opts.text || /^\[Einmal-Foto/i.test(opts.text.trim()));

  // 🧠 KONTEXT-CHECK: Audio/Video/Ephemeral-Bypass NUR feuern wenn die Kundin
  // in den letzten 30 Min KEINE echte Text-Message geschrieben hat. Sonst
  // ignoriert die statische "Bin nur ein Bot"-Antwort den ganzen vorherigen
  // Kontext und wirkt wie ein dummer Bot, der nicht zuhört.
  //
  // Beispiel-Bug (User-Beobachtung 2026-05): Kundin schreibt 3 lange
  // Textblöcke über ihre Bedürfnisse, schickt dann ein Video. Bot feuerte
  // sofort "kann keine Videos hören" — ohne die 3 Textblöcke zu erwähnen.
  let hasRecentTextContext = false;
  // 🆕 RAPPORT-CHECK (User-Wunsch 2026-05-28): Audio/Video-Bypass darf nicht
  // als Erstantwort feuern — wirkt aus dem Nichts. Nur OK wenn der Bot in
  // dieser Session schon mal autonom geantwortet hat (= Rapport mit der Kundin
  // existiert). Sonst soll die MA übernehmen.
  // Einmal-Foto bleibt ausgenommen, da bei Einmal-Ansicht JEDE Sekunde zählt
  // (Foto wird verschluckt) — da ist die Bot-Antwort selbst beim Erstkontakt
  // wertvoll.
  let hasPriorAutobotMessage = false;
  if (noTextWithAudio || noTextWithVideo || noTextWithEphemeral) {
    const thirtyMinAgo = new Date(Date.now() - 30 * 60_000).toISOString();
    const { data: recentMsgs } = await svc
      .from("chat_messages")
      .select("content, attachments, created_at")
      .eq("session_id", session.id)
      .eq("role", "user")
      .gt("created_at", thirtyMinAgo)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(10);
    hasRecentTextContext = (recentMsgs || []).some(m => {
      const txt = (m.content || "").trim();
      // Echte Text-Message = nicht leer + nicht ein reines Attachment-Label
      return txt.length > 5 && !/^\[(Audio|Video|Foto|Einmal-Foto)[^\]]*\]$/i.test(txt);
    });
    if (hasRecentTextContext) {
      console.log(`[meta-webhook] media-bypass SKIPPED for session=${session.id.slice(0,8)} — Kundin hat in letzten 30 Min Text geschrieben, statische "kann kein Video hören"-Antwort wäre dumm. Mitarbeiterin soll manuell ran.`);
    }
    // Rapport-Check nur für Audio/Video, nicht für Einmal-Foto
    if (noTextWithAudio || noTextWithVideo) {
      const { data: priorAutobot } = await svc
        .from("chat_messages")
        .select("id")
        .eq("session_id", session.id)
        .eq("role", "assistant")
        .eq("auto_sent", true)
        .is("deleted_at", null)
        .limit(1)
        .maybeSingle();
      hasPriorAutobotMessage = !!priorAutobot?.id;
      if (!hasPriorAutobotMessage) {
        console.log(`[meta-webhook] media-bypass SKIPPED for session=${session.id.slice(0,8)} — kein vorheriger Autobot-Kontakt (Erstantwort wäre aus dem Nichts). Mitarbeiterin soll manuell ran.`);
      }
    }
  }

  // Effektive Bedingung für Bypass-Feuer:
  //  - Audio/Video: braucht Rapport (vorheriger Autobot-Kontakt)
  //  - Einmal-Foto: feuert auch beim Erstkontakt (Zeit ist kritisch)
  const mediaBypassAllowed =
    noTextWithEphemeral ||
    ((noTextWithAudio || noTextWithVideo) && hasPriorAutobotMessage);

  if (
    (noTextWithAudio || noTextWithVideo || noTextWithEphemeral) &&
    !hasRecentTextContext &&
    mediaBypassAllowed &&
    (botMode === "auto" || botMode === "selective_auto") &&
    session.status === "active"
  ) {
    try {
      // Wartezeit-Wording je nach Geschäftszeit (importieren dynamisch um Cycle zu vermeiden)
      const { getBusinessHoursContext } = await import("@/lib/chatbot/business-hours");
      const biz = getBusinessHoursContext();
      const handoffTime = biz.status === "open_wide"
        ? "Sonst meldet sich gleich eine Kollegin bei dir"
        : biz.status === "open_closing_soon"
          ? `Sonst meldet sich noch heute oder spätestens ${biz.nextOpenLabel} eine Kollegin`
          : `Sonst meldet sich ${biz.nextOpenLabel} eine Kollegin bei dir`;

      let reply: string;
      let logType: string;
      if (noTextWithEphemeral) {
        // Einmal-Ansicht-Foto — wir können das Bild nicht sehen, weder Bot noch Stylistin
        reply = `Hallöchen Liebes 💕\n\nDein Foto wurde als Einmal-Ansicht geschickt — ich kann es leider nicht sehen 🥲 Und unsere Stylistin später auch nicht, weil das Bild nach dem Versand verschwindet.\n\nMagst du es einfach als ganz normales Foto noch mal schicken? Dann kann unsere Farb-Expertin es sich in Ruhe anschauen und dir eine passende Empfehlung geben ✨\n\n${handoffTime} 💌`;
        logType = "Einmal-Foto";
      } else {
        // Kürzere Audio/Video-Antwort (User-Anweisung 2026-05-28):
        // - "Bin nur ein süßer kleiner Bot…"-Teil raus (zu viel)
        // - "kann ich" → "können wir" (weniger Bot-Outing)
        // - "sofort" raus
        // - Kollegin-Zeile raus (greift sowieso nur wenn Rapport schon da ist)
        // Voraussetzung dafür ist der Rapport-Check oben — diese Antwort
        // kommt nur, wenn der Autobot in dieser Session schon mal aktiv war.
        const mediaWord = noTextWithAudio ? "Audios" : "Videos";
        reply = `Hallöchen 💕\n\n${mediaWord} können wir derzeit leider nicht abhören 🥲\n\nMagst du mir kurz aufschreiben worum's geht? Dann helfe ich dir weiter ✨`;
        // handoffTime intentionally not used hier — Rapport ist bereits da
        void handoffTime;
        logType = noTextWithAudio ? "Audio" : "Video";
      }

      const { data: inserted } = await svc.from("chat_messages").insert({
        session_id: session.id,
        role: "assistant",
        content: reply,
        auto_sent: true,
      }).select("id").single();

      // An den echten Channel zurücksenden
      if (opts.channel === "instagram" && opts.externalId) {
        const { sendInstagramMessage } = await import("@/lib/messaging/meta");
        const r = await sendInstagramMessage(opts.externalId, reply);
        if (r.success && r.message_id && inserted?.id) {
          await svc.from("chat_messages").update({ external_id: r.message_id }).eq("id", inserted.id);
        }
      } else if (opts.channel === "whatsapp" && opts.externalId) {
        const { sendWhatsAppMessage } = await import("@/lib/messaging/meta");
        const r = await sendWhatsAppMessage(opts.externalId, reply);
        if (r.success && r.message_id && inserted?.id) {
          await svc.from("chat_messages").update({ external_id: r.message_id }).eq("id", inserted.id);
        }
      }
      console.log(`[meta-webhook] ${logType}-Bypass-Antwort gesendet für session ${session.id}`);
      return;
    } catch (e) {
      console.error("[meta-webhook] Medien-Bypass fehlgeschlagen:", e);
      // Fall through: normales Bot-Handling
    }
  }

  // 💬 REACTION-ONLY-GUARD (User-Bug 2026-05-29: Kundin antwortet auf Story
  // nur mit "😍" → Bot generiert Standard-Intro "Wie kann ich dir helfen?
  // Suchst du Tapes …?" — total überflüssig, kostet Tokens, wirkt
  // gedankenlos). Wenn die Customer-Message NUR aus Emojis / Reaktions-
  // Zeichen besteht und kein Foto / Story-Mention / Video / Audio
  // mit-anhängt, dann gibt es nichts Sinnvolles zu beantworten — wir
  // skippen die Bot-Generierung komplett. Die MA sieht die Reaktion in
  // der Inbox und entscheidet selbst, ob es eine Antwort braucht.
  if (session.status === "active" && isReactionOnly(opts.text, opts.attachments || [])) {
    console.log(`[meta-webhook] REACTION-ONLY (text="${(opts.text || "").slice(0,20)}", atts=${(opts.attachments || []).map(a => a.type).join(",") || "none"}) — skip bot trigger for session=${session.id.slice(0,8)}`);
    return;
  }

  // ── AUTO-RESPOND-OVERRIDE für Standard-Eröffnungen ──
  // Standard-Muster (Begrüßung ohne Anliegen / Farbberatungs-Wunsch ohne Foto)
  // werden auto-beantwortet, EGAL was bot_mode oder Kill-Switch sagen.
  // Begründung: das sind günstige Template-artige Vorbereitungs-Antworten
  // (Foto-Bitte etc.), die der MA Zeit sparen, ohne reale Kosten zu generieren.
  // User-Anweisung 2026-05-27: "Autobot kann bei den besprochenen Themen
  // automatisch antworten — Farbberatung-Vorbereitung."
  let effectiveBotMode = botMode;
  let autoOverrideType: "intro" | "color_no_photo" | null = null;
  if (session.status === "active") {
    autoOverrideType = detectAutoRespondType(opts.text, opts.attachments || []);
    if (autoOverrideType) {
      effectiveBotMode = "auto";
      console.log(`[meta-webhook] auto-respond override (${autoOverrideType}) for session ${session.id} — bot_mode=${botMode}`);
    }
  }

  // 🛑 GRANULAR KILL-SWITCH (via lib/chatbot/settings.ts)
  // User-Anweisung 2026-05-26: Bot antwortet nur bei "ungefährlichen" Categories
  // automatisch. AUSNAHME 2026-05-27: autoOverrideType (intro / color_no_photo)
  // umgeht den Kill-Switch — das sind kontrollierte Vorbereitungs-Antworten
  // (Foto-Bitte etc.), die immer durchlaufen dürfen.
  // Manual-Trigger (Inbox "Antwort generieren") ist NICHT betroffen.
  if (!autoOverrideType) {
    const { isProactiveGenerationEnabled } = await import("@/lib/chatbot/settings");
    if (!(await isProactiveGenerationEnabled(sessionCategory))) {
      console.log(`[meta-webhook] PROACTIVE-DISABLED (category=${sessionCategory ?? "none"}) — skip bot session=${session.id.slice(0,8)}`);
      return;
    }
  } else {
    console.log(`[meta-webhook] kill-switch BYPASSED — autoOverrideType=${autoOverrideType} ist kontrollierte Vorbereitungs-Antwort`);
  }

  if ((effectiveBotMode === "auto" || effectiveBotMode === "assisted" || effectiveBotMode === "selective_auto") && session.status === "active") {
    try {
      // ── SMART DEBOUNCE ──
      // Wartezeit damit die Kundin Zeit hat mehrere Nachrichten zu schicken
      // bevor der Bot antwortet, und damit's nicht nach 0-Sekunden-Bot wirkt.
      // Bei jeder neuen Customer-Message wird der Timer resettet.
      //
      // ⚠️ WICHTIG — VERCEL FUNCTION TIMEOUT
      // Die Function läuft maxDuration Sekunden (siehe oben: 300s mit Pro).
      // Debounce muss sicher darunter bleiben + Buffer für Bot-Generation.
      // Konservativ: max 50s Debounce, sodass mind. 250s für Bot übrig bleiben.
      //
      // Adaptiv:
      //   - Default                            →  50s
      //   - Letzte Bot-Nachricht hatte 2+ Fragen
      //     (Kundin tippt evtl. lang)          →  50s (max)
      //   - Customer-Reply ist sehr kurz       →  20s (schnelle Antwort)
      const { data: lastBot } = await svc.from("chat_messages")
        .select("content, role").eq("session_id", session.id)
        .in("role", ["assistant", "human_agent"])
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(1).maybeSingle();
      const questionCount = (lastBot?.content || "").match(/\?/g)?.length || 0;
      const customerMsgShort = (opts.text || "").trim().length <= 30;
      // ECHTE Customer-Channels (Instagram/WhatsApp) brauchen großzügige Wartezeit:
      // Kundin tippt + lädt Foto hoch + überlegt → oft 2-4 Min Streckung.
      // Mit Latest-Wins-Guard kann der Debounce ruhig groß sein — wir antworten
      // erst wenn die Kundin WIRKLICH fertig ist (max-msg-Lücke = DEBOUNCE).
      //
      //   - Kurze msg (<=30 Zeichen, oft "ok", "ja", "?"): 60s reicht
      //   - Normal msg: 240s = 4 Minuten
      // (Vercel Function Limit 300s → noch genug Buffer für Bot-Generation.)
      const DEBOUNCE_MS = customerMsgShort ? 60_000 : 240_000;
      void questionCount; // bleibt vorgehalten falls wir später wieder differenzieren wollen
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
      // 🔒 LATEST-WINS GUARD: hat zwischen MEINER Customer-Message und JETZT
      // schon jemand (Bot/Team/parallel-Webhook) geantwortet?
      //   - Bot/Team-Message NACH myMsgTimestamp → ja → skip
      //
      // Verhindert den Spam-Loop bei mehreren Customer-Messages innerhalb
      // weniger Minuten (Customer tippt + lädt Foto hoch = 3 Webhooks):
      // nur EINE Antwort, egal wie viele Trigger.
      const { data: laterReply } = await svc
        .from("chat_messages")
        .select("id, role, created_at, auto_sent")
        .eq("session_id", session.id)
        .in("role", ["assistant", "human_agent"])
        .gt("created_at", myMsgTimestamp)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (laterReply) {
        console.log(`[meta-webhook] LATEST-WINS: ${laterReply.role}-reply (${laterReply.created_at}) bereits nach customer-msg (${myMsgTimestamp}) — skip`);
        return;
      }
      // Status hat sich geändert (z.B. Mitarbeiter hat übernommen)?
      const curMode = refreshed?.bot_mode || (refreshed?.bot_auto_reply ? "auto" : "off");
      // Bei Auto-Respond-Override darf curMode auch 'off' sein — wir antworten trotzdem.
      const effectiveCurMode = autoOverrideType && curMode === "off" ? "auto" : curMode;
      if (refreshed?.status !== "active" || (effectiveCurMode !== "auto" && effectiveCurMode !== "assisted" && effectiveCurMode !== "selective_auto")) {
        console.log(`[meta-webhook] debounce: session no longer active+bot, skipping`);
        return;
      }
      // Alles klar → Bot generiert (Auto-Respond-Override forciert curMode='auto')
      console.log(`[meta-webhook] DEBOUNCE PASSED session=${session.id.slice(0,8)} → trigger`);
      await triggerBotResponse(session.id, opts.channel, opts.externalId, effectiveCurMode, lastUserMsg?.id);
    } catch (e) {
      console.error(`[meta-webhook] bot reply EXCEPTION session=${session.id.slice(0,8)}:`, e);
    }
  } else {
    // Loggen warum NICHT getriggert wurde — wichtig für Reliability-Debugging
    const skipReason: string[] = [];
    if (effectiveBotMode === "off") skipReason.push(`mode=${botMode}(no autoOverride)`);
    if (session.status !== "active") skipReason.push(`status=${session.status}`);
    if (skipReason.length > 0) {
      console.log(`[meta-webhook] BOT SKIP session=${session.id.slice(0,8)} reason=${skipReason.join(",")}`);
    }
  }
}

/**
 * Erkennt Standard-Eröffnungs-Patterns die der Bot AUTOMATISCH beantworten kann,
 * auch wenn die Session auf bot_mode='off' steht. Spart der Mitarbeiterin
 * generische Antworten und bereitet die Konversation vor.
 */
/**
 * Erkennt rein reaktive Customer-Messages — nur Emojis, Reaktions-
 * Zeichen oder Mini-Bestätigungen ohne echten Inhalt. Beispiele:
 *   "😍"   "❤️"   "🥰🥰"   "👍"   "🔥"   "ok"   "okay"
 *
 * Wenn nur eines dieser Pattern UND kein Foto/Video/Audio/Story-Mention
 * im Anhang ist, gibt es nichts Sinnvolles zu beantworten. Story-Reply
 * mit nur Emoji zählt auch als reaktive Antwort — die Story ist der
 * Kontext-Trigger, aber es gibt keine Frage zu beantworten.
 *
 * NICHT als reaktiv zählen:
 *   - Texte mit Buchstaben/Ziffern jeglicher Sprache
 *   - Foto/Video/Audio im Anhang (das wird separat gehandhabt)
 *   - Story-Mention (das ist die Kundin, die unsere Story teilt — anders
 *     als ihre Reply darauf)
 */
function isReactionOnly(text: string, attachments: { type: string; url: string }[]): boolean {
  // Wenn ein Medien-Anhang da ist (Foto/Video/Audio/Story-Mention),
  // ist das KEINE pure-reaction — wird vom Audio/Video-Bypass-Code
  // weiter oben gehandhabt.
  const mediaAttachmentTypes = ["image", "video", "audio", "ephemeral", "story_mention"];
  if (attachments.some(a => mediaAttachmentTypes.includes(a.type))) return false;

  const raw = (text || "").trim();
  if (raw.length === 0) return true; // Reine Story-Reply ohne Text → reactive

  // Strip alle Emojis (umfassender Unicode-Range) und Sonderzeichen.
  // Wenn danach < 2 Buchstaben/Ziffern übrig sind, ist's reactive.
  const stripped = raw
    // Emoji-Ranges (Pictographic + Modifier + Skin-Tone + ZWJ)
    .replace(/\p{Extended_Pictographic}/gu, "")
    .replace(/\p{Emoji_Modifier_Base}/gu, "")
    .replace(/\p{Emoji_Modifier}/gu, "")
    .replace(/‍/g, "")
    .replace(/[☀-⟿]/g, "")
    .replace(/[︀-️]/g, "")
    // Häufige Sonderzeichen entfernen
    .replace(/[❣️♥♡✨⭐🌟💫💕💖💗💓💝💘♥️❤️]/g, "")
    .trim();

  // Auch reine Mini-Bestätigungen ohne Frage:
  const miniAcks = /^(ok|okay|okey|👌|jo|jep|aha|achso|achsoo+|ahso+|mhm|hm+|alles\s+klar|cool|gut|super|nice|toll|danke|danke!|dankee+|gerne|gern|jaja|jaaa+)\.?!?$/i;
  if (miniAcks.test(raw)) return true;

  // Nach Strip nur noch < 2 alphanumerische Zeichen → reactive
  const alphanumeric = stripped.replace(/[^\p{L}\p{N}]/gu, "");
  return alphanumeric.length < 2;
}

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

/**
 * Konservativer Confidence-Check für selective_auto-Modus.
 * Antwort wird NUR autonom gesendet wenn ALLE Kriterien erfüllt sind.
 * Lieber zu vorsichtig (Draft) als false-positive (autonom gesendet aber falsch).
 */
function isHighConfidence(category: string | null, botReply: string): boolean {
  // 1. Nur unkritische Kategorien dürfen autonom raus
  //    color_advice ist hier SONDERFALL: autonom NUR im Preflight-Modus
  //    (Foto-Briefing/Rückfragen sammeln), niemals bei konkreten Farbempfehlungen.
  // color_advice ist BEWUSST nicht in safeCategories: Farbberatung ist heikel
  // (subjektiv, Foto-Interpretation, Folge-Empfehlungen), kann schiefgehen.
  // → IMMER Draft, auch wenn der Bot nur Foto-Briefing macht. Die Stylistin
  // klickt 'Senden' in 5 Sekunden, das Risiko einer falschen autonomen
  // Farbempfehlung ist nicht wert.
  //
  // AUSNAHME 1a: Wenn Session-Kategorie 'color_advice' ist, aber die Antwort
  // klar um PACK-INHALT / VERFÜGBARKEIT / LAGER geht und KEINE konkrete
  // Farb-EMPFEHLUNG enthält → safe behandeln. Beispiel:
  // Kundin: "Wie viele Tapes pro Packung?" → Bot: "25 Strähnen, FAWN auf Lager"
  // Das ist Pack-Info + Lagerstand, keine Farbberatung. Session-Kategorie ist
  // nur "color_advice" weil früher über Farben gesprochen wurde (sticky).
  let effectiveCategory = category;
  if (category === "color_advice") {
    const hasPackOrStockClaim =
      /\b\d+\s*(strähnen?|packung(en)?|pakete?|paket\b)/i.test(botReply) ||
      /\b(auf lager|verfügbar|gerade unterwegs|nicht (mehr )?da|ausverkauft|wieder rein|hairvenly\.de\/products)\b/i.test(botReply);
    // "Echte" Farbempfehlung erkennen — wenn diese Phrasen drin sind, ist es
    // KEINE simple Verfügbarkeits-Antwort sondern aktive Beratung → bleibt Draft.
    // WICHTIG: NICHT zu breit fassen — "für dein Haar brauchst" ist KEIN Color-Advice,
    // sondern eine Pack-Mengen-Frage. Pattern muss color-spezifisch sein.
    const isActualColorAdvice =
      /\b(empfehle dir|empfehle ich|passt perfekt zu|würde gut zu dir|harmoniert mit|trifft deinen ton|für deinen ton|passend zu deinem ton|passend zu deiner)\b/i.test(botReply) ||
      /\b(deine haarfarbe|dein farbton|deinem farbton|dein ansatz|deinem ansatz|dein eigenes haar)\b/i.test(botReply) ||
      /\b(foto|bild)\b.{0,30}\b(schau|gucke|analysier|brauch|schick)/i.test(botReply) ||
      /\b(kühles?|warmes?|honig-?|aschiges?|goldenes?)\s+(blond|braun|mittelbraun|dunkelbraun|hellbraun)\b/i.test(botReply);
    if (hasPackOrStockClaim && !isActualColorAdvice) {
      effectiveCategory = "availability";
      console.log("[isHighConfidence] color_advice → availability override (Pack/Lager-Antwort ohne Farbempfehlung)");
    }
  }

  const safeCategories = new Set(["availability", "general", "pricing"]);
  if (!effectiveCategory || !safeCategories.has(effectiveCategory)) return false;
  // gewerbe explizit blacklisten — selbst wenn safeCategory (sollte nicht sein, defensive)
  if (effectiveCategory === "gewerbe") return false;

  // 2. Unsicherheits-Phrasen im Reply → NICHT autonom senden
  const uncertaintyPatterns = [
    /\bkläre? das (eben|gerade|kurz) (mit|ab)/i,
    /\bleider weiß ich (das )?nicht\b/i,
    /\blass uns das (im salon|persönlich)\b/i,
    /\b(eine )?kollegin (meldet|wird|schaut|kümmert)/i,
    /\bich (überprüfe|prüfe|checke|frage) das (kurz |eben |gerade )?(noch )?/i,
    /\bbin mir (nicht )?(ganz )?sicher\b/i,
    /\bda müsste ich (kurz |eben )?(rücksprache|nachfragen|abklären)/i,
    /\bmelde mich (gleich|später|kurz) wieder/i,
  ];
  if (uncertaintyPatterns.some(p => p.test(botReply))) return false;

  // 2b. PROAKTIVES Anbieten von extra Fotos/Videos der Tressen ist verboten.
  //     ABER: Reaktive Antworten ("klar, Kollegin schickt's sobald Montag wieder
  //     da") sind erlaubt — wir erkennen sie am Übergabe-Marker im selben Satz.
  //     Siehe FAQ color-advice-no-proactive-extra-photos.
  const forbiddenOffers = [
    /\b(extra |zusätzliche? )?(fotos? oder videos?|videos? oder fotos?|videos?)\b.{0,40}\b(machen|schicken|senden|aufnehmen|filmen)/i,
    /\bich (kann|könnte) dir (ein |noch ein )?(video|extra foto)\b/i,
    /\bwir filmen (dir |die )/i,
    /\b(wir|ich) (machen|mache) dir (extra |gerne extra )?(fotos|videos)\b/i,
  ];
  const reactiveHandoverMarker = /(kollegin|stylistin|farb-?expertin|im\s+salon|mo[\s-]?fr|montag|dienstag|mittwoch|donnerstag|freitag|sobald\s+wir\s+wieder|ab\s+\d{1,2}(:\d{2}|\s*uhr)|werktag)/i;
  if (forbiddenOffers.some(p => p.test(botReply)) && !reactiveHandoverMarker.test(botReply)) {
    return false;
  }

  // 2c. INVISIBLE TAPES sind ein heikles Thema (Launch August 2026, eigenständiges
  //     Produkt, NICHT Mini Tapes). Antworten dazu sollen IMMER von Stylistin
  //     gegengecheckt werden → kein autonomous send.
  if (/\binvisible[ -]?tape/i.test(botReply)) return false;

  // 3. (Früher gab es hier einen color_advice-Sonderpfad. Entfernt — color_advice
  //    ist nicht mehr in safeCategories und kommt deshalb nie hier an.
  //    Farbberatung läuft IMMER über Draft, weil sie zu fehleranfällig ist.)

  // 3b. KLÄRUNGS-ANTWORT: Rückfragen + harmlose Allgemeininfo ohne konkrete
  //     Produktaussage sind sicher autonom — Bot fragt was die Kundin braucht
  //     oder gibt sehr allgemeine Hinweise. Beispiele:
  //     - "Hi, hätte eine Frage" → "Klar, was möchtest du wissen?"
  //     - "Habt ihr was für Zopf?" → "Ja, mit Extensions geht Zopf —
  //        kurze Frage: hast du eher welliges oder glattes Haar?"
  //     Kriterien (auch bei längerer Antwort OK, solange keine Produkt-
  //     Behauptung getroffen wird):
  //     - < 1000 Zeichen
  //     - enthält Fragezeichen (= Bot fragt zurück)
  //     - Klärungs-Verben drin
  //     - KEINE Produkt-URL
  //     - KEINE Stock-Aussage
  //     - KEINE Maßangabe (60cm, 200g etc.)
  //     - KEINE konkrete Farb-Empfehlung (Farbnamen-Codes wie 6A, 3A,
  //       Cappuccino, Toffee, Dubai, Mocha, Pearl White, RAW, Honey etc.)
  //     - KEIN konkreter Preis (€-Angaben)
  // Preis-Check: nur SALON-DIENSTLEISTUNGS-Preise blocken.
  // - Produktpreise vom Shop (Tapes, Bondings etc.) sind OK — die Daten sind
  //   verifiziert in product_colors.
  // - Versandkosten / Bestellwert sind OK — reine Service-Infos.
  // - Heikel: Salon-Vor-Ort-Dienstleistungen (Einarbeiten, Termine, vor Ort
  //   Beratung). Da kann der Bot Fehler machen weil die Preise variabel sind.
  const hasEurAnywhere = /\b\d+[.,]?\d*\s*€/i.test(botReply);
  const isSalonServiceContext = /\b(einarbeit\w*|einset\w+|einleg\w+|einnäh\w+|einsetzen|im\s+salon\b|im\s+studio\b|vor\s+ort\b|salon-?termin|arbeitskosten|dienstleistung|service-?leistung|behandlung\w*|beratungs-?termin)\b/i.test(botReply);
  const hasSalonPriceClaim = hasEurAnywhere && isSalonServiceContext;

  const looksLikeClarifyingQuestion =
    botReply.length < 1000 &&
    /\?/.test(botReply) &&
    /\b(suchst|brauchst|möchtest|welche|welches|hast\s+du|magst\s+du|was\s+möchtest|wonach|worum|interessiert|hättest\s+du|trägst\s+du|hast\s+du\s+(von\s+natur\s+aus|natürlich))\b/i.test(botReply) &&
    !/hairvenly\.de\/products\//i.test(botReply) &&
    !/\b(auf\s+lager|sofort\s+verfügbar|ausverkauft|kommt\s+(am|ca|voraussichtlich)|wieder\s+rein|unterwegs)\b/i.test(botReply) &&
    !/\b\d+\s*(cm|g|gramm|gr)\b/i.test(botReply) &&
    // Bekannte Farbnamen / Farbcodes — sobald die im Bot-Reply auftauchen,
    // ist es keine reine Klärung mehr, sondern eine Empfehlung
    !/\b(cappuccino|toffee|dubai|mocha|pearl\s+white|raw|honey|ebony|caramel|cool\s+toned|warm\s+toned|taupe|chestnut|hazelnut|platin|blond|aschbraun|mittelbraun|rehbraun|balayage|cool\s+blonde)\b/i.test(botReply) &&
    !/\b#?\d+[A-Z]\b/.test(botReply) && // Farb-Codes wie 5A, 6A, 4/27T24
    !hasSalonPriceClaim; // nur Salon-Service-Preise blocken; Produktpreise + Versand OK
  if (looksLikeClarifyingQuestion) return true;

  // 4. availability / general / pricing: Reply muss konkrete Daten enthalten
  const hasUrl = /hairvenly\.de\/products\//i.test(botReply);
  const hasStockStatus = /(auf lager|sofort verfügbar|gerade unterwegs|ausverkauft|nicht (mehr|auf)? lager)/i.test(botReply);
  const hasSpecificAnswer = /\b(150g|200g|225g|125g|100g|60cm|65cm|55cm|45cm|85cm|5[-–]8\s*wochen|6[-–]8\s*wochen|6\s*monate)\b/i.test(botReply);
  if (!hasUrl && !hasStockStatus && !hasSpecificAnswer) return false;

  // 4b. SALON-DIENSTLEISTUNGSPREISE blocken — auch wenn andere konkrete
  //     Daten da sind. Bot soll bei Vor-Ort-Einarbeit-Preisen IMMER an
  //     Stylistin übergeben.
  if (hasSalonPriceClaim) return false;

  // 5. Reply darf nicht zu lang sein (komplexe Beratung ist meist >800 Zeichen)
  if (botReply.length > 1200) return false;

  return true;
}

// Bot-Antwort generieren + an Channel senden ODER als Entwurf speichern (assisted mode)
async function triggerBotResponse(
  sessionId: string,
  channel: string,
  externalId: string,
  mode: string,
  triggerMessageId?: string,
) {
  const triggerStart = Date.now();
  console.log(`[meta-webhook] TRIGGER START session=${sessionId.slice(0,8)} mode=${mode} channel=${channel}`);

  // 🚀 DETERMINISTIC FAST-PATH: Kontakt-Anfragen bekommen Template-Antwort
  // OHNE LLM. Verhindert Halluzinationen bei Adresse/Telefon/Öffnungszeiten,
  // spart Tokens, schneller Response. Werte kommen aus business-config.ts.
  try {
    const { detectContactIntent, renderContactResponse } = await import("@/lib/chatbot/intent-contact");
    const svcEarly = createServiceClient();
    const { data: lastUserMsg } = await svcEarly
      .from("chat_messages")
      .select("content")
      .eq("session_id", sessionId)
      .eq("role", "user")
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const contactIntent = detectContactIntent(lastUserMsg?.content || "");
    if (contactIntent) {
      const text = renderContactResponse(contactIntent);
      // Direkt als Bot-Message speichern + auto-senden (kein Anthropic-Call,
      // also auch kein Cost-Logging nötig). Nur wenn Modus auto/selective_auto.
      if (mode === "auto" || mode === "selective_auto") {
        const { data: ins } = await svcEarly.from("chat_messages").insert({
          session_id: sessionId,
          role:       "assistant",
          content:    text,
          auto_sent:  true,
        }).select("id").single();
        await svcEarly.from("chat_sessions")
          .update({ last_message_at: new Date().toISOString() })
          .eq("id", sessionId);
        console.log(`[meta-webhook] FAST-PATH contact-intent=${contactIntent} → autosent (0 tokens, 0ms LLM)`);
        // IG-Message senden
        if (channel === "instagram" && externalId) {
          const { sendInstagramMessage } = await import("@/lib/messaging/meta");
          const send = await sendInstagramMessage(externalId, text);
          if (send.success && send.message_id && ins?.id) {
            await svcEarly.from("chat_messages").update({ external_id: send.message_id }).eq("id", ins.id);
          }
        } else if (channel === "whatsapp" && externalId) {
          const { sendWhatsAppMessage } = await import("@/lib/messaging/meta");
          const send = await sendWhatsAppMessage(externalId, text);
          if (send.success && send.message_id && ins?.id) {
            await svcEarly.from("chat_messages").update({ external_id: send.message_id }).eq("id", ins.id);
          }
        }
        return;
      } else {
        // assisted-Mode: als Draft anlegen, Mitarbeiter:in approved
        await svcEarly.from("chat_drafts").insert({
          session_id:         sessionId,
          original_text:      text,
          trigger_message_id: triggerMessageId || null,
          status:             "pending",
        });
        console.log(`[meta-webhook] FAST-PATH contact-intent=${contactIntent} → draft (0 tokens)`);
        return;
      }
    }
  } catch (e) {
    // Fast-Path fehlgeschlagen → normaler LLM-Pfad. Niemals blocken.
    console.warn("[meta-webhook] contact-intent-bypass failed, falling back to LLM:", (e as Error).message);
  }

  const { respondAsBot } = await import("@/lib/chatbot/respond");
  // Für assisted UND selective_auto erstmal als assisted laufen lassen (also
  // KEIN auto-insert in chat_messages) — wir entscheiden danach was wir damit tun.
  const willDecideAfter = mode === "assisted" || mode === "selective_auto";

  // RETRY-LOGIK: respondAsBot kann durch transiente Fehler (Anthropic 5xx,
  // Sheet-Timeout, Race in Tool-Calls) fehlschlagen. 1× retry nach 5s.
  let result: Awaited<ReturnType<typeof respondAsBot>>;
  try {
    result = await respondAsBot(sessionId, { assisted: willDecideAfter });
    if (!result.success || !result.text) {
      console.warn(`[meta-webhook] TRIGGER FIRST-ATTEMPT failed session=${sessionId.slice(0,8)}: ${result.error}. Retrying in 5s...`);
      await new Promise(r => setTimeout(r, 5000));
      try {
        result = await respondAsBot(sessionId, { assisted: willDecideAfter });
      } catch (retryErr) {
        console.error(`[meta-webhook] TRIGGER RETRY threw session=${sessionId.slice(0,8)}:`, retryErr);
        return;
      }
    }
  } catch (e) {
    console.error(`[meta-webhook] TRIGGER FIRST-ATTEMPT threw session=${sessionId.slice(0,8)}:`, e);
    await new Promise(r => setTimeout(r, 5000));
    try {
      result = await respondAsBot(sessionId, { assisted: willDecideAfter });
    } catch (retryErr) {
      console.error(`[meta-webhook] TRIGGER RETRY threw session=${sessionId.slice(0,8)}:`, retryErr);
      return;
    }
  }

  if (!result.success || !result.text) {
    console.error(`[meta-webhook] TRIGGER FAILED (also retry) session=${sessionId.slice(0,8)} mode=${mode} elapsed=${Date.now() - triggerStart}ms error=${result.error}`);
    return;
  }

  // SELECTIVE_AUTO: Confidence-Check entscheidet ob senden oder Draft
  let finalMode = mode;
  if (mode === "selective_auto") {
    const svc = createServiceClient();
    const { data: sessForCheck } = await svc
      .from("chat_sessions")
      .select("category")
      .eq("id", sessionId)
      .maybeSingle();
    const confident = isHighConfidence(sessForCheck?.category || null, result.text);
    finalMode = confident ? "auto" : "assisted";
    console.log(`[meta-webhook] selective_auto → ${finalMode} (category=${sessForCheck?.category}, confident=${confident})`);
  }

  // WAITLIST-PROMISE-OHNE-TOOL-CALL → IMMER zu Draft umwandeln (auch wenn
  // mode=auto). Begründung: Bot hat Warteliste versprochen aber nicht
  // angelegt — autobot-send würde der Kundin eine leere Zusage geben.
  // Draft → MA sieht es, klickt manuell den Warteliste-Button im Header.
  if (result.needsManualReview) {
    console.warn(`[meta-webhook] FORCING-DRAFT session=${sessionId.slice(0,8)} — ${result.manualReviewReason}`);
    finalMode = "assisted";
  }

  if (finalMode === "assisted") {
    // Entwurf in chat_drafts speichern — NICHT senden
    const svc = createServiceClient();
    // 🛡 SAFETY: wenn der Webhook auto→assisted umgeschaltet hat (z.B. via
    // needsManualReview von respond.ts), wurde die Message evtl. SCHON in
    // chat_messages gespeichert (respond.ts speichert immer wenn !assisted).
    // Wir löschen sie jetzt soft (deleted_at setzen) — sonst hätte die Inbox
    // beide Einträge: scheinbar-gesendete Message + zusätzlicher Draft.
    if (result.insertedMessageId) {
      await svc
        .from("chat_messages")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", result.insertedMessageId);
      console.log(`[meta-webhook] soft-deleted respond-inserted message ${result.insertedMessageId} (force-draft)`);
    }
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

  // finalMode === "auto": Wenn selective_auto vorher confident war, müssen wir die
  // assistant-Message JETZT in chat_messages einfügen (war ja assisted-Run, also
  // hat respond.ts nichts gespeichert). Bei reinem "auto"-Mode ist sie schon drin.
  if (mode === "selective_auto" && finalMode === "auto") {
    const svc = createServiceClient();
    const { data: inserted } = await svc.from("chat_messages").insert({
      session_id:   sessionId,
      role:         "assistant",
      content:      result.text,
      tool_calls:   result.toolCalls && result.toolCalls.length > 0 ? result.toolCalls : null,
      tool_results: result.toolResults && result.toolResults.length > 0 ? result.toolResults : null,
      auto_sent:    true,
    }).select("id").single();
    result.insertedMessageId = inserted?.id;
    await svc.from("chat_sessions").update({ last_message_at: new Date().toISOString() }).eq("id", sessionId);
  } else if (mode === "auto") {
    // Bei reinem "auto" hat respond.ts schon gespeichert — wir markieren als auto_sent
    if (result.insertedMessageId) {
      const svc = createServiceClient();
      await svc.from("chat_messages").update({ auto_sent: true }).eq("id", result.insertedMessageId);
    }
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
  console.log(`[meta-webhook] TRIGGER DONE session=${sessionId.slice(0,8)} mode=${mode}→${finalMode} elapsed=${Date.now() - triggerStart}ms textLen=${result.text.length}`);
}
