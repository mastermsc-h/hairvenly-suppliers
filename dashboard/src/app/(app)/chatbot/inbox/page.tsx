import { Suspense } from "react";
import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { Bot, MessageSquare, Clock, UserCheck, CheckCircle2, User, Mail } from "lucide-react";
import SyncInstagramButton from "./sync-instagram-button";
import MarkUnreadButton from "./mark-unread-button";
import MarkSeenButton from "./mark-seen-button";
import MarkNotDoneButton from "./mark-not-done-button";
import InboxSearchBar from "./search-bar";
import DefaultBotModeToggle from "./default-bot-mode-toggle";
import ClassifyBackfillButton from "./classify-backfill-button";

interface PageProps {
  searchParams: Promise<{ status?: string; mode?: string; channel?: string; category?: string; q?: string; unread?: string; limit?: string }>;
}

const PAGE_SIZE = 50;

const CATEGORY_LABELS: Record<string, { label: string; emoji: string }> = {
  availability: { label: "Verfügbarkeit", emoji: "📦" },
  pricing:      { label: "Preis",         emoji: "💰" },
  color_advice: { label: "Farbberatung",  emoji: "🎨" },
  appointment:  { label: "Termin",        emoji: "📅" },
  complaint:    { label: "Reklamation",   emoji: "⚠️" },
  order_status: { label: "Bestellstatus", emoji: "🚚" },
  gewerbe:      { label: "Gewerbe",       emoji: "💼" },
  partnership:  { label: "Partnership",   emoji: "🤝" },
  general:      { label: "Sonstiges",     emoji: "💬" },
};

interface SessionStats {
  lastUser?: string;
  lastBot?: string;
  lastMsg?: string;
  lastMsgRole?: string;
  lastMsgAgentId?: string | null;
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
  const filter        = params.status   || "all";
  const mode          = params.mode     || "all"; // 'all' | 'pure_bot' | 'with_human'
  const channelFilter = params.channel  || "all"; // 'all' | 'web' | 'instagram' | 'whatsapp'
  const categoryFilter = params.category || "all";
  const searchQuery    = (params.q || "").trim();
  // Default = nur unbeantwortet. User kann via "unread=0" alles anzeigen.
  const onlyUnread     = params.unread !== "0";
  // Pagination: max 50 pro "Klick", über "Weitere laden" wird der Limit erhöht
  const limit = Math.min(Math.max(Number(params.limit) || PAGE_SIZE, PAGE_SIZE), 1000);

  const svc = createServiceClient();
  let query = svc
    .from("chat_sessions")
    .select(`
      id, channel, customer_name, customer_full_name, status, assigned_to, bot_signature_name,
      bot_mode, category, last_message_at, last_customer_msg_at, last_seen_by_agent_at, last_opened_by_agent_at, created_at,
      assigned_profile:profiles!chat_sessions_assigned_to_fkey(display_name,email)
    `)
    .order("last_message_at", { ascending: false })
    // Candidate-Pool deutlich größer als das Anzeige-Limit — Filter (unread/mode/...)
    // arbeiten in JS, daher brauchen wir Headroom. 500 reicht für > 50 unread + Filter.
    .limit(500);

  if (filter !== "all")        query = query.eq("status", filter);
  if (channelFilter !== "all") query = query.eq("channel", channelFilter);
  if (categoryFilter !== "all") query = query.eq("category", categoryFilter);
  if (searchQuery) query = query.ilike("customer_name", `%${searchQuery}%`);
  const { data: sessions } = await query;

