/**
 * POST /api/chat/suggest
 *
 * Generiert einen Antwort-Vorschlag für die Mitarbeiterin — basierend auf dem
 * aktuellen Session-Verlauf. Speichert NICHTS in die DB. Mitarbeiter kann den
 * Vorschlag dann editieren und ggf. abschicken.
 *
 * Body: { sessionId }
 * Response: { suggestion: string, toolsUsed: string[] }
 */
import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { TOOLS, TOOL_SCHEMAS, type ToolContext } from "@/lib/chatbot/tools";

const MODEL = "claude-sonnet-4-5";
const MAX_ITER = 5;

export async function POST(req: NextRequest) {
  const { sessionId } = await req.json();
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth required" }, { status: 401 });

  const svc = createServiceClient();

  // Lade Session + Persona + Avatar
  const { data: session } = await svc
    .from("chat_sessions").select("bot_signature_name").eq("id", sessionId).single();
  if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });

  const signatureName = session.bot_signature_name || "Lara";

  const { data: persona } = await svc
    .from("chatbot_persona").select("system_prompt").eq("active", true).limit(1).single();
  if (!persona) return NextResponse.json({ error: "no persona" }, { status: 500 });

  const { data: avatars } = await svc
    .from("chatbot_avatars").select("name, personality").eq("active", true);
  const avatarRow = (avatars || []).find(a => a.name === signatureName) || (avatars || [])[0];

  // System-Prompt zusammenbauen
  let systemPrompt = persona.system_prompt.replaceAll("{signature_name}", signatureName);
  if (avatarRow) {
    systemPrompt += `\n\n## DEINE PERSÖNLICHKEIT (als ${avatarRow.name})\n${avatarRow.personality}`;
  }
  systemPrompt += `\n\n## VORSCHLAG-MODUS
Du generierst gerade einen ANTWORT-VORSCHLAG für eine Mitarbeiterin (nicht direkt für den Kunden).
Die Mitarbeiterin liest deinen Vorschlag und entscheidet ob sie ihn so übernimmt, editiert oder verwirft.

REGELN für den Vorschlag:
- Knackig und konkret — Mitarbeiterin will schnell ein gutes Gerüst, kein Roman
- KEINE Signatur (/Ava von ...) — die Mitarbeiterin antwortet als sie selbst
- KEINE Begrüßung wenn das Gespräch schon im Gange ist
- Direkt mit der Antwort starten`;

  // Trainings-Beispiele anhängen
  const { data: training } = await svc
    .from("chatbot_training")
    .select("user_message, good_answer, bad_answer, feedback, avatar_name")
    .eq("active", true)
    .or(`avatar_name.is.null,avatar_name.eq.${signatureName}`)
    .order("created_at", { ascending: false })
    .limit(15);
  if (training && training.length > 0) {
    systemPrompt += "\n\n## TRAININGS-BEISPIELE\n";
    for (let i = 0; i < training.length; i++) {
      const t = training[i];
      systemPrompt += `### Beispiel ${i + 1}\nKunde: ${t.user_message}\nGute Antwort: ${t.good_answer}\n`;
      if (t.feedback) systemPrompt += `Hinweis: ${t.feedback}\n`;
      systemPrompt += "\n";
    }
  }

  // History laden (alle Nachrichten — User, Bot, Human-Agent)
  const { data: msgs } = await svc
    .from("chat_messages")
    .select("role, content, tool_calls, tool_results")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  const messages: Anthropic.MessageParam[] = [];
  for (const m of msgs || []) {
    if (m.role === "user") {
      messages.push({ role: "user", content: m.content || "" });
    } else if (m.role === "assistant") {
      const blocks: Anthropic.ContentBlockParam[] = [];
      if (m.content) blocks.push({ type: "text", text: m.content });
      const tc = (m.tool_calls as { id: string; name: string; input: Record<string, unknown> }[] | null) || [];
      for (const t of tc) blocks.push({ type: "tool_use", id: t.id, name: t.name, input: t.input });
      if (blocks.length > 0) messages.push({ role: "assistant", content: blocks });
      const tr = (m.tool_results as { tool_use_id: string; content: string }[] | null) || [];
      if (tr.length > 0) {
        messages.push({
          role: "user",
          content: tr.map(r => ({ type: "tool_result" as const, tool_use_id: r.tool_use_id, content: r.content })),
        });
      }
    } else if (m.role === "human_agent") {
      messages.push({ role: "assistant", content: m.content || "" });
    }
  }

  if (messages.length === 0) {
    return NextResponse.json({ error: "no messages in session" }, { status: 400 });
  }

  // Claude aufrufen (Tool-Loop wie /api/chat, aber ohne DB-Saves)
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const toolCtx: ToolContext = { sessionId, signatureName };
  const toolsUsed: string[] = [];
  let finalText = "";
  let convo = messages;

  for (let iter = 0; iter < MAX_ITER; iter++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      tools: TOOL_SCHEMAS,
      messages: convo,
    });

    const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === "text");
    const toolBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");

    finalText = textBlocks.map(b => b.text).join("\n").trim();

    if (toolBlocks.length === 0 || response.stop_reason === "end_turn") break;

    const results: Anthropic.ContentBlockParam[] = [];
    for (const tb of toolBlocks) {
      const tool = TOOLS[tb.name];
      let output = "";
      if (tool) {
        try {
          const r = await tool.execute(tb.input as Record<string, unknown>, toolCtx);
          output = r.output;
        } catch (e) { output = `Tool-Fehler: ${(e as Error).message}`; }
      }
      toolsUsed.push(tb.name);
      results.push({ type: "tool_result", tool_use_id: tb.id, content: output });
    }
    convo = [
      ...convo,
      { role: "assistant", content: response.content as Anthropic.ContentBlockParam[] },
      { role: "user", content: results },
    ];
  }

  // Signatur entfernen falls Bot trotzdem eingefügt hat
  finalText = finalText.replace(/\n*\/Ava von [^\n]+\s*$/, "").trim();

  return NextResponse.json({ suggestion: finalText, toolsUsed });
}
