/**
 * Auto-Konsolidierung: nach jeder neuen Mitarbeiter-Korrektur (Training-Insert)
 * prüft Haiku 4.5 ob die Korrektur einen statischen FAKT lehrt, der dauerhaft
 * in die Wissensdatenbank (chatbot_faq) gehört.
 *
 * Wenn ja: wird automatisch dort eingetragen — dann steht der Fakt in JEDER
 * zukünftigen Bot-Antwort im Prompt, unabhängig vom Trainings-Limit.
 *
 * Wenn nein: Training-Eintrag bleibt wie er ist, nichts passiert.
 *
 * Auch Strategie-Vorschläge gibt Haiku zurück — aber die werden NUR vorgeschlagen
 * (notes-Feld im FAQ-Insert), nicht automatisch in chatbot_strategies eingetragen.
 * Strategie-Anpassungen brauchen menschliches Review.
 */
import Anthropic from "@anthropic-ai/sdk";
import { createServiceClient } from "@/lib/supabase/server";

const MODEL = "claude-haiku-4-5";

const PROMPT = `Du analysierst eine Korrektur, die ein Mitarbeiter im Hairvenly-Chatbot vorgenommen hat. Entscheide ob das Wissen dauerhaft in die Wissensdatenbank (FAQ) gehört oder ob's nur ein einzelnes Trainings-Beispiel bleibt.

Ein STATISCHER FAKT erfüllt alle drei Kriterien:
• Aussage gilt IMMER (nicht situativ — z.B. "Tapes hochsetzen alle 5-8 Wochen" gilt immer; "diese Kundin bekommt Rabatt" ist situativ)
• Unabhängig vom Kunden-Kontext anwendbar
• Kurz und konkret formulierbar (Frage + Antwort in 1-3 Sätzen)

Beispiele:
✅ FAKT: "Wie oft müssen Tapes hochgesetzt werden?" → "Alle 5-8 Wochen, das ist normal."
✅ FAKT: "Welche Längen gibt es?" → "Usbekisch wellig: 45/55/65/85cm. Russisch glatt: 60cm."
❌ KEIN FAKT: "Antworte freundlicher bei genervten Kundinnen" — das ist Verhaltens-Strategie
❌ KEIN FAKT: "Erwähne BITTER CACAO als Alternative wenn Latte Brown ausverkauft" — situativ

OUTPUT (NUR JSON, keine Erklärung außenrum):

{
  "is_fact": true | false,
  "topic": "produkte" | "preise" | "pflege" | "termine" | "versand" | "zahlung" | "farbberatung" | "lager" | "reklamation" | "allgemein",
  "question": "kurze, generische Frage (nicht wörtlich aus dem Chat)",
  "answer": "knappe Faktantwort mit den korrekten Werten",
  "reason": "1 Satz: warum FAKT oder warum nicht"
}

KORREKTUR:
Kundin fragte: {{USER_MSG}}

Schlechte Antwort: {{BAD}}

Richtige Antwort: {{GOOD}}

Mitarbeiter-Feedback: {{FEEDBACK}}
`;

interface ConsolidationResult {
  is_fact: boolean;
  topic?: string;
  question?: string;
  answer?: string;
  reason?: string;
}

export async function consolidateCorrection(trainingId: string): Promise<void> {
  const svc = createServiceClient();
  const { data: t } = await svc
    .from("chatbot_training")
    .select("user_message, good_answer, bad_answer, feedback")
    .eq("id", trainingId)
    .maybeSingle();
  if (!t) return;

  const promptFilled = PROMPT
    .replace("{{USER_MSG}}", (t.user_message || "").slice(0, 400))
    .replace("{{BAD}}", (t.bad_answer || "(keine bad answer)").slice(0, 600))
    .replace("{{GOOD}}", (t.good_answer || "").slice(0, 600))
    .replace("{{FEEDBACK}}", (t.feedback || "(kein Feedback)").slice(0, 600));

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  let raw = "";
  try {
    const r = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 400,
      messages: [{ role: "user", content: promptFilled }],
    });
    raw = r.content[0].type === "text" ? r.content[0].text : "";
  } catch (e) {
    console.warn("[auto-consolidate] Haiku failed:", (e as Error).message);
    return;
  }

  let parsed: ConsolidationResult;
  try {
    raw = raw.trim();
    if (raw.startsWith("```")) {
      raw = raw.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
    }
    parsed = JSON.parse(raw);
  } catch {
    console.warn("[auto-consolidate] couldn't parse JSON:", raw.slice(0, 150));
    return;
  }

  if (!parsed.is_fact || !parsed.question || !parsed.answer) {
    console.log("[auto-consolidate] not a fact:", parsed.reason);
    return;
  }

  // Dedup: existiert schon eine sehr ähnliche FAQ-Frage?
  const { data: existing } = await svc
    .from("chatbot_faq")
    .select("id, question")
    .eq("active", true)
    .ilike("question", `%${parsed.question.slice(0, 30).split(" ").filter(w => w.length > 4)[0] || parsed.question.slice(0, 20)}%`)
    .limit(5);

  // Simple Dedup-Heuristik: gleiche 5+ Tokens am Anfang → schon vorhanden
  const tokensOfNew = parsed.question.toLowerCase().split(/\s+/).slice(0, 6).join(" ");
  if ((existing || []).some(e => e.question.toLowerCase().includes(tokensOfNew))) {
    console.log("[auto-consolidate] very similar FAQ already exists, skipping:", parsed.question.slice(0, 60));
    return;
  }

  const { error } = await svc.from("chatbot_faq").insert({
    slug: `auto-${Date.now()}`,
    topic: parsed.topic || "allgemein",
    question: parsed.question,
    answer: parsed.answer,
    notes: `Auto-konsolidiert aus Training ${trainingId}. Grund: ${parsed.reason || "n/a"}`,
    active: true,
    order_idx: 999, // ans Ende — Reihenfolge im Prompt egal
  });

  if (error) {
    console.warn("[auto-consolidate] FAQ insert failed:", error.message);
    return;
  }

  console.log(`[auto-consolidate] ✓ FAQ erstellt: "${parsed.question.slice(0, 60)}"`);
}
