"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Mail, User, Bot, Sparkles, Send, X, RefreshCw, ExternalLink, Clock } from "lucide-react";

interface Session {
  id: string;
  channel: string;
  bot_signature_name: string | null;
  days_quiet: number;
  last_message_at: string;
  first_user_message?: string;
  last_bot_message?: string;
}

export default function FollowUpsClient() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Session | null>(null);
  const [suggestion, setSuggestion] = useState("");
  const [generatingFor, setGeneratingFor] = useState<string | null>(null);
  const [sending, setSending] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/chat/follow-ups");
    const data = await res.json();
    setSessions(data.sessions || []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  async function generate(s: Session) {
    setGeneratingFor(s.id);
    try {
      const res = await fetch("/api/chat/follow-ups/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: s.id }),
      });
      const data = await res.json();
      if (data.suggestion) {
        setSuggestion(data.suggestion);
        setEditing(s);
      }
    } finally {
      setGeneratingFor(null);
    }
  }

  async function sendNow() {
    if (!editing || !suggestion.trim()) return;
    setSending(true);
    try {
      await fetch("/api/chat/follow-ups/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: editing.id, message: suggestion }),
      });
      setEditing(null);
      setSuggestion("");
      load();
    } finally {
      setSending(false);
    }
  }

  async function skip(s: Session) {
    if (!confirm(`Session überspringen? Sie taucht nicht mehr in dieser Liste auf.`)) return;
    await fetch("/api/chat/follow-ups/skip", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: s.id }),
    });
    load();
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Mail size={20} className="text-purple-600" />
          <h1 className="text-xl font-semibold text-neutral-900">Follow-Ups</h1>
          <span className="text-sm text-neutral-500 ml-2">
            Kunden die seit ≥3 Tagen nicht geantwortet haben
          </span>
        </div>
        <button onClick={load} className="text-xs px-3 py-1.5 rounded-lg border border-neutral-300 hover:bg-neutral-50 inline-flex items-center gap-1">
          <RefreshCw size={11} /> Neu laden
        </button>
      </div>

      <div className="bg-purple-50 border border-purple-200 rounded-xl p-3 text-xs text-purple-900">
        💡 Klick &ldquo;Vorschlag generieren&rdquo; pro Session — Bot schreibt eine personalisierte Nachhak-Nachricht.
        Du kannst sie editieren oder direkt senden. <strong>Nichts wird automatisch verschickt.</strong>
      </div>

      {loading ? (
        <div className="text-center py-12 text-neutral-400">Lade…</div>
      ) : sessions.length === 0 ? (
        <div className="bg-green-50 border border-green-200 rounded-xl p-8 text-center">
          <div className="font-medium text-green-900">✨ Keine offenen Nachhak-Fälle</div>
          <div className="text-xs text-green-700 mt-1">Alle Kunden haben aktuell geantwortet oder noch keine 3 Tage Stille.</div>
        </div>
      ) : (
        <div className="space-y-3">
          {sessions.map(s => (
            <div key={s.id} className="bg-white border border-neutral-200 rounded-xl p-4 shadow-sm">
              <div className="flex items-center gap-2 text-xs text-neutral-500 mb-2 flex-wrap">
                <span>{s.channel === "web" ? "🌐 Web" : s.channel === "instagram" ? "📷 Instagram" : "💬 WhatsApp"}</span>
                <span>·</span>
                <span>Ava von <strong className="text-neutral-700">{s.bot_signature_name || "?"}</strong></span>
                <span>·</span>
                <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                  s.days_quiet >= 7 ? "bg-red-100 text-red-700" :
                  s.days_quiet >= 5 ? "bg-orange-100 text-orange-700" :
                                      "bg-amber-100 text-amber-700"
                }`}>
                  <Clock size={10} /> still seit {s.days_quiet} Tag{s.days_quiet === 1 ? "" : "en"}
                </span>
                <Link href={`/chatbot/inbox/${s.id}`} className="ml-auto text-blue-600 hover:underline inline-flex items-center gap-1">
                  <ExternalLink size={11} /> ganzen Chat
                </Link>
              </div>

              {s.first_user_message && (
                <div className="flex gap-2 mb-1 text-sm">
                  <User size={13} className="text-neutral-400 mt-0.5 shrink-0" />
                  <span className="text-neutral-700 line-clamp-2">{s.first_user_message}</span>
                </div>
              )}
              {s.last_bot_message && (
                <div className="flex gap-2 text-sm mb-3">
                  <Bot size={13} className="text-pink-500 mt-0.5 shrink-0" />
                  <span className="text-neutral-600 line-clamp-2">{s.last_bot_message}</span>
                </div>
              )}

              <div className="flex gap-2 pt-2 border-t border-neutral-100">
                <button
                  onClick={() => generate(s)}
                  disabled={generatingFor === s.id}
                  className="text-xs px-3 py-1.5 rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-40 inline-flex items-center gap-1 font-medium"
                >
                  <Sparkles size={11} />
                  {generatingFor === s.id ? "Generiere…" : "Vorschlag generieren"}
                </button>
                <button
                  onClick={() => skip(s)}
                  className="text-xs px-3 py-1.5 rounded-lg border border-neutral-300 text-neutral-600 hover:bg-neutral-50 inline-flex items-center gap-1"
                >
                  <X size={11} /> Überspringen
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Edit-Modal */}
      {editing && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl overflow-hidden">
            <div className="px-5 py-4 border-b border-neutral-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles size={18} className="text-purple-600" />
                <span className="font-semibold text-neutral-900">
                  Follow-Up für Ava von {editing.bot_signature_name}
                </span>
              </div>
              <button onClick={() => setEditing(null)} className="text-neutral-400 hover:text-neutral-700">
                <X size={18} />
              </button>
            </div>
            <div className="p-5 space-y-3">
              <div className="text-xs text-neutral-500">
                Der Kunde hat sich seit {editing.days_quiet} Tagen nicht mehr gemeldet.
                Editiere die Nachricht falls nötig.
              </div>
              <textarea
                value={suggestion}
                onChange={(e) => setSuggestion(e.target.value)}
                rows={5}
                className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 font-sans"
              />
            </div>
            <div className="px-5 py-3 bg-neutral-50 border-t border-neutral-200 flex justify-end gap-2">
              <button
                onClick={() => setEditing(null)}
                className="text-sm px-4 py-2 rounded-lg border border-neutral-300 hover:bg-neutral-50"
              >
                Abbrechen
              </button>
              <button
                onClick={sendNow}
                disabled={sending || !suggestion.trim()}
                className="text-sm px-4 py-2 rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-40 inline-flex items-center gap-1.5"
              >
                <Send size={14} /> {sending ? "Sende…" : "Senden"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
