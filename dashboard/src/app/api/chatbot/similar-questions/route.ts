/**
 * POST /api/chatbot/similar-questions
 *
 * Findet zu einer NEUEN Kundenfrage sinngemäß ähnliche FRÜHERE Fragen+Antworten
 * aus dem Wissens-Archiv (chatbot_knowledge_archive_v2/v1 + aktive FAQs).
 *
 * Ansatz (kein Embedding/pgvector nötig):
 *   1) Stichwort-Vorfilter (ilike über question/answer) → bis zu ~40 Kandidaten
 *   2) Mini-LLM-Rerank (DeepSeek/Haiku) wählt die bis zu 5 sinngemäß ähnlichsten
 *
 * Nur Admin.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireProfile } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { miniMessagesCreate } from "@/lib/chatbot/mini-llm";

export const maxDuration = 30;

const STOP = new Set([
  "und","oder","wie","was","wann","wo","wer","der","die","das","den","dem","ich","ihr","ein","eine","einen",
  "mit","für","fuer","von","bei","auf","aus","kann","muss","ist","sind","auch","mal","gibt","habt","haben",
  "dann","schon","noch","aber","wenn","man","sich","mir","mich","euch","wollte","fragen","gerne","hallo",
  "danke","bitte","eigene","eigenes","eigenen","meine","meinen","eurem","euer","eure","sein","muss","möchte","moechte",
  "hey","hallöchen","halloechen","moin","servus","liebes","liebe","huhu","sorry","mal","gern","nochmal","überhaupt","ueberhaupt",
]);

function keywords(q: string): string[] {
  return Array.from(new Set((q.toLowerCase().match(/[a-zäöüß0-9]{3,}/gi) || []).filter((w) => !STOP.has(w)))).slice(0, 8);
}

interface Cand { question: string; answer: string; source: string; topic: string | null; score: number }

export async function POST(req: NextRequest) {
  const profile = await requireProfile();
  if (!profile.is_admin) return NextResponse.json({ error: "Admin only" }, { status: 403 });

  let body: { question?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 }); }
  const question = (body.question || "").trim();
  if (question.length < 4) return NextResponse.json({ error: "Frage zu kurz" }, { status: 400 });

  try {
    const svc = createServiceClient();
    const kws = keywords(question);
    const orFilter = kws.length ? kws.map((w) => `question.ilike.%${w}%,answer.ilike.%${w}%`).join(",") : "";

    const candMap = new Map<string, Cand>();
    const ingest = (rows: Record<string, unknown>[], source: string, defaultScore: number) => {
      for (const r of rows) {
        const q = r.question as string, a = r.answer as string;
        if (!q || !a) continue;
        const key = q.toLowerCase().trim().slice(0, 80);
        if (!candMap.has(key)) {
          candMap.set(key, { question: q, answer: a, source, topic: (r.topic as string) ?? null, score: Number(r.biz_score) || defaultScore });
        }
      }
    };
    const pull = async (table: "chatbot_knowledge_archive_v2" | "chatbot_knowledge_archive_v1", source: string) => {
      let qb = svc.from(table).select("question, answer, topic, biz_score").limit(30);
      if (orFilter) qb = qb.or(orFilter);
      const { data } = await qb;
      ingest((data || []) as unknown as Record<string, unknown>[], source, 0);
    };
    await pull("chatbot_knowledge_archive_v2", "Archiv v2");
    await pull("chatbot_knowledge_archive_v1", "Archiv v1");
    // Aktive FAQs ebenfalls (hohe Priorität)
    {
      let qb = svc.from("chatbot_faq").select("question, answer, topic").eq("active", true).limit(20);
      if (orFilter) qb = qb.or(orFilter);
      const { data } = await qb;
      ingest((data || []) as unknown as Record<string, unknown>[], "FAQ", 1000);
    }

    const candidates = Array.from(candMap.values()).sort((a, b) => b.score - a.score).slice(0, 40);
    if (candidates.length === 0) return NextResponse.json({ matches: [] });

    // LLM-Rerank: nur Indizes der ähnlichsten zurückgeben
    const list = candidates.map((c, i) => `[${i}] ${c.question}`).join("\n");
    const sys =
      "Du hilfst einer Salon-Mitarbeiterin, im Archiv ähnliche Kundenfragen zu finden. " +
      "Gegeben eine NEUE Kundenfrage und eine nummerierte Liste FRÜHERER Fragen — gib die Nummern der bis zu 5 " +
      "SINNGEMÄSS ähnlichsten zurück (gleiche Absicht/Thema, auch bei anderer Wortwahl). Die ähnlichste zuerst. " +
      "Wenn nichts wirklich passt, gib weniger oder ein leeres Array zurück. " +
      "Antworte AUSSCHLIESSLICH mit einem JSON-Array von Zahlen, z.B. [3,0,7] — kein weiterer Text.";
    const usr = `NEUE FRAGE:\n${question}\n\nFRÜHERE FRAGEN:\n${list}`;

    let idxs: number[] = [];
    try {
      const resp = await miniMessagesCreate(
        { max_tokens: 60, system: sys, messages: [{ role: "user", content: usr }], temperature: 0 },
        { purpose: "other" }
      );
      const txt = resp.content.filter((b) => b.type === "text").map((b) => b.text).join("").trim();
      const m = txt.match(/\[[\d,\s]*\]/);
      idxs = m ? (JSON.parse(m[0]) as number[]) : [];
    } catch {
      idxs = candidates.slice(0, 5).map((_, i) => i); // Fallback: Top-Keyword-Treffer
    }

    const matches = idxs
      .filter((i) => Number.isInteger(i) && i >= 0 && i < candidates.length)
      .slice(0, 5)
      .map((i) => candidates[i]);
    return NextResponse.json({ matches: matches.length ? matches : candidates.slice(0, 3) });
  } catch (e) {
    return NextResponse.json({ error: "Suche fehlgeschlagen", details: (e as Error).message }, { status: 500 });
  }
}
