/**
 * GET  /api/chat/follow-ups — listet Sessions die fällig sind für Nachhaken
 * POST /api/chat/follow-ups — sendet Follow-Ups für fällige Sessions (idempotent)
 *
 * Logik:
 * - Session-Status = 'active' (nicht awaiting_human, nicht closed)
 * - letzte Nachricht im Chat war von Bot/Mitarbeiter (Kunde hat nicht geantwortet)
 * - last_message_at < jetzt - DAYS_QUIET Tage
 * - follow_up_sent_at IS NULL (noch nicht nachgehakt)
 *
 * Wird einmalig pro Session nachgehakt. Falls Kunde nicht antwortet → no_response.
 */
import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createServiceClient, createClient } from "@/lib/supabase/server";

const DAYS_QUIET = 3;           // Nach wievielen Tagen Stille nachhaken
const NO_RESPONSE_AFTER = 3;    // Nach Follow-Up wievielen Tagen ohne Antwort als 'no_response' markieren

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles").select("is_admin").eq("id", user.id).single();
  return profile?.is_admin ? user : null;
}

async function findDueSessions() {
  const svc = createServiceClient();
  const cutoff = new Date(Date.now() - DAYS_QUIET * 86400 * 1000).toISOString();
  const { data } = await svc
    .from("chat_sessions")
    .select("id, channel, bot_signature_name, last_message_at, last_customer_msg_at, follow_up_sent_at, status")
    .eq("status", "active")
    .is("follow_up_sent_at", null)
    .lt("last_message_at", cutoff)
    .limit(50);
  // Zusätzlicher Filter: nur Sessions wo zuletzt Bot/Mitarbeiter geschrieben hat
  // (= Kunde hat nicht geantwortet auf unsere letzte Nachricht)
  const sessions = data || [];
  const eligible: typeof sessions = [];
  for (const s of sessions) {
    const { data: lastMsg } = await svc
      .from("chat_messages")
      .select("role")
      .eq("session_id", s.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    if (lastMsg && lastMsg.role !== "user") eligible.push(s);
  }
  return eligible;
}

async function generateFollowUp(sessionId: string, signatureName: string): Promise<string> {
  const svc = createServiceClient();
  const { data: msgs } = await svc
    .from("chat_messages")
    .select("role, content")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true })
    .limit(30);
  const transcript = (msgs || []).map(m =>
    `[${m.role === "user" ? "Kunde" : m.role === "assistant" ? "Bot" : "Team"}] ${m.content?.slice(0, 300) || ""}`,
  ).join("\n");

  const prompt = `Du bist eine warme, persönliche Stylistin bei Hairvenly. Du heißt ${signatureName}.

Der Kunde hat sich seit 3 Tagen nicht mehr gemeldet — der Chat war so:

${transcript}

Schreibe EINE kurze, persönliche Follow-Up-Nachricht (1-2 Sätze max), die freundlich nachhakt:
- Knüpfe an den letzten Stand an (kein generisches "Hallo wieder")
- Frage subtil nach (z.B. "Bist du noch interessiert?", "Hat sich das geklärt?", "Brauchst du noch Infos?")
- Hairvenly-Tonfall: Liebes, 🩷, locker
- KEINE Signatur — die wird automatisch nicht hinzugefügt
- Nicht aufdringlich!

Output: nur die Nachricht selbst, sonst nichts.`;

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 200,
    messages: [{ role: "user", content: prompt }],
  });
  const text = response.content[0].type === "text" ? response.content[0].text : "";
  return text.trim().replace(/\n*\/Ava von [^\n]+\s*$/i, "").trim();
}

export async function GET() {
  if (!(await requireAdmin())) return NextResponse.json({ error: "auth" }, { status: 401 });
  const due = await findDueSessions();
  return NextResponse.json({
    due_count: due.length,
    sessions: due.map(s => ({
      id: s.id,
      channel: s.channel,
      bot_signature_name: s.bot_signature_name,
      days_quiet: Math.floor((Date.now() - new Date(s.last_message_at).getTime()) / 86400000),
    })),
  });
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "auth" }, { status: 401 });
  const url = req.nextUrl;
  const limit = parseInt(url.searchParams.get("limit") || "10");

  const svc = createServiceClient();
  const due = await findDueSessions();
  const toProcess = due.slice(0, limit);

  const results: { sessionId: string; status: string; message?: string; error?: string }[] = [];

  for (const s of toProcess) {
    try {
      const followUp = await generateFollowUp(s.id, s.bot_signature_name || "Lara");
      if (!followUp) {
        results.push({ sessionId: s.id, status: "skipped", error: "empty follow-up" });
        continue;
      }
      // Nachricht in Chat einfügen (als assistant)
      await svc.from("chat_messages").insert({
        session_id: s.id,
        role: "assistant",
        content: followUp,
      });
      // Session updaten
      await svc.from("chat_sessions").update({
        follow_up_sent_at: new Date().toISOString(),
        follow_up_status:  "sent",
        follow_up_message: followUp,
        last_message_at:   new Date().toISOString(),
      }).eq("id", s.id);

      // TODO: hier echte Channel-API ansteuern (Web hat eh Polling)
      // - Instagram/WhatsApp: via 360dialog senden

      results.push({ sessionId: s.id, status: "sent", message: followUp });
    } catch (e) {
      results.push({ sessionId: s.id, status: "error", error: (e as Error).message });
    }
  }

  // Markiere alte Follow-Ups als 'no_response' wenn Kunde nicht reagiert hat
  const noRespCutoff = new Date(Date.now() - NO_RESPONSE_AFTER * 86400 * 1000).toISOString();
  const { data: stale } = await svc
    .from("chat_sessions")
    .select("id, follow_up_sent_at, last_customer_msg_at")
    .eq("follow_up_status", "sent")
    .lt("follow_up_sent_at", noRespCutoff);
  for (const s of stale || []) {
    if (!s.last_customer_msg_at || s.last_customer_msg_at < s.follow_up_sent_at) {
      await svc.from("chat_sessions")
        .update({ follow_up_status: "no_response", status: "closed" })
        .eq("id", s.id);
    } else {
      await svc.from("chat_sessions")
        .update({ follow_up_status: "responded" })
        .eq("id", s.id);
    }
  }

  return NextResponse.json({
    processed: results.length,
    results,
  });
}
