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

  // q sanitisieren — PostgREST .or() bricht bei Komma/Klammer/Stern.
  // Wir entfernen alles außer Buchstaben/Zahlen/Umlaute/Space und schneiden
  // auf einzelne Wörter. Multi-Wort-Queries werden zu AND-verkettetem ilike,
  // damit "tressen breite" auch Antworten mit beiden Wörtern in beliebiger
  // Reihenfolge findet (vorher: phrasen-Suche → 0 Hits bei Wortdrehung).
  const sanitizedQ = q.replace(/[^a-zA-Z0-9äöüÄÖÜß\s]/g, " ").replace(/\s+/g, " ").trim();
  const qTerms = sanitizedQ
    ? sanitizedQ.split(/\s+/).filter(t => t.length >= 2).slice(0, 5)
    : [];

  // ── VOLLTEXT-CHAT-SUCHE ─────────────────────────────────────────
  // User-Befund 2026-05-30: Destillierte Archives (533+148 Q&A) decken
  // nicht das ganze Wissen ab. Echte Customer-Themen wie "Microring",
  // "Butterfly Tressen", "Silikon-Microringe" tauchen in 2739 rohen
  // chat_messages auf, sind aber im destillierten Archiv NICHT
  // enthalten.
  //
  // UX-Trick: COUNT immer laden wenn q gesetzt (billig via head:true),
  // damit der Source-Toggle echte Treffer-Zahlen zeigt. Volle Liste
  // nur bei source=chats laden (teurer, aber selten).
  type ChatHit = {
    session_id: string;
    role: string;
    content: string;
    created_at: string;
  };
  let chatHits: ChatHit[] = [];
  let chatHitCount = 0;
  let chatSessionCount = 0;
  if (qTerms.length > 0) {
    // 1. Cheap count query: läuft IMMER bei aktiver Suche
    let countQ = svc.from("chat_messages")
      .select("*", { count: "exact", head: true })
      .is("deleted_at", null);
    for (const t of qTerms) countQ = countQ.ilike("content", `%${t}%`);
    const { count } = await countQ;
    chatHitCount = count || 0;
    // 2. Volle Liste nur bei source=chats
    if (source === "chats") {
      let cq = svc.from("chat_messages")
        .select("session_id, role, content, created_at")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(400);
      for (const t of qTerms) cq = cq.ilike("content", `%${t}%`);
      const { data } = await cq;
      chatHits = (data || []) as ChatHit[];
      chatSessionCount = new Set(chatHits.map(h => h.session_id)).size;
    }
  }

  // V2 query (destilliert, höhere Qualität)
  let v2q = svc.from("chatbot_knowledge_archive_v2").select("id, topic, question, answer, facts, tags, biz_score, conversion, created_at");
  if (topic !== "all") v2q = v2q.eq("topic", topic);
  if (tag !== "all")   v2q = v2q.contains("tags", [tag]);
  // Pro Term: muss in question ODER answer vorkommen (AND zwischen Terms,
  // OR zwischen Spalten). PostgREST: kette .or() pro Term mit AND-Semantik.
  for (const t of qTerms) {
    v2q = v2q.or(`question.ilike.%${t}%,answer.ilike.%${t}%`);
  }
  const { data: v2Rows } = await v2q.order("biz_score", { ascending: false, nullsFirst: false }).limit(500);

  // V1 query (raw, höheres Volumen)
  let v1q = svc.from("chatbot_knowledge_archive_v1").select("id, topic, question, answer, methods, colors, lengths, grams, biz_score, conversion, created_at");
  if (topic !== "all") v1q = v1q.eq("topic", topic);
  if (tag !== "all")   v1q = v1q.contains("methods", [tag]);
  for (const t of qTerms) {
    v1q = v1q.or(`question.ilike.%${t}%,answer.ilike.%${t}%`);
  }
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
      <div className="flex items-center gap-2 text-xs flex-wrap">
        <span className="text-neutral-500">Quelle:</span>
        {[
          { k: "both",  label: `Beide Archive (${v1.length + v2.length})` },
          { k: "v2",    label: `Destilliert v2 (${v2.length})` },
          { k: "v1",    label: `Roh v1 (${v1.length})` },
          { k: "chats", label: `Volltext-Chats${q ? ` (${chatHitCount} Msg)` : ""}` },
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

      {source === "chats" && !q && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Tippe oben ein Suchwort — Volltext-Chats werden nur bei aktiver Suche durchsucht (sonst 2739 Nachrichten = zu viel).
        </div>
      )}

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

      {/* Cross-Source-Hint: Archives leer aber Volltext-Chats hat Treffer */}
      {q && source !== "chats" && entries.length === 0 && chatHitCount > 0 && (
        <div className="rounded-2xl border-2 border-purple-300 bg-purple-50 p-4">
          <div className="text-sm font-semibold text-purple-900 mb-1">
            💡 Im Archiv keine Treffer — aber {chatHitCount} Treffer in echten Chats
          </div>
          <div className="text-xs text-purple-800 mb-3 leading-relaxed">
            „{q}" wurde von den Mitarbeiter:innen in der Vergangenheit besprochen, aber nicht als FAQ destilliert.
            Schau dir die echten Customer-Konversationen an um zu sehen wie das Team das Thema beantwortet hat.
          </div>
          <Link
            href={`/chatbot/chat-wissen${buildQs({ source: "chats" })}`}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-purple-600 text-white text-xs font-medium hover:bg-purple-700"
          >
            Volltext-Chats durchsuchen →
          </Link>
        </div>
      )}

      {/* Liste — Archive-Quellen */}
      {source !== "chats" && (
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
      )}

      {/* Liste — Volltext-Chat-Treffer */}
      {source === "chats" && q && (
        <div className="space-y-2">
          <div className="text-sm text-neutral-500">
            <strong className="text-neutral-900">{chatHits.length}</strong> Nachrichten in{" "}
            <strong className="text-neutral-900">{chatSessionCount}</strong> Sessions
            {chatHits.length === 400 && " (Limit erreicht — schränke Suche enger ein)"}
          </div>
          {chatSessionCount === 0 && (
            <div className="rounded-2xl border border-neutral-200 bg-white p-4 text-sm text-neutral-500">
              Keine Treffer im Chat-Volltext für „{q}".
            </div>
          )}
          {(() => {
            const bySession = new Map<string, ChatHit[]>();
            for (const h of chatHits) {
              if (!bySession.has(h.session_id)) bySession.set(h.session_id, []);
              bySession.get(h.session_id)!.push(h);
            }
            const sessions = Array.from(bySession.entries()).slice(0, 40);
            return sessions.map(([sid, hits]) => {
              const sorted = hits.slice().sort((a, b) => a.created_at.localeCompare(b.created_at));
              return (
                <div key={sid} className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
                  <div className="flex items-center justify-between mb-2">
                    <div className="text-xs font-mono text-neutral-500">Session {sid.slice(0, 8)}…</div>
                    <Link
                      href={`/chatbot/inbox/${sid}`}
                      className="text-xs px-2 py-1 rounded-md border border-neutral-300 hover:bg-neutral-50"
                    >
                      Verlauf öffnen →
                    </Link>
                  </div>
                  <div className="space-y-1.5">
                    {sorted.slice(0, 5).map((h, i) => {
                      const lower = h.content.toLowerCase();
                      // Snippet um ersten matching term ±100 Zeichen
                      const firstTerm = qTerms.find(t => lower.includes(t.toLowerCase()));
                      let snippet = h.content;
                      if (firstTerm) {
                        const idx = lower.indexOf(firstTerm.toLowerCase());
                        const start = Math.max(0, idx - 100);
                        const end = Math.min(h.content.length, idx + firstTerm.length + 200);
                        snippet = (start > 0 ? "…" : "") + h.content.slice(start, end) + (end < h.content.length ? "…" : "");
                      } else if (snippet.length > 300) {
                        snippet = snippet.slice(0, 300) + "…";
                      }
                      // Hervorhebung der Terms (simpel: nur erster Term, reicht für UX)
                      let highlighted: React.ReactNode = snippet;
                      if (firstTerm) {
                        const re = new RegExp(`(${firstTerm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi");
                        const parts: string[] = snippet.split(re);
                        highlighted = parts.map((p: string, j: number) =>
                          p.toLowerCase() === firstTerm.toLowerCase()
                            ? <mark key={j} className="bg-yellow-200 px-0.5 rounded">{p}</mark>
                            : <span key={j}>{p}</span>
                        );
                      }
                      const roleBadge =
                        h.role === "user" ? { label: "Kundin", cls: "bg-neutral-100 text-neutral-700" } :
                        h.role === "assistant" ? { label: "Bot", cls: "bg-pink-100 text-pink-800" } :
                        h.role === "human_agent" ? { label: "MA", cls: "bg-purple-100 text-purple-800" } :
                        { label: h.role, cls: "bg-neutral-100 text-neutral-600" };
                      return (
                        <div key={i} className="text-sm text-neutral-700 leading-relaxed flex gap-2">
                          <span className={`shrink-0 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded-md ${roleBadge.cls}`}>
                            {roleBadge.label}
                          </span>
                          <div>
                            <span className="text-xs text-neutral-400 mr-2">{new Date(h.created_at).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" })}</span>
                            {highlighted}
                          </div>
                        </div>
                      );
                    })}
                    {hits.length > 5 && (
                      <div className="text-xs text-neutral-400">+ {hits.length - 5} weitere Treffer in dieser Session</div>
                    )}
                  </div>
                </div>
              );
            });
          })()}
          {chatSessionCount > 40 && (
            <div className="text-xs text-neutral-400 text-center py-2">
              … {chatSessionCount - 40} weitere Sessions (Top 40 angezeigt)
            </div>
          )}
        </div>
      )}
    </div>
  );
}
