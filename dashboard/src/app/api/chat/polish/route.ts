/**
 * POST /api/chat/polish
 *
 * Nimmt einen MITARBEITER-Entwurf (mit eckigen Klammern als Anweisungen, z.B.
 * „... schau mal [füge hier den link ein]") und gibt eine polierte Version
 * zurück. Die KI:
 *  - korrigiert Grammatik/Tippfehler
 *  - führt die in eckigen Klammern stehenden Anweisungen aus
 *    (z.B. fügt Produkt-URL ein, wenn das gewünscht ist)
 *  - hat Zugriff auf die DB-Tools (get_stock_eta etc.) für faktenbasierte Daten
 *
 * Speichert NICHTS in die DB — nur Texttransformation. Mitarbeiter kann den
 * polierten Text dann editieren und absenden.
 *
 * Body: { sessionId, draftText }
 * Response: { polished: string, toolsUsed: string[] }
 */
import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { TOOLS, TOOL_SCHEMAS, type ToolContext } from "@/lib/chatbot/tools";

const MODEL = "claude-sonnet-4-5";
const MAX_ITER = 5;

export async function POST(req: NextRequest) {
  const { sessionId, draftText } = await req.json();
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }
  if (!draftText || typeof draftText !== "string" || draftText.trim().length === 0) {
    return NextResponse.json({ error: "draftText required" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "auth required" }, { status: 401 });

  const svc = createServiceClient();

  const { data: session } = await svc
    .from("chat_sessions").select("bot_signature_name").eq("id", sessionId).single();
  if (!session) return NextResponse.json({ error: "session not found" }, { status: 404 });

  const signatureName = session.bot_signature_name || "Lara";

  // System-Prompt für POLISH-Modus — bewusst minimal, kein Persona-Block.
  // Ziel: KI soll den TEXT der MA polieren, nicht ihre eigene Antwort schreiben.
  const systemPrompt = `Du bist ein Text-Polierer für eine Mitarbeiterin im Hairvenly-Salon.

Die Mitarbeiterin hat einen Entwurf für eine Kundinnen-Antwort geschrieben. Deine Aufgabe:

1. **Grammatik & Rechtschreibung** korrigieren (deutsch, freundlich, du-Anrede)
2. **Eckige Klammern [...] sind Anweisungen** — die du AUSFÜHREN sollst. Beispiele:
   - "[füge hier den link ein]" → schau über Tool get_stock_eta nach der passenden Shopify-URL und fügst sie an dieser Stelle ein
   - "[kürzer]" → den umliegenden Text knapper formulieren
   - "[passender Emoji]" → einen passenden Emoji einfügen
   - "[ETA]" → die nächste Lieferung via get_stock_eta nachschauen
3. **Tonalität bewahren** — wenn die MA freundlich/sachlich schreibt, bleibst du dabei. Keine Übersetzung in „Bot-Sprache". Kein „/Ava von ..."-Signatur. Keine Selbst-Vorstellung.
4. **KEINE neuen Themen oder Empfehlungen einbringen** — nur was die MA reingeschrieben hat. Wenn sie eine kurze Antwort will, bleibt es kurz.
5. **Wenn Tool-Lookup keine passenden Daten findet** (z.B. Produkt existiert nicht in der gewünschten Kombination): an dieser Stelle ehrlich schreiben „[keine passende URL gefunden — bitte selbst einfügen]" anstatt etwas zu erfinden.
6. **NIE Produkt-Kombinationen erfinden** die nicht aus dem Tool-Output kommen.

Antworte NUR mit dem polierten Text — keine Erklärung davor/danach, keine Markdown-Formatierung, keine Klammer-Kommentare am Ende.`;

  // Letzte 5 messages als Context für Tool-Lookups
  const { data: msgs } = await svc
    .from("chat_messages")
    .select("role, content")
    .eq("session_id", sessionId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(5);
  const recentContext = (msgs || [])
    .reverse()
    .map(m => `[${m.role}] ${m.content || ""}`)
    .join("\n");

  // Initiale Message: MA-Draft + Kontext
  const userMessage =
    `RECENT CHAT CONTEXT (für Tool-Lookups):\n${recentContext}\n\n` +
    `MA-ENTWURF (zu polieren):\n${draftText}\n\n` +
    `Liefere NUR den polierten Text zurück.`;

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const toolCtx: ToolContext = { sessionId, signatureName };
  const toolsUsed: string[] = [];
  let finalText = "";
  let convo: Anthropic.MessageParam[] = [{ role: "user", content: userMessage }];

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

  // Defensive cleanup: Signatur + Markdown raus
  finalText = finalText.replace(/\n*\/(Ava|Lara|Tipa|Thao)[^\n]*$/, "").trim();
  finalText = finalText.replace(/^[`*_~]+|[`*_~]+$/g, "").trim();

  return NextResponse.json({ polished: finalText, toolsUsed });
}
