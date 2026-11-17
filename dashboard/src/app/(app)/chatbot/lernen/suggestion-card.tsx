"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Check, X } from "lucide-react";
import { acceptLearningSuggestion, rejectLearningSuggestion } from "@/lib/actions/chatbot-learning";

export interface Suggestion {
  id: string;
  kind: "bot_wrong" | "bot_missing";
  category: string | null;
  fact: string;
  bot_said: string | null;
  faq_question: string;
  faq_answer: string;
  team_reply_excerpt: string | null;
  created_at: string;
  session_id: string | null;
}

const TOPICS = ["allgemein", "produkte", "preise", "pflege", "termine", "salon", "versand", "zahlung", "lager", "farbberatung", "reklamation", "gewerbe", "modelle"];
const TOPIC_BY_CATEGORY: Record<string, string> = {
  pricing: "preise", availability: "lager", color_advice: "farbberatung", appointment: "termine",
  order_status: "versand", complaint: "reklamation", gewerbe: "gewerbe", models: "modelle",
};

export default function SuggestionCard({ s }: { s: Suggestion }) {
  const [q, setQ] = useState(s.faq_question);
  const [a, setA] = useState(s.faq_answer);
  const [topic, setTopic] = useState(TOPIC_BY_CATEGORY[s.category ?? ""] ?? "allgemein");
  const [done, setDone] = useState<null | "accepted" | "rejected">(null);
  const [pending, start] = useTransition();

  if (done) {
    return (
      <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm text-sm text-neutral-500">
        {done === "accepted" ? "✅ Als FAQ übernommen" : "Verworfen"} — {s.faq_question}
      </div>
    );
  }

  function run(fn: () => Promise<void>, result: "accepted" | "rejected") {
    start(async () => {
      try { await fn(); setDone(result); } catch (e) { alert(`Fehler: ${(e as Error).message}`); }
    });
  }

  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-5 shadow-sm space-y-3">
      <div className="flex items-start gap-2">
        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full shrink-0 ${s.kind === "bot_wrong" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
          {s.kind === "bot_wrong" ? "Bot lag falsch" : "Bot wusste es nicht"}
        </span>
        <p className="text-sm text-neutral-900 font-medium">{s.fact}</p>
      </div>

      <div className="grid md:grid-cols-2 gap-3 text-xs">
        {s.bot_said && (
          <div className="rounded-lg bg-neutral-50 p-2.5">
            <div className="font-medium text-neutral-500 uppercase tracking-wide mb-1">Bot-Entwurf</div>
            <div className="text-neutral-700">{s.bot_said}</div>
          </div>
        )}
        {s.team_reply_excerpt && (
          <div className="rounded-lg bg-neutral-50 p-2.5">
            <div className="font-medium text-neutral-500 uppercase tracking-wide mb-1">Eure Antwort</div>
            <div className="text-neutral-700 whitespace-pre-line line-clamp-6">{s.team_reply_excerpt}</div>
          </div>
        )}
      </div>

      <div className="space-y-2">
        <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide">FAQ-Frage</label>
        <input value={q} onChange={(e) => setQ(e.target.value)} className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900" />
        <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide">FAQ-Antwort (so sagt es der Bot künftig)</label>
        <textarea value={a} onChange={(e) => setA(e.target.value)} rows={3} className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900" />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <select value={topic} onChange={(e) => setTopic(e.target.value)} className="rounded-lg border border-neutral-300 px-2 py-2 text-sm">
          {TOPICS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <button
          type="button" disabled={pending}
          onClick={() => run(() => acceptLearningSuggestion(s.id, q, a, topic), "accepted")}
          className="inline-flex items-center gap-1.5 bg-neutral-900 text-white font-medium rounded-lg px-4 py-2 text-sm disabled:opacity-50"
        >
          <Check size={14} /> Als FAQ übernehmen
        </button>
        <button
          type="button" disabled={pending}
          onClick={() => run(() => rejectLearningSuggestion(s.id), "rejected")}
          className="inline-flex items-center gap-1.5 border border-neutral-300 text-neutral-700 rounded-lg px-4 py-2 text-sm disabled:opacity-50"
        >
          <X size={14} /> Verwerfen
        </button>
        {s.session_id && (
          <Link href={`/chatbot/inbox/${s.session_id}`} className="text-xs text-blue-600 hover:underline ml-auto">Chat öffnen</Link>
        )}
      </div>
    </div>
  );
}
