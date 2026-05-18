"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bot, User, UserCheck, Send, Hand, RotateCcw, X, Wrench, Sparkles, Trash2, Power, Check, Wand2 } from "lucide-react";
import {
  takeoverSession,
  sendHumanMessage,
  resumeBot,
  closeSession,
  deleteSession,
  setSessionAvatar,
  setBotMode,
  approveDraft,
  discardDraft,
} from "@/lib/actions/chat-inbox";

interface Message {
  id: string;
  role: string;
  content: string | null;
  attachments: { type: string; url: string }[];
  tool_calls: { name: string }[] | null;
  agent_name: string | null;
  created_at: string;
}

interface Props {
  session: {
    id: string;
    channel: string;
    status: string;
    assigned_to: string | null;
    bot_signature_name: string | null;
    customer_name: string | null;
    bot_auto_reply: boolean;
    bot_mode: "auto" | "assisted" | "off";
    assigned_name: string | null;
  };
  initialMessages: Message[];
  avatarOptions: string[];
  pendingDraft: { id: string; original_text: string; created_at: string } | null;
}

export default function ChatSessionView({ session, initialMessages, avatarOptions, pendingDraft }: Props) {
  const router = useRouter();
  const [messages, setMessages] = useState(initialMessages);
  const [input, setInput] = useState("");
  const [isPending, startTransition] = useTransition();
  const [suggesting, setSuggesting] = useState(false);
  const [andResume, setAndResume] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // Polling für neue Nachrichten alle 3s — mit Dedup gegen Optimistic-Updates
  useEffect(() => {
    let lastTs = messages.length > 0 ? messages[messages.length - 1].created_at : new Date().toISOString();
    let lastDraftId = pendingDraft?.id || null;
    const interval = setInterval(async () => {
      const res = await fetch(`/api/chat/messages?sessionId=${session.id}&since=${encodeURIComponent(lastTs)}`);
      if (!res.ok) return;
      const data = await res.json();
      if (data.messages && data.messages.length > 0) {
        setMessages(m => {
          const existingIds = new Set(m.map(p => p.id));
          const existingContents = new Set(m.map(p => `${p.role}::${(p.content || "").slice(0, 80)}`));
          const fresh = (data.messages as Message[]).filter(nm => {
            if (existingIds.has(nm.id)) return false;
            const sig = `${nm.role}::${(nm.content || "").slice(0, 80)}`;
            return !existingContents.has(sig);
          });
          return fresh.length > 0 ? [...m, ...fresh] : m;
        });
        lastTs = data.messages[data.messages.length - 1].created_at;
        router.refresh();
      }
      // Draft-Wechsel erkennen (neuer Entwurf erschienen oder vorhandener verschwunden)
      const curDraftId = data.pending_draft_id || null;
      if (curDraftId !== lastDraftId) {
        lastDraftId = curDraftId;
        router.refresh();
      }
    }, 3000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

  async function handleTakeover() {
    startTransition(async () => {
      await takeoverSession(session.id);
      router.refresh();
    });
  }

  async function handleSend(resumeBotAfter = false) {
    if (!input.trim() || isPending) return;
    const text = input.trim();
    setInput("");
    const tempMsg: Message = {
      id: `temp-${Date.now()}`,
      role: "human_agent",
      content: text,
      attachments: [],
      tool_calls: null,
      agent_name: "Du",
      created_at: new Date().toISOString(),
    };
    setMessages(m => [...m, tempMsg]);
    startTransition(async () => {
      await sendHumanMessage(session.id, text);
      if (resumeBotAfter) {
        await resumeBot(session.id);
      }
      router.refresh();
    });
  }

  async function handleSuggest() {
    if (suggesting) return;
    setSuggesting(true);
    try {
      const res = await fetch("/api/chat/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.id }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(`Vorschlag fehlgeschlagen: ${err.error}`);
        return;
      }
      const data = await res.json();
      if (data.suggestion) {
        setInput(data.suggestion);
      }
    } catch (e) {
      alert(`Fehler: ${(e as Error).message}`);
    } finally {
      setSuggesting(false);
    }
  }

  async function handleResume() {
    startTransition(async () => {
      await resumeBot(session.id);
      router.refresh();
    });
  }

  async function handleClose() {
    startTransition(async () => {
      await closeSession(session.id);
      router.push("/chatbot/inbox");
    });
  }

  async function handleReopen() {
    startTransition(async () => {
      // resumeBot setzt status='active' + assigned_to=null — perfekt für "reaktivieren"
      await resumeBot(session.id);
      router.refresh();
    });
  }

  async function handleDelete() {
    if (!confirm("Diese Session komplett löschen (mit allen Nachrichten)? Kann nicht rückgängig gemacht werden.")) return;
    startTransition(async () => {
      await deleteSession(session.id);
      router.push("/chatbot/inbox");
    });
  }

  const statusBadge = {
    active:         { label: "Bot aktiv",       color: "bg-green-100 text-green-800" },
    awaiting_human: { label: "Du übernimmst",   color: "bg-amber-100 text-amber-800" },
    escalated:      { label: "Eskaliert",       color: "bg-red-100 text-red-800" },
    closed:         { label: "Abgeschlossen",   color: "bg-neutral-100 text-neutral-600" },
  }[session.status] || { label: session.status, color: "bg-neutral-100" };

  const isTakenOver = session.status === "awaiting_human";

  return (
    <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden flex flex-col" style={{ height: "calc(100vh - 200px)" }}>
      {/* Header */}
      <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3 flex-wrap">
          <div className={`text-xs px-2 py-1 rounded-full font-medium ${statusBadge.color}`}>
            {statusBadge.label}
          </div>
          <div className="text-sm text-neutral-700">
            <span className="text-neutral-400">
              {session.channel === "instagram" ? "📷" : session.channel === "whatsapp" ? "💬" : "🌐"} Kunde:
            </span>{" "}
            <span className="font-medium">{session.customer_name || "—"}</span>
          </div>
          <div className="text-sm text-neutral-700 inline-flex items-center gap-1">
            <span className="text-neutral-400">Bot:</span>
            <span className="font-medium">Ava von</span>
            <select
              value={session.bot_signature_name || ""}
              onChange={(e) => {
                const newAvatar = e.target.value;
                if (!newAvatar || newAvatar === session.bot_signature_name) return;
                startTransition(async () => {
                  await setSessionAvatar(session.id, newAvatar);
                  router.refresh();
                });
              }}
              disabled={isPending}
              className="text-xs rounded-md border border-neutral-300 px-2 py-0.5 bg-white font-medium hover:bg-neutral-50 disabled:opacity-50"
            >
              {!session.bot_signature_name && <option value="">—</option>}
              {avatarOptions.map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
            </select>
          </div>
          {session.assigned_name && (
            <div className="text-sm text-neutral-700">
              <span className="text-neutral-400">·</span>{" "}
              <span className="text-neutral-400">übernommen von</span>{" "}
              <span className="font-medium">{session.assigned_name}</span>
            </div>
          )}
        </div>
        <div className="flex gap-2 items-center">
          {/* Bot-Modus Selector: Auto · Begleitet · Aus */}
          {session.status === "active" && (
            <div className="inline-flex items-center gap-1 text-xs">
              <Power size={11} className="text-neutral-400" />
              <span className="text-neutral-500">Bot:</span>
              <select
                value={session.bot_mode}
                onChange={(e) => {
                  const m = e.target.value as "auto" | "assisted" | "off";
                  startTransition(async () => {
                    await setBotMode(session.id, m);
                    router.refresh();
                  });
                }}
                disabled={isPending}
                title="Auto = sendet selbst · Begleitet = Bot generiert Entwurf, du bestätigst · Aus = kein Bot"
                className={`text-xs rounded-md border px-2 py-0.5 font-medium ${
                  session.bot_mode === "auto"
                    ? "bg-green-100 text-green-800 border-green-300"
                    : session.bot_mode === "assisted"
                    ? "bg-blue-100 text-blue-800 border-blue-300"
                    : "bg-neutral-100 text-neutral-600 border-neutral-300"
                }`}
              >
                <option value="auto">🤖 Auto (sendet selbst)</option>
                <option value="assisted">🧑‍🏫 Begleitet (Entwurf)</option>
                <option value="off">⏸ Aus</option>
              </select>
            </div>
          )}
          {!isTakenOver && session.status !== "closed" && (
            <button
              onClick={handleTakeover}
              disabled={isPending}
              className="text-xs px-3 py-1.5 rounded-lg bg-amber-100 text-amber-800 hover:bg-amber-200 inline-flex items-center gap-1 disabled:opacity-50"
            >
              <Hand size={12} /> Übernehmen
            </button>
          )}
          {isTakenOver && (
            <button
              onClick={handleResume}
              disabled={isPending}
              className="text-xs px-3 py-1.5 rounded-lg bg-green-100 text-green-800 hover:bg-green-200 inline-flex items-center gap-1 disabled:opacity-50"
            >
              <RotateCcw size={12} /> Zurück an Bot
            </button>
          )}
          {session.status !== "closed" && (
            <button
              onClick={handleClose}
              disabled={isPending}
              className="text-xs px-3 py-1.5 rounded-lg border border-neutral-300 text-neutral-600 hover:bg-neutral-50 inline-flex items-center gap-1 disabled:opacity-50"
            >
              <X size={12} /> Schließen
            </button>
          )}
          <button
            onClick={handleDelete}
            disabled={isPending}
            title="Session komplett löschen"
            className="text-xs px-3 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 inline-flex items-center gap-1 disabled:opacity-50"
          >
            <Trash2 size={12} /> Löschen
          </button>
        </div>
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 bg-neutral-50">
        {messages.length === 0 && (
          <div className="text-center text-neutral-400 mt-12 text-sm">Noch keine Nachrichten</div>
        )}
        {messages.map(m => (
          <MessageRow key={m.id} msg={m} signatureName={session.bot_signature_name} />
        ))}
      </div>

      {/* Input — nur wenn übernommen */}
      {isTakenOver ? (
        <div className="border-t border-neutral-100 p-3 space-y-2">
          <div className="flex gap-2 items-end">
            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.ctrlKey) {
                  e.preventDefault();
                  handleSend(andResume);
                }
              }}
              placeholder="Antwort als Mitarbeiterin schreiben… (Enter = senden, Shift+Enter = neue Zeile)"
              rows={Math.max(2, Math.min(8, (input.match(/\n/g)?.length || 0) + 2))}
              className="flex-1 rounded-xl border border-neutral-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none"
              disabled={isPending || suggesting}
            />
            <div className="flex flex-col gap-1.5">
              <button
                onClick={handleSuggest}
                disabled={suggesting || isPending}
                title="Bot generiert einen Antwort-Vorschlag"
                className="bg-purple-600 text-white rounded-xl px-3 py-2 hover:bg-purple-700 disabled:opacity-40 inline-flex items-center gap-1 text-xs font-medium"
              >
                <Sparkles size={12} /> {suggesting ? "Denkt…" : "Vorschlag"}
              </button>
              <button
                onClick={() => handleSend(andResume)}
                disabled={isPending || !input.trim()}
                className="bg-amber-600 text-white rounded-xl px-3 py-2 hover:bg-amber-700 disabled:opacity-40 inline-flex items-center gap-1 text-xs font-medium"
              >
                <Send size={12} /> Senden
              </button>
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs text-neutral-600 cursor-pointer">
            <input
              type="checkbox"
              checked={andResume}
              onChange={(e) => setAndResume(e.target.checked)}
              className="rounded"
            />
            <span>Nach dieser Antwort wieder an Bot übergeben</span>
          </label>
        </div>
      ) : session.status === "active" && pendingDraft && session.bot_mode === "assisted" ? (
        <DraftBox
          draft={pendingDraft}
          onDone={() => router.refresh()}
        />
      ) : session.status === "active" ? (
        <div className="border-t border-neutral-100 p-3 text-center text-xs text-neutral-400 italic">
          {session.bot_mode === "off"
            ? "Bot ist deaktiviert. Klick \"Übernehmen\" um selbst zu antworten."
            : session.bot_mode === "assisted"
            ? "Bot-Begleitung aktiv. Wartet auf nächste Kundennachricht — Entwurf erscheint hier."
            : "Bot antwortet automatisch. Klick \"Übernehmen\" um selbst zu antworten."}
        </div>
      ) : (
        <div className="border-t border-neutral-100 p-3 text-center text-xs text-neutral-500 flex items-center justify-center gap-2">
          <span>Session abgeschlossen — kann jederzeit wieder geöffnet werden</span>
          <button
            onClick={handleReopen}
            disabled={isPending}
            className="text-xs px-3 py-1.5 rounded-lg bg-green-600 text-white hover:bg-green-700 inline-flex items-center gap-1 disabled:opacity-50"
          >
            <RotateCcw size={11} /> Wieder öffnen
          </button>
        </div>
      )}
    </div>
  );
}

function MessageRow({ msg, signatureName }: { msg: Message; signatureName: string | null }) {
  const time = new Date(msg.created_at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

  if (msg.role === "user") {
    return (
      <div className="flex gap-2 justify-start">
        <div className="w-7 h-7 rounded-full bg-neutral-200 flex-shrink-0 flex items-center justify-center">
          <User size={12} className="text-neutral-600" />
        </div>
        <div className="max-w-[70%]">
          <div className="bg-white border border-neutral-200 rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap">{msg.content}</div>
          {msg.attachments?.length > 0 && (
            <div className="flex gap-1 mt-1">
              {msg.attachments.map((a, i) => (
                <a key={i} href={a.url} target="_blank" rel="noopener" className="text-xs text-blue-600 underline">
                  📎 {a.type}
                </a>
              ))}
            </div>
          )}
          <div className="text-[10px] text-neutral-400 mt-0.5">Kunde · {time}</div>
        </div>
      </div>
    );
  }

  if (msg.role === "assistant") {
    return (
      <div className="flex gap-2 justify-end">
        <div className="max-w-[70%]">
          <div className="bg-pink-100 rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap">{msg.content}</div>
          {msg.tool_calls && msg.tool_calls.length > 0 && (
            <div className="mt-1 text-[10px] text-neutral-500 inline-flex items-center gap-1">
              <Wrench size={10} />
              Tools: {msg.tool_calls.map(t => t.name).join(", ")}
            </div>
          )}
          <div className="text-[10px] text-neutral-400 mt-0.5 text-right">
            Ava von {signatureName || "—"} · {time}
          </div>
        </div>
        <div className="w-7 h-7 rounded-full bg-pink-200 flex-shrink-0 flex items-center justify-center">
          <Bot size={12} className="text-pink-700" />
        </div>
      </div>
    );
  }

  if (msg.role === "human_agent") {
    return (
      <div className="flex gap-2 justify-end">
        <div className="max-w-[70%]">
          <div className="bg-amber-100 border border-amber-200 rounded-2xl px-4 py-2 text-sm whitespace-pre-wrap">{msg.content}</div>
          <div className="text-[10px] text-neutral-400 mt-0.5 text-right">
            {msg.agent_name || "Mitarbeiterin"} · {time}
          </div>
        </div>
        <div className="w-7 h-7 rounded-full bg-amber-200 flex-shrink-0 flex items-center justify-center">
          <UserCheck size={12} className="text-amber-700" />
        </div>
      </div>
    );
  }

  return null;
}

function DraftBox({
  draft,
  onDone,
}: {
  draft: { id: string; original_text: string; created_at: string };
  onDone: () => void;
}) {
  const [text, setText] = useState(draft.original_text);
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);
  const [busy, setBusy] = useState<"send" | "grammar" | "discard" | null>(null);
  const wasEdited = text.trim() !== draft.original_text.trim();
  const hasNote = note.trim().length > 0;

  async function handleSend() {
    if (!text.trim() || busy) return;
    setBusy("send");
    try {
      await approveDraft(draft.id, text.trim(), note.trim() || undefined);
      onDone();
    } catch (e) {
      alert(`Senden fehlgeschlagen: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  async function handleGrammar() {
    if (!text.trim() || busy) return;
    setBusy("grammar");
    try {
      const res = await fetch("/api/chat/grammar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });
      const data = await res.json();
      if (data.corrected) setText(data.corrected);
    } catch (e) {
      alert(`Grammatik-Check fehlgeschlagen: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  }

  async function handleDiscard() {
    if (busy) return;
    if (!confirm("Diesen Bot-Entwurf verwerfen? Es wird KEINE Nachricht gesendet.")) return;
    setBusy("discard");
    try {
      await discardDraft(draft.id);
      onDone();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="border-t-2 border-blue-200 bg-blue-50/60 p-3 space-y-2">
      <div className="flex items-center gap-2 text-xs text-blue-800">
        <Bot size={12} className="text-blue-600" />
        <span className="font-semibold">Bot-Entwurf wartet auf Freigabe</span>
        {(wasEdited || hasNote) && (
          <span className="bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full text-[10px] font-medium">
            {wasEdited && hasNote ? "editiert + Notiz" : wasEdited ? "editiert" : "Notiz"} — wird als Training gespeichert
          </span>
        )}
        <span className="text-blue-500 ml-auto">
          {new Date(draft.created_at).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={Math.max(4, Math.min(12, (text.match(/\n/g)?.length || 0) + 3))}
        className="w-full rounded-xl border border-blue-200 bg-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
        disabled={busy !== null}
      />

      {/* Strategie-Hinweis (optional) — wird mit Gesprächskontext ins Training übernommen */}
      {showNote ? (
        <div className="space-y-1">
          <label className="text-[11px] font-medium text-blue-700 flex items-center gap-1">
            <Sparkles size={10} /> Strategie-Hinweis fürs Training (optional)
            <button
              type="button"
              onClick={() => { setShowNote(false); setNote(""); }}
              className="ml-auto text-neutral-400 hover:text-neutral-600 text-[10px]"
            >
              Ausblenden
            </button>
          </label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder='z.B. "Zuerst Haarstruktur erfragen bevor Methode empfohlen wird"'
            className="w-full rounded-lg border border-blue-200 bg-white px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-blue-400"
            disabled={busy !== null}
          />
          <div className="text-[10px] text-blue-600">
            Wird zusammen mit dem letzten Gesprächsverlauf gespeichert, damit der Bot lernt WANN diese Antwort passt.
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setShowNote(true)}
          className="text-[11px] text-blue-600 hover:text-blue-800 inline-flex items-center gap-1 underline-offset-2 hover:underline"
        >
          <Sparkles size={10} /> Strategie-Hinweis fürs Training hinzufügen
        </button>
      )}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={handleSend}
          disabled={busy !== null || !text.trim()}
          className="bg-green-600 text-white rounded-xl px-4 py-2 hover:bg-green-700 disabled:opacity-40 inline-flex items-center gap-1 text-xs font-medium"
        >
          <Check size={12} /> {busy === "send" ? "Sende…" : "Senden ✓"}
        </button>
        <button
          onClick={handleGrammar}
          disabled={busy !== null || !text.trim()}
          className="bg-purple-600 text-white rounded-xl px-3 py-2 hover:bg-purple-700 disabled:opacity-40 inline-flex items-center gap-1 text-xs font-medium"
          title="KI korrigiert nur Grammatik/Rechtschreibung — Inhalt + Tonalität bleiben"
        >
          <Wand2 size={12} /> {busy === "grammar" ? "Prüfe…" : "Grammatik per KI"}
        </button>
        <button
          onClick={() => setText(draft.original_text)}
          disabled={busy !== null || text === draft.original_text}
          className="text-xs px-3 py-2 rounded-xl border border-neutral-300 text-neutral-600 hover:bg-neutral-50 disabled:opacity-40 inline-flex items-center gap-1"
        >
          <RotateCcw size={11} /> Original
        </button>
        <button
          onClick={handleDiscard}
          disabled={busy !== null}
          className="text-xs px-3 py-2 rounded-xl border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-40 inline-flex items-center gap-1 ml-auto"
        >
          <X size={11} /> Verwerfen
        </button>
      </div>
    </div>
  );
}
