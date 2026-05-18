import { Suspense } from "react";
import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { Bot, MessageSquare, Clock, UserCheck, CheckCircle2, User, Mail } from "lucide-react";
import SyncInstagramButton from "./sync-instagram-button";
import MarkUnreadButton from "./mark-unread-button";

interface PageProps {
  searchParams: Promise<{ status?: string; mode?: string; channel?: string }>;
}

interface PreviewMsg { role: string; content: string; created_at: string; }
interface SessionStats {
  firstUser?: string;
  lastUser?: string;
  lastBot?: string;
  lastMsg?: string;
  lastMsgRole?: string;
  botCount: number;
  humanCount: number;
}

export const dynamic = "force-dynamic";

const STATUS_LABELS: Record<string, { label: string; color: string; icon: typeof Bot }> = {
  active:          { label: "Bot aktiv",       color: "bg-green-100 text-green-800",     icon: Bot },
  awaiting_human:  { label: "Wartet auf Team", color: "bg-amber-100 text-amber-800",     icon: Clock },
  escalated:       { label: "Eskaliert",       color: "bg-red-100 text-red-800",         icon: UserCheck },
  closed:          { label: "Abgeschlossen",   color: "bg-neutral-100 text-neutral-600", icon: CheckCircle2 },
};

const CHANNEL_LABELS: Record<string, string> = {
  web:       "🌐 Web",
  instagram: "📷 Instagram",
  whatsapp:  "💬 WhatsApp",
};

