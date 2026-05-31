"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Bot, User, UserCheck, Send, Hand, RotateCcw, X, Wrench, Sparkles, Trash2, Power, Check, Wand2, ChevronDown, AlertTriangle, Mail, CornerUpLeft } from "lucide-react";
import CategorySelector from "./category-selector";
import AdditionalCategoriesSelector from "./additional-categories-selector";
import AddToWaitlistButton from "./add-to-waitlist-button";
import TeamNotes from "./team-notes";
import FollowupButton from "./followup-button";
import LoadOlderMessagesButton from "./load-older-messages-button";
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
  markSessionAsOpened,
  toggleHumanOnly,
  deleteMessage,
} from "@/lib/actions/chat-inbox";
import { cancelReservation } from "@/lib/actions/chat-reservations";

interface Message {
  id: string;
  role: string;
  content: string | null;
  attachments: { type: string; url: string }[];
  tool_calls: { name: string }[] | null;
  agent_name: string | null;
  auto_sent?: boolean;
  teach_feedback_at?: string | null;
  teach_sentiment?: "positive" | "correction" | null;
  reply_to?: { id?: string | null; role: string; content_preview: string } | null;
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
    category: null | "availability" | "pricing" | "color_advice" | "appointment" | "complaint" | "order_status" | "gewerbe" | "partnership" | "models" | "general";
    additional_categories?: Array<"availability" | "pricing" | "color_advice" | "appointment" | "complaint" | "order_status" | "gewerbe" | "partnership" | "models" | "general">;
    assigned_name: string | null;
  };
  initialMessages: Message[];
  avatarOptions: string[];
  pendingDraft: { id: string; original_text: string; created_at: string } | null;
  /**
   * Ziel für post-Aktion-Redirects (Close / Delete). Enthält den
   * zurückkonstruierten Inbox-Zustand (View/Filter/Sort/Unread-Toggle), damit
   * die MA nach „Erledigt" oder „Löschen" wieder im gleichen Tab landet.
   * Default: /chatbot/inbox.
   */
  backInboxHref?: string;
  /**
   * Aktive Wartelisten-Reservierungen dieser Session (status = waiting).
   * Werden als Info-Banner unter dem Header gezeigt mit Storno-Button.
   */
  activeReservations?: Array<{
    id: string;
    product_name: string;
    product_url: string | null;
    color: string | null;
    method: string | null;
    eta_hint: string | null;
    notes: string | null;
    requested_at: string | null;
  }>;
}

