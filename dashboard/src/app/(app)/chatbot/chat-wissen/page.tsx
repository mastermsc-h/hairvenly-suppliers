import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { BookOpen, Sparkles, Tag } from "lucide-react";
import KnowledgeSearchBox from "./search-box";
import KnowledgeRow from "./knowledge-row";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ topic?: string; tag?: string; q?: string; source?: string }>;
}

const TOPIC_LABELS: Record<string, { label: string; emoji: string }> = {
  farbberatung: { label: "Farbberatung", emoji: "🎨" },
  preise:       { label: "Preise",       emoji: "💰" },
  produkte:     { label: "Produkte",     emoji: "📦" },
  reklamation:  { label: "Reklamation",  emoji: "⚠️" },
  termine:      { label: "Termine",      emoji: "📅" },
  modell:       { label: "Modell/Beratung", emoji: "🧑‍🎨" },
  anfaenger:    { label: "Anfänger-Fragen", emoji: "🌱" },
  pflege:       { label: "Pflege",       emoji: "🧴" },
  lager:        { label: "Lager",        emoji: "📊" },
  versand:      { label: "Versand",      emoji: "🚚" },
  zahlung:      { label: "Zahlung",      emoji: "💳" },
  gewerbe:      { label: "Gewerbe",      emoji: "💼" },
  kooperation:  { label: "Kooperation",  emoji: "🤝" },
  rabatt:       { label: "Rabatt",       emoji: "🎟" },
  sonstiges:    { label: "Sonstiges",    emoji: "💬" },
};

const METHOD_TAGS = ["tape", "bonding", "tressen", "genius", "weft", "invisible", "mini tapes", "clip-in", "ponytail", "russisch", "usbekisch", "65cm", "150g", "200g", "balayage", "farbmischung"];

interface RawV2 {
  id: string; topic: string; question: string; answer: string;
  facts: string[] | null; tags: string[] | null; biz_score: number | null; conversion: boolean;
  created_at: string;
}
interface RawV1 {
  id: string; topic: string; question: string; answer: string;
  methods: string[] | null; colors: string[] | null; lengths: string[] | null; grams: string[] | null;
  biz_score: number; conversion: boolean; created_at: string;
}

export interface KnowledgeEntry {
  id: string; topic: string; question: string; answer: string;
  tags: string[];
  facts: string[];
  biz_score: number;
  conversion: boolean;
  source: "v1" | "v2";
}

