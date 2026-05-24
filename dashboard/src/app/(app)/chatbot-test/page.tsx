"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Send, Bot, User, AlertCircle, UserCheck, Plus, MessageCircle, Trash2 } from "lucide-react";

interface Message {
  id: string;
  role: "user" | "assistant" | "system" | "human";
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

interface AvatarOption { name: string; avatar_url: string | null }

export default function ChatbotTestPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string>("active");
  const [lastPolled, setLastPolled] = useState<string | null>(null);
  const [sessions, setSessions] = useState<SessionPreview[]>([]);
  const [signature, setSignature] = useState<string | null>(null);
  const [avatars, setAvatars] = useState<AvatarOption[]>([]);
  const [selectedAvatar, setSelectedAvatar] = useState<string>(""); // "" = Zufall
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadSessions = useCallback(async () => {
    try {
      const res = await fetch("/api/chat/sessions?channel=web&limit=30");
      const data = await res.json();
      setSessions(data.sessions || []);
    } catch {}
  }, []);

  const loadAvatars = useCallback(async () => {
    try {
      const res = await fetch("/api/chat/avatars");
      const data = await res.json();
      setAvatars(data.avatars || []);
    } catch {}
  }, []);

  useEffect(() => { loadSessions(); loadAvatars(); }, [loadSessions, loadAvatars]);

  // Auto-Scroll
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  // Polling neuer Nachrichten — mit Dedup gegen bereits gestreamte Bot-Antworten
  useEffect(() => {
    if (!sessionId) return;
    // Beim ersten Lauf für diese sessionId: cursor auf jetzt setzen damit Polling
    // nichts vor dem aktuellen Zeitpunkt zieht (sonst Doppel-Anzeige der grade
    // per Stream gerenderten Bot-Antwort)
    if (!lastPolled) {
      setLastPolled(new Date().toISOString());
      return;
    }
    const interval = setInterval(async () => {
      const url = `/api/chat/messages?sessionId=${sessionId}&since=${encodeURIComponent(lastPolled)}`;
      try {
        const res = await fetch(url);
        if (!res.ok) return;
        const data = await res.json();
        if (data.status && data.status !== status) setStatus(data.status);
        const newOnes = (data.messages || []).filter(
          (m: { role: string }) => m.role === "human_agent" || m.role === "assistant",
        );
        if (newOnes.length > 0) {
          // Dedup: skip messages die schon (via stream) im state sind
          setMessages(prev => {
            const existingIds = new Set(prev.map(p => p.id));
            const existingContents = new Set(prev.map(p => `${p.role}::${(p.content || "").slice(0, 80)}`));
            const additions = newOnes
              .filter((m: { id: string; role: string; content: string }) => {
                if (existingIds.has(m.id)) return false;
                const role = m.role === "human_agent" ? "human" : "assistant";
                const sig = `${role}::${(m.content || "").slice(0, 80)}`;
                return !existingContents.has(sig);
              })
              .map((m: { id: string; role: string; content: string; agent_name?: string; created_at: string }) => ({
                id: m.id,
                role: m.role === "human_agent" ? ("human" as const) : ("assistant" as const),
                content: m.content,
                signature: m.agent_name || undefined,
                ts: m.created_at,
              }));
            return additions.length > 0 ? [...prev, ...additions] : prev;
          });
          setLastPolled(newOnes[newOnes.length - 1].created_at);
        }
      } catch {}
    }, 3000);
    return () => clearInterval(interval);
  }, [sessionId, status, lastPolled]);

  // Bestehende Session laden
  async function loadSession(id: string) {
    setLoading(true);
    try {
      const res = await fetch(`/api/chat/messages?sessionId=${id}`);
      const data = await res.json();
      setSessionId(id);
      setStatus(data.status || "active");
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
    } finally {
      setLoading(false);
    }
  }