export default async function ChatInboxPage({ searchParams }: PageProps) {
  await requireProfile();
  const params = await searchParams;
  const filter        = params.status  || "all";
  const mode          = params.mode    || "all"; // 'all' | 'pure_bot' | 'with_human'
  const channelFilter = params.channel || "all"; // 'all' | 'web' | 'instagram' | 'whatsapp'

  const svc = createServiceClient();
  let query = svc
    .from("chat_sessions")
    .select(`
      id, channel, customer_name, status, assigned_to, bot_signature_name,
      bot_mode, last_message_at, last_customer_msg_at, last_seen_by_agent_at, created_at,
      assigned_profile:profiles!chat_sessions_assigned_to_fkey(display_name,email)
    `)
    .order("last_message_at", { ascending: false })
    .limit(100);

  if (filter !== "all") {
    query = query.eq("status", filter);
  }
  if (channelFilter !== "all") {
    query = query.eq("channel", channelFilter);
  }
  const { data: sessions } = await query;

  // Stats für Follow-Up-Indikator
  const followUpCutoff = new Date(Date.now() - 3 * 86400 * 1000).toISOString();
  const { count: dueFollowUps } = await svc
    .from("chat_sessions")
    .select("id", { count: "exact", head: true })
    .eq("status", "active")
    .is("follow_up_sent_at", null)
    .lt("last_message_at", followUpCutoff);

  // Pro Session: erste User-Frage, erste Bot-Antwort, letzte Nachricht, Counts
  const sessionIds = (sessions ?? []).map(s => s.id);
  const stats: Record<string, SessionStats> = {};
  if (sessionIds.length > 0) {
    const { data: msgs } = await svc
      .from("chat_messages")
      .select("session_id, role, content, created_at")
      .in("session_id", sessionIds)
      .order("created_at", { ascending: true });
    // Messages kommen aufsteigend (ältester zuerst) — wir überschreiben lastUser/lastBot
    // bei jeder weiteren Message, so steht am Ende die jeweils NEUESTE drin.
    for (const m of msgs ?? []) {
      const s = stats[m.session_id] ??= { botCount: 0, humanCount: 0 };
      if (m.role === "user") {
        if (!s.firstUser) s.firstUser = m.content;
        s.lastUser = m.content;
      }
      if (m.role === "assistant") {
        s.lastBot = m.content;
        s.botCount++;
      }
      if (m.role === "human_agent") {
        s.lastBot = m.content; // im Vorschau-Bereich wie Bot anzeigen (von uns gesendet)
        s.humanCount++;
      }
      s.lastMsg = m.content;
      s.lastMsgRole = m.role;
    }
  }

  // Filter nach Mode: pure_bot = nur Bot hat geantwortet, with_human = Mensch hat reingeschrieben
  let filteredSessions = sessions ?? [];
  if (mode === "pure_bot") {
    filteredSessions = filteredSessions.filter(s => (stats[s.id]?.humanCount || 0) === 0);
  } else if (mode === "with_human") {
    filteredSessions = filteredSessions.filter(s => (stats[s.id]?.humanCount || 0) > 0);
  }

  const pureBotCount   = (sessions ?? []).filter(s => (stats[s.id]?.humanCount || 0) === 0).length;
  const withHumanCount = (sessions ?? []).filter(s => (stats[s.id]?.humanCount || 0) > 0).length;

  // KPIs
  const { count: cntActive } = await svc.from("chat_sessions").select("id", { count: "exact", head: true }).eq("status", "active");
  const { count: cntWaiting } = await svc.from("chat_sessions").select("id", { count: "exact", head: true }).eq("status", "awaiting_human");
  const { count: cntClosed } = await svc.from("chat_sessions").select("id", { count: "exact", head: true }).eq("status", "closed");

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <MessageSquare size={20} className="text-neutral-700" />
          <h1 className="text-xl font-semibold text-neutral-900">Chat-Inbox</h1>
          <span className="text-sm text-neutral-500 ml-2">Live-Gespräche aller Kanäle</span>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <SyncInstagramButton />
          {(dueFollowUps ?? 0) > 0 && (
            <a
              href="/chatbot/follow-ups"
              className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-purple-600 text-white text-xs font-medium hover:bg-purple-700"
            >
              <Mail size={12} /> {dueFollowUps} Follow-Ups fällig →
            </a>
          )}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4">
        <KPI label="Bot aktiv"        count={cntActive ?? 0}  color="text-green-700"  />
        <KPI label="Warten auf Team"  count={cntWaiting ?? 0} color="text-amber-700"  />
        <KPI label="Abgeschlossen"    count={cntClosed ?? 0}  color="text-neutral-500"/>
      </div>

      {/* Filter — Kanal */}
      <div className="space-y-2">
        <div className="text-xs font-medium text-neutral-500 uppercase tracking-wide">Kanal</div>
        <div className="flex gap-2 flex-wrap">
          {["all", "instagram", "whatsapp", "web"].map(c => (
            <Link
              key={c}
              href={`/chatbot/inbox?${new URLSearchParams({
                ...(filter !== "all" ? { status: filter } : {}),
                ...(mode !== "all" ? { mode } : {}),
                ...(c !== "all" ? { channel: c } : {}),
              }).toString()}`}
              className={`text-xs px-3 py-1.5 rounded-full border ${
                channelFilter === c
                  ? "bg-neutral-900 text-white border-neutral-900"
                  : "bg-white text-neutral-600 border-neutral-300 hover:bg-neutral-50"
              }`}
            >
              {c === "all" ? "Alle" : CHANNEL_LABELS[c] || c}
            </Link>
          ))}
        </div>
      </div>

      {/* Filter — Status */}
      <div className="space-y-2">
        <div className="text-xs font-medium text-neutral-500 uppercase tracking-wide">Status</div>
        <div className="flex gap-2 flex-wrap">
          {["all", "awaiting_human", "active", "closed"].map(s => (
            <Link
              key={s}
              href={`/chatbot/inbox?${new URLSearchParams({
                ...(s !== "all" ? { status: s } : {}),
                ...(mode !== "all" ? { mode } : {}),
                ...(channelFilter !== "all" ? { channel: channelFilter } : {}),
              }).toString()}`}
              className={`text-xs px-3 py-1.5 rounded-full border ${
                filter === s
                  ? "bg-neutral-900 text-white border-neutral-900"
                  : "bg-white text-neutral-600 border-neutral-300 hover:bg-neutral-50"
              }`}
            >
              {s === "all" ? "Alle" : STATUS_LABELS[s]?.label || s}
            </Link>
          ))}
        </div>
      </div>

      {/* Filter — Mode (Bot vs Mensch) */}
      <div className="space-y-2">
        <div className="text-xs font-medium text-neutral-500 uppercase tracking-wide">Bot/Mensch</div>
        <div className="flex gap-2 flex-wrap">
          {[
            { key: "all",        label: `Alle (${(sessions ?? []).length})`,                  icon: null },
            { key: "pure_bot",   label: `Reine Bot-Chats (${pureBotCount})`,                  icon: <Bot size={11} className="text-pink-600" /> },
            { key: "with_human", label: `Mit Mitarbeiter-Eingriff (${withHumanCount})`,        icon: <UserCheck size={11} className="text-amber-700" /> },
          ].map(opt => (
            <Link
              key={opt.key}
              href={`/chatbot/inbox?${new URLSearchParams({ ...(filter !== "all" ? { status: filter } : {}), ...(opt.key !== "all" ? { mode: opt.key } : {}) }).toString()}`}
              className={`text-xs px-3 py-1.5 rounded-full border inline-flex items-center gap-1 ${
                mode === opt.key
                  ? "bg-neutral-900 text-white border-neutral-900"
                  : "bg-white text-neutral-600 border-neutral-300 hover:bg-neutral-50"
              }`}
            >
              {opt.icon} {opt.label}
            </Link>
          ))}
        </div>
      </div>

      {/* Sessions Liste */}
      <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
        {filteredSessions.length === 0 ? (
          <div className="p-12 text-center text-neutral-400">
            <Bot size={32} className="mx-auto mb-2 text-neutral-300" />
            Keine Sessions in diesem Filter
          </div>
        ) : (
          <Suspense fallback={null}>
            <ul>
              {filteredSessions.map((s, idx) => {
                const meta = STATUS_LABELS[s.status] || STATUS_LABELS.active;
                const Icon = meta.icon;
                const st = stats[s.id] || { botCount: 0, humanCount: 0 };
                const profile = (s.assigned_profile as unknown as { display_name?: string; email?: string } | null);
                const assignedName = profile?.display_name || profile?.email || null;
                const isHybrid = st.humanCount > 0;
                // Ungelesen wenn letzte Kundennachricht NACH letztem Agent-Besuch der Session
                const isUnread = !!(s.last_customer_msg_at && (
                  !s.last_seen_by_agent_at || s.last_customer_msg_at > s.last_seen_by_agent_at
                ));
                const zebra = idx % 2 === 0 ? "bg-white" : "bg-neutral-50/60";
                return (
                  <li
                    key={s.id}
                    className={`group relative border-b border-neutral-100 hover:bg-blue-50/40 transition-colors ${zebra} ${isUnread ? "border-l-4 border-l-pink-500" : "border-l-4 border-l-transparent"}`}
                  >
                    {/* Mark-Unread-Button absolut positioniert, nur bei Hover sichtbar */}
                    {!isUnread && (
                      <div className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition">
                        <MarkUnreadButton sessionId={s.id} variant="icon" />
                      </div>
                    )}
                    <Link href={`/chatbot/inbox/${s.id}`} className="block p-4">
                      {/* Customer-Name oben (z.B. @apfel.me oder Phone-Nr) */}
                      <div className="flex items-center gap-2 mb-1.5">
                        <User size={14} className="text-neutral-400" />
                        <span className={`text-sm truncate ${isUnread ? "font-bold text-neutral-900" : "font-medium text-neutral-800"}`}>
                          {s.customer_name || <span className="text-neutral-400 font-normal">Unbekannt</span>}
                        </span>
                        {isUnread && (
                          <span className="bg-pink-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                            Neu
                          </span>
                        )}
                      </div>
                      {/* Top row: badges + zeit */}
                      <div className="flex items-center gap-2 flex-wrap mb-2 text-xs">
                        <span className="text-neutral-500 font-medium">
                          {CHANNEL_LABELS[s.channel] || s.channel}
                        </span>
                        <span className="text-neutral-300">·</span>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${meta.color}`}>
                          <Icon size={11} />
                          {meta.label}
                        </span>
                        <span className="text-neutral-300">·</span>
                        <span className="text-neutral-500">Ava von <strong>{s.bot_signature_name || "?"}</strong></span>

                        {isHybrid ? (
                          <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-800 px-2 py-0.5 rounded-full">
                            <UserCheck size={11} /> Mitarbeiter eingegriffen
                            {assignedName && <span className="font-medium">· {assignedName}</span>}
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 bg-pink-100 text-pink-700 px-2 py-0.5 rounded-full">
                            <Bot size={11} /> Reiner Bot-Chat
                          </span>
                        )}
                        <span className="inline-flex items-center gap-2 text-neutral-400 ml-auto">
                          {s.status === "awaiting_human" && (() => {
                            const wait = (Date.now() - new Date(s.last_message_at).getTime()) / 60000;
                            const color = wait > 120 ? "bg-red-100 text-red-700" :
                                          wait > 30  ? "bg-orange-100 text-orange-700" :
                                                       "bg-green-100 text-green-700";
                            const label = wait < 1 ? "gerade eben" :
                                          wait < 60 ? `wartet ${Math.floor(wait)}m` :
                                          wait < 1440 ? `wartet ${Math.floor(wait/60)}h` :
                                                        `wartet ${Math.floor(wait/1440)}d`;
                            return (
                              <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-[10px] font-medium ${color}`}>
                                ⏱ {label}
                              </span>
                            );
                          })()}
                          <span><Bot size={10} className="inline" /> {st.botCount}</span>
                          {st.humanCount > 0 && (
                            <span><UserCheck size={10} className="inline" /> {st.humanCount}</span>
                          )}
                          <span className="whitespace-nowrap">{formatRelative(s.last_message_at)}</span>
                        </span>
                      </div>

                      {/* Vorschau: nur die LETZTE Kundennachricht — das ist was Aufmerksamkeit braucht.
                          (Bot-/Mitarbeiter-Antworten weglassen — sind oft veraltet wenn Kunde danach
                          wieder geschrieben hat, irreführend für "was ist offen?".) */}
                      {st.lastUser && (
                        <div className="flex gap-2 text-sm">
                          <span className="text-neutral-400 shrink-0 mt-0.5" title="Letzte Kundennachricht">
                            <User size={13} />
                          </span>
                          <span className="text-neutral-700 line-clamp-2">{st.lastUser}</span>
                        </div>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Suspense>
        )}
      </div>
    </div>
  );
}

function KPI({ label, count, color }: { label: string; count: number; color: string }) {
  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
      <div className="text-xs font-medium text-neutral-500 uppercase tracking-wide">{label}</div>
      <div className={`text-2xl font-bold mt-1 ${color}`}>{count}</div>
    </div>
  );
}

function formatRelative(iso: string): string {
  const date = new Date(iso);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const min = Math.floor(diff / 60000);
  const sameDay = date.toDateString() === now.toDateString();
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();
  const timeStr = date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  if (min < 1)        return "gerade eben";
  if (min < 60)       return `vor ${min} Min`;
  if (sameDay)        return `heute · ${timeStr}`;
  if (isYesterday)    return `gestern · ${timeStr}`;
  const sameYear = date.getFullYear() === now.getFullYear();
  if (sameYear)       return `${date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })} · ${timeStr}`;
  return `${date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" })} · ${timeStr}`;
}