  // Wenn Such-Query: Auch IDs aus chat_messages.content matching suchen
  // (damit man auch nach Nachricht-Inhalt suchen kann, nicht nur Kundenname)
  let extraSessionIdsFromMessages: string[] = [];
  if (searchQuery) {
    const { data: matchedMsgs } = await svc
      .from("chat_messages")
      .select("session_id")
      .ilike("content", `%${searchQuery}%`)
      .is("deleted_at", null)
      .limit(200);
    extraSessionIdsFromMessages = Array.from(new Set((matchedMsgs || []).map(m => m.session_id)));
  }
  let messageMatchedSessions: typeof sessions = [];
  if (extraSessionIdsFromMessages.length > 0) {
    const existingIds = new Set((sessions || []).map(s => s.id));
    const onlyNew = extraSessionIdsFromMessages.filter(id => !existingIds.has(id));
    if (onlyNew.length > 0) {
      const { data: extra } = await svc
        .from("chat_sessions")
        .select(`
          id, channel, customer_name, customer_full_name, status, assigned_to, bot_signature_name,
          bot_mode, category, last_message_at, last_customer_msg_at, last_seen_by_agent_at, last_opened_by_agent_at, created_at,
          assigned_profile:profiles!chat_sessions_assigned_to_fkey(display_name,email)
        `)
        .in("id", onlyNew)
        .order("last_message_at", { ascending: false });
      messageMatchedSessions = extra || [];
    }
  }
  const combinedSessions = [...(sessions || []), ...messageMatchedSessions];

  // Stats für Follow-Up-Indikator
  const followUpCutoff = new Date(Date.now() - 3 * 86400 * 1000).toISOString();
  const { count: dueFollowUps } = await svc
    .from("chat_sessions")
    .select("id", { count: "exact", head: true })
    .eq("status", "active")
    .is("follow_up_sent_at", null)
    .lt("last_message_at", followUpCutoff);

  // Globaler Default-Bot-Modus für neue Sessions
  const { data: globalSettings } = await svc
    .from("chatbot_settings")
    .select("default_bot_mode")
    .eq("id", 1)
    .maybeSingle();
  const defaultBotMode = (globalSettings?.default_bot_mode || "off") as "auto" | "assisted" | "off";

  // Pro Session: Counts + jeweils NEUESTE User-Message + neueste Bot/Agent-Antwort
  const sessionIds = combinedSessions.map(s => s.id);
  const stats: Record<string, SessionStats> = {};
  if (sessionIds.length > 0) {
    // WICHTIG: DESC sortieren + first-seen-wins.
    // Vorher: ASC + Limit 20000 → bei vielen Sessions wurden die NEUESTEN Messages
    // abgeschnitten, lastMsgRole landete auf einem alten User-Eintrag → Sessions die
    // längst beantwortet waren tauchten als "unbeantwortet" auf, und Vorschau zeigte
    // veraltete Nachrichten. Jetzt: neueste zuerst, "lastX" wird beim ERSTEN Treffer
    // gesetzt (= dem aktuell jüngsten), botCount/humanCount zählen alle.
    const cutoff = new Date(Date.now() - 120 * 24 * 60 * 60 * 1000).toISOString();
    const { data: msgs } = await svc
      .from("chat_messages")
      .select("session_id, role, content, created_at, agent_id")
      .in("session_id", sessionIds)
      .is("deleted_at", null)
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(20000);
    for (const m of msgs ?? []) {
      const s = stats[m.session_id] ??= { botCount: 0, humanCount: 0 };
      if (m.role === "assistant") s.botCount++;
      if (m.role === "human_agent") s.humanCount++;
      // first-seen wins = aktuell neuestes Vorkommen
      if (!s.lastMsgRole) {
        s.lastMsg = m.content;
        s.lastMsgRole = m.role;
        s.lastMsgAgentId = (m as { agent_id?: string | null }).agent_id ?? null;
      }
      if (m.role === "user" && !s.lastUser) s.lastUser = m.content;
      if ((m.role === "assistant" || m.role === "human_agent") && !s.lastBot) {
        s.lastBot = m.content;
      }
    }
  }

