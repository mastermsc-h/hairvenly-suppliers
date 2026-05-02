import { Suspense } from "react";
import { getChatbotEntries, getChatbotStats } from "@/lib/actions/chatbot";
import { requireProfile } from "@/lib/auth";
import KnowledgeTable from "./knowledge-table";
import KnowledgeFilters from "./knowledge-filters";
import { Bot, MessageSquare, Zap } from "lucide-react";

interface PageProps {
  searchParams: Promise<{ topic?: string; q?: string; active?: string }>;
}

export default async function ChatbotPage({ searchParams }: PageProps) {
  await requireProfile();
  const params = await searchParams;

  const [entries, stats] = await Promise.all([
    getChatbotEntries({
      topic:      params.topic || undefined,
      search:     params.q || undefined,
      activeOnly: params.active === "1",
    }),
    getChatbotStats(),
  ]);

  const totalActive   = stats.reduce((s, t) => s + t.active, 0);
  const totalEntries  = stats.reduce((s, t) => s + t.count, 0);
  const topicCount    = stats.length;

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <Bot size={20} className="text-neutral-700" />
            <h1 className="text-xl font-semibold text-neutral-900">
              Chatbot Wissensdatenbank
            </h1>
          </div>
          <p className="text-sm text-neutral-500">
            Q&amp;A-Paare aus echten Kundengesprächen · Grundlage für den KI-Chatbot
          </p>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <MessageSquare size={14} className="text-neutral-400" />
            <span className="text-xs font-medium text-neutral-500 uppercase tracking-wide">Einträge gesamt</span>
          </div>
          <div className="text-2xl font-bold text-neutral-900">{totalEntries}</div>
          <div className="text-xs text-neutral-400 mt-0.5">{totalActive} aktiv</div>
        </div>
        <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <Zap size={14} className="text-neutral-400" />
            <span className="text-xs font-medium text-neutral-500 uppercase tracking-wide">Themen</span>
          </div>
          <div className="text-2xl font-bold text-neutral-900">{topicCount}</div>
          <div className="text-xs text-neutral-400 mt-0.5">Kategorien abgedeckt</div>
        </div>
        <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-1">
            <Bot size={14} className="text-neutral-400" />
            <span className="text-xs font-medium text-neutral-500 uppercase tracking-wide">Aktiv-Rate</span>
          </div>
          <div className="text-2xl font-bold text-neutral-900">
            {totalEntries > 0 ? Math.round((totalActive / totalEntries) * 100) : 0}%
          </div>
          <div className="text-xs text-neutral-400 mt-0.5">für Bot freigegeben</div>
        </div>
      </div>

      {/* Topic breakdown */}
      <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
        <h2 className="text-xs font-medium text-neutral-500 uppercase tracking-wide mb-3">
          Einträge pro Thema
        </h2>
        <div className="flex flex-wrap gap-2">
          {stats.map(({ topic, count, active }) => (
            <div
              key={topic}
              className="flex items-center gap-1.5 bg-neutral-50 border border-neutral-200 rounded-lg px-3 py-1.5 text-xs"
            >
              <span className="font-medium text-neutral-800 capitalize">{topic}</span>
              <span className="text-neutral-400">·</span>
              <span className="text-neutral-600">{count}</span>
              {active < count && (
                <span className="text-neutral-400">({active} aktiv)</span>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Filter bar + table */}
      <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
        <div className="p-4 border-b border-neutral-100">
          <Suspense fallback={null}>
            <KnowledgeFilters />
          </Suspense>
        </div>

        <div className="px-0">
          <div className="px-4 py-2 bg-neutral-50 border-b border-neutral-100 flex items-center justify-between">
            <span className="text-xs text-neutral-500">
              {entries.length} Einträ{entries.length === 1 ? "g" : "ge"} gefunden
            </span>
            <span className="text-xs text-neutral-400">
              Quelle: Instagram-Export + manuell
            </span>
          </div>
          <KnowledgeTable entries={entries} />
        </div>
      </div>
    </div>
  );
}
