"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bot, User, UserCheck, Send, Hand, RotateCcw, X, Wrench, Sparkles, Trash2, Power, Check, Wand2, ChevronDown, AlertTriangle, Mail, CornerUpLeft } from "lucide-react";
import CategorySelector from "./category-selector";
import AddToWaitlistButton from "./add-to-waitlist-button";
import TeamNotes from "./team-notes";
import FollowupButton from "./followup-button";
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
  refineDraftWithFeedback,
  generateDraftOnDemand,
  markSessionUnread,
  markSessionAsSeen,
  markSessionAsNotDone,
  markSessionAsRead,
  toggleHumanOnly,
  deleteMessage,
} from "@/lib/actions/chat-inbox";

interface Message {
  id: string;
  role: string;
  content: string | null;
  attachments: { type: string; url: string }[];
  tool_calls: { name: string }[] | null;
  agent_name: string | null;
  auto_sent?: boolean;
  teach_feedback_at?: string | null;
  reply_to?: { role: string; content_preview: string } | null;
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
    customer_full_name: string | null;
    bot_auto_reply: boolean;
    bot_mode: "auto" | "selective_auto" | "assisted" | "off";
    human_only?: boolean;
    team_notes?: string | null;
    team_notes_updated_at?: string | null;
    team_notes_author?: string | null;
    followup_due_at?: string | null;
    followup_reason?: string | null;
    category: null | "availability" | "pricing" | "color_advice" | "appointment" | "complaint" | "order_status" | "gewerbe" | "partnership" | "general";
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
  const [modeSwitching, setModeSwitching] = useState<null | "auto" | "selective_auto" | "assisted" | "off">(null);
  const [generating, setGenerating] = useState(false);
  const [showModeSettings, setShowModeSettings] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
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

