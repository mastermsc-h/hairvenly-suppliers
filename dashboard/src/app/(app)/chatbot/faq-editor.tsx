"use client";

import { useState } from "react";
import { Plus, Edit3, Trash2, Save, X, BookOpen, Search, Sparkles } from "lucide-react";

interface Faq {
  id: string;
  slug: string;
  topic: string;
  question: string;
  answer: string;
  order_idx: number;
  active: boolean;
  notes: string | null;
  updated_at: string;
}

// Standard-Topics als Startpunkt — können erweitert werden
const DEFAULT_TOPICS = [
  "produkte", "farbberatung", "preise", "lager", "versand", "pflege",
  "reklamation", "rabatt", "zahlung", "gewerbe", "termine", "anfaenger",
  "modell", "kooperation", "gewinnspiel", "sonstiges",
];

function normalizeTopic(input: string): string {
  return input.toLowerCase().trim()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
}

export default function FaqEditor({ initialFaqs }: { initialFaqs: Faq[] }) {
  const [faqs, setFaqs] = useState<Faq[]>(initialFaqs);
  const [editing, setEditing] = useState<Faq | null>(null);
  const [creating, setCreating] = useState(false);
  const [topicFilter, setTopicFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState<string>("");

  async function reload() {
    const res = await fetch("/api/chatbot/faq");
    const data = await res.json();
    setFaqs(data.faqs || []);
  }

  async function save(faq: Partial<Faq> & { id?: string }) {
    const method = faq.id ? "PATCH" : "POST";
    const res = await fetch("/api/chatbot/faq", {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(faq),
    });
    if (res.ok) {
      reload();
      setEditing(null);
      setCreating(false);
    } else {
      const err = await res.json();
      alert(`Fehler: ${err.error}`);
    }
  }

  async function remove(id: string, q: string) {
    if (!confirm(`FAQ "${q.slice(0, 50)}…" löschen?`)) return;
    await fetch(`/api/chatbot/faq?id=${id}`, { method: "DELETE" });
    reload();
  }

  async function toggleActive(f: Faq) {
    await save({ id: f.id, active: !f.active });
  }

  // Filter: zuerst Topic, dann Volltext-Suche (Slug + Topic + Frage + Antwort)
  const topicFiltered = topicFilter === "all" ? faqs : faqs.filter(f => f.topic === topicFilter);
  const q = searchQuery.trim().toLowerCase();
  const filtered = q.length === 0 ? topicFiltered : topicFiltered.filter(f => {
    const hay = `${f.slug} ${f.topic} ${f.question} ${f.answer}`.toLowerCase();
    // Alle Such-Tokens müssen vorkommen (AND-Semantik)
    return q.split(/\s+/).every(token => hay.includes(token));
  });
  const topicCounts: Record<string, number> = {};
  for (const f of faqs) topicCounts[f.topic] = (topicCounts[f.topic] || 0) + 1;

  // Vorhandene Topics aus FAQs + Defaults (alphabetisch, ohne Duplikate)
  const availableTopics = Array.from(new Set([
    ...Object.keys(topicCounts),
    ...DEFAULT_TOPICS,
  ])).sort();

  return (
    <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
      <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <BookOpen size={16} className="text-neutral-500" />
          <h2 className="text-sm font-semibold text-neutral-800">FAQ-Einträge</h2>
          <span className="text-xs text-neutral-400">{faqs.length} insgesamt · {filtered.length} gefiltert</span>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="bg-neutral-900 text-white rounded-lg px-3 py-1.5 text-xs hover:bg-neutral-800 inline-flex items-center gap-1"
        >
          <Plus size={12} /> Neue FAQ
        </button>
      </div>

      {/* Volltext-Suche — findet Stichwort in Slug/Topic/Frage/Antwort */}
      <div className="px-5 py-3 border-b border-neutral-100">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Suche in allen FAQs (Slug, Topic, Frage, Antwort)… z.B. 'genius', 'tape 65cm', 'farbe'"
            className="w-full pl-9 pr-9 py-2 text-sm border border-neutral-300 rounded-lg focus:ring-2 focus:ring-neutral-900 focus:border-transparent outline-none"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery("")}
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-neutral-400 hover:text-neutral-700"
              title="Suche löschen"
            >
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Topic-Filter */}
      <div className="px-5 py-3 border-b border-neutral-100 flex gap-1 flex-wrap text-xs">
        <button
          onClick={() => setTopicFilter("all")}
          className={`px-2 py-1 rounded-full ${topicFilter === "all" ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"}`}
        >
          Alle ({faqs.length})
        </button>
        {Object.keys(topicCounts).sort().map(t => (
          <button
            key={t}
            onClick={() => setTopicFilter(t)}
            className={`px-2 py-1 rounded-full ${topicFilter === t ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"}`}
          >
            {t} ({topicCounts[t]})
          </button>
        ))}
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="p-8 text-center text-sm text-neutral-400">Keine FAQs in diesem Filter</div>
      ) : (
        <ul className="divide-y divide-neutral-100">
          {filtered.map(f => (
            <li key={f.id} className={`p-4 hover:bg-neutral-50 ${!f.active ? "opacity-60" : ""}`}>
              <div className="flex items-start gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1.5">
                    <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-pink-100 text-pink-700">
                      {f.topic}
                    </span>
                    {!f.active && (
                      <span className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-neutral-200 text-neutral-600">
                        inaktiv
                      </span>
                    )}
                    <span className="text-[10px] text-neutral-400 font-mono">{f.slug}</span>
                  </div>
                  <div className="text-sm font-medium text-neutral-900 mb-1">{f.question}</div>
                  <div className="text-xs text-neutral-600 whitespace-pre-wrap line-clamp-3">{f.answer}</div>
                </div>
                <div className="flex flex-col gap-1 shrink-0">
                  <button
                    onClick={() => setEditing(f)}
                    className="text-xs px-2 py-1 rounded-lg border border-neutral-300 hover:bg-neutral-50 inline-flex items-center gap-1"
                  >
                    <Edit3 size={11} /> Bearbeiten
                  </button>
                  {/* Bot-Test pro FAQ — öffnet chatbot-test in neuem Tab
                      mit der Frage prefilled, damit der Mitarbeiter sofort
                      sieht ob die FAQ wirkt wie gedacht. */}
                  <a
                    href={`/chatbot-test?prefill=${encodeURIComponent(f.question)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs px-2 py-1 rounded-lg border border-blue-200 text-blue-700 hover:bg-blue-50 inline-flex items-center gap-1"
                    title="Frage im Chatbot-Test öffnen — sieht ob die FAQ richtig wirkt"
                  >
                    <Sparkles size={11} /> Test mit Bot
                  </a>
                  <button
                    onClick={() => toggleActive(f)}
                    className={`text-xs px-2 py-1 rounded-lg ${
                      f.active
                        ? "border border-neutral-300 text-neutral-600 hover:bg-neutral-50"
                        : "bg-green-600 text-white hover:bg-green-700"
                    }`}
                  >
                    {f.active ? "Deaktivieren" : "Aktivieren"}
                  </button>
                  <button
                    onClick={() => remove(f.id, f.question)}
                    className="text-xs px-2 py-1 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 inline-flex items-center gap-1"
                  >
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {(editing || creating) && (
        <FaqModal
          faq={editing}
          availableTopics={availableTopics}
          onClose={() => { setEditing(null); setCreating(false); }}
          onSave={save}
        />
      )}
    </div>
  );
}

function FaqModal({
  faq, availableTopics, onClose, onSave,
}: {
  faq: Faq | null;
  availableTopics: string[];
  onClose: () => void;
  onSave: (f: Partial<Faq> & { id?: string }) => void;
}) {
  const [topic, setTopic] = useState(faq?.topic || "produkte");
  const [question, setQuestion] = useState(faq?.question || "");
  const [answer, setAnswer] = useState(faq?.answer || "");
  const [active, setActive] = useState(faq?.active ?? true);
  const [orderIdx, setOrderIdx] = useState(faq?.order_idx ?? 999);
  const [notes, setNotes] = useState(faq?.notes || "");

  function submit() {
    if (!question.trim() || !answer.trim()) { alert("Frage und Antwort sind Pflicht"); return; }
    if (!topic.trim()) { alert("Topic ist Pflicht"); return; }
    const normalized = normalizeTopic(topic);
    if (!normalized) { alert("Topic enthält nur Sonderzeichen — bitte mit Buchstaben/Zahlen"); return; }
    onSave({
      id: faq?.id,
      topic: normalized, question, answer,
      active, order_idx: orderIdx,
      notes: notes || null,
    });
  }
  const isNewTopic = topic.trim() !== "" && !availableTopics.includes(normalizeTopic(topic));

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-neutral-200 flex items-center justify-between">
          <h3 className="font-semibold text-neutral-900">
            {faq ? "FAQ bearbeiten" : "Neue FAQ"}
          </h3>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-3 max-h-[70vh] overflow-y-auto">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide block mb-1">
                Topic <span className="text-neutral-400 font-normal">(bestehend wählen oder neu eingeben)</span>
              </label>
              <input
                list="topic-suggestions"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                placeholder="z.B. produkte oder neue_kategorie"
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
              />
              <datalist id="topic-suggestions">
                {availableTopics.map(t => <option key={t} value={t} />)}
              </datalist>
              {isNewTopic && (
                <div className="mt-1 text-[11px] text-purple-700 inline-flex items-center gap-1">
                  ✨ Neues Topic: <strong>{normalizeTopic(topic)}</strong> wird beim Speichern angelegt
                </div>
              )}
            </div>
            <div>
              <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide block mb-1">Reihenfolge</label>
              <input
                type="number"
                value={orderIdx}
                onChange={(e) => setOrderIdx(parseInt(e.target.value) || 999)}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
              />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide block mb-1">Frage</label>
            <input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="z.B. Welche Haarqualitäten bietet ihr an?"
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide block mb-1">
              Antwort <span className="text-neutral-400 font-normal">(im Hairvenly-Stil)</span>
            </label>
            <textarea
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              rows={6}
              placeholder="Wir bieten zwei Haarqualitäten: **Russisch Glatt** (Premium…) und **Usbekisch Wellig** 💕"
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide block mb-1">Notizen (intern)</label>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional"
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm"
            />
          </div>
          <label className="inline-flex items-center gap-2 text-sm">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            <span>Aktiv (wird vom Bot genutzt)</span>
          </label>
        </div>
        <div className="px-5 py-3 bg-neutral-50 border-t border-neutral-200 flex justify-end gap-2">
          <button onClick={onClose} className="text-sm px-4 py-2 rounded-lg border border-neutral-300 hover:bg-neutral-50">
            Abbrechen
          </button>
          <button onClick={submit} className="text-sm px-4 py-2 rounded-lg bg-neutral-900 text-white hover:bg-neutral-800 inline-flex items-center gap-1.5">
            <Save size={14} /> Speichern
          </button>
        </div>
      </div>
    </div>
  );
}
