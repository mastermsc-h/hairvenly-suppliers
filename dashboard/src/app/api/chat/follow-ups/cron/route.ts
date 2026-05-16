/**
 * GET /api/chat/follow-ups/cron
 *
 * Täglich um 10:00 UTC — sendet Follow-Ups an Kunden die seit ≥3 Tagen still sind.
 * Auth: Vercel setzt automatisch `Authorization: Bearer ${CRON_SECRET}`.
 */
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

const DAYS_QUIET = 3;
const NO_RESPONSE_AFTER = 3;

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

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 200,
    messages: [{ role: "user", content:
      `Du bist Stylistin ${signatureName} bei Hairvenly. Der Kunde hat sich seit 3+ Tagen nicht mehr gemeldet:\n\n${transcript}\n\n` +
      `Schreibe EINE kurze, persönliche Follow-Up-Nachricht (1-2 Sätze max), die freundlich nachhakt. ` +
      `Knüpfe an den letzten Stand an. Tonfall: warm, "Liebes", 🩷, locker. Nicht aufdringlich. KEINE Signatur.\n\n` +
      `Output: nur die Nachricht.`,
    }],
  });
  const text = response.content[0].type === "text" ? response.content[0].text : "";
  return text.trim().replace(/\n*\/Ava von [^\n]+\s*$/i, "").trim();
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const svc = createServiceClient();

  // 1. Fällige Follow-Ups senden
  const cutoff = new Date(Date.now() - DAYS_QUIET * 86400 * 1000).toISOString();
  const { data: due } = await svc
    .from("chat_sessions")
    .select("id, channel, bot_signature_name, last_message_at")
    .eq("status", "active")
    .is("follow_up_sent_at", null)
    .lt("last_message_at", cutoff)
    .limit(30);

  let sent = 0;
  for (const s of due || []) {
    try {
      // Nur senden wenn letzte Nachricht NICHT vom Kunden war
      const { data: lastMsg } = await svc
        .from("chat_messages")
        .select("role")
        .eq("session_id", s.id)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      if (!lastMsg || lastMsg.role === "user") continue;

      const text = await generateFollowUp(s.id, s.bot_signature_name || "Lara");
      if (!text) continue;
      await svc.from("chat_messages").insert({
        session_id: s.id, role: "assistant", content: text,
      });
      await svc.from("chat_sessions").update({
        follow_up_sent_at: new Date().toISOString(),
        follow_up_status:  "sent",
        follow_up_message: text,
        last_message_at:   new Date().toISOString(),
      }).eq("id", s.id);
      sent++;
    } catch (e) {
      console.error("[follow-ups cron]", s.id, e);
    }
  }

  // 2. Alte Follow-Ups die unbeantwortet sind → no_response
  const noRespCutoff = new Date(Date.now() - NO_RESPONSE_AFTER * 86400 * 1000).toISOString();
  const { data: stale } = await svc
    .from("chat_sessions")
    .select("id, follow_up_sent_at, last_customer_msg_at")
    .eq("follow_up_status", "sent")
    .lt("follow_up_sent_at", noRespCutoff);
  let closed = 0;
  for (const s of stale || []) {
    if (!s.last_customer_msg_at || s.last_customer_msg_at < s.follow_up_sent_at) {
      await svc.from("chat_sessions")
        .update({ follow_up_status: "no_response", status: "closed" })
        .eq("id", s.id);
      closed++;
    } else {
      await svc.from("chat_sessions").update({ follow_up_status: "responded" }).eq("id", s.id);
    }
  }

  return NextResponse.json({ sent, marked_no_response: closed, source: "cron" });
}