  async function handleGenerate() {
    if (generating) return;
    setGenerating(true);
    try {
      const r = await generateDraftOnDemand(session.id);
      if (!r.ok) alert(r.reason);
      else router.refresh();
    } catch (e) {
      alert(`Generierung fehlgeschlagen: ${(e as Error).message}`);
    } finally {
      setGenerating(false);
    }
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
    <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden flex flex-col" style={{ height: "calc(100vh - 110px)" }}>
      {/* Header */}
      <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3 flex-wrap">
          {/* Avatar-Kreis mit Channel-Icon */}
          <div className="w-9 h-9 rounded-full bg-gradient-to-br from-neutral-100 to-neutral-200 flex-shrink-0 flex items-center justify-center text-base">
            {session.channel === "instagram" ? "📷" : session.channel === "whatsapp" ? "💬" : "🌐"}
          </div>
          <div className="flex flex-col gap-0.5">
            <div className="text-sm font-semibold text-neutral-900 leading-tight">
              {session.customer_full_name || session.customer_name || "Unbekannt"}
            </div>
            <div className="text-[11px] text-neutral-500 leading-tight">
              {session.customer_full_name && session.customer_name ? session.customer_name : null}
              {session.customer_full_name && session.customer_name && <span className="mx-1">·</span>}
              <span className={`inline-flex items-center gap-1 ${statusBadge.color.replace("bg-", "text-").split(" ")[0].replace("100", "700")}`}>
                {statusBadge.label}
              </span>
              {session.assigned_name && (
                <>
                  <span className="mx-1">·</span>
                  <span>übernommen von <span className="text-neutral-700">{session.assigned_name}</span></span>
                </>
              )}
            </div>
          </div>
          <div className="h-6 w-px bg-neutral-200 mx-1" />
          <div className="text-xs text-neutral-600 inline-flex items-center gap-1.5">
            <span className="text-neutral-400">Ava von</span>
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
          <CategorySelector sessionId={session.id} currentCategory={session.category} />
        </div>
        <div className="flex gap-1 items-center [&>div.divider]:mx-1 [&>div.divider]:h-5 [&>div.divider]:w-px [&>div.divider]:bg-neutral-200">
          {/* Bot-Modus — klarer Dropdown-Button mit Pfeil, deutlich klickbar */}
          {session.status === "active" && (
            <div className="relative">
              <span className="text-[10px] text-neutral-400 uppercase tracking-wide block mb-0.5">Bot-Modus</span>
              <button
                type="button"
                onClick={() => setShowModeSettings(v => !v)}
                disabled={modeSwitching !== null}
                title="Klick zum Ändern: Manuell · Auto-Entwurf · Smart-Auto · Auto-Antwort"
                className={`inline-flex items-center gap-1.5 text-sm font-medium px-3 py-1.5 rounded-lg border-2 shadow-sm hover:shadow transition ${
                  session.bot_mode === "auto"
                    ? "bg-green-50 text-green-800 border-green-400 hover:bg-green-100"
                    : session.bot_mode === "selective_auto"
                    ? "bg-violet-50 text-violet-800 border-violet-400 hover:bg-violet-100"
                    : session.bot_mode === "assisted"
                    ? "bg-blue-50 text-blue-800 border-blue-400 hover:bg-blue-100"
                    : "bg-white text-neutral-800 border-neutral-400 hover:bg-neutral-50"
                } ${modeSwitching ? "opacity-50 cursor-wait" : "cursor-pointer"}`}
              >
                {session.bot_mode === "auto" ? "🤖"
                 : session.bot_mode === "selective_auto" ? "🧠"
                 : session.bot_mode === "assisted" ? "🧑‍🏫"
                 : "⏸"}
                <span>
                  {session.bot_mode === "auto"           ? "Auto-Antwort" :
                   session.bot_mode === "selective_auto" ? "Smart-Auto" :
                   session.bot_mode === "assisted"       ? "Auto-Entwurf" :
                                                           "Manuell"}
                </span>
                <ChevronDown size={14} className={`transition-transform ${showModeSettings ? "rotate-180" : ""}`} />
              </button>
              {showModeSettings && (
                <>
                  {/* Click-outside-overlay */}
                  <div className="fixed inset-0 z-10" onClick={() => setShowModeSettings(false)} />
                  <div className="absolute left-0 top-full mt-1 z-20 w-80 bg-white border border-neutral-200 rounded-xl shadow-xl p-2 space-y-1">
                    <div className="text-[10px] font-semibold text-neutral-500 uppercase tracking-wide px-2 pt-1">
                      Was passiert bei neuer Kundennachricht?
                    </div>
                    {([
                      { v: "off",            icon: "⏸",    color: "neutral", label: "Manuell",       desc: "Bot tut nichts. Du klickst pro Antwort auf „Antwort generieren\"." },
                      { v: "assisted",       icon: "🧑‍🏫", color: "blue",    label: "Auto-Entwurf",  desc: "Bot generiert IMMER einen Entwurf, du bestätigst vor dem Senden." },
                      { v: "selective_auto", icon: "🧠",   color: "violet",  label: "Smart-Auto",    desc: "Bot prüft selbst: bei einfachen Fragen (Verfügbarkeit, Info) antwortet er autonom, sonst Entwurf." },
                      { v: "auto",           icon: "🤖",   color: "green",   label: "Auto-Antwort",  desc: "Bot sendet IMMER selbst ohne Rückfrage. Nur für eingespielte Avatare." },
                    ] as const).map(opt => {
                      const isActive = session.bot_mode === opt.v;
                      return (
                        <button
                          key={opt.v}
                          onClick={() => {
                            setModeSwitching(opt.v);
                            setShowModeSettings(false);
                            startTransition(async () => {
                              try {
                                await setBotMode(session.id, opt.v);
                                router.refresh();
                              } finally { setModeSwitching(null); }
                            });
                          }}
                          className={`w-full text-left p-2.5 rounded-lg border-2 transition ${
                            isActive
                              ? opt.color === "green"   ? "border-green-400 bg-green-50"
                              : opt.color === "violet"  ? "border-violet-400 bg-violet-50"
                              : opt.color === "blue"    ? "border-blue-400 bg-blue-50"
                              :                            "border-neutral-400 bg-neutral-50"
                              : "border-transparent hover:bg-neutral-50"
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-lg">{opt.icon}</span>
                            <span className="text-sm font-semibold text-neutral-900">{opt.label}</span>
                            {isActive && <Check size={14} className="text-green-600 ml-auto" />}
                          </div>
                          <div className="text-[11px] text-neutral-600 mt-0.5 ml-7">{opt.desc}</div>
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          )}
          {modeSwitching && (
            <span className="inline-flex items-center gap-1 text-[11px] text-neutral-500">
              <RotateCcw size={11} className="animate-spin" />
              wechsle…
            </span>
          )}
          <div className="divider" />
          {!isTakenOver && session.status !== "closed" && (
            <button
              onClick={handleTakeover}
              disabled={isPending}
              className="h-8 px-3 rounded-lg bg-amber-500 text-white text-xs font-medium hover:bg-amber-600 inline-flex items-center gap-1.5 disabled:opacity-50 shadow-sm"
            >
              <Hand size={13} /> Übernehmen
            </button>
          )}
          {isTakenOver && (
            <button
              onClick={handleResume}
              disabled={isPending}
              className="h-8 px-3 rounded-lg bg-green-500 text-white text-xs font-medium hover:bg-green-600 inline-flex items-center gap-1.5 disabled:opacity-50 shadow-sm"
            >
              <RotateCcw size={13} /> Zurück an Bot
            </button>
          )}
          <div className="divider" />
          {session.status !== "closed" && (
            <SplitButton
              primaryLabel="Erledigt"
              primaryIcon={<Check size={13} />}
              primaryTitle="Markiert die Session als erledigt — sie verschwindet aus 'Nur unbeantwortet'"
              primaryClass="text-emerald-700 hover:bg-emerald-50"
              onPrimary={() => startTransition(async () => { await markSessionAsSeen(session.id); router.refresh(); })}
              menuLabel="✗ Nicht erledigt"
              menuTitle="Session wieder als 'noch zu tun' markieren"
              onMenu={() => startTransition(async () => { await markSessionAsNotDone(session.id); router.refresh(); })}
              disabled={isPending}
            />
          )}
          <div className="divider" />
          {session.status !== "closed" && (
            <AddToWaitlistButton sessionId={session.id} />
          )}
          <div className="divider" />
          {session.status !== "closed" && (
            <FollowupButton
              sessionId={session.id}
              initialDueAt={session.followup_due_at ?? null}
            />
          )}
          <div className="divider" />
          {session.status !== "closed" && (
            <button
              onClick={() => startTransition(async () => {
                await toggleHumanOnly(session.id, !session.human_only);
                router.refresh();
              })}
              disabled={isPending}
              title={session.human_only
                ? "Bot wieder zulassen"
                : "Diese Session ist 'Nur für Team' — Bot antwortet nicht mehr selbstständig"}
              className={`h-8 px-3 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-50 transition ${
                session.human_only
                  ? "bg-rose-500 text-white hover:bg-rose-600 shadow-sm"
                  : "text-rose-700 hover:bg-rose-50"
              }`}
            >
              <AlertTriangle size={13} /> {session.human_only ? "Nur Team aktiv" : "Nur Team"}
            </button>
          )}
          <div className="divider" />
          {session.status !== "closed" && (
            <SplitButton
              primaryLabel="Ungelesen"
              primaryIcon={<Mail size={13} />}
              primaryTitle="Setzt die Session wieder auf 'ungelesen' (Name wird in der Inbox fett)"
              primaryClass="text-neutral-600 hover:bg-neutral-100"
              onPrimary={() => startTransition(async () => { await markSessionUnread(session.id); router.refresh(); })}
              menuLabel="✓ Gelesen"
              menuTitle="Name in der Inbox wieder normal (nicht fett) machen"
              onMenu={() => startTransition(async () => { await markSessionAsRead(session.id); router.refresh(); })}
              disabled={isPending}
            />
          )}
          <div className="divider" />
          {/* Schließen + Löschen ins Overflow-Menü — selten genutzte
              destruktive Aktionen, gehören nicht permanent sichtbar. */}
          <OverflowMenu>
            {session.status !== "closed" && (
              <button
                onClick={handleClose}
                disabled={isPending}
                className="w-full text-left text-xs px-3 py-2 rounded-md hover:bg-neutral-50 text-neutral-700 inline-flex items-center gap-2 disabled:opacity-50"
              >
                <X size={12} /> Session schließen
              </button>
            )}
            <button
              onClick={handleDelete}
              disabled={isPending}
              title="Session komplett löschen"
              className="w-full text-left text-xs px-3 py-2 rounded-md hover:bg-red-50 text-red-600 inline-flex items-center gap-2 disabled:opacity-50"
            >
              <Trash2 size={12} /> Session löschen
            </button>
          </OverflowMenu>
        </div>
      </div>

      {/* Banner — sehr sichtbar während Bot generiert (egal ob via Mode-Switch oder Button) */}
      {(modeSwitching === "assisted" || generating) && (
        <div className="border-b border-blue-200 bg-gradient-to-r from-blue-50 via-blue-100 to-blue-50 px-5 py-3 flex items-center gap-3">
          <div className="relative">
            <div className="w-8 h-8 rounded-full bg-blue-200 flex items-center justify-center">
              <Bot size={16} className="text-blue-700" />
            </div>
            <div className="absolute inset-0 rounded-full border-2 border-blue-400 border-t-transparent animate-spin" />
          </div>
          <div className="flex-1">
            <div className="text-sm font-semibold text-blue-900">Bot generiert Entwurf…</div>
            <div className="text-xs text-blue-700">Liest Gesprächsverlauf, prüft Lagerbestand und schreibt Antwort auf die offenen Nachrichten. Dauert ca. 5-15 Sekunden.</div>
          </div>
        </div>
      )}

      {/* Team-Notiz — schlanker Chip im Header-Bereich, NICHT im Chat-Verlauf.
          Default: 1-Zeilen-Preview oder dezenter "+ Notiz"-Link. Klick öffnet
          den Editor inline. So nervt's nicht beim Lesen der Konversation. */}
      <div className="px-5 py-2 border-b border-neutral-100 bg-white">
        <TeamNotes
          sessionId={session.id}
          initialNotes={session.team_notes ?? null}
          updatedAt={session.team_notes_updated_at ?? null}
          author={session.team_notes_author ?? null}
        />
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 bg-neutral-50">
        {messages.length === 0 && (
          <div className="text-center text-neutral-400 mt-12 text-sm">Noch keine Nachrichten</div>
        )}
        {messages.map(m => (
          <MessageRow
            key={m.id}
            msg={m}
            signatureName={session.bot_signature_name}
            onDeleted={() => setMessages(curr => curr.filter(x => x.id !== m.id))}
            onImageClick={(url) => setLightboxImage(url)}
          />
        ))}
      </div>

      {/* Lightbox-Modal für Vollbild-Anzeige */}
      {lightboxImage && (
        <div
          className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center p-4 cursor-zoom-out"
          onClick={() => setLightboxImage(null)}
          onKeyDown={(e) => { if (e.key === "Escape") setLightboxImage(null); }}
          tabIndex={-1}
        >
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setLightboxImage(null); }}
            className="absolute top-4 right-4 bg-white/10 hover:bg-white/20 text-white rounded-full p-2 transition"
            aria-label="Schließen"
          >
            <X size={20} />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={lightboxImage}
            alt="Vollbild"
            className="max-h-[95vh] max-w-[95vw] object-contain rounded-lg shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}

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
      ) : session.status === "active" && pendingDraft ? (
        <DraftBox
          draft={pendingDraft}
          onDone={() => router.refresh()}
        />
      ) : session.status === "active" ? (
        <div className="border-t border-neutral-100 p-3 flex items-center justify-between gap-3 flex-wrap bg-gradient-to-r from-blue-50/40 to-transparent">
          <div className="text-xs text-neutral-500 flex-1 min-w-0">
            {session.bot_mode === "auto"
              ? <span>🤖 Bot antwortet bei neuen Nachrichten automatisch.</span>
              : session.bot_mode === "assisted"
              ? <span>🧑‍🏫 Bot bereitet bei neuen Nachrichten automatisch einen Entwurf vor.</span>
              : <span>Klick auf <b>Antwort generieren</b> und Bot schreibt einen Entwurf zur aktuellen Lage.</span>}
          </div>
          <div className="flex gap-2 items-center">
            <button
              onClick={handleGenerate}
              disabled={generating || isPending}
              className="bg-blue-600 text-white rounded-xl px-4 py-2 hover:bg-blue-700 disabled:opacity-40 inline-flex items-center gap-1.5 text-sm font-medium shadow-sm"
            >
              <Sparkles size={14} className={generating ? "animate-pulse" : ""} />
              {generating ? "Generiert…" : "Antwort generieren"}
            </button>
            <button
              onClick={handleTakeover}
              disabled={isPending}
              className="text-xs px-3 py-2 rounded-xl border border-neutral-300 text-neutral-600 hover:bg-neutral-50 inline-flex items-center gap-1"
            >
              <Hand size={12} /> selbst antworten
            </button>
          </div>
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

function formatMsgTime(iso: string): string {
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  const isYesterday = d.toDateString() === yesterday.toDateString();
  const sameYear = d.getFullYear() === now.getFullYear();
  const time = d.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  if (sameDay)     return `heute · ${time}`;
  if (isYesterday) return `gestern · ${time}`;
  if (sameYear)    return `${d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })} · ${time}`;
  return `${d.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" })} · ${time}`;
}

function MessageRow({ msg, signatureName, onDeleted, onImageClick }: { msg: Message; signatureName: string | null; onDeleted: () => void; onImageClick?: (url: string) => void }) {
  const time = formatMsgTime(msg.created_at);
  const router = useRouter();
  const [deleting, setDeleting] = useState(false);

  async function handleDelete() {
    if (deleting) return;
    if (!confirm("Diese Nachricht aus dem Verlauf entfernen?\n\nWird nur im Dashboard ausgeblendet — die Nachricht bei Instagram bleibt unverändert. Bot ignoriert sie dann bei zukünftigen Antworten.")) return;
    setDeleting(true);
    try {
      await deleteMessage(msg.id);
      onDeleted();
      router.refresh();
    } catch (e) {
      alert(`Löschen fehlgeschlagen: ${(e as Error).message}`);
    } finally {
      setDeleting(false);
    }
  }

  const DeleteBtn = (
    <button
      onClick={handleDelete}
      disabled={deleting}
      title="Nachricht aus Inbox entfernen (nur intern, IG bleibt unverändert)"
      className="opacity-0 group-hover:opacity-100 transition text-neutral-300 hover:text-red-500 p-1"
    >
      <Trash2 size={12} />
    </button>
  );

  // Reply-Threading: wenn diese Nachricht eine direkte Antwort auf eine
  // frühere Nachricht ist (Instagram-Reply-Feature), zeigen wir wie auf
  // Instagram darüber einen kleinen "Antwort auf"-Snippet mit Vorschau.
  const ReplyPreview = msg.reply_to ? (
    <div className="mb-1 text-[11px] text-neutral-500 flex items-start gap-1 border-l-2 border-neutral-300 pl-2 max-w-full">
      <CornerUpLeft size={11} className="mt-0.5 flex-shrink-0 text-neutral-400" />
      <div className="min-w-0">
        <span className="font-medium text-neutral-600">
          {msg.reply_to.role === "user" ? "Kunde" : msg.reply_to.role === "assistant" ? "Ava" : "Mitarbeiterin"}:
        </span>{" "}
        <span className="italic">
          {msg.reply_to.content_preview.length >= 140
            ? msg.reply_to.content_preview + "…"
            : msg.reply_to.content_preview}
        </span>
      </div>
    </div>
  ) : null;

  if (msg.role === "user") {
    return (
      <div className="group flex gap-2 justify-start items-start">
        <div className="w-7 h-7 rounded-full bg-neutral-200 flex-shrink-0 flex items-center justify-center">
          <User size={12} className="text-neutral-600" />
        </div>
        <div className="max-w-[70%]">
          {ReplyPreview}
          {/* Text nur anzeigen wenn nicht reiner [Foto]-Platzhalter mit Image-Attachment */}
          {(() => {
            const hasImage = msg.attachments?.some(a => a.type === "image" && a.url);
            const isJustFotoPlaceholder = hasImage && (msg.content || "").trim() === "[Foto]";
            if (isJustFotoPlaceholder || !msg.content) return null;
            return (
              <div className="bg-white border border-neutral-200 rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap shadow-sm">{msg.content}</div>
            );
          })()}
          {msg.attachments?.length > 0 && (
            <div className="flex gap-1.5 mt-1 flex-wrap">
              {msg.attachments.map((a, i) =>
                a.type === "image" && a.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={i}
                    src={a.url}
                    alt="Anhang"
                    onClick={() => onImageClick?.(a.url)}
                    className="max-h-48 max-w-[200px] rounded-xl border border-neutral-200 shadow-sm cursor-zoom-in hover:shadow-md hover:border-neutral-400 transition object-cover"
                  />
                ) : (
                  <a key={i} href={a.url} target="_blank" rel="noopener" className="text-xs text-blue-600 underline">
                    📎 {a.type}
                  </a>
                )
              )}
            </div>
          )}
          <div className="text-[10px] text-neutral-400 mt-0.5">Kunde · {time}</div>
        </div>
        <div className="self-start">{DeleteBtn}</div>
      </div>
    );
  }

  if (msg.role === "assistant") {
    return (
      <div className="group flex gap-2 justify-end items-start">
        <div className="self-start order-first">{DeleteBtn}</div>
        <div className="max-w-[70%]">
          {ReplyPreview}
          <div className="bg-rose-50 border border-rose-100/80 rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap shadow-sm">{msg.content}</div>
          {msg.tool_calls && msg.tool_calls.length > 0 && (
            <div className="mt-1 text-[10px] text-neutral-500 inline-flex items-center gap-1">
              <Wrench size={10} />
              Tools: {msg.tool_calls.map(t => t.name).join(", ")}
            </div>
          )}
          <div className="text-[10px] text-neutral-400 mt-0.5 text-right inline-flex items-center justify-end gap-1.5 w-full">
            {msg.auto_sent ? (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200 font-medium" title="Autonom vom Bot gesendet, ohne Mitarbeiter-Approve">
                🤖 autobot
              </span>
            ) : (
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 font-medium" title="Vom Mitarbeiter via Auto-Entwurf approved">
                🧑‍🏫 manueller autobot
              </span>
            )}
            <span>Ava von {signatureName || "—"} · {time}</span>
          </div>
          {/* Nachtraining-Box für Autobot-Antworten */}
          {msg.auto_sent && (
            <AutobotTeachBox messageId={msg.id} originalText={msg.content || ""} alreadyTaught={!!msg.teach_feedback_at} />
          )}
        </div>
        <div className="w-7 h-7 rounded-full bg-rose-100 flex-shrink-0 flex items-center justify-center">
          <Bot size={12} className="text-rose-600" />
        </div>
      </div>
    );
  }

  if (msg.role === "human_agent") {
    return (
      <div className="group flex gap-2 justify-end items-start">
        <div className="self-start order-first">{DeleteBtn}</div>
        <div className="max-w-[70%]">
          {ReplyPreview}
          <div className="bg-orange-50 border border-orange-100/80 rounded-2xl px-4 py-2.5 text-sm whitespace-pre-wrap shadow-sm">{msg.content}</div>
          <div className="text-[10px] text-neutral-400 mt-0.5 text-right">
            {msg.agent_name || "Mitarbeiterin"} · {time}
          </div>
        </div>
        <div className="w-7 h-7 rounded-full bg-orange-100 flex-shrink-0 flex items-center justify-center">
          <UserCheck size={12} className="text-orange-600" />
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
  const [refineInput, setRefineInput] = useState("");
  const [refineLog, setRefineLog] = useState<string[]>([]);
  const [busy, setBusy] = useState<"send" | "grammar" | "discard" | "refine" | null>(null);
  // Aktueller Stand vs Original: zeigt ob editiert
  const wasEdited = text.trim() !== draft.original_text.trim();
  const hasNote = note.trim().length > 0;
  // Trainings-Speicherung: Default an, Mitarbeiterin kann abklicken (z.B. bei
  // situativen Einzelfällen, die das Bot-Verhalten nicht trainieren sollen).
  const [saveAsTraining, setSaveAsTraining] = useState(true);

  // Resize-State: Höhe der Draft-Box (verschiebbar via Drag-Handle oben)
  const [height, setHeight] = useState<number>(() => {
    if (typeof window === "undefined") return 380;
    const saved = parseInt(localStorage.getItem("draftBoxHeight") || "0", 10);
    return saved > 0 ? saved : 380;
  });
  const [collapsed, setCollapsed] = useState(false);
  const dragStartRef = useRef<{ y: number; h: number } | null>(null);
  useEffect(() => {
    function onMove(e: MouseEvent) {
      if (!dragStartRef.current) return;
      const delta = dragStartRef.current.y - e.clientY;        // hoch ziehen = größer
      const next = Math.max(180, Math.min(window.innerHeight * 0.8, dragStartRef.current.h + delta));
      setHeight(next);
    }
    function onUp() {
      if (dragStartRef.current) {
        try { localStorage.setItem("draftBoxHeight", String(height)); } catch {}
      }
      dragStartRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [height]);

  function startResize(e: React.MouseEvent) {
    dragStartRef.current = { y: e.clientY, h: height };
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
  }

  async function handleSend() {
    if (!text.trim() || busy) return;
    setBusy("send");
    try {
      await approveDraft(draft.id, text.trim(), note.trim() || undefined, saveAsTraining);
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

  async function handleRefine() {
    if (!refineInput.trim() || busy) return;
    const fb = refineInput.trim();
    setBusy("refine");
    try {
      const r = await refineDraftWithFeedback(draft.id, text.trim(), fb);
      setText(r.newText);
      setRefineLog(l => [...l, fb]);
      setRefineInput("");
    } catch (e) {
      alert(`Neu generieren fehlgeschlagen: ${(e as Error).message}`);
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
    <div
      className="border-t-2 border-blue-200 bg-blue-50/60 flex flex-col relative"
      style={{ height: collapsed ? 56 : height, transition: dragStartRef.current ? "none" : "height 0.15s" }}
    >
      {/* Drag-Handle oben — Resize per Maus-Ziehen */}
      <div
        onMouseDown={startResize}
        title="Ziehen um Höhe zu ändern"
        className="h-2 -mt-1 cursor-row-resize group flex items-center justify-center hover:bg-blue-200/60 transition"
      >
        <div className="w-12 h-1 rounded-full bg-blue-300 group-hover:bg-blue-500 transition" />
      </div>

      {/* Header */}
      <div className="px-3 pt-1 pb-2 flex items-center gap-2 text-xs text-blue-800 flex-wrap shrink-0">
        <Bot size={12} className="text-blue-600" />
        <span className="font-semibold">Bot-Entwurf wartet auf Freigabe</span>
        {(wasEdited || hasNote || refineLog.length > 0) && (
          <label
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium cursor-pointer select-none transition ${
              saveAsTraining
                ? "bg-amber-100 text-amber-800 hover:bg-amber-200"
                : "bg-neutral-100 text-neutral-500 hover:bg-neutral-200"
            }`}
            title={saveAsTraining
              ? "Klick zum Abwählen: für situative Einzelfälle, die das Bot-Training nicht beeinflussen sollen"
              : "Klick zum Anklicken: diese Korrektur wird als Training gespeichert, der Bot lernt für ähnliche Fälle"}
          >
            <input
              type="checkbox"
              checked={saveAsTraining}
              onChange={(e) => setSaveAsTraining(e.target.checked)}
              className="w-3 h-3 accent-amber-700"
            />
            {[
              refineLog.length > 0 ? `${refineLog.length}× neu generiert` : null,
              wasEdited ? "editiert" : null,
              hasNote ? "Notiz" : null,
            ].filter(Boolean).join(" + ")}{" "}
            {saveAsTraining ? "— als Training speichern" : "— NICHT als Training (situativ)"}
          </label>
        )}
        <span className="text-blue-500 ml-auto inline-flex items-center gap-2">
          {formatMsgTime(draft.created_at)}
          <button
            type="button"
            onClick={() => setCollapsed(c => !c)}
            title={collapsed ? "Aufklappen" : "Einklappen — nur Header zeigen"}
            className="text-blue-500 hover:text-blue-800 px-1.5 py-0.5 rounded text-xs"
          >
            {collapsed ? "▼ Aufklappen" : "▲ Einklappen"}
          </button>
        </span>
      </div>

      {/* Scrollbarer Inhalt */}
      <div className={`flex-1 min-h-0 overflow-y-auto px-3 pb-3 space-y-2 ${collapsed ? "hidden" : ""}`}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={Math.max(4, Math.min(12, (text.match(/\n/g)?.length || 0) + 3))}
        className="w-full rounded-xl border border-blue-200 bg-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400 resize-none"
        disabled={busy !== null}
      />

      {/* Refine-Loop: Bot per Beschreibung anweisen statt selbst editieren */}
      <div className="rounded-xl border border-purple-200 bg-purple-50/40 p-2.5 space-y-1.5">
        <div className="text-[11px] font-medium text-purple-700 flex items-center gap-1">
          <Wand2 size={11} /> Bot anweisen — sag in Worten was falsch ist
        </div>
        {refineLog.length > 0 && (
          <div className="space-y-1">
            {refineLog.map((fb, i) => (
              <div key={i} className="text-[11px] text-purple-900 bg-white border border-purple-100 rounded-md px-2 py-1">
                <span className="font-medium text-purple-500">#{i + 1}:</span> {fb}
              </div>
            ))}
          </div>
        )}
        <div className="flex gap-1.5">
          <input
            type="text"
            value={refineInput}
            onChange={(e) => setRefineInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleRefine(); }
            }}
            placeholder='z.B. "Kürzer halten, keine Markdown-Formatierung, erst nach Haarstruktur fragen"'
            className="flex-1 rounded-lg border border-purple-200 bg-white px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-purple-400"
            disabled={busy !== null}
          />
          <button
            type="button"
            onClick={handleRefine}
            disabled={busy !== null || !refineInput.trim()}
            className="bg-purple-600 text-white rounded-lg px-3 py-1.5 hover:bg-purple-700 disabled:opacity-40 inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap"
          >
            <RotateCcw size={11} /> {busy === "refine" ? "Schreibt…" : "Neu generieren"}
          </button>
        </div>
        <div className="text-[10px] text-purple-500">
          Bot bekommt den ganzen Chat-Verlauf + alle bisherigen Feedbacks und schreibt die Antwort neu. Beim finalen Senden landen alle deine Kommentare als Lern-Hinweis im Training.
        </div>
      </div>

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
      </div>{/* End scrollbarer Inhalt */}

      {/* Fixe Action-Bar — immer sichtbar, egal wie lang der Entwurf ist */}
      <div className={`shrink-0 border-t border-blue-200 px-3 py-2 bg-gradient-to-b from-blue-50/60 to-blue-50/30 ${collapsed ? "hidden" : ""}`}>
        <div className="flex gap-2 flex-wrap items-center">
          <button
            onClick={handleSend}
            disabled={busy !== null || !text.trim()}
            className="bg-green-600 text-white rounded-xl px-4 py-2 hover:bg-green-700 disabled:opacity-40 inline-flex items-center gap-1 text-xs font-medium shadow-sm"
          >
            <Check size={12} /> {busy === "send" ? "Sende…" : "Senden ✓"}
          </button>
          <button
            onClick={handleGrammar}
            disabled={busy !== null || !text.trim()}
            className="bg-purple-600 text-white rounded-xl px-3 py-2 hover:bg-purple-700 disabled:opacity-40 inline-flex items-center gap-1 text-xs font-medium shadow-sm"
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
    </div>
  );
}

/**
 * 3-Punkte-Menü für sekundäre/destruktive Aktionen — versteckt sich hinter
 * einem "•••"-Button damit die Haupt-Action-Reihe schlanker bleibt.
 */
function OverflowMenu({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-flex">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        title="Mehr Aktionen"
        className="h-8 w-8 rounded-lg text-neutral-500 hover:bg-neutral-100 inline-flex items-center justify-center transition"
      >
        •••
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-20 min-w-[200px] bg-white border border-neutral-200 rounded-lg shadow-lg p-1 space-y-0.5" onClick={() => setOpen(false)}>
            {children}
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Split-Button: linker Teil führt die Primär-Aktion aus, rechter Chevron
 * öffnet ein Mini-Menü mit der Gegen-Aktion. Beide Hälften teilen denselben
 * Outline-Style, sind aber per Linie getrennt.
 */
function SplitButton({
  primaryLabel, primaryIcon, primaryTitle, primaryClass, onPrimary,
  menuLabel, menuTitle, onMenu,
  disabled,
}: {
  primaryLabel: string;
  primaryIcon?: React.ReactNode;
  primaryTitle: string;
  primaryClass: string;
  onPrimary: () => void;
  menuLabel: string;
  menuTitle: string;
  onMenu: () => void;
  disabled?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative inline-flex">
      <button
        type="button"
        onClick={onPrimary}
        disabled={disabled}
        title={primaryTitle}
        className={`h-8 pl-3 pr-2 rounded-l-lg text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-50 transition ${primaryClass}`}
      >
        {primaryIcon}
        {primaryLabel}
      </button>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        disabled={disabled}
        aria-label="Weitere Optionen"
        className={`h-8 px-1.5 rounded-r-lg text-xs inline-flex items-center disabled:opacity-50 border-l border-current/10 transition ${primaryClass}`}
      >
        <ChevronDown size={12} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute left-0 top-full mt-1 z-20 min-w-[180px] bg-white border border-neutral-200 rounded-lg shadow-lg p-1">
            <button
              type="button"
              onClick={() => { setOpen(false); onMenu(); }}
              title={menuTitle}
              className="w-full text-left text-xs px-2.5 py-1.5 rounded-md hover:bg-neutral-50 text-neutral-700"
            >
              {menuLabel}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/**
 * Inline-Nachtraining-Box für autonom-gesendete Bot-Antworten.
 * Klick auf "🎓 Für nächstes Mal trainieren" öffnet 2 Felder:
 *   - korrigierte Variante (was der Bot besser gesagt hätte)
 *   - Notiz (warum die Original-Antwort schlecht war)
 * Submit schickt das via Server-Action teachFromAutobotMessage an chatbot_training
 * — die ORIGINAL-Bot-Message bleibt unverändert im Chat, der Eintrag dient nur
 * dem zukünftigen Bot-Lernen.
 */
function AutobotTeachBox({
  messageId,
  originalText,
  alreadyTaught,
}: { messageId: string; originalText: string; alreadyTaught: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState(originalText);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(alreadyTaught);

  if (done) {
    return (
      <div className="mt-1 inline-flex items-center gap-1 text-[10px] text-emerald-700">
        <Check size={10} /> Nachtrainiert — Bot lernt fürs nächste Mal
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mt-1 inline-flex items-center gap-1 text-[10px] text-purple-600 hover:text-purple-900 underline-offset-2 hover:underline"
        title="Bot-Antwort war nicht optimal? Sag dem Bot wie es besser wäre — er lernt für ähnliche Fälle"
      >
        <Sparkles size={10} /> Für nächstes Mal trainieren
      </button>
    );
  }

  async function submit() {
    if (!text.trim() || !note.trim()) return;
    setBusy(true);
    try {
      const { teachFromAutobotMessage } = await import("@/lib/actions/chat-inbox");
      await teachFromAutobotMessage(messageId, text.trim(), note.trim());
      setDone(true);
      setOpen(false);
      router.refresh();
    } catch (e) {
      alert(`Training fehlgeschlagen: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-2 rounded-xl border border-purple-200 bg-purple-50/40 p-2.5 space-y-2 text-left">
      <div className="text-[11px] font-medium text-purple-700 flex items-center gap-1">
        <Sparkles size={11} /> Nachtraining für diese Autobot-Antwort
      </div>
      <div className="space-y-1">
        <label className="text-[10px] font-medium text-purple-700">Wie hätte der Bot besser geantwortet?</label>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={5}
          className="w-full rounded-lg border border-purple-200 bg-white px-3 py-2 text-xs focus:outline-none focus:ring-2 focus:ring-purple-400 resize-none"
          disabled={busy}
        />
      </div>
      <div className="space-y-1">
        <label className="text-[10px] font-medium text-purple-700">Was war an der Original-Antwort falsch / nicht gut? (wird als Lern-Hinweis gespeichert)</label>
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder='z.B. "ETA-Datum war aus falscher Linie" / "Soll erst nach Foto fragen statt direkt Empfehlung"'
          className="w-full rounded-lg border border-purple-200 bg-white px-3 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-purple-400"
          disabled={busy}
        />
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={busy || !text.trim() || !note.trim()}
          className="bg-purple-600 text-white rounded-lg px-3 py-1.5 hover:bg-purple-700 disabled:opacity-40 inline-flex items-center gap-1 text-xs font-medium"
        >
          <Check size={11} /> {busy ? "Speichere…" : "Als Training speichern"}
        </button>
        <button
          type="button"
          onClick={() => { setOpen(false); setText(originalText); setNote(""); }}
          disabled={busy}
          className="text-xs px-3 py-1.5 rounded-lg border border-neutral-300 text-neutral-600 hover:bg-neutral-50"
        >
          Abbrechen
        </button>
      </div>
      <div className="text-[10px] text-purple-600">
        💡 Die Original-Nachricht bleibt unverändert im Chat — wir speichern die Korrektur nur als Lern-Beispiel für ähnliche zukünftige Fälle.
      </div>
    </div>
  );
}
