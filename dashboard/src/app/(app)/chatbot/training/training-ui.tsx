"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Send, Bot, User, UserCheck, Plus, MessageCircle,
  GraduationCap, Edit3, ListChecks, X, Trash2, Sparkles,
} from "lucide-react";

interface Message {
  id: string;
  role: "user" | "assistant" | "human";
  content: string;
  signature?: string;
  ts: string;
}

interface SessionPreview {
  id: string;
  status: string;
  bot_signature_name: string | null;
  preview: string;
  last_message_at: string;
}

interface TrainingEntry {
  id: string;
  user_message: string;
  good_answer: string;
  bad_answer: string | null;
  feedback: string | null;
  active: boolean;
  pinned?: boolean;
  avatar_name: string | null;
  created_at: string;
}

interface AvatarOption { name: string; avatar_url: string | null }

type Role = "kunde" | "mitarbeiter";

export default function TrainingUI() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [signature, setSignature] = useState<string | null>(null);
  const [lastPolled, setLastPolled] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionPreview[]>([]);
  const [role, setRole] = useState<Role>("kunde");
  const [correctingMsg, setCorrectingMsg] = useState<Message | null>(null);
  const [showLibrary, setShowLibrary] = useState(false);
  const [library, setLibrary] = useState<TrainingEntry[]>([]);
  const [avatars, setAvatars] = useState<AvatarOption[]>([]);
  const [selectedAvatar, setSelectedAvatar] = useState<string>("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadSessions = useCallback(async () => {
    const res = await fetch("/api/chat/sessions?channel=web&limit=30");
    const data = await res.json();
    setSessions(data.sessions || []);
  }, []);

  const loadLibrary = useCallback(async () => {
    const res = await fetch("/api/chat/training");
    const data = await res.json();
    setLibrary(data.training || []);
  }, []);

  const loadAvatars = useCallback(async () => {
    const res = await fetch("/api/chat/avatars");
    const data = await res.json();
    setAvatars(data.avatars || []);
  }, []);

  useEffect(() => { loadSessions(); loadLibrary(); loadAvatars(); }, [loadSessions, loadLibrary, loadAvatars]);
  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages, loading]);

  async function loadSession(id: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/chat/messages?sessionId=${id}`);
      const data = await res.json();
      setSessionId(id);
      setSignature(data.bot_signature_name);
      setMessages((data.messages || []).map((m: { id: string; role: string; content: string; agent_name?: string; created_at: string }) => ({
        id: m.id,
        role: m.role === "user" ? "user" : m.role === "human_agent" ? "human" : "assistant",
        content: m.content,
        signature: m.role === "human_agent" ? m.agent_name : data.bot_signature_name,
        ts: m.created_at,
      })));
      if (data.messages?.length > 0) {
        setLastPolled(data.messages[data.messages.length - 1].created_at);
      }
    } finally { setLoading(false); }
  }

  async function send() {
    if (!input.trim() || loading) return;
    const text = input.trim();
    setInput("");
    if (role === "kunde") {
      setMessages(m => [...m, { id: `temp-${Date.now()}`, role: "user", content: text, ts: new Date().toISOString() }]);
      setLoading(true);
      const botMsgId = `bot-${Date.now()}`;
      setMessages(m => [...m, { id: botMsgId, role: "assistant", content: "", ts: new Date().toISOString() }]);
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sessionId, message: text, channel: "web",
            avatarName: !sessionId && selectedAvatar ? selectedAvatar : undefined,
          }),
        });
        if (!res.body) throw new Error("kein Stream");
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const events = buffer.split("\n\n");
          buffer = events.pop() || "";
          for (const ev of events) {
            if (!ev.startsWith("data: ")) continue;
            let payload: { type: string; [k: string]: unknown };
            try { payload = JSON.parse(ev.slice(6)); } catch { continue; }
            if (payload.type === "session") {
              if (payload.sessionId) setSessionId(payload.sessionId as string);
              if (payload.signatureName) setSignature(payload.signatureName as string);
            } else if (payload.type === "text") {
              const delta = payload.delta as string;
              setMessages(m => m.map(x => x.id === botMsgId
                ? { ...x, content: x.content + delta, signature: x.signature || signature || undefined }
                : x));
            } else if (payload.type === "tool_start") {
              setMessages(m => m.map(x => x.id === botMsgId
                ? { ...x, content: x.content + `\n_⏳ schaue im Lager nach…_\n` }
                : x));
            } else if (payload.type === "tool_end") {
              setMessages(m => m.map(x => x.id === botMsgId
                ? { ...x, content: x.content.replace(/\n_⏳ schaue im Lager nach…_\n/g, "") }
                : x));
            }
          }
        }
        loadSessions();
      } finally { setLoading(false); }
    } else {
      // Mitarbeiter-Modus: schreibt manuell, kein Bot-Aufruf
      if (!sessionId) { alert("Erst eine Session starten (Kunde-Modus) bevor du als Mitarbeiter schreibst"); return; }
      setMessages(m => [...m, { id: `temp-${Date.now()}`, role: "human", content: text, signature: "Du (Test)", ts: new Date().toISOString() }]);
      // Wir senden NICHT an /api/chat (würde Bot triggern). Stattdessen direkt als human_agent speichern:
      await fetch("/api/chat/human-message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, content: text }),
      });
    }
  }

  function newChat() {
    setMessages([]); setSessionId(null); setLastPolled(null); setSignature(null);
  }

  async function saveCorrection(goodAnswer: string, feedback: string, applyToAll: boolean) {
    if (!correctingMsg || !sessionId) return;
    setLoading(true);
    try {
      await fetch("/api/chat/training", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId,
          messageId: correctingMsg.id.startsWith("bot-") || correctingMsg.id.startsWith("temp-") ? undefined : correctingMsg.id,
          goodAnswer,
          feedback,
          applyToAll,
        }),
      });
      loadLibrary();
      await loadSession(sessionId);
      setCorrectingMsg(null);
    } finally { setLoading(false); }
  }

  async function deleteTrainingEntry(id: string) {
    if (!confirm("Wirklich löschen?")) return;
    await fetch(`/api/chat/training?id=${id}`, { method: "DELETE" });
    loadLibrary();
  }

  async function togglePinTraining(id: string, pinned: boolean) {
    await fetch(`/api/chat/training?id=${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pinned }),
    });
    loadLibrary();
  }

  return (
    <div className="flex h-screen">
      {/* Sessions Sidebar */}
      <div className="w-64 border-r border-neutral-200 bg-neutral-50 flex flex-col">
        <div className="p-3 border-b border-neutral-200 flex items-center justify-between">
          <span className="text-xs font-medium text-neutral-500 uppercase tracking-wide">Sessions</span>
          <button onClick={newChat} className="text-xs px-2 py-1 rounded-lg bg-neutral-900 text-white hover:bg-neutral-700 inline-flex items-center gap-1">
            <Plus size={11} /> Neu
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {sessions.length === 0 && <div className="p-4 text-xs text-neutral-400 text-center">Keine Sessions</div>}
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => loadSession(s.id)}
              className={`w-full text-left px-3 py-2 border-b border-neutral-100 hover:bg-white ${sessionId === s.id ? "bg-white border-l-2 border-l-pink-500" : ""}`}
            >
              <div className="flex items-center gap-1.5 mb-0.5">
                <MessageCircle size={10} className="text-neutral-400" />
                <span className="text-[10px] text-neutral-400">{s.bot_signature_name || "?"}</span>
              </div>
              <div className="text-xs text-neutral-700 truncate">{s.preview}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex-1 flex flex-col">
        {/* Header */}
        <div className="px-5 py-3 border-b border-neutral-200 flex items-center justify-between flex-wrap gap-2 bg-white">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 rounded-full bg-purple-100 flex items-center justify-center">
              <GraduationCap size={18} className="text-purple-600" />
            </div>
            <div>
              <div className="font-semibold text-neutral-900 text-sm">Bot-Training</div>
              <div className="text-xs text-neutral-500">
                {signature ? `Ava von ${signature} ·` : ""} {library.length} Lernbeispiele aktiv
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Rolle */}
            <div className="flex bg-neutral-100 rounded-lg p-0.5 text-xs">
              <button
                onClick={() => setRole("kunde")}
                className={`px-3 py-1.5 rounded-md font-medium transition-colors ${role === "kunde" ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500"}`}
              >
                <User size={11} className="inline mr-1" /> Kunde
              </button>
              <button
                onClick={() => setRole("mitarbeiter")}
                className={`px-3 py-1.5 rounded-md font-medium transition-colors ${role === "mitarbeiter" ? "bg-white text-neutral-900 shadow-sm" : "text-neutral-500"}`}
              >
                <UserCheck size={11} className="inline mr-1" /> Mitarbeiter
              </button>
            </div>
            <div className="flex items-center gap-1.5 text-xs">
              <span className="text-neutral-500">Avatar:</span>
              <select
                value={selectedAvatar}
                onChange={(e) => setSelectedAvatar(e.target.value)}
                disabled={!!sessionId}
                title={sessionId ? "Avatar bleibt für die Session — neuer Chat zum Wechseln" : "Wähle einen Avatar oder Zufall"}
                className="text-xs rounded-lg border border-neutral-300 px-2 py-1 bg-white disabled:bg-neutral-50 disabled:text-neutral-400"
              >
                <option value="">🎲 Zufall</option>
                {avatars.map(a => (
                  <option key={a.name} value={a.name}>{a.name}</option>
                ))}
              </select>
            </div>
            <button
              onClick={() => setShowLibrary(!showLibrary)}
              className={`text-xs px-3 py-1.5 rounded-lg inline-flex items-center gap-1 ${showLibrary ? "bg-purple-600 text-white" : "border border-neutral-300 hover:bg-neutral-50"}`}
            >
              <ListChecks size={11} /> Bibliothek
            </button>
          </div>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Chat */}
          <div className="flex-1 flex flex-col p-4">
            <div ref={scrollRef} className="flex-1 overflow-y-auto bg-white rounded-2xl border border-neutral-200 p-4 space-y-3 shadow-sm">
              {messages.length === 0 && (
                <div className="text-center text-neutral-400 mt-12">
                  <GraduationCap size={32} className="mx-auto mb-2 text-neutral-300" />
                  Tippe als <strong>{role === "kunde" ? "Kunde" : "Mitarbeiter"}</strong>, der Bot antwortet.
                  <br />
                  <span className="text-xs">Wenn dir die Antwort nicht gefällt → klicke <Edit3 size={11} className="inline" /> Korrigieren</span>
                </div>
              )}
              {messages.map((m) => (
                <div key={m.id} className={`flex gap-2 ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  {m.role === "assistant" && (
                    <div className="w-8 h-8 rounded-full bg-pink-100 flex-shrink-0 flex items-center justify-center">
                      <Bot size={14} className="text-pink-600" />
                    </div>
                  )}
                  {m.role === "human" && (
                    <div className="w-8 h-8 rounded-full bg-amber-100 flex-shrink-0 flex items-center justify-center">
                      <UserCheck size={14} className="text-amber-700" />
                    </div>
                  )}
                  <div className="group max-w-[75%] relative">
                    <div className={`rounded-2xl px-4 py-2.5 text-sm ${
                      m.role === "user" ? "bg-neutral-900 text-white"
                      : m.role === "human" ? "bg-amber-50 text-neutral-800 border border-amber-200"
                      : "bg-pink-50 text-neutral-800"
                    }`}>
                      <div className="whitespace-pre-wrap">{m.content}</div>
                    </div>
                    {/* Korrigieren-Button nur bei Assistant-Nachrichten */}
                    {m.role === "assistant" && (
                      <button
                        onClick={() => setCorrectingMsg(m)}
                        className="absolute -bottom-2 -right-2 opacity-0 group-hover:opacity-100 transition-opacity bg-purple-600 text-white rounded-full p-1.5 shadow-md hover:bg-purple-700"
                        title="Korrigieren — als Lernbeispiel speichern"
                      >
                        <Edit3 size={11} />
                      </button>
                    )}
                  </div>
                  {m.role === "user" && (
                    <div className="w-8 h-8 rounded-full bg-neutral-100 flex-shrink-0 flex items-center justify-center">
                      <User size={14} className="text-neutral-600" />
                    </div>
                  )}
                </div>
              ))}
              {loading && (
                <div className="flex gap-2 justify-start">
                  <div className="w-8 h-8 rounded-full bg-pink-100 flex-shrink-0 flex items-center justify-center">
                    <Bot size={14} className="text-pink-600" />
                  </div>
                  <div className="bg-pink-50 rounded-2xl px-4 py-2.5 text-sm">
                    <span className="inline-flex gap-1">
                      <span className="w-1.5 h-1.5 bg-pink-400 rounded-full animate-bounce" />
                      <span className="w-1.5 h-1.5 bg-pink-400 rounded-full animate-bounce" style={{ animationDelay: "0.1s" }} />
                      <span className="w-1.5 h-1.5 bg-pink-400 rounded-full animate-bounce" style={{ animationDelay: "0.2s" }} />
                    </span>
                  </div>
                </div>
              )}
            </div>
            <div className="mt-3 flex gap-2">
              <input
                type="text"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && send()}
                placeholder={role === "kunde" ? "Als Kunde tippen…" : "Als Mitarbeiterin tippen (kein Bot-Trigger)…"}
                disabled={loading}
                className={`flex-1 rounded-xl border px-4 py-3 text-sm focus:outline-none focus:ring-2 ${
                  role === "kunde" ? "border-neutral-300 focus:ring-pink-500" : "border-amber-300 bg-amber-50 focus:ring-amber-500"
                } disabled:opacity-50`}
              />
              <button onClick={send} disabled={loading || !input.trim()} className="bg-neutral-900 text-white rounded-xl px-4 py-3 hover:bg-neutral-800 disabled:opacity-40">
                <Send size={16} />
              </button>
            </div>
          </div>

          {/* Bibliothek */}
          {showLibrary && (
            <div className="w-96 border-l border-neutral-200 bg-neutral-50 overflow-y-auto">
              <div className="p-3 border-b border-neutral-200 flex items-center justify-between sticky top-0 bg-neutral-50">
                <span className="text-xs font-medium text-neutral-700 uppercase tracking-wide">
                  Lernbeispiele ({library.length})
                </span>
                <button onClick={() => setShowLibrary(false)} className="text-neutral-400 hover:text-neutral-700">
                  <X size={14} />
                </button>
              </div>
              <LibraryView library={library} avatars={avatars} onDelete={deleteTrainingEntry} onPin={togglePinTraining} />
            </div>
          )}
        </div>
      </div>

      {/* Korrektur-Modal */}
      {correctingMsg && (
        <CorrectionModal
          message={correctingMsg}
          currentAvatar={signature || "?"}
          onClose={() => setCorrectingMsg(null)}
          onSave={saveCorrection}
        />
      )}
    </div>
  );
}

function LibraryView({
  library, avatars, onDelete, onPin,
}: {
  library: TrainingEntry[];
  avatars: AvatarOption[];
  onDelete: (id: string) => void;
  onPin: (id: string, pinned: boolean) => void;
}) {
  const [filter, setFilter] = useState<string>("all");
  const filtered = library.filter(e => {
    if (filter === "all") return true;
    if (filter === "global") return e.avatar_name === null;
    return e.avatar_name === filter;
  });

  return (
    <>
      {/* Filter-Bar */}
      <div className="p-2 border-b border-neutral-200 flex gap-1 flex-wrap text-[10px]">
        <button onClick={() => setFilter("all")} className={`px-2 py-1 rounded-full ${filter === "all" ? "bg-purple-600 text-white" : "bg-white border border-neutral-200"}`}>
          Alle ({library.length})
        </button>
        <button onClick={() => setFilter("global")} className={`px-2 py-1 rounded-full ${filter === "global" ? "bg-purple-600 text-white" : "bg-white border border-neutral-200"}`}>
          🌐 Global ({library.filter(e => e.avatar_name === null).length})
        </button>
        {avatars.map(a => {
          const c = library.filter(e => e.avatar_name === a.name).length;
          return (
            <button
              key={a.name}
              onClick={() => setFilter(a.name)}
              className={`px-2 py-1 rounded-full ${filter === a.name ? "bg-purple-600 text-white" : "bg-white border border-neutral-200"}`}
            >
              {a.name} ({c})
            </button>
          );
        })}
      </div>
      {filtered.length === 0 ? (
        <div className="p-6 text-center text-xs text-neutral-400">
          Keine Einträge in diesem Filter.
        </div>
      ) : (
        <div className="divide-y divide-neutral-200">
          {filtered.map(e => (
            <div key={e.id} className="p-3 hover:bg-white">
              <div className="text-[10px] text-neutral-400 mb-1 flex items-center justify-between">
                <div className="flex items-center gap-1.5">
                  <span className={`px-1.5 py-0.5 rounded ${e.avatar_name ? "bg-pink-100 text-pink-700" : "bg-neutral-200 text-neutral-700"}`}>
                    {e.avatar_name || "🌐 Global"}
                  </span>
                  {e.pinned && (
                    <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium" title="Angepinnt — wird immer geladen">
                      📌 Pin
                    </span>
                  )}
                  <span>{new Date(e.created_at).toLocaleString("de-DE")}</span>
                </div>
                <div className="inline-flex items-center gap-1.5">
                  <button
                    onClick={() => onPin(e.id, !e.pinned)}
                    title={e.pinned ? "Pin entfernen" : "Anpinnen — landet immer im Bot-Prompt"}
                    className={`hover:text-amber-700 ${e.pinned ? "text-amber-700" : "text-neutral-400"}`}
                  >
                    {e.pinned ? "📌" : "📍"}
                  </button>
                  <button onClick={() => onDelete(e.id)} className="text-red-500 hover:text-red-700">
                    <Trash2 size={11} />
                  </button>
                </div>
              </div>
              <div className="text-xs text-neutral-500 mb-1">
                <strong>Kunde:</strong> {e.user_message.slice(0, 100)}
              </div>
              {e.bad_answer && (
                <div className="text-xs text-red-700 mb-1 bg-red-50 rounded p-1.5">
                  <strong>Schlecht:</strong> {e.bad_answer.slice(0, 120)}
                </div>
              )}
              <div className="text-xs text-green-800 bg-green-50 rounded p-1.5">
                <strong>Gut:</strong> {e.good_answer.slice(0, 200)}
              </div>
              {e.feedback && (
                <div className="text-[10px] text-purple-600 mt-1 italic">💡 {e.feedback}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

function CorrectionModal({
  message, currentAvatar, onClose, onSave,
}: {
  message: Message;
  currentAvatar: string;
  onClose: () => void;
  onSave: (goodAnswer: string, feedback: string, applyToAll: boolean) => void;
}) {
  const [goodAnswer, setGoodAnswer] = useState(message.content);
  const [feedback, setFeedback] = useState("");
  const [applyToAll, setApplyToAll] = useState(false);

  return (
    <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl max-w-2xl w-full shadow-2xl overflow-hidden">
        <div className="px-5 py-4 border-b border-neutral-200 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Sparkles size={18} className="text-purple-600" />
            <span className="font-semibold text-neutral-900">Antwort korrigieren — Bot lernt daraus</span>
          </div>
          <button onClick={onClose} className="text-neutral-400 hover:text-neutral-700">
            <X size={18} />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide block mb-1">
              Bisherige Antwort
            </label>
            <div className="text-xs bg-red-50 border border-red-200 rounded-lg p-3 max-h-32 overflow-y-auto whitespace-pre-wrap">
              {message.content}
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide block mb-1">
              Wie sollte sie lauten? <span className="text-neutral-400 font-normal">(in deinem Tonfall)</span>
            </label>
            <textarea
              value={goodAnswer}
              onChange={(e) => setGoodAnswer(e.target.value)}
              rows={6}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              placeholder="Hier die bessere Version reinschreiben…"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide block mb-1">
              Hinweis fürs Training <span className="text-neutral-400 font-normal">(optional)</span>
            </label>
            <input
              type="text"
              value={feedback}
              onChange={(e) => setFeedback(e.target.value)}
              className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-purple-500"
              placeholder='z.B. "Nicht so generisch antworten" oder "Bei Preisanfragen immer Methode erfragen"'
            />
          </div>

          {/* Scope: nur dieser Avatar oder alle? */}
          <div className="border border-purple-200 bg-purple-50 rounded-lg p-3 space-y-2">
            <div className="text-xs font-medium text-purple-900 uppercase tracking-wide">Für wen gilt diese Korrektur?</div>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                checked={!applyToAll}
                onChange={() => setApplyToAll(false)}
                className="mt-0.5"
              />
              <div className="text-xs">
                <strong>Nur für {currentAvatar}</strong>
                <div className="text-purple-700">
                  Andere Avatars (z.B. Barbara, Tanja) bleiben wie sie sind — gut für persönlichkeits-spezifische Korrekturen.
                </div>
              </div>
            </label>
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="radio"
                checked={applyToAll}
                onChange={() => setApplyToAll(true)}
                className="mt-0.5"
              />
              <div className="text-xs">
                <strong>🌐 Für alle Avatare</strong>
                <div className="text-purple-700">
                  Globale Regel — alle Avatars lernen daraus (z.B. Faktenkorrekturen, allgemeines Verhalten).
                </div>
              </div>
            </label>
          </div>
        </div>
        <div className="px-5 py-3 bg-neutral-50 border-t border-neutral-200 flex justify-end gap-2">
          <button onClick={onClose} className="text-sm px-4 py-2 rounded-lg border border-neutral-300 hover:bg-neutral-50">
            Abbrechen
          </button>
          <button
            onClick={() => onSave(goodAnswer, feedback, applyToAll)}
            disabled={!goodAnswer.trim()}
            className="text-sm px-4 py-2 rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-40 inline-flex items-center gap-1.5"
          >
            <Sparkles size={14} /> Speichern & trainieren
          </button>
        </div>
      </div>
    </div>
  );
}
