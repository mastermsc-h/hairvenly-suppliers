/**
 * Refine-Loop für Bot-Begleitung: Mitarbeiter gibt Feedback in natürlicher
 * Sprache, Bot generiert die Antwort neu — basierend auf Verlauf + Feedback.
 */
import Anthropic from "@anthropic-ai/sdk";
import { createServiceClient } from "@/lib/supabase/server";

const MODEL = "claude-sonnet-4-5";

interface RefineResult {
  success: boolean;
  text?: string;
  error?: string;
}

export async function refineBotDraft(
  sessionId: string,
  currentDraftText: string,
  feedback: string,
): Promise<RefineResult> {
  if (!feedback?.trim()) return { success: false, error: "feedback leer" };

  const svc = createServiceClient();

  const { data: session } = await svc
    .from("chat_sessions")
    .select("id, bot_signature_name, channel")
    .eq("id", sessionId)
    .single();
  if (!session) return { success: false, error: "session not found" };
  const signatureName = session.bot_signature_name || "Lara";

  // Persona laden (gleiches Pattern wie respondAsBot)
  const { data: persona } = await svc
    .from("chatbot_persona").select("system_prompt")
    .eq("active", true).limit(1).single();
  if (!persona) return { success: false, error: "no persona" };

  const { data: avatars } = await svc.from("chatbot_avatars")
    .select("name, personality").eq("active", true);
  const avatarRow = (avatars || []).find(a => a.name === signatureName) || (avatars || [])[0];

  let systemPrompt = persona.system_prompt.replaceAll("{signature_name}", signatureName);
  if (avatarRow) {
    systemPrompt += `\n\n## DEINE PERSÖNLICHKEIT (als ${avatarRow.name})\n${avatarRow.personality}`;
  }

  // Refine-Spezifischer Zusatz
  systemPrompt += `

## REFINE-MODUS
Du hast bereits einen Antwort-Entwurf für die letzte Kundennachricht geschrieben.
Eine MITARBEITERIN hat dir Feedback gegeben, was du anders machen sollst.
Schreibe die Antwort komplett neu — unter Berücksichtigung dieses Feedbacks und des Gesprächsverlaufs.

WICHTIG:
- Antworte AUSSCHLIESSLICH mit der neuen Antwort an den Kunden (keine Meta-Kommentare wie "Hier ist die überarbeitete Version:")
- Behalte deine Tonalität und die Avatare-Persönlichkeit bei
- Nimm das Feedback ernst — die Mitarbeiterin kennt den Kontext besser
- Keine Tool-Calls, du hast die Daten schon aus dem ersten Versuch`;

  // Conversation laden
  const { data: msgsDesc } = await svc
    .from("chat_messages")
    .select("role, content, created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(30);
  const msgs = (msgsDesc || []).slice().reverse();

  const messages: Anthropic.MessageParam[] = [];
  for (const m of msgs) {
    if (m.role === "user") {
      messages.push({ role: "user", content: m.content || "" });
    } else if (m.role === "assistant" || m.role === "human_agent") {
      messages.push({ role: "assistant", content: m.content || "" });
    }
  }

  // Hänge den aktuellen Entwurf als letzten Bot-Turn an + Feedback als User-Turn
  messages.push({ role: "assistant", content: currentDraftText });
  messages.push({
    role: "user",
    content: `[FEEDBACK DER MITARBEITERIN — KEINE KUNDENNACHRICHT]\n${feedback.trim()}\n\nSchreibe deine vorherige Antwort an den Kunden unter Berücksichtigung dieses Feedbacks komplett neu. Antworte nur mit der neuen Kundenantwort.`,
  });

  try {
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const resp = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: systemPrompt,
      messages,
    });
    const textBlocks = resp.content.filter((b): b is Anthropic.TextBlock => b.type === "text");
    const newText = textBlocks.map(b => b.text).join("\n").trim();
    if (!newText) return { success: false, error: "leere Antwort" };
    return { success: true, text: newText };
  } catch (e) {
    return { success: false, error: (e as Error).message };
  }
}