export default async function ChatWissenPage({ searchParams }: PageProps) {
  await requireProfile();
  const params = await searchParams;
  const topic = params.topic || "all";
  const tag   = params.tag   || "all";
  const q     = (params.q || "").trim();
  const source = params.source || "both";

  const svc = createServiceClient();

  // V2 query (destilliert, höhere Qualität)
  let v2q = svc.from("chatbot_knowledge_archive_v2").select("id, topic, question, answer, facts, tags, biz_score, conversion, created_at");
  if (topic !== "all") v2q = v2q.eq("topic", topic);
  if (tag !== "all")   v2q = v2q.contains("tags", [tag]);
  if (q) v2q = v2q.or(`question.ilike.%${q}%,answer.ilike.%${q}%`);
  const { data: v2Rows } = await v2q.order("biz_score", { ascending: false, nullsFirst: false }).limit(500);

  // V1 query (raw, höheres Volumen)
  let v1q = svc.from("chatbot_knowledge_archive_v1").select("id, topic, question, answer, methods, colors, lengths, grams, biz_score, conversion, created_at");
  if (topic !== "all") v1q = v1q.eq("topic", topic);
  if (tag !== "all")   v1q = v1q.contains("methods", [tag]);
  if (q) v1q = v1q.or(`question.ilike.%${q}%,answer.ilike.%${q}%`);
  const { data: v1Rows } = await v1q.order("biz_score", { ascending: false }).limit(500);

  const v2: KnowledgeEntry[] = ((v2Rows ?? []) as RawV2[]).map(r => ({
    id: r.id, topic: r.topic, question: r.question, answer: r.answer,
    tags: r.tags ?? [], facts: r.facts ?? [],
    biz_score: r.biz_score ?? 3, conversion: r.conversion, source: "v2",
  }));
  const v1: KnowledgeEntry[] = ((v1Rows ?? []) as RawV1[]).map(r => ({
    id: r.id, topic: r.topic, question: r.question, answer: r.answer,
    tags: [...(r.methods ?? []), ...(r.colors ?? []), ...(r.lengths ?? []), ...(r.grams ?? [])],
    facts: [],
    biz_score: r.biz_score, conversion: r.conversion, source: "v1",
  }));
  const entries =
    source === "v1" ? v1
    : source === "v2" ? v2
    : [...v2, ...v1];

  // Topic counts (unabhängig von Topic-Filter, aber abhängig von q+tag)
  const topicCounts: Record<string, number> = {};
  const allForCounts: KnowledgeEntry[] = [...v2, ...v1];
  for (const e of allForCounts) topicCounts[e.topic] = (topicCounts[e.topic] || 0) + 1;
  // Globale Counts (kein topic-Filter) zur Anzeige
  const { data: v2TopicsRaw } = await svc.from("chatbot_knowledge_archive_v2").select("topic");
  const { data: v1TopicsRaw } = await svc.from("chatbot_knowledge_archive_v1").select("topic");
  const globalTopics: Record<string, number> = {};
  for (const r of v2TopicsRaw || []) globalTopics[r.topic as string] = (globalTopics[r.topic as string] || 0) + 1;
  for (const r of v1TopicsRaw || []) globalTopics[r.topic as string] = (globalTopics[r.topic as string] || 0) + 1;

  function buildQs(patch: Record<string, string | null>): string {
    const next = new URLSearchParams();
    const final: Record<string, string> = { topic, tag, q, source };
    for (const [k, v] of Object.entries(patch)) {
      if (v === null) delete final[k];
      else final[k] = v;
    }
    for (const [k, v] of Object.entries(final)) {
      if (v && v !== "all" && !(k === "source" && v === "both")) next.set(k, v);
    }
    const qs = next.toString();
    return qs ? `?${qs}` : "";
  }

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="space-y-1">
        <div className="flex items-center gap-2">
          <BookOpen size={20} className="text-neutral-700" />
          <h1 className="text-xl font-semibold text-neutral-900">Chat-Wissen aus 3300 Verläufen</h1>
        </div>
        <p className="text-sm text-neutral-500">
          Destilliertes Q&A-Wissen unserer Mitarbeiter:innen aus echten Instagram-Chats — durchsuchbar nach Thema, Methode und Volltext. Diese Datenbank wird vom Bot aktuell <strong>nicht</strong> automatisch genutzt (noch ARCHIV-Status).
        </p>
      </div>

      {/* Test-Suche */}
      <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm space-y-2">
        <div className="flex items-center gap-2">
          <Sparkles size={14} className="text-purple-600" />
          <span className="text-sm font-medium text-neutral-900">Wissens-Test</span>
        </div>
        <p className="text-xs text-neutral-500">
          Tippe eine Kundinnen-Frage. Du siehst direkt die ähnlichsten Antworten aus dem Archiv.
        </p>
        <KnowledgeSearchBox defaultValue={q} />
      </div>

      {/* Source-Toggle */}
      <div className="flex items-center gap-2 text-xs">
        <span className="text-neutral-500">Quelle:</span>
        {[
          { k: "both", label: `Beide (${v1.length + v2.length})` },
          { k: "v2",   label: `Destilliert v2 (${v2.length})` },
          { k: "v1",   label: `Roh v1 (${v1.length})` },
        ].map(opt => (
          <Link
            key={opt.k}
            href={`/chatbot/chat-wissen${buildQs({ source: opt.k === "both" ? null : opt.k })}`}
            className={`px-2.5 py-1 rounded-full border ${
              source === opt.k
                ? "bg-neutral-900 text-white border-neutral-900"
                : "bg-white text-neutral-600 border-neutral-300 hover:bg-neutral-50"
            }`}
          >
            {opt.label}
          </Link>
        ))}
      </div>

      {/* Topic-Chips */}
      <div className="space-y-2">
        <div className="text-xs font-medium text-neutral-500 uppercase tracking-wide">Themen</div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/chatbot/chat-wissen${buildQs({ topic: null })}`}
            className={`text-xs px-3 py-1.5 rounded-full border ${
              topic === "all"
                ? "bg-neutral-900 text-white border-neutral-900"
                : "bg-white text-neutral-600 border-neutral-300 hover:bg-neutral-50"
            }`}
          >
            Alle Themen
          </Link>
          {Object.entries(TOPIC_LABELS).map(([key, meta]) => {
            const cnt = globalTopics[key] || 0;
            if (cnt === 0) return null;
            return (
              <Link
                key={key}
                href={`/chatbot/chat-wissen${buildQs({ topic: key })}`}
                className={`text-xs px-3 py-1.5 rounded-full border inline-flex items-center gap-1 ${
                  topic === key
                    ? "bg-neutral-900 text-white border-neutral-900"
                    : "bg-white text-neutral-600 border-neutral-300 hover:bg-neutral-50"
                }`}
              >
                <span>{meta.emoji}</span>
                {meta.label}
                <span className={topic === key ? "text-white/70" : "text-neutral-400"}>· {cnt}</span>
              </Link>
            );
          })}
        </div>
      </div>

      {/* Methoden/Tag-Chips */}
      <div className="space-y-2">
        <div className="text-xs font-medium text-neutral-500 uppercase tracking-wide">Methode / Tag</div>
        <div className="flex flex-wrap gap-2">
          <Link
            href={`/chatbot/chat-wissen${buildQs({ tag: null })}`}
            className={`text-xs px-3 py-1.5 rounded-full border inline-flex items-center gap-1 ${
              tag === "all"
                ? "bg-neutral-900 text-white border-neutral-900"
                : "bg-white text-neutral-600 border-neutral-300 hover:bg-neutral-50"
            }`}
          >
            <Tag size={10} /> Alle
          </Link>
          {METHOD_TAGS.map(m => (
            <Link
              key={m}
              href={`/chatbot/chat-wissen${buildQs({ tag: m })}`}
              className={`text-xs px-3 py-1.5 rounded-full border ${
                tag === m
                  ? "bg-purple-600 text-white border-purple-600"
                  : "bg-white text-neutral-600 border-neutral-300 hover:bg-neutral-50"
              }`}
            >
              {m}
            </Link>
          ))}
        </div>
      </div>

      {/* Ergebnis-Zähler */}
      <div className="text-sm text-neutral-500">
        {entries.length === 0
          ? "Keine Einträge passen zu deinem Filter."
          : <><strong className="text-neutral-900">{entries.length}</strong> Einträge gefunden</>}
        {q && <> für „<strong className="text-neutral-700">{q}</strong>"</>}
        {topic !== "all" && TOPIC_LABELS[topic] && <> · {TOPIC_LABELS[topic].emoji} {TOPIC_LABELS[topic].label}</>}
        {tag !== "all" && <> · Tag „<strong>{tag}</strong>"</>}
      </div>

      {/* Liste */}
      <div className="space-y-2">
        {entries.slice(0, 200).map(e => (
          <KnowledgeRow key={e.source + e.id} entry={e} />
        ))}
        {entries.length > 200 && (
          <div className="text-xs text-neutral-400 text-center py-2">
            … {entries.length - 200} weitere Einträge (Top 200 angezeigt — schränke per Filter weiter ein)
          </div>
        )}
      </div>
    </div>
  );
}