  async function send() {
    if (!input.trim() || loading) return;
    const userMsg = input.trim();
    setInput("");
    setMessages(m => [...m, { id: `temp-${Date.now()}`, role: "user", content: userMsg, ts: new Date().toISOString() }]);
    setLoading(true);

    // Platzhalter-Message für Streaming-Antwort
    const botMsgId = `bot-${Date.now()}`;
    setMessages(m => [...m, { id: botMsgId, role: "assistant", content: "", ts: new Date().toISOString() }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId, message: userMsg, channel: "web",
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
              ? { ...x, content: x.content + (x.content.endsWith("\n") ? "" : "\n") + `\n_⏳ schaue im Lager nach…_\n` }
              : x));
          } else if (payload.type === "tool_end") {
            setMessages(m => m.map(x => x.id === botMsgId
              ? { ...x, content: x.content.replace(/\n_⏳ schaue im Lager nach…_\n/g, "") }
              : x));
          } else if (payload.type === "text_replace") {
            // Server hat Bot-Output korrigiert (z.B. halluzinierte Adresse →
            // Hans-Böckler-Straße via enforceBusinessFacts). Wir überschreiben
            // den live-gestreamten Text mit der korrigierten Version.
            const fullText = payload.fullText as string;
            setMessages(m => m.map(x => x.id === botMsgId
              ? { ...x, content: fullText }
              : x));
          } else if (payload.type === "done") {
            const status = payload.status as string;
            if (status) setStatus(status);
            setLastPolled(new Date().toISOString());
          } else if (payload.type === "error") {
            setMessages(m => [...m, {
              id: `err-${Date.now()}`,
              role: "system",
              content: `Fehler: ${payload.error}`,
              ts: new Date().toISOString(),
            }]);
          }
        }
      }
      loadSessions();
    } catch (e) {
      setMessages(m => [...m, {
        id: `err-${Date.now()}`,
        role: "system",
        content: `Fehler: ${(e as Error).message}`,
        ts: new Date().toISOString(),
      }]);
    } finally {
      setLoading(false);
    }
  }

  function newChat() {
    setMessages([]);
    setSessionId(null);
    setStatus("active");
    setLastPolled(null);
    setSignature(null);
  }

  async function deleteSession(id: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm("Diese Session komplett löschen (mit allen Nachrichten)?")) return;
    await fetch(`/api/chat/sessions?id=${id}`, { method: "DELETE" });
    if (sessionId === id) newChat();
    loadSessions();
  }

  async function deleteAllTest() {
    if (!confirm("ALLE Web-Test-Chats löschen? Das kann nicht rückgängig gemacht werden.")) return;
    if (!confirm("Wirklich sicher? Alle Test-Sessions weg.")) return;
    const res = await fetch(`/api/chat/sessions?all=test`, { method: "DELETE" });
    const data = await res.json();
    alert(`${data.deleted || 0} Sessions gelöscht`);
    newChat();
    loadSessions();
  }

  return (
    <div className="flex h-screen">
      {/* Sidebar: Sessions */}
      <div className="w-72 border-r border-neutral-200 bg-neutral-50 flex flex-col">
        <div className="p-3 border-b border-neutral-200 flex items-center justify-between gap-1">
          <span className="text-xs font-medium text-neutral-500 uppercase tracking-wide">Test-Chats</span>
          <div className="flex gap-1">
            <button
              onClick={deleteAllTest}
              title="Alle Test-Chats löschen"
              className="text-xs p-1 rounded-lg border border-red-200 text-red-600 hover:bg-red-50"
            >
              <Trash2 size={11} />
            </button>
            <button
              onClick={newChat}
              className="text-xs px-2 py-1 rounded-lg bg-neutral-900 text-white hover:bg-neutral-700 inline-flex items-center gap-1"
            >
              <Plus size={11} /> Neu
            </button>
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {sessions.length === 0 && (
            <div className="p-4 text-xs text-neutral-400 text-center">Noch keine Chats</div>
          )}
          {sessions.map((s) => (
            <div
              key={s.id}
              onClick={() => loadSession(s.id)}
              className={`group relative px-3 py-2.5 border-b border-neutral-100 hover:bg-white transition-colors cursor-pointer ${
                sessionId === s.id ? "bg-white border-l-2 border-l-pink-500" : ""
              }`}
            >
              <div className="flex items-center gap-1.5 mb-0.5">
                <MessageCircle size={11} className="text-neutral-400" />
                <span className="text-[10px] text-neutral-400">
                  Ava von {s.bot_signature_name || "?"}
                </span>
                {s.status === "awaiting_human" && (
                  <span className="text-[10px] bg-amber-100 text-amber-700 px-1 py-0 rounded">🟡</span>
                )}
                {s.status === "closed" && (
                  <span className="text-[10px] bg-neutral-200 text-neutral-500 px-1 py-0 rounded">✓</span>
                )}
              </div>
              <div className="text-xs text-neutral-700 truncate pr-6">{s.preview}</div>
              <div className="text-[10px] text-neutral-400 mt-0.5">{formatRel(s.last_message_at)}</div>
              <button
                onClick={(e) => deleteSession(s.id, e)}
                title="Diese Session löschen"
                className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded text-red-500 hover:bg-red-50"
              >
                <Trash2 size={11} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Chat */}
      <div className="flex-1 flex flex-col p-4 md:p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-full bg-pink-100 flex items-center justify-center">
              <Bot size={20} className="text-pink-600" />
            </div>
            <div>
              <div className="font-semibold text-neutral-900">
                Ava{signature ? ` von ${signature}` : ""}
              </div>
              <div className="text-xs text-neutral-500">
                {status === "awaiting_human"
                  ? "🟡 Eine Stylistin übernimmt"
                  : status === "closed"
                  ? "✓ Beendet"
                  : "🟢 Bereit · Test-Modus"}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1.5 text-xs">
            <span className="text-neutral-500">Avatar:</span>
            <select
              value={selectedAvatar}
              onChange={(e) => setSelectedAvatar(e.target.value)}
              disabled={!!sessionId}
              title={sessionId ? "Avatar bleibt für die ganze Session — starte neuen Chat zum Wechseln" : "Wähle einen Avatar oder Zufall"}
              className="text-xs rounded-lg border border-neutral-300 px-2 py-1 bg-white disabled:bg-neutral-50 disabled:text-neutral-400"
            >
              <option value="">🎲 Zufall</option>
              {avatars.map(a => (
                <option key={a.name} value={a.name}>{a.name}</option>
              ))}
            </select>
          </div>
          {sessionId && (
            <span className="text-xs text-neutral-400 font-mono">
              {sessionId.slice(0, 8)}
            </span>
          )}
        </div>

        <div ref={scrollRef} className="flex-1 overflow-y-auto bg-white rounded-2xl border border-neutral-200 p-4 space-y-3 shadow-sm">
          {messages.length === 0 && (
            <div className="text-center text-neutral-400 mt-12">
              <Bot size={32} className="mx-auto mb-2 text-neutral-300" />
              {sessionId
                ? "Schreib weiter — Ava erinnert sich an den Verlauf"
                : <>Schreib was — z.B. <em>&ldquo;Was kostet 150g Tape russisch?&rdquo;</em></>}
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
              {m.role === "system" && (
                <div className="w-8 h-8 rounded-full bg-neutral-100 flex-shrink-0 flex items-center justify-center">
                  <AlertCircle size={14} className="text-neutral-600" />
                </div>
              )}
              <div className={`max-w-[75%] rounded-2xl px-4 py-2.5 text-sm ${
                m.role === "user" ? "bg-neutral-900 text-white"
                : m.role === "human" ? "bg-amber-50 text-neutral-800 border border-amber-200"
                : m.role === "system" ? "bg-neutral-50 text-neutral-600 border border-neutral-200 italic"
                : "bg-pink-50 text-neutral-800"
              }`}>
                <div className="whitespace-pre-wrap">{m.content}</div>
                {m.role === "human" && m.signature && (
                  <div className="text-[10px] text-amber-700 mt-1">{m.signature}</div>
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

        <div className="mt-4 flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder={status === "awaiting_human" ? "Schreib weiter — eine Stylistin liest mit…" : "Frag Ava…"}
            disabled={loading}
            className="flex-1 rounded-xl border border-neutral-300 px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-pink-500 disabled:bg-neutral-50 disabled:text-neutral-400"
          />
          <button
            onClick={send}
            disabled={loading || !input.trim()}
            className="bg-neutral-900 text-white rounded-xl px-4 py-3 hover:bg-neutral-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
}

function formatRel(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "jetzt";
  if (m < 60) return `vor ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `vor ${h}h`;
  return `vor ${Math.floor(h / 24)}d`;
}
