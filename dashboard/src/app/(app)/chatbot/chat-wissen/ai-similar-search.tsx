"use client";

import { useState } from "react";
import { Sparkles, Loader2, BookmarkPlus, Check, ChevronDown, ChevronRight } from "lucide-react";

interface Match { question: string; answer: string; source: string; topic: string | null }

const FAQ_TOPICS = ["produkte","farbberatung","preise","lager","versand","pflege","reklamation","rabatt","zahlung","gewerbe","termine","anfaenger","modell","kooperation","gewinnspiel","sonstiges"];

export default function AiSimilarSearch() {
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [matches, setMatches] = useState<Match[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function search() {
    const q = query.trim();
    if (q.length < 4) { setError("Bitte eine etwas längere Frage eingeben."); return; }
    setLoading(true); setError(null); setMatches(null);
    try {
      const res = await fetch("/api/chatbot/similar-questions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error || `Fehler ${res.status}`);
      setMatches(j.matches || []);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  }

  return (
    <div className="bg-white rounded-2xl border border-purple-200 p-4 shadow-sm space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles size={15} className="text-purple-600" />
        <span className="text-sm font-semibold text-neutral-900">KI-Ähnlichkeitssuche</span>
      </div>
      <p className="text-xs text-neutral-500">
        Kundenfrage hier reinwerfen — die KI sucht sinngemäß ähnliche frühere Fragen + Antworten (auch bei anderer Wortwahl). Antwort übernehmen oder direkt als FAQ speichern.
      </p>
      <div className="flex gap-2 items-end">
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) search(); }}
          rows={2}
          placeholder="z.B. Wie lang muss mein eigenes Haar für eine Verlängerung sein?"
          className="flex-1 rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-purple-500"
        />
        <button
          onClick={search}
          disabled={loading}
          className="shrink-0 bg-purple-600 text-white text-sm font-medium rounded-lg px-4 py-2.5 hover:bg-purple-700 disabled:opacity-50 inline-flex items-center gap-1.5"
        >
          {loading ? <Loader2 size={15} className="animate-spin" /> : <Sparkles size={15} />} Ähnliche finden
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}

      {matches && matches.length === 0 && (
        <p className="text-sm text-neutral-500">Keine ähnliche Frage im Archiv gefunden. Du kannst trotzdem eine neue FAQ anlegen:</p>
      )}
      {matches && (
        <div className="space-y-2">
          {matches.map((m, i) => (
            <ResultCard key={i} match={m} query={query.trim()} />
          ))}
          {/* immer: aus der Frage eine neue FAQ machen (auch ohne Treffer) */}
          <ResultCard match={null} query={query.trim()} />
        </div>
      )}
    </div>
  );
}

function ResultCard({ match, query }: { match: Match | null; query: string }) {
  const [open, setOpen] = useState(false);
  const [topic, setTopic] = useState("sonstiges");
  const [q, setQ] = useState(query);
  const [answer, setAnswer] = useState(match?.answer || "");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    if (!answer.trim() || !q.trim()) { setErr("Frage und Antwort dürfen nicht leer sein."); return; }
    setSaving(true); setErr(null);
    try {
      const res = await fetch("/api/chatbot/faq", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ topic, question: q.trim(), answer: answer.trim() }),
      });
      if (!res.ok) { const j = await res.json().catch(() => ({})); throw new Error(j.error || `Fehler ${res.status}`); }
      setSaved(true); setTimeout(() => setOpen(false), 1200);
    } catch (e) { setErr((e as Error).message); }
    finally { setSaving(false); }
  }

  if (!match) {
    // "Neue FAQ aus dieser Frage" — Karte ohne Treffer
    return (
      <div className="rounded-lg border border-dashed border-neutral-300 p-3">
        {!open ? (
          <button onClick={() => setOpen(true)} className="text-xs text-purple-700 hover:text-purple-900 inline-flex items-center gap-1">
            <BookmarkPlus size={13} /> Neue FAQ aus dieser Frage anlegen
          </button>
        ) : (
          <SaveForm {...{ topic, setTopic, q, setQ, answer, setAnswer, saving, saved, err, save, onCancel: () => setOpen(false) }} />
        )}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-neutral-200 p-3 bg-neutral-50/60">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] text-neutral-400 mb-0.5 inline-flex items-center gap-1.5">
            <span className="bg-neutral-200 text-neutral-600 rounded-full px-1.5 py-0.5">{match.source}</span>
            {match.topic && <span className="text-neutral-400">{match.topic}</span>}
          </div>
          <div className="text-sm font-medium text-neutral-900">{match.question}</div>
          <div className="text-sm text-neutral-700 mt-1 whitespace-pre-wrap">{match.answer}</div>
        </div>
        <button
          onClick={() => setOpen((o) => !o)}
          title="Als FAQ speichern"
          className="shrink-0 text-neutral-400 hover:text-pink-600 inline-flex items-center gap-1 text-xs"
        >
          {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}<BookmarkPlus size={14} />
        </button>
      </div>
      {open && (
        <div className="mt-3 pt-3 border-t border-neutral-200">
          <SaveForm {...{ topic, setTopic, q, setQ, answer, setAnswer, saving, saved, err, save, onCancel: () => setOpen(false) }} />
        </div>
      )}
    </div>
  );
}

function SaveForm(p: {
  topic: string; setTopic: (v: string) => void;
  q: string; setQ: (v: string) => void;
  answer: string; setAnswer: (v: string) => void;
  saving: boolean; saved: boolean; err: string | null;
  save: () => void; onCancel: () => void;
}) {
  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <label className="text-[11px] text-neutral-600 flex-1">Thema
          <select value={p.topic} onChange={(e) => p.setTopic(e.target.value)} className="mt-0.5 w-full rounded border border-neutral-300 px-2 py-1 text-xs">
            {FAQ_TOPICS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
      </div>
      <label className="text-[11px] text-neutral-600 block">Frage
        <textarea value={p.q} onChange={(e) => p.setQ(e.target.value)} rows={2} className="mt-0.5 w-full rounded border border-neutral-300 px-2 py-1 text-xs" />
      </label>
      <label className="text-[11px] text-neutral-600 block">Antwort (was der Bot sagen soll)
        <textarea value={p.answer} onChange={(e) => p.setAnswer(e.target.value)} rows={3} className="mt-0.5 w-full rounded border border-neutral-300 px-2 py-1 text-xs" />
      </label>
      {p.err && <p className="text-xs text-red-600">{p.err}</p>}
      <div className="flex items-center gap-2">
        {p.saved ? (
          <span className="text-xs text-emerald-600 inline-flex items-center gap-1"><Check size={13} /> als FAQ gespeichert</span>
        ) : (
          <>
            <button onClick={p.save} disabled={p.saving} className="bg-neutral-900 text-white text-xs font-medium rounded-lg px-3 py-1.5 disabled:opacity-50 inline-flex items-center gap-1.5">
              {p.saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Als FAQ speichern
            </button>
            <button onClick={p.onCancel} className="text-xs text-neutral-500 hover:bg-neutral-100 rounded-lg px-2 py-1.5">Abbrechen</button>
          </>
        )}
      </div>
    </div>
  );
}