  // Pro Session: ist sie "unbeantwortet"? = Kundin zuletzt geschrieben + nicht gesehen
  // ODER vom Mitarbeiter explizit als "nicht erledigt" geflaggt (Sentinel < 2000).
  const unreadMap: Record<string, boolean> = {};
  for (const s of combinedSessions) {
    const st = stats[s.id];
    const lastRole = st?.lastMsgRole;
    const ourTurn = lastRole === "assistant" || lastRole === "human_agent";
    const isExplicitlyNotDone = !!s.last_seen_by_agent_at &&
      new Date(s.last_seen_by_agent_at).getFullYear() < 2000;
    unreadMap[s.id] = isExplicitlyNotDone || (!ourTurn && !!(s.last_customer_msg_at && (
      !s.last_seen_by_agent_at || s.last_customer_msg_at > s.last_seen_by_agent_at
    )));
  }
  const totalUnreadCount = combinedSessions.filter(s => unreadMap[s.id]).length;

  // Filter nach Mode: pure_bot = nur Bot hat geantwortet, with_human = Mensch hat reingeschrieben
  let filteredSessions = combinedSessions;
  if (mode === "pure_bot") {
    filteredSessions = filteredSessions.filter(s => (stats[s.id]?.humanCount || 0) === 0);
  } else if (mode === "with_human") {
    filteredSessions = filteredSessions.filter(s => (stats[s.id]?.humanCount || 0) > 0);
  }

  // "Nur unbeantwortet" Filter + Sortierung nach Kundin-Zeitstempel (neueste zuerst)
  if (onlyUnread) {
    filteredSessions = filteredSessions
      .filter(s => unreadMap[s.id])
      .slice()
      .sort((a, b) => {
        const ta = a.last_customer_msg_at || a.last_message_at || "";
        const tb = b.last_customer_msg_at || b.last_message_at || "";
        return tb.localeCompare(ta);
      });
  }

  // Pagination: total nach Filter merken, dann auf "limit" trimmen
  const totalAfterFilters = filteredSessions.length;
  const hasMore = totalAfterFilters > limit;
  filteredSessions = filteredSessions.slice(0, limit);

  const pureBotCount   = combinedSessions.filter(s => (stats[s.id]?.humanCount || 0) === 0).length;
  const withHumanCount = combinedSessions.filter(s => (stats[s.id]?.humanCount || 0) > 0).length;

