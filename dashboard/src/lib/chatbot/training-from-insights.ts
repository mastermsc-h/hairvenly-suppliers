/**
 * Auto-Training-Feeder: zieht Muster aus chatbot_insights und generiert
 * globale Trainings-Einträge die der Bot dann automatisch befolgt.
 *
 * Strategie pro Blocker-Typ:
 *   1. Sammle gute Phrasen (good_phrases) aus KONVERTIERTEN Chats
 *   2. Sammle schlechte Phrasen (bad_phrases) aus Lost-Deals
 *   3. LLM destilliert daraus eine universelle Regel (good_answer + feedback)
 *   4. Speichert in chatbot_training mit avatar_name = NULL (global)
 */
import Anthropic from "@anthropic-ai/sdk";
import { createServiceClient } from "@/lib/supabase/server";

interface Pattern {
  blocker: string;
  cluster: string | null;
  good_phrases_sample: string[];
  bad_phrases_sample: string[];
  example_summaries: string[];
}

const BLOCKER_TARGETS = [
  "Bedenkzeit",
  "Lager-Problem",
  "Unklare Antwort",
  "Mitarbeiter deflectiert",
  "Foto-Hürde",
  "Preis-Schock",
] as const;

async function collectPatterns(): Promise<Pattern[]> {
  const svc = createServiceClient();
  const patterns: Pattern[] = [];

  for (const blocker of BLOCKER_TARGETS) {
    // Schlechte Beispiele: Lost Deals mit diesem Blocker
    const { data: bad } = await svc
      .from("chatbot_insights")
      .select("bad_phrases, summary, main_request")
      .eq("conversion_blocker", blocker)
      .eq("conversion", false)
      .gte("lost_deal_score", 5)
      .limit(20);

    // Gute Beispiele: konvertierte Chats aus dem gleichen Cluster
    const sampleSummaries = (bad || []).slice(0, 5).map(b => b.summary).filter(Boolean) as string[];
    const badPhrases = (bad || []).flatMap(b => (b.bad_phrases as string[] | null) || []).slice(0, 15);

    const { data: good } = await svc
      .from("chatbot_insights")
      .select("good_phrases, main_request, summary")
      .eq("conversion", true)
      .not("good_phrases", "is", null)
      .limit(30);
    const goodPhrases = (good || []).flatMap(g => (g.good_phrases as string[] | null) || []).slice(0, 20);

    patterns.push({
      blocker,
      cluster: null,
      good_phrases_sample: goodPhrases,
      bad_phrases_sample: badPhrases,
      example_summaries: sampleSummaries,
    });
  }

  return patterns;
}

const DISTILL_PROMPT = `Du bist ein Sales-Coach für einen Hairvenly-Chatbot. Aus echten Kundenservice-Gesprächen wurden Muster gesammelt.

Deine Aufgabe: Schreibe EINEN Trainings-Eintrag für den Bot, der ihn in Situationen mit diesem CONVERSION-BLOCKER besser machen lässt.

OUTPUT (gültiges JSON, sonst nichts):
{
  "user_message": "Typische Kunden-Nachricht die zu diesem Blocker führt (eine konkrete Beispiel-Frage)",
  "bad_answer": "Eine typische SCHLECHTE Antwort die zu Lost Deal führt (max 2 Sätze)",
  "good_answer": "Die ideale Antwort im Hairvenly-Stil (warm, Liebes, max 3 Sätze, KEINE Signatur, konkret, sales-orientiert ohne aufdringlich zu sein)",
  "feedback": "Klare Regel/Hinweis für den Bot — was er IMMER tun soll in dieser Situation (max 2 Sätze, imperativ)"
}

BLOCKER: `;

export async function generateTrainingFromInsights(): Promise<{
  patterns: number;
  inserted: number;
  preview: Array<{ blocker: string; user_message: string; good_answer: string }>;
}> {
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const svc = createServiceClient();

  const patterns = await collectPatterns();
  let inserted = 0;
  const preview: Array<{ blocker: string; user_message: string; good_answer: string }> = [];

  for (const p of patterns) {
    if (p.good_phrases_sample.length === 0 && p.bad_phrases_sample.length === 0) continue;

    const prompt = `${DISTILL_PROMPT}${p.blocker}

ECHTE SCHLECHTE FORMULIERUNGEN aus Lost-Deals (vermeiden!):
${p.bad_phrases_sample.slice(0, 8).map(s => `- "${s.slice(0, 200)}"`).join("\n")}

ECHTE GUTE FORMULIERUNGEN aus erfolgreichen Verkäufen:
${p.good_phrases_sample.slice(0, 8).map(s => `- "${s.slice(0, 200)}"`).join("\n")}

BEISPIEL-SZENARIEN aus echten Lost Deals:
${p.example_summaries.slice(0, 4).map((s, i) => `${i+1}. ${s}`).join("\n")}`;

    try {
      const response = await anthropic.messages.create({
        model: "claude-haiku-4-5",
        max_tokens: 800,
        messages: [{ role: "user", content: prompt }],
      });

      let raw = response.content[0].type === "text" ? response.content[0].text : "{}";
      raw = raw.trim();
      if (raw.startsWith("```")) {
        raw = raw.split("```")[1];
        if (raw.startsWith("json")) raw = raw.substring(4);
        raw = raw.trim();
      }

      const parsed = JSON.parse(raw);
      if (!parsed.good_answer || !parsed.user_message) continue;

      // Prüfen ob für diesen Blocker schon ein Auto-Eintrag existiert
      const { data: existing } = await svc
        .from("chatbot_training")
        .select("id")
        .eq("avatar_name", null)
        .ilike("feedback", `%${p.blocker}%`)
        .limit(1);

      if (existing && existing.length > 0) {
        // Update statt insert
        await svc.from("chatbot_training").update({
          user_message: parsed.user_message,
          bad_answer:   parsed.bad_answer || null,
          good_answer:  parsed.good_answer,
          feedback:     `[Auto-Training: Blocker "${p.blocker}"] ${parsed.feedback || ""}`,
          active:       true,
        }).eq("id", existing[0].id);
      } else {
        await svc.from("chatbot_training").insert({
          user_message: parsed.user_message,
          bad_answer:   parsed.bad_answer || null,
          good_answer:  parsed.good_answer,
          feedback:     `[Auto-Training: Blocker "${p.blocker}"] ${parsed.feedback || ""}`,
          avatar_name:  null,  // global
          active:       true,
          context_messages: [],
        });
      }

      inserted++;
      preview.push({
        blocker:      p.blocker,
        user_message: parsed.user_message,
        good_answer:  parsed.good_answer,
      });
    } catch (e) {
      console.error(`[training-from-insights] ${p.blocker} failed:`, e);
    }
  }

  return { patterns: patterns.length, inserted, preview };
}
