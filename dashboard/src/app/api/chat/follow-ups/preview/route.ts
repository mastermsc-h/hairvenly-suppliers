/**
 * POST /api/chat/follow-ups/preview
 * Body: { sessionId }
 * Generiert eine personalisierte Follow-Up-Nachricht — speichert NICHTS in die DB.
 */
import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient, createServiceClient } from "@/lib/supabase/server";

async function requireAdmin() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await supabase
    .from("profiles").select("is_admin").eq("id", user.id).single();
  return profile?.is_admin ? user : null;
}

export async function POST(req: NextRequest) {
  if (!(await requireAdmin())) return NextResponse.json({ error: "auth" }, { status: 401 });
  const { sessionId } = await req.json();
  if (!sessionId) return NextResponse.json({ error: "sessionId required" }, { status: 400 });

  const svc = createServiceClient();
  const { data: session } = await svc
    .from("chat_sessions")
    .select("bot_signature_name")
    .eq("id", sessionId)
    .single();
  if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });

  const { data: msgs } = await svc
    .from("chat_messages")
    .select("role, content")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true })
    .limit(30);

  const transcript = (msgs || []).map(m =>
    `[${m.role === "user" ? "Kunde" : m.role === "assistant" ? "Bot" : "Team"}] ${m.content?.slice(0, 300) || ""}`,
  ).join("\n");

  const signatureName = session.bot_signature_name || "Lara";
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await anthropic.messages.create({
    model: "claude-haiku-4-5",
    max_tokens: 200,
    messages: [{ role: "user", content:
      `Du bist Stylistin ${signatureName} bei Hairvenly. Der Kunde hat sich seit 3+ Tagen nicht mehr gemeldet:\n\n${transcript}\n\n` +
      `Schreibe EINE kurze, persönliche Follow-Up-Nachricht (1-2 Sätze max), die freundlich nachhakt. ` +
      `Knüpfe an den letzten Stand an. Tonfall: warm, "Liebes", 🩷, locker. Nicht aufdringlich. KEINE Signatur. KEINE Begrüßung wie 'Hallo nochmal'.\n\n` +
      `Output: nur die Nachricht.`,
    }],
  });
  const text = response.content[0].type === "text" ? response.content[0].text : "";
  const cleaned = text.trim().replace(/\n*\/Ava von [^\n]+\s*$/i, "").trim();

  return NextResponse.json({ suggestion: cleaned, signatureName });
}