  // Kategorie-Counts für die Filter-Chips (basierend auf aktuell sichtbarer Liste)
  const categoryCounts: Record<string, number> = {};
  for (const s of combinedSessions) {
    const c = s.category || "general";
    categoryCounts[c] = (categoryCounts[c] || 0) + 1;
  }

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
        <div className="flex items-end gap-3 flex-wrap">
          <DefaultBotModeToggle currentMode={defaultBotMode} />
          <SyncInstagramButton />
          {/* Toggle: Nur unbeantwortet zeigen (Kundin schrieb zuletzt, wir noch nicht reagiert).
              Beim Aktivieren werden alle anderen Filter beibehalten und die Liste nach
              last_customer_msg_at DESC sortiert — neueste Kunden-Nachricht oben. */}
          <Link
            href={(() => {
              const next = new URLSearchParams();
              if (filter !== "all")        next.set("status",   filter);
              if (mode !== "all")          next.set("mode",     mode);
              if (channelFilter !== "all") next.set("channel",  channelFilter);
              if (categoryFilter !== "all") next.set("category", categoryFilter);
              if (searchQuery)             next.set("q",        searchQuery);
              // Default ist jetzt "nur unbeantwortet" — zum Aufheben explizit unread=0 setzen
              if (onlyUnread) next.set("unread", "0");
              const qs = next.toString();
              return `/chatbot/inbox${qs ? "?" + qs : ""}`;
            })()}
            className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
              onlyUnread
                ? "bg-pink-600 text-white border-pink-600 hover:bg-pink-700"
                : "bg-white text-pink-700 border-pink-300 hover:bg-pink-50"
            }`}
            title={onlyUnread
              ? "Filter aktiv — Klick zeigt ALLE Sessions (auch beantwortete)"
              : "Nur Sessions zeigen, bei denen die Kundin zuletzt geschrieben hat"}
          >
            🔔 {onlyUnread ? "Nur unbeantwortet" : "Alle Sessions"}
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
              onlyUnread ? "bg-white/25 text-white" : "bg-pink-100 text-pink-700"
            }`}>
              {totalUnreadCount}
            </span>
          </Link>
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

      {/* Suche */}
      <div className="flex items-center gap-3">
        <InboxSearchBar />
        {searchQuery && (
          <span className="text-xs text-neutral-500">
            {combinedSessions.length} Treffer für &ldquo;<strong className="text-neutral-700">{searchQuery}</strong>&rdquo;
          </span>
        )}
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
                ...(categoryFilter !== "all" ? { category: categoryFilter } : {}),
                ...(searchQuery ? { q: searchQuery } : {}),
                ...(!onlyUnread ? { unread: "0" } : {}),
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


      {/* Filter — Kategorie (Auto-klassifiziert) */}
      <div className="space-y-2">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="text-xs font-medium text-neutral-500 uppercase tracking-wide">Kategorie</div>
          <ClassifyBackfillButton />
        </div>
        <div className="flex gap-2 flex-wrap">
          <Link
            href={`/chatbot/inbox?${new URLSearchParams({
              ...(filter !== "all" ? { status: filter } : {}),
              ...(mode !== "all" ? { mode } : {}),
              ...(channelFilter !== "all" ? { channel: channelFilter } : {}),
              ...(searchQuery ? { q: searchQuery } : {}),
              ...(!onlyUnread ? { unread: "0" } : {}),
            }).toString()}`}
            className={`text-xs px-3 py-1.5 rounded-full border ${
              categoryFilter === "all"
                ? "bg-neutral-900 text-white border-neutral-900"
                : "bg-white text-neutral-600 border-neutral-300 hover:bg-neutral-50"
            }`}
          >
            Alle Kategorien
          </Link>
          {Object.entries(CATEGORY_LABELS).map(([key, meta]) => {
            const cnt = categoryCounts[key] || 0;
            return (
              <Link
                key={key}
                href={`/chatbot/inbox?${new URLSearchParams({
                  ...(filter !== "all" ? { status: filter } : {}),
                  ...(mode !== "all" ? { mode } : {}),
                  ...(channelFilter !== "all" ? { channel: channelFilter } : {}),
                  ...(searchQuery ? { q: searchQuery } : {}),
                  ...(!onlyUnread ? { unread: "0" } : {}),
                  category: key,
                }).toString()}`}
                className={`text-xs px-3 py-1.5 rounded-full border inline-flex items-center gap-1 ${
                  categoryFilter === key
                    ? "bg-neutral-900 text-white border-neutral-900"
                    : "bg-white text-neutral-600 border-neutral-300 hover:bg-neutral-50"
                }`}
              >
                <span>{meta.emoji}</span>
                {meta.label}
                {cnt > 0 && <span className={categoryFilter === key ? "text-white/70" : "text-neutral-400"}>· {cnt}</span>}
              </Link>
            );
          })}
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
              href={`/chatbot/inbox?${new URLSearchParams({
                ...(filter !== "all" ? { status: filter } : {}),
                ...(opt.key !== "all" ? { mode: opt.key } : {}),
                ...(channelFilter !== "all" ? { channel: channelFilter } : {}),
                ...(categoryFilter !== "all" ? { category: categoryFilter } : {}),
                ...(searchQuery ? { q: searchQuery } : {}),
                ...(!onlyUnread ? { unread: "0" } : {}),
              }).toString()}`}
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

      {/* Sessions Liste — im "Nur unbeantwortet"-Modus transparenter Container,
          damit die einzelnen Karten gut atmen können; sonst klassische Card-Wand. */}
      <div className={onlyUnread ? "" : "bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden"}>
        {filteredSessions.length === 0 ? (
          <div className="p-12 text-center text-neutral-400">
            <Bot size={32} className="mx-auto mb-2 text-neutral-300" />
            Keine Sessions in diesem Filter
          </div>
        ) : (
          <Suspense fallback={null}>
            <ul className={onlyUnread ? "p-2 space-y-2" : ""}>
              {filteredSessions.map((s, idx) => {
                const meta = STATUS_LABELS[s.status] || STATUS_LABELS.active;
                const Icon = meta.icon;
                const st = stats[s.id] || { botCount: 0, humanCount: 0 };
                const profile = (s.assigned_profile as unknown as { display_name?: string; email?: string } | null);
                const assignedName = profile?.display_name || profile?.email || null;
                const isHybrid = st.humanCount > 0;
                // Wir-zuletzt-geantwortet (Kundin dran): leichter blauer Touch
                const ourTurn = st.lastMsgRole === "assistant" || st.lastMsgRole === "human_agent";
                // Sentinel-Check: explizit vom Mitarbeiter via "Als ungelesen" /
                // "Nicht erledigt" geflaggt? Dann override die "wer schrieb zuletzt"-Logik.
                const sessRaw = s as { last_opened_by_agent_at?: string | null };
                const isExplicitlyNotDone = !!s.last_seen_by_agent_at &&
                  new Date(s.last_seen_by_agent_at).getFullYear() < 2000;
                const isExplicitlyUnseen  = !!sessRaw.last_opened_by_agent_at &&
                  new Date(sessRaw.last_opened_by_agent_at).getFullYear() < 2000;

                // "unread" für den Filter: explizit geflaggt ODER Kundin schrieb zuletzt
                // ohne dass wir aktiv abgehandelt haben.
                const isUnread = isExplicitlyNotDone || (!ourTurn && !!(s.last_customer_msg_at && (
                  !s.last_seen_by_agent_at || s.last_customer_msg_at > s.last_seen_by_agent_at
                )));
                // "unseen" für die Bold/Normal-Optik (Instagram-Style):
                // explizit geflaggt ODER Mitarbeiter hat die Session seit der letzten
                // Kunden-Message nicht geöffnet.
                const isUnseen = isExplicitlyUnseen || (!ourTurn && !!(s.last_customer_msg_at && (
                  !sessRaw.last_opened_by_agent_at ||
                  s.last_customer_msg_at > sessRaw.last_opened_by_agent_at
                )));
                // Antwort kam via Instagram-App (nicht aus Dashboard): human_agent OHNE agent_id
                // → entstand durch Echo-Webhook von einer externen Mitarbeiter-Antwort
                const lastReplyViaIgApp = st.lastMsgRole === "human_agent" && !st.lastMsgAgentId;
                // Im "Nur unbeantwortet"-Modus ist alles eh unread → keine dramatischen
                // Farben/Streifen, sondern eine ruhige, freundliche Karten-Optik mit
                // sanftem Mint-Touch und Atmung. In der Gesamt-Ansicht (alle Sessions)
                // bleibt's wie bisher mit klarer visueller Unterscheidung.
                const rowBg = onlyUnread
                  ? "bg-white"
                  : isUnread
                  ? "bg-pink-50/30"
                  : ourTurn
                  ? "bg-blue-50/40"
                  : (idx % 2 === 0 ? "bg-white" : "bg-neutral-50/60");
                // Kategorie-Akzent im Unread-Modus: drei Top-Kategorien bekommen
                // dezente Pastell-Töne, alle anderen ein einheitliches Grau.
                // Dadurch hat JEDE Box einen sanften Farbklecks, ohne dass es bunt
                // wird. Badge-Border greift dieselbe Farbfamilie auf (visuelle Klammer).
                interface CatVis { box: string; tint: string; badge: string; }
                const CATEGORY_VISUAL: Record<string, CatVis> = {
                  gewerbe:       { box: "border-l-amber-200", tint: "bg-amber-50/30", badge: "bg-amber-50 text-amber-700 border-amber-200" },
                  availability:  { box: "border-l-sky-200",   tint: "bg-sky-50/30",   badge: "bg-sky-50 text-sky-700 border-sky-200" },
                  color_advice:  { box: "border-l-pink-200",  tint: "bg-pink-50/30",  badge: "bg-pink-50 text-pink-700 border-pink-200" },
                };
                const DEFAULT_VISUAL: CatVis = {
                  box: "border-l-neutral-200", tint: "bg-neutral-50/50",
                  badge: "bg-neutral-50 text-neutral-600 border-neutral-200",
                };
                const visual = onlyUnread
                  ? (s.category && CATEGORY_VISUAL[s.category]) || DEFAULT_VISUAL
                  : null;
                const baseLi = onlyUnread
                  ? `rounded-xl border border-neutral-200 hover:border-emerald-300 hover:shadow-sm transition-all border-l-4 ${visual!.box}`
                  : `border-b border-neutral-100 hover:bg-blue-100/40 transition-colors ${
                      isUnread
                        ? "border-l-4 border-l-pink-500"
                        : ourTurn
                        ? "border-l-4 border-l-blue-300"
                        : "border-l-4 border-l-transparent"
                    }`;
                const effectiveBg = onlyUnread && visual ? visual.tint : rowBg;
                const badgeClass = visual?.badge ?? "bg-neutral-100 text-neutral-600 border-transparent";
                return (
                  <li
                    key={s.id}
                    className={`group relative ${baseLi} ${effectiveBg}`}
                  >
                    {/* Hover-Buttons rechts oben — alle drei je nach Status:
                        - Grüner Haken (Erledigt): wenn Session im Unread-Filter
                        - Amber Undo (Nicht erledigt): wenn NICHT im Unread-Filter
                        - Pinke Mail (Als ungelesen): wenn Name normal (= schon gesehen) */}
                    <div className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition flex items-center gap-0.5">
                      {isUnread
                        ? <MarkSeenButton sessionId={s.id} />
                        : <MarkNotDoneButton sessionId={s.id} />}
                      {!isUnseen && <MarkUnreadButton sessionId={s.id} variant="icon" />}
                    </div>
                    <Link href={`/chatbot/inbox/${s.id}`} className={`block ${onlyUnread ? "p-5" : "p-4"} pr-14`}>
                      {/* Customer-Name oben + Status-Badges links / IG-App-Hinweis rechts */}
                      <div className={`flex items-center gap-2 ${onlyUnread ? "mb-2.5" : "mb-1.5"}`}>
                        <User size={14} className="text-neutral-400" />
                        <span className={`text-sm truncate ${isUnseen ? "font-bold text-neutral-900" : "font-normal text-neutral-700"}`}>
                          {(s as { customer_full_name?: string | null }).customer_full_name ? (
                            <>
                              {(s as { customer_full_name?: string | null }).customer_full_name}
                              {s.customer_name && (
                                <span className="ml-1.5 text-xs font-normal text-neutral-500">
                                  {s.customer_name}
                                </span>
                              )}
                            </>
                          ) : (
                            s.customer_name || <span className="text-neutral-400 font-normal">Unbekannt</span>
                          )}
                        </span>
                        {isUnread && !onlyUnread && (
                          <span className="bg-pink-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide">
                            Neu
                          </span>
                        )}
                        {!isUnread && ourTurn && (
                          <span className="bg-blue-100 text-blue-700 text-[10px] font-medium px-1.5 py-0.5 rounded-full">
                            wartet auf Kundin
                          </span>
                        )}
                        {/* Rechts: Kategorie + IG-App-Hinweis — getrennt von Name/Status links */}
                        <div className="ml-auto flex items-center gap-1.5">
                          {s.category && CATEGORY_LABELS[s.category] && (
                            <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full inline-flex items-center gap-0.5 border ${badgeClass}`}>
                              {CATEGORY_LABELS[s.category].emoji} {CATEGORY_LABELS[s.category].label}
                            </span>
                          )}
                          {lastReplyViaIgApp && (
                            <span
                              title="Diese Antwort wurde direkt über die Instagram-App geschickt, nicht aus dem Dashboard."
                              className="bg-purple-100 text-purple-700 text-[10px] font-medium px-1.5 py-0.5 rounded-full inline-flex items-center gap-0.5"
                            >
                              📱 via IG-App
                            </span>
                          )}
                        </div>
                      </div>
                      {/* Top row: badges + zeit */}
                      <div className={`flex items-center gap-2 flex-wrap text-xs ${onlyUnread ? "mb-3" : "mb-2"}`}>
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

                      {/* Vorschau-Regel:
                          - Wenn KUNDIN zuletzt schrieb (ourTurn = false): nur ihre Nachricht zeigen.
                            Ein veralteter Bot-Reply wäre hier irreführend (anderes Thema).
                          - Wenn WIR zuletzt antworteten (ourTurn = true): Q&A-Paar zeigen — letzte
                            Kundenfrage + unsere Antwort. Sind in dem Fall thematisch verbunden, weil
                            wir GERADE darauf reagiert haben. */}
                      {!ourTurn && st.lastUser && (
                        <div className="flex gap-2 text-sm">
                          <span className="text-neutral-400 shrink-0 mt-0.5" title="Letzte Nachricht von der Kundin">
                            <User size={13} />
                          </span>
                          <span className={`line-clamp-2 ${isUnseen ? "text-neutral-900 font-medium" : "text-neutral-600"}`}>
                            {st.lastUser}
                          </span>
                        </div>
                      )}
                      {ourTurn && st.lastUser && (
                        <div className="flex gap-2 text-sm">
                          <span className="text-neutral-400 shrink-0 mt-0.5" title="Letzte Kundennachricht">
                            <User size={13} />
                          </span>
                          <span className="text-neutral-700 line-clamp-2">{st.lastUser}</span>
                        </div>
                      )}
                      {ourTurn && st.lastBot && (
                        <div className={`flex gap-2 text-sm ${onlyUnread ? "mt-2" : "mt-1"}`}>
                          <span
                            className={`shrink-0 mt-0.5 ${st.lastMsgRole === "human_agent" || lastReplyViaIgApp ? "text-amber-600" : "text-pink-500"}`}
                            title={st.lastMsgRole === "human_agent" ? "Letzte Mitarbeiter-Antwort" : "Letzte Bot-Antwort"}
                          >
                            {(st.lastMsgRole === "human_agent" || lastReplyViaIgApp) ? <UserCheck size={13} /> : <Bot size={13} />}
                          </span>
                          <span className="text-neutral-500 line-clamp-2">{st.lastBot}</span>
                        </div>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Suspense>
        )}

        {/* Pagination — "Weitere laden" Button am Listenende */}
        {hasMore && (
          <div className="border-t border-neutral-100 p-4 text-center">
            <Link
              href={(() => {
                const next = new URLSearchParams();
                if (filter !== "all")         next.set("status",   filter);
                if (mode !== "all")           next.set("mode",     mode);
                if (channelFilter !== "all")  next.set("channel",  channelFilter);
                if (categoryFilter !== "all") next.set("category", categoryFilter);
                if (searchQuery)              next.set("q",        searchQuery);
                if (!onlyUnread)              next.set("unread",   "0");
                next.set("limit", String(limit + PAGE_SIZE));
                return `/chatbot/inbox?${next.toString()}`;
              })()}
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-neutral-100 text-neutral-700 hover:bg-neutral-200 text-sm font-medium transition"
            >
              Weitere {Math.min(PAGE_SIZE, totalAfterFilters - limit)} laden
              <span className="text-xs text-neutral-500">
                ({limit} von {totalAfterFilters} angezeigt)
              </span>
            </Link>
          </div>
        )}
        {!hasMore && filteredSessions.length > PAGE_SIZE && (
          <div className="border-t border-neutral-100 p-3 text-center text-xs text-neutral-400">
            Alle {filteredSessions.length} Sessions angezeigt
          </div>
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