export default function ChatSessionView({ session, initialMessages, avatarOptions, pendingDraft, backInboxHref = "/chatbot/inbox", activeReservations = [] }: Props) {
  const router = useRouter();
  const [messages, setMessages] = useState(initialMessages);
  const [input, setInput] = useState("");
  const [isPending, startTransition] = useTransition();
  const [suggesting, setSuggesting] = useState(false);
  const [polishing, setPolishing] = useState(false);
  const [andResume, setAndResume] = useState(false);
  const [modeSwitching, setModeSwitching] = useState<null | "auto" | "selective_auto" | "assisted" | "off">(null);
  const [generating, setGenerating] = useState(false);
  const [showModeSettings, setShowModeSettings] = useState(false);
  const [lightboxImage, setLightboxImage] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  // INSTAGRAM-STYLE "gelesen"-Marker: feuert NUR beim Component-Mount —
  // also bei echter Navigation auf die Detail-Page (z.B. Klick aus der
  // Inbox). router.refresh() innerhalb der Page unmountet nicht und löst
  // dies daher NICHT aus → "Ungelesen"-Sentinel bleibt sticky bis zur
  // nächsten echten Navigation. Architektur-Bug 2026-05-29 dadurch
  // strukturell gelöst.
  useEffect(() => {
    void markSessionAsOpened(session.id).catch(() => {
      // Silent — Marker ist Nice-to-have, kein Block für die UI
    });
    // Bewusst nur session.id als Dep — wir feuern pro Session genau einmal
    // beim Mount. Wechsel auf eine andere Session-Detail-Page unmountet
    // und remounted die Komponente → neuer Mount → erneuter Marker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id]);

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

  /**
   * Polish-Modus: MA hat einen Entwurf mit Klammer-Anweisungen geschrieben
   * (z.B. „... schau mal [füge hier den link ein]"). KI:
   *  - korrigiert Grammatik
   *  - führt die Klammer-Anweisungen aus (Tool-Lookups für URLs etc.)
   *  - gibt polierten Text zurück
   * Voraussetzung: input darf nicht leer sein.
   */
  async function handlePolish() {
    if (polishing) return;
    const draft = input.trim();
    if (!draft) {
      alert("Schreib erst einen Entwurf — die KI poliert dann den Text und führt deine [Klammer-Anweisungen] aus.");
      return;
    }
    setPolishing(true);
    try {
      const res = await fetch("/api/chat/polish", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId: session.id, draftText: draft }),
      });
      if (!res.ok) {
        const err = await res.json();
        alert(`Polieren fehlgeschlagen: ${err.error}`);
        return;
      }
      const data = await res.json();
      if (data.polished) {
        setInput(data.polished);
      }
    } catch (e) {
      alert(`Fehler: ${(e as Error).message}`);
    } finally {
      setPolishing(false);
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
      router.push(backInboxHref);
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
      if (!r.ok) {
        // Skip-Errors human-readable übersetzen
        const friendly = friendlyErrorMessage(r.reason || "Unbekannter Fehler");
        alert(friendly);
      } else {
        router.refresh();
      }
    } catch (e) {
      alert(`Generierung fehlgeschlagen: ${friendlyErrorMessage((e as Error).message)}`);
    } finally {
      setGenerating(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Diese Session komplett löschen (mit allen Nachrichten)? Kann nicht rückgängig gemacht werden.")) return;
    startTransition(async () => {
      await deleteSession(session.id);
      router.push(backInboxHref);
    });
  }

  async function handleCancelReservation(reservationId: string, productName: string) {
    const reason = prompt(`Warteliste-Reservierung für "${productName}" wirklich löschen?\n\nOptional: Grund eingeben (z.B. "Kundin hat anderweitig bestellt").`, "");
    if (reason === null) return; // Abbrechen
    startTransition(async () => {
      try {
        await cancelReservation(reservationId, reason || undefined);
        router.refresh();
      } catch (e) {
        alert(`Fehler beim Stornieren: ${(e as Error).message}`);
      }
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
            <div className="text-[11px] text-neutral-500 leading-tight inline-flex items-center gap-1 flex-wrap">
              {session.customer_full_name && session.customer_name ? session.customer_name : null}
              {/* Bot-Status-Indikator basierend auf bot_mode (nicht session.status).
                  Zeigt: Bot aktiv / Assistiert / Manuell — abhängig vom Modus. */}
              {(() => {
                const m = session.bot_mode;
                const info = m === "auto" || m === "selective_auto"
                  ? { label: "Bot aktiv", color: "text-green-700" }
                  : m === "assisted"
                  ? { label: "Assistiert", color: "text-blue-700" }
                  : { label: "Manuell", color: "text-neutral-500" };
                return (
                  <>
                    {session.customer_full_name && session.customer_name && <span>·</span>}
                    <span className={`${info.color} font-medium`}>{info.label}</span>
                  </>
                );
              })()}
              {/* Besondere session.status nur wenn awaiting_human / escalated (manuell gesetzt) */}
              {session.status !== "active" && session.status !== "closed" && (
                <>
                  <span>·</span>
                  <span className={statusBadge.color.replace("bg-", "text-").split(" ")[0].replace("100", "700")}>
                    {statusBadge.label}
                  </span>
                </>
              )}
              {session.assigned_name && (
                <>
                  <span>·</span>
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
          <AdditionalCategoriesSelector
            sessionId={session.id}
            primaryCategory={session.category}
            initialAdditional={session.additional_categories || []}
          />
        </div>
        <div className="flex gap-1 items-center flex-wrap [&>div.divider]:mx-1 [&>div.divider]:h-5 [&>div.divider]:w-px [&>div.divider]:bg-neutral-200">
          {/* Bot-Modus — klarer Dropdown-Button mit Pfeil, deutlich klickbar */}
          {session.status === "active" && (
            <div className="relative">
              <span className="text-[10px] text-neutral-400 uppercase tracking-wide block mb-0.5">Bot-Modus</span>
              <button
                type="button"
                onClick={() => setShowModeSettings(v => !v)}
                disabled={modeSwitching !== null}
                title="Klick zum Ändern: Manuell · Assistiert · Smart-Auto · Auto-Antwort"
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
                 : session.bot_mode === "assisted" ? "🤝"
                 : "⏸"}
                <span>
                  {session.bot_mode === "auto"           ? "Auto-Antwort" :
                   session.bot_mode === "selective_auto" ? "Smart-Auto" :
                   session.bot_mode === "assisted"       ? "Assistiert" :
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
                      { v: "off",            icon: "⏸",    color: "neutral", label: "Manuell",       desc: "Bot ist komplett aus. Keine Generierung, kein Auto-Draft. Du schreibst alles selbst." },
                      { v: "assisted",       icon: "🤝", color: "blue",    label: "Assistiert",  desc: "Bot wartet auf deinen Klick. Erst wenn du „Antwort generieren\" drückst, baut der Bot einen Entwurf für dich, den du dann freigibst." },
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
              primaryTitle="Session schließen und zurück zur Inbox-Übersicht"
              primaryClass="text-emerald-700 hover:bg-emerald-50"
              onPrimary={() => startTransition(async () => {
                // User-Anweisung 2026-05-30: "Erledigt" schließt die Session
                // (status=closed) UND navigiert zurück zur Inbox-Übersicht.
                // markSessionAsSeen wird zusätzlich gerufen, damit der "Zu
                // tun"-Detector zuverlässig greift, falls die Session jemals
                // wieder reopened wird.
                await markSessionAsSeen(session.id);
                await closeSession(session.id);
                router.push(backInboxHref);
              })}
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
                ? "Markierung entfernen — der Bot darf wieder antworten"
                : "Diese Session als 'Mitarbeiter benötigt!' markieren — Bot pausiert, im Team sichtbar dass ein Mensch ran muss. (Wenn du selbst übernimmst, klicke stattdessen orange 'Übernehmen'.)"}
              className={`h-8 px-3 rounded-lg text-xs font-medium inline-flex items-center gap-1.5 disabled:opacity-50 transition whitespace-nowrap ${
                session.human_only
                  ? "bg-amber-100 text-amber-800 border border-amber-300 hover:bg-amber-200"
                  : "text-amber-700 hover:bg-amber-50"
              }`}
            >
              {session.human_only ? (
                <><Check size={13} /> Markiert</>
              ) : (
                <><AlertTriangle size={13} /> Mitarbeiter benötigt!</>
              )}
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

      {/* WARTELISTE-BANNER: kompakter Einzeiler, aufklappbar.
          Zeigt schnell "diese Kundin wartet auf X" — Details + Storno-Button
          erscheinen erst nach Klick (kein Platz-Klau, wenn man sie nicht
          braucht). User-Wunsch 2026-05-28: "ruhig ein einzeiler, aufklappbar". */}
      {activeReservations.length > 0 && (
        <details className="group border-b border-amber-200 bg-amber-50 [&[open]]:bg-amber-50">
          <summary className="list-none cursor-pointer select-none px-5 py-1.5 flex items-center gap-2 text-xs hover:bg-amber-100/60 transition">
            <span className="font-semibold text-amber-900">🔔 Auf Warteliste · {activeReservations.length}</span>
            <span className="text-amber-800/80 truncate flex-1 min-w-0">
              {activeReservations
                .map(r => r.product_name)
                .join(" · ")}
            </span>
            <span className="text-amber-700 group-open:rotate-90 transition-transform">›</span>
          </summary>
          <div className="px-5 pb-2.5 pt-1 space-y-1.5">
            {activeReservations.map(r => {
              const requestedAtStr = r.requested_at
                ? new Date(r.requested_at).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" })
                : null;
              return (
                <div
                  key={r.id}
                  className="flex items-start justify-between gap-3 bg-white/70 rounded-lg px-3 py-2 border border-amber-200/60"
                >
                  <div className="flex-1 min-w-0 text-sm">
                    <div className="font-medium text-neutral-900 flex flex-wrap items-baseline gap-x-2">
                      {r.product_url ? (
                        <a
                          href={r.product_url}
                          target="_blank"
                          rel="noopener"
                          className="text-amber-900 hover:underline"
                          title="Produkt im Shop ansehen"
                        >
                          {r.product_name}
                        </a>
                      ) : (
                        <span>{r.product_name}</span>
                      )}
                      {requestedAtStr && (
                        <span className="text-[11px] font-normal text-neutral-500">
                          seit {requestedAtStr}
                        </span>
                      )}
                    </div>
                    {(r.color || r.method) && (
                      <div className="text-xs text-neutral-600 mt-0.5">
                        {[r.color, r.method].filter(Boolean).join(" · ")}
                      </div>
                    )}
                    {r.eta_hint && (
                      <div className="text-xs text-neutral-600 mt-0.5">
                        ETA: {r.eta_hint}
                      </div>
                    )}
                    {r.notes && (
                      <div className="text-xs text-neutral-500 italic mt-0.5 truncate" title={r.notes}>
                        „{r.notes}"
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => handleCancelReservation(r.id, r.product_name)}
                    disabled={isPending}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium text-rose-700 hover:bg-rose-100 border border-rose-200 transition shrink-0"
                    title="Reservierung löschen / stornieren"
                  >
                    <Trash2 size={11} /> Stornieren
                  </button>
                </div>
              );
            })}
          </div>
        </details>
      )}

      {/* Messages */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3 bg-neutral-50">
        {/* "Ältere Nachrichten von Instagram laden" — über dem ersten msg */}
        <LoadOlderMessagesButton sessionId={session.id} channel={session.channel} />
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
              placeholder='Antwort als Mitarbeiterin schreiben… (Enter = senden, Shift+Enter = neue Zeile). Tipp: schreib z.B. "[füge link ein]" — die KI ersetzt das beim Polieren.'
              rows={Math.max(2, Math.min(8, (input.match(/\n/g)?.length || 0) + 2))}
              className="flex-1 rounded-xl border border-neutral-300 px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-amber-500 resize-none"
              disabled={isPending || suggesting || polishing}
            />
            <div className="flex flex-col gap-1.5">
              <button
                onClick={handleSuggest}
                disabled={suggesting || polishing || isPending}
                title="KI generiert von Grund auf einen Antwort-Vorschlag (ohne deine Eingabe)"
                className="bg-purple-600 text-white rounded-xl px-3 py-2 hover:bg-purple-700 disabled:opacity-40 inline-flex items-center gap-1 text-xs font-medium"
              >
                <Sparkles size={12} /> {suggesting ? "Denkt…" : "Vorschlag"}
              </button>
              <button
                onClick={handlePolish}
                disabled={polishing || suggesting || isPending || !input.trim()}
                title={'KI verbessert DEINEN Entwurf: Grammatik, Stil — und führt [Klammer-Anweisungen] aus, z.B. "[füge hier den link ein]". Voraussetzung: schreib zuerst einen Entwurf.'}
                className="bg-indigo-600 text-white rounded-xl px-3 py-2 hover:bg-indigo-700 disabled:opacity-40 inline-flex items-center gap-1 text-xs font-medium"
              >
                <Wand2 size={12} /> {polishing ? "Poliert…" : "Polieren"}
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
          sessionId={session.id}
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

/**
 * Übersetzt interne Skip-/Fehler-Codes in menschenlesbare Texte.
 * Wird in handleGenerate / handleRefine / approveDraft genutzt damit
 * Mitarbeiter:innen wissen WARUM ein Bot-Aktion fehlgeschlagen ist.
 */
function friendlyErrorMessage(raw: string): string {
  if (!raw) return "Unbekannter Fehler";
  const r = raw.toLowerCase();
  if (r.includes("skip_appointment_no_calendar_access")) {
    return "⚠️ Bot kann keinen Termin-Entwurf erstellen — wir haben noch keinen Kalender-Zugriff (Treatwell). Bitte direkt selbst antworten mit dem Treatwell-Link.";
  }
  if (r.includes("session not found")) return "Session nicht gefunden — neu laden.";
  if (r.includes("session not active")) return "Diese Session ist nicht mehr aktiv.";
  if (r.includes("no persona")) return "Bot ist nicht konfiguriert (keine Persona aktiv).";
  if (r.includes("keine kundennachricht")) return "Keine Kundennachricht da — der Bot hätte nichts zu beantworten.";
  return raw;
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
      className="opacity-30 group-hover:opacity-100 transition text-neutral-400 hover:text-red-500 p-1"
    >
      <Trash2 size={13} />
    </button>
  );

  // Reply-Threading: wenn diese Nachricht eine direkte Antwort auf eine
  // frühere Nachricht ist (Instagram-Reply-Feature), zeigen wir wie auf
  // Instagram darüber einen kleinen "Antwort auf"-Snippet mit Vorschau.
  // Klick darauf → scrollt zur Original-Message + kurzes Highlight.
  const jumpToRepliedMessage = msg.reply_to?.id ? () => {
    const targetId = msg.reply_to!.id!;
    const el = document.querySelector(`[data-msg-id="${targetId}"]`) as HTMLElement | null;
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    // Highlight kurz aufblitzen lassen
    el.classList.add("ring-2", "ring-amber-400", "ring-offset-2", "transition-shadow");
    setTimeout(() => {
      el.classList.remove("ring-2", "ring-amber-400", "ring-offset-2");
    }, 1600);
  } : null;

  const ReplyPreviewInner = msg.reply_to ? (
    <>
      <CornerUpLeft size={11} className="mt-0.5 flex-shrink-0 text-neutral-400" />
      <div className="min-w-0 text-left">
        {msg.reply_to.role === "external" ? (
          <span className="italic text-neutral-500">
            Antwort auf eine ältere Nachricht (nicht mehr im Verlauf)
          </span>
        ) : (
          <>
            <span className="font-medium text-neutral-600">
              {msg.reply_to.role === "user" ? "Kunde" : msg.reply_to.role === "assistant" ? "Ava" : "Mitarbeiterin"}:
            </span>{" "}
            <span className="italic">
              {msg.reply_to.content_preview.length >= 140
                ? msg.reply_to.content_preview + "…"
                : msg.reply_to.content_preview}
            </span>
          </>
        )}
      </div>
    </>
  ) : null;

  const ReplyPreview = msg.reply_to ? (
    jumpToRepliedMessage ? (
      <button
        type="button"
        onClick={jumpToRepliedMessage}
        title="Klick: zur Ursprungs-Nachricht springen"
        className="mb-1 text-[11px] text-neutral-500 hover:text-neutral-900 hover:bg-neutral-50 flex items-start gap-1 border-l-2 border-neutral-300 hover:border-amber-400 pl-2 pr-1 py-0.5 rounded-r-md max-w-full transition cursor-pointer"
      >
        {ReplyPreviewInner}
      </button>
    ) : (
      <div className="mb-1 text-[11px] text-neutral-500 flex items-start gap-1 border-l-2 border-neutral-300 pl-2 max-w-full">
        {ReplyPreviewInner}
      </div>
    )
  ) : null;

  if (msg.role === "user") {
    return (
      <div className="group flex gap-2 justify-start items-start rounded-2xl" data-msg-id={msg.id}>
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
              {msg.attachments.map((a, i) => {
                // Story-Mention oder Story-Reply → kleine Vorschau MIT Label,
                // damit der MA sofort sieht: "ah, sie antwortet auf unsere
                // Story." (User-Wunsch 2026-05-28: aus dem Nichts schwer zu
                // deuten).
                const isStory = a.type === "story_mention" || a.type === "story_reply";
                if (isStory && a.url) {
                  const label = a.type === "story_reply" ? "Antwort auf Story" : "Story-Mention";
                  // Meta-CDN-URLs (scontent.cdninstagram.com / fbcdn.net) liefern
                  // bei direktem Browser-Aufruf 403/0 wegen Hot-Link-Schutz —
                  // wir gehen über unseren Server-Proxy. Andere URLs unverändert.
                  const needsProxy = /\.(?:cdninstagram\.com|fbcdn\.net)\b/i.test(a.url);
                  const displayUrl = needsProxy
                    ? `/api/ig-proxy?url=${encodeURIComponent(a.url)}`
                    : a.url;
                  return (
                    <div key={i} className="flex flex-col gap-1 max-w-[200px]">
                      <span className="text-[10px] text-purple-700 bg-purple-50 border border-purple-200 rounded-full px-2 py-0.5 self-start inline-flex items-center gap-1">
                        <span>📸</span>{label}
                      </span>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={displayUrl}
                        alt={label}
                        onClick={() => onImageClick?.(displayUrl)}
                        onError={(e) => {
                          // Fallback wenn auch via Proxy nichts kommt
                          // (= Meta hat den Link wirklich invalidiert).
                          const t = e.currentTarget as HTMLImageElement;
                          t.style.display = "none";
                          const next = t.nextElementSibling as HTMLElement | null;
                          if (next) next.style.display = "flex";
                        }}
                        className="max-h-48 max-w-[200px] rounded-xl border border-purple-200 shadow-sm cursor-zoom-in hover:shadow-md transition object-cover"
                      />
                      <div
                        style={{ display: "none" }}
                        className="items-center gap-1 text-[11px] text-neutral-500 italic px-2 py-2 border border-dashed border-neutral-200 rounded-lg max-w-[200px]"
                      >
                        Story-Vorschau aktuell nicht ladbar (Instagram-Link)
                      </div>
                    </div>
                  );
                }
                return a.type === "image" && a.url ? (
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
                );
              })}
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
      <div className="group flex gap-2 justify-end items-start rounded-2xl" data-msg-id={msg.id}>
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
              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 font-medium" title="Vom Bot generiert, von der Mitarbeiterin freigegeben — beste Mischung aus Effizienz und Qualität">
                🤝 assistiert
              </span>
            )}
            <span>Ava von {signatureName || "—"} · {time}</span>
          </div>
          {/* Nachtraining-Box für Autobot-Antworten */}
          {msg.auto_sent && (
            <AutobotTeachBox
              messageId={msg.id}
              originalText={msg.content || ""}
              alreadyTaught={!!msg.teach_feedback_at}
              sentiment={msg.teach_sentiment ?? null}
            />
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
      <div className="group flex gap-2 justify-end items-start rounded-2xl" data-msg-id={msg.id}>
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
  sessionId,
  onDone,
}: {
  draft: { id: string; original_text: string; created_at: string };
  sessionId: string;
  onDone: () => void;
}) {
  const [text, setText] = useState(draft.original_text);
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);
  const [refineInput, setRefineInput] = useState("");
  const [refineLog, setRefineLog] = useState<string[]>([]);
  const [busy, setBusy] = useState<"send" | "grammar" | "discard" | "refine" | "force" | null>(null);
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

  async function handleSend(markAsPositive = false) {
    if (!text.trim() || busy) return;
    setBusy("send");
    try {
      await approveDraft(draft.id, text.trim(), note.trim() || undefined, saveAsTraining, markAsPositive);
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
      alert(`Neu generieren fehlgeschlagen: ${friendlyErrorMessage((e as Error).message)}`);
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

  async function handleForceRegenerate() {
    if (busy) return;
    setBusy("force");
    try {
      // generateDraftOnDemand mit force=true: verwirft aktuellen Draft und
      // erzeugt einen frischen mit dem aktuell deployten Code.
      const r = await generateDraftOnDemand(sessionId, { force: true });
      if (!r.ok) {
        alert(`Frisch-Generieren fehlgeschlagen: ${friendlyErrorMessage(r.reason || "Unbekannter Fehler")}`);
      } else {
        onDone();
      }
    } catch (e) {
      alert(`Frisch-Generieren fehlgeschlagen: ${friendlyErrorMessage((e as Error).message)}`);
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
            <RotateCcw size={11} /> {busy === "refine" ? "Schreibt…" : "Mit Feedback neu"}
          </button>
          <button
            type="button"
            onClick={handleForceRegenerate}
            disabled={busy !== null}
            title="Verwirft diesen Entwurf und generiert mit dem aktuell deployten Code neu. Nutze das nach Deploy-Updates."
            className="bg-blue-600 text-white rounded-lg px-3 py-1.5 hover:bg-blue-700 disabled:opacity-40 inline-flex items-center gap-1 text-xs font-medium whitespace-nowrap"
          >
            <Sparkles size={11} /> {busy === "force" ? "Frisch…" : "Frisch (neuer Code)"}
          </button>
        </div>
        <div className="text-[10px] text-purple-500">
          „Mit Feedback neu": Bot bekommt den ganzen Chat-Verlauf + dein Feedback und schreibt neu (Feedback landet im Training).
          „Frisch": verwirft den Entwurf und lässt den Bot mit aktuell deployten Code neu generieren — ohne Feedback. Nutze das nach Code-Deploys.
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
            onClick={() => handleSend(false)}
            disabled={busy !== null || !text.trim()}
            className="bg-green-600 text-white rounded-xl px-4 py-2 hover:bg-green-700 disabled:opacity-40 inline-flex items-center gap-1 text-xs font-medium shadow-sm"
          >
            <Check size={12} /> {busy === "send" ? "Sende…" : "Senden ✓"}
          </button>
          {/* 👍 Senden + als positives Vorbild fürs Training markieren — Bot lernt
              "diese Antwort war gut so" und priorisiert ähnliche bei neuen Fragen. */}
          <button
            onClick={() => handleSend(true)}
            disabled={busy !== null || !text.trim()}
            className="bg-emerald-500 text-white rounded-xl px-3 py-2 hover:bg-emerald-600 disabled:opacity-40 inline-flex items-center gap-1 text-xs font-medium shadow-sm"
            title={wasEdited
              ? "Senden + die finale Version als positives Vorbild speichern (Bot lernt aus deinem Edit + Vorbild)"
              : "Senden + Bot-Entwurf war perfekt — als positives Vorbild speichern. Bot wird bei ähnlichen Fragen sicherer."}
          >
            👍 {busy === "send" ? "Sende…" : "Senden + Vorbild"}
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
  sentiment,
}: { messageId: string; originalText: string; alreadyTaught: boolean; sentiment?: "positive" | "correction" | null }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [showGoodNote, setShowGoodNote] = useState(false);
  const [goodNote, setGoodNote] = useState("");
  const [text, setText] = useState(originalText);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [doneSentiment, setDoneSentiment] = useState<"positive" | "correction" | null>(
    alreadyTaught ? (sentiment ?? "correction") : null
  );

  async function markAsGood() {
    if (busy) return;
    setBusy(true);
    try {
      const { markBotMessageAsGood } = await import("@/lib/actions/chat-inbox");
      await markBotMessageAsGood(messageId, goodNote.trim() || undefined);
      setDoneSentiment("positive");
      setShowGoodNote(false);
      setGoodNote("");
      router.refresh();
    } catch (e) {
      alert(`Bewerten fehlgeschlagen: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  if (doneSentiment === "positive") {
    return (
      <div className="mt-1 inline-flex items-center gap-1 text-[10px] text-emerald-700">
        <Check size={10} /> 👍 Als positives Vorbild gespeichert — Bot priorisiert diesen Stil
      </div>
    );
  }
  if (doneSentiment === "correction") {
    return (
      <div className="mt-1 inline-flex items-center gap-1 text-[10px] text-emerald-700">
        <Check size={10} /> Nachtrainiert — Bot lernt fürs nächste Mal
      </div>
    );
  }

  if (!open) {
    return (
      <div className="mt-1 flex items-center gap-2.5 flex-wrap">
        {/* 👍 Direkt-Bewertung — ein Klick = "war gut so" (mit optionaler Notiz-Erweiterung) */}
        {showGoodNote ? (
          <div className="inline-flex items-center gap-1 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-1">
            <input
              type="text"
              value={goodNote}
              onChange={(e) => setGoodNote(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") markAsGood(); }}
              placeholder="Optional: warum war's gut? (z.B. guter Ton bei unsicherer Kundin)"
              className="text-[11px] bg-white border border-emerald-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-emerald-400 w-72 max-w-[60vw]"
              disabled={busy}
              autoFocus
            />
            <button
              type="button"
              onClick={markAsGood}
              disabled={busy}
              className="text-[11px] bg-emerald-600 text-white rounded px-2 py-1 hover:bg-emerald-700 disabled:opacity-40 inline-flex items-center gap-1"
            >
              <Check size={10} /> {busy ? "…" : "Speichern"}
            </button>
            <button
              type="button"
              onClick={() => { setShowGoodNote(false); setGoodNote(""); }}
              disabled={busy}
              className="text-[10px] text-neutral-500 hover:text-neutral-800 px-1"
            >
              Abbrechen
            </button>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={markAsGood}
              disabled={busy}
              className="inline-flex items-center gap-1 text-[10px] text-emerald-700 hover:text-emerald-900 underline-offset-2 hover:underline disabled:opacity-40"
              title="Diese Antwort war gut so — als Vorbild speichern, damit der Bot bei ähnlichen Fragen sicherer wird"
            >
              👍 War gut so
            </button>
            <button
              type="button"
              onClick={() => setShowGoodNote(true)}
              disabled={busy}
              className="text-[10px] text-emerald-600 hover:text-emerald-900 disabled:opacity-40"
              title="Mit kurzer Notiz speichern (warum die Antwort besonders gut war)"
            >
              + Notiz
            </button>
            <span className="text-[10px] text-neutral-300">|</span>
            <button
              type="button"
              onClick={() => setOpen(true)}
              className="inline-flex items-center gap-1 text-[10px] text-purple-600 hover:text-purple-900 underline-offset-2 hover:underline"
              title="Bot-Antwort war nicht optimal? Sag dem Bot wie es besser wäre — er lernt für ähnliche Fälle"
            >
              <Sparkles size={10} /> Korrigieren / Nachtraining
            </button>
          </>
        )}
      </div>
    );
  }

  async function submit() {
    if (!text.trim() || !note.trim()) return;
    setBusy(true);
    try {
      const { teachFromAutobotMessage } = await import("@/lib/actions/chat-inbox");
      await teachFromAutobotMessage(messageId, text.trim(), note.trim());
      setDoneSentiment("correction");
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
