import { Suspense } from "react";
import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { Bot, MessageSquare, Clock, UserCheck, CheckCircle2, User, AlertTriangle, StickyNote, Bell, Filter, X, Check } from "lucide-react";
import SyncInstagramButton from "./sync-instagram-button";
import MarkUnreadButton from "./mark-unread-button";
import MarkSeenButton from "./mark-seen-button";
import MarkNotDoneButton from "./mark-not-done-button";
import DeleteSessionButton from "./delete-session-button";
import InboxSearchBar from "./search-bar";
import DefaultBotModeToggle from "./default-bot-mode-toggle";
import ClassifyBackfillButton from "./classify-backfill-button";

interface PageProps {
  searchParams: Promise<{ status?: string; mode?: string; channel?: string; category?: string; q?: string; unread?: string; limit?: string; sort?: string; show?: string; view?: string }>;
}

const SORT_OPTIONS: Record<string, { label: string; emoji: string }> = {
  newest:          { label: "Neueste zuerst",      emoji: "🆕" },
  longest_waiting: { label: "Am längsten wartend", emoji: "⏱" },
  oldest:          { label: "Älteste zuerst",      emoji: "📜" },
};

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
  lastMsgAutoSent?: boolean;       // war die letzte Bot-Message autonom?
  botCount: number;
  humanCount: number;
  autobotCount: number;            // assistant-Messages mit auto_sent=true
  lastAutobotAt?: string;          // wann zuletzt eine autonome Bot-Antwort raus ging
  lastUserHasPhoto?: boolean;      // hat die NEUESTE Kunden-Message ein Foto/Image-Attachment?
}

/**
 * Status-Modell pro Session — was muss die Mitarbeiterin wissen?
 *  todo_unread     → 🟡 Kundin hat geschrieben, niemand hat geantwortet
 *  todo_draft      → 📝 Bot-Entwurf wartet auf dein Approve
 *  autobot         → 🤖 Bot hat autonom geantwortet (zum Gegenchecken)
 *  answered_team   → ✅ Mitarbeiterin hat zuletzt geantwortet
 *  answered_human  → ✅ Beantwortet
 *  done            → ✓ als erledigt markiert
 */
type SessionUiStatus = "todo_unread" | "todo_draft" | "autobot" | "answered_team" | "answered_human" | "done";

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
  // VIEW-Modell — ein Tab pro Mental-Model:
  //   todo    (Default): Pending Drafts ODER unbeantwortet → "was muss ich tun?"
  //   autobot           : Sessions mit autonomer Bot-Aktivität (zum Gegenchecken)
  //   all               : alle nicht-erledigten Sessions
  //   done              : erledigte (status=closed)
  const view = (params.view as "todo" | "autobot" | "all" | "done") || "todo";
  // Legacy-Mappings für alte URLs (?unread=1, ?show=closed) — alles auf view normalisieren
  const onlyUnread     = view === "todo" || params.unread === "1";
  const showClosed     = view === "done" || params.show === "closed" || filter === "closed";
  const sortMode       = params.sort && SORT_OPTIONS[params.sort] ? params.sort : "newest";
  // Pagination: max 50 pro "Klick", über "Weitere laden" wird der Limit erhöht
  const limit = Math.min(Math.max(Number(params.limit) || PAGE_SIZE, PAGE_SIZE), 1000);

  const svc = createServiceClient();
  let query = svc
    .from("chat_sessions")
    .select(`
      id, channel, customer_name, customer_full_name, status, assigned_to, bot_signature_name,
      bot_mode, human_only, team_notes, followup_due_at, followup_reason, ig_unread_count, category, last_message_at, last_customer_msg_at, last_seen_by_agent_at, last_opened_by_agent_at, created_at,
      assigned_profile:profiles!chat_sessions_assigned_to_fkey(display_name,email)
    `)
    .order("last_message_at", { ascending: false })
    // Candidate-Pool deutlich größer als das Anzeige-Limit — Filter (unread/mode/...)
    // arbeiten in JS, daher brauchen wir Headroom. 500 reicht für > 50 unread + Filter.
    .limit(500);

  if (filter !== "all")        query = query.eq("status", filter);
  else if (!showClosed)        query = query.neq("status", "closed"); // erledigte standardmäßig ausblenden
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
          bot_mode, human_only, team_notes, followup_due_at, followup_reason, ig_unread_count, category, last_message_at, last_customer_msg_at, last_seen_by_agent_at, last_opened_by_agent_at, created_at,
          assigned_profile:profiles!chat_sessions_assigned_to_fkey(display_name,email)
        `)
        .in("id", onlyNew)
        .order("last_message_at", { ascending: false });
      messageMatchedSessions = extra || [];
    }
  }
  const combinedSessions = [...(sessions || []), ...messageMatchedSessions];

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
      .select("session_id, role, content, created_at, agent_id, auto_sent, attachments")
      .in("session_id", sessionIds)
      .is("deleted_at", null)
      .gte("created_at", cutoff)
      .order("created_at", { ascending: false })
      .limit(20000);
    for (const m of msgs ?? []) {
      const s = stats[m.session_id] ??= { botCount: 0, humanCount: 0, autobotCount: 0 };
      const autoSent = (m as { auto_sent?: boolean }).auto_sent === true;
      if (m.role === "assistant") {
        s.botCount++;
        if (autoSent) {
          s.autobotCount++;
          if (!s.lastAutobotAt) s.lastAutobotAt = m.created_at;
        }
      }
      if (m.role === "human_agent") s.humanCount++;
      // first-seen wins = aktuell neuestes Vorkommen
      if (!s.lastMsgRole) {
        s.lastMsg = m.content;
        s.lastMsgRole = m.role;
        s.lastMsgAgentId = (m as { agent_id?: string | null }).agent_id ?? null;
        s.lastMsgAutoSent = m.role === "assistant" ? autoSent : false;
      }
      if (m.role === "user" && !s.lastUser) {
        s.lastUser = m.content;
        // NEUESTE Kunden-Message: hat sie ein Foto/Image-Attachment?
        // Wenn ja, muss eine Mitarbeiter:in das auswerten — auto_send kommt
        // bei color_advice/Fotos nicht zustande, also Hinweis "Mitarbeiter benötigt".
        const att = (m as { attachments?: Array<{ type?: string; url?: string }> | null }).attachments;
        s.lastUserHasPhoto = Array.isArray(att) && att.some(a =>
          a?.type === "image" || a?.type === "photo" ||
          (typeof a?.url === "string" && /\.(jpg|jpeg|png|webp|heic|gif)(\?|$)/i.test(a.url))
        );
      }
      if ((m.role === "assistant" || m.role === "human_agent") && !s.lastBot) {
        s.lastBot = m.content;
      }
    }

  }
  // Pending Drafts pro Session — kritisch für "Zu tun"-Filter.
  // Eigene let-Deklaration außerhalb des if-Blocks damit unten erreichbar.
  let pendingDraftSet = new Set<string>();
  if (sessionIds.length > 0) {
    const { data: drafts } = await svc.from("chat_drafts")
      .select("session_id").in("session_id", sessionIds).eq("status", "pending");
    pendingDraftSet = new Set((drafts || []).map(d => d.session_id));
  }

  // Pro Session: ist sie "unbeantwortet"? = Kundin zuletzt geschrieben + nicht gesehen
  // ODER vom Mitarbeiter explizit als "nicht erledigt" geflaggt (Sentinel < 2000).
  const unreadMap: Record<string, boolean> = {};
  const uiStatusMap: Record<string, SessionUiStatus> = {};
  for (const s of combinedSessions) {
    const st = stats[s.id];
    const lastRole = st?.lastMsgRole;
    const ourTurn = lastRole === "assistant" || lastRole === "human_agent";
    const isExplicitlyNotDone = !!s.last_seen_by_agent_at &&
      new Date(s.last_seen_by_agent_at).getFullYear() < 2000;
    unreadMap[s.id] = isExplicitlyNotDone || (!ourTurn && !!(s.last_customer_msg_at && (
      !s.last_seen_by_agent_at || s.last_customer_msg_at > s.last_seen_by_agent_at
    )));
    // Deterministisches UI-Status-Modell — eindeutig pro Session.
    if (s.status === "closed") {
      uiStatusMap[s.id] = "done";
    } else if (pendingDraftSet.has(s.id)) {
      uiStatusMap[s.id] = "todo_draft";       // 📝 Entwurf wartet
    } else if (unreadMap[s.id]) {
      uiStatusMap[s.id] = "todo_unread";      // 🟡 Wartet auf dich
    } else if (lastRole === "assistant" && st?.lastMsgAutoSent) {
      uiStatusMap[s.id] = "autobot";          // 🤖 Bot autonom
    } else if (lastRole === "human_agent") {
      uiStatusMap[s.id] = "answered_team";    // ✅ Mitarbeiterin
    } else {
      uiStatusMap[s.id] = "answered_human";   // ✅ Beantwortet (Bot manuell approved)
    }
  }
  const totalUnreadCount = combinedSessions.filter(s => unreadMap[s.id]).length;

  // Filter nach Mode: pure_bot = nur Bot hat geantwortet, with_human = Mensch hat reingeschrieben,
  // autobot_active = mindestens eine autonom-vom-Bot-gesendete Nachricht (auto_sent=true)
  let filteredSessions = combinedSessions;
  if (mode === "pure_bot") {
    filteredSessions = filteredSessions.filter(s => (stats[s.id]?.humanCount || 0) === 0);
  } else if (mode === "with_human") {
    filteredSessions = filteredSessions.filter(s => (stats[s.id]?.humanCount || 0) > 0);
  } else if (mode === "autobot_active") {
    filteredSessions = filteredSessions.filter(s => (stats[s.id]?.autobotCount || 0) > 0);
  }
  const autobotActiveCount = combinedSessions.filter(s => (stats[s.id]?.autobotCount || 0) > 0).length;

  // Helper: gehört die Session in "Zu tun"?
  //  - unbeantwortet ODER
  //  - pending Draft existiert ODER
  //  - in den letzten 24h von uns beantwortet (Grace Period — Mitarbeiterin kann
  //    noch nachfassen / verwerfen / als erledigt markieren) ODER
  //  - Bot hat in seiner letzten Antwort einen Handoff angekündigt
  //    ("Kollegin meldet sich Montag", "morgen früh ab 10 Uhr" etc.)
  //    → bleibt drin als Erinnerung für die Mitarbeiterin, am versprochenen Tag zu antworten
  const HANDOFF_RE = /\b(kollegin|stylistin|farb-?expertin|mitarbeiterin)\b[^.\n]{0,80}\b(meldet|schreibt|kommt|kümmert|schaut)/i;
  const HANDOFF_DAY_RE = /\b(montag|dienstag|mittwoch|donnerstag|freitag|morgen)\b[^.\n]{0,30}\b(früh|ab\s+10|10\s*uhr|ankommt)/i;
  const isInTodo = (s: typeof combinedSessions[number]) => {
    if (s.status === "closed") return false;
    if (pendingDraftSet.has(s.id)) return true;
    if (unreadMap[s.id]) return true;
    // 🏢 B2B-AUTOBOT-WARNING: Gewerbe-Session + Bot hat autonom geantwortet
    // → IMMER in "Zu tun", muss gegengecheckt werden (kein B2B-Lead verlieren)
    if (s.category === "gewerbe" && (stats[s.id]?.autobotCount || 0) > 0) return true;
    const st = stats[s.id];
    // 24h Grace Period — wenn von UNS geantwortet wurde
    const lastMsg = s.last_message_at;
    if (lastMsg && st) {
      const ageH = (Date.now() - new Date(lastMsg).getTime()) / 3_600_000;
      const lastWasOurs = st.lastMsgRole === "human_agent"
        || (st.lastMsgRole === "assistant" && !st.lastMsgAutoSent);
      if (ageH < 24 && lastWasOurs) return true;
    }
    // Handoff-Promise erkannt → bleibt drin
    if (st?.lastBot && (HANDOFF_RE.test(st.lastBot) || HANDOFF_DAY_RE.test(st.lastBot))) return true;
    return false;
  };

  // VIEW-Filter (Tabs)
  // - todo: pending Draft ODER unbeantwortet ODER <24h beantwortet ODER Handoff-Promise
  // - autobot: Sessions wo autonom-gesendete Bot-Messages existieren
  // - all: alle nicht-erledigten (default: closed ausgeblendet)
  // - done: nur erledigte (status=closed)
  if (!searchQuery) {
    if (view === "todo") {
      filteredSessions = filteredSessions.filter(s => isInTodo(s));
    } else if (view === "autobot") {
      filteredSessions = filteredSessions.filter(s => (stats[s.id]?.autobotCount || 0) > 0);
    } else if (view === "done") {
      filteredSessions = filteredSessions.filter(s => s.status === "closed");
    }
    // view === "all" → keine zusätzliche Filterung (showClosed steuert closed-Anzeige)
  }

  // Sortierung — explizit per ?sort= überschreibbar.
  // "longest_waiting" / "oldest" → ASC (älteste zuerst).
  // "newest" → DESC nach last_customer_msg_at (im Unread-Modus) bzw.
  //            last_message_at (in der Gesamtansicht — Default aus der DB).
  if (sortMode === "longest_waiting" || sortMode === "oldest") {
    filteredSessions = filteredSessions.slice().sort((a, b) => {
      const ta = (sortMode === "longest_waiting"
        ? a.last_customer_msg_at
        : a.last_message_at) || "";
      const tb = (sortMode === "longest_waiting"
        ? b.last_customer_msg_at
        : b.last_message_at) || "";
      return ta.localeCompare(tb); // ASC = älteste zuerst
    });
  } else if (onlyUnread) {
    // Default im Unread-Modus: neueste Kunden-Message oben
    filteredSessions = filteredSessions.slice().sort((a, b) => {
      const ta = a.last_customer_msg_at || a.last_message_at || "";
      const tb = b.last_customer_msg_at || b.last_message_at || "";
      return tb.localeCompare(ta);
    });
  }
  // sonst: DB-Default-Sortierung bleibt (last_message_at DESC)

  // Pagination: total nach Filter merken, dann auf "limit" trimmen
  const totalAfterFilters = filteredSessions.length;
  const hasMore = totalAfterFilters > limit;
  filteredSessions = filteredSessions.slice(0, limit);

  const pureBotCount   = combinedSessions.filter(s => (stats[s.id]?.humanCount || 0) === 0).length;
  const withHumanCount = combinedSessions.filter(s => (stats[s.id]?.humanCount || 0) > 0).length;

  // Kategorie-Counts für die Filter-Chips — passen sich dem Modus an:
  // - Unread-Modus: zählt nur die unbeantworteten Sessions pro Kategorie
  // - Alle-Modus: zählt alle sichtbaren Sessions pro Kategorie
  const categoryCounts: Record<string, number> = {};
  const baseForCounts = onlyUnread
    ? combinedSessions.filter(s => unreadMap[s.id])
    : combinedSessions;
  for (const s of baseForCounts) {
    const c = s.category || "general";
    categoryCounts[c] = (categoryCounts[c] || 0) + 1;
  }

  // KPIs (awaiting_human wird nicht mehr genutzt — siehe KPI-Block unten)
  const { count: cntActive } = await svc.from("chat_sessions").select("id", { count: "exact", head: true }).eq("status", "active");
  const { count: cntClosed } = await svc.from("chat_sessions").select("id", { count: "exact", head: true }).eq("status", "closed");

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto space-y-4">
      {/* Kompakter Header — Titel, Live-Counter, Aktionen in EINER Zeile */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-2">
            <MessageSquare size={18} className="text-neutral-700" />
            <h1 className="text-lg font-semibold text-neutral-900">Chat-Inbox</h1>
          </div>
          {/* Counter inline statt riesige KPI-Karten */}
          <div className="flex items-center gap-1.5 text-xs">
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-pink-50 text-pink-700 border border-pink-200 font-medium">
              <span className="w-1.5 h-1.5 rounded-full bg-pink-500 animate-pulse" />
              {totalUnreadCount} unbeantwortet
            </span>
            {(cntActive ?? 0) > totalUnreadCount && (
              <span className="text-neutral-400">·</span>
            )}
            <span className="text-neutral-500">{cntActive ?? 0} aktiv</span>
            <span className="text-neutral-400">·</span>
            <span className="text-neutral-500">{cntClosed ?? 0} erledigt</span>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <DefaultBotModeToggle currentMode={defaultBotMode} />
          <SyncInstagramButton />
        </div>
      </div>

      {/* HAUPT-TABS: klares Mental-Model
          - Zu tun: was muss die Mitarbeiterin anpacken (Drafts + Unbeantwortet)
          - Autobot-Check: wo war der Bot autonom (gegenchecken)
          - Alle aktiven: alles in Bearbeitung
          - Erledigt: closed-Archiv
      */}
      {(() => {
        const todoCount    = combinedSessions.filter(s => isInTodo(s)).length;
        const autobotCount = combinedSessions.filter(s => s.status !== "closed" && (stats[s.id]?.autobotCount || 0) > 0).length;
        const allCount     = combinedSessions.filter(s => s.status !== "closed").length;
        const doneCount    = (cntClosed ?? 0);
        const buildHref = (newView: string) => {
          const next = new URLSearchParams();
          next.set("view", newView);
          if (mode !== "all")          next.set("mode",     mode);
          if (channelFilter !== "all") next.set("channel",  channelFilter);
          if (categoryFilter !== "all") next.set("category", categoryFilter);
          if (searchQuery)             next.set("q",        searchQuery);
          return `/chatbot/inbox?${next.toString()}`;
        };
        const TAB = (key: string, label: string, count: number, color: string) => (
          <Link key={key} href={buildHref(key)}
            className={`inline-flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-medium transition border ${
              view === key
                ? `${color} shadow-sm`
                : "bg-white text-neutral-600 border-neutral-200 hover:bg-neutral-50"
            }`}>
            {label}
            <span className={`text-xs px-1.5 py-0.5 rounded-full ${view === key ? "bg-white/30 text-white" : "bg-neutral-100 text-neutral-600"}`}>
              {count}
            </span>
          </Link>
        );
        return (
          <div className="flex items-center gap-1.5 flex-wrap">
            {TAB("todo",    "🟡 Zu tun",          todoCount,    "bg-pink-600 text-white border-pink-600")}
            {TAB("autobot", "🤖 Autobot-Check",   autobotCount, "bg-green-600 text-white border-green-600")}
            {TAB("all",     "📂 Alle aktiven",    allCount,     "bg-neutral-900 text-white border-neutral-900")}
            {TAB("done",    "✓ Erledigt",         doneCount,    "bg-neutral-600 text-white border-neutral-600")}
          </div>
        );
      })()}

      {/* Suche — schlank, mit Treffer-Inline-Info */}
      <div className="flex items-center gap-3">
        <InboxSearchBar />
        {searchQuery && (
          <span className="text-xs text-neutral-500 whitespace-nowrap">
            {combinedSessions.length} Treffer
          </span>
        )}
      </div>

      {/* Aktive Filter als kompakte Chips ÜBER dem Klapp-Bereich.
          So sieht die Mitarbeiterin auf einen Blick welche Filter aktiv sind,
          ohne dass die ganze Wand sichtbar sein muss. */}
      {(() => {
        const activeChips: Array<{ label: string; clearHref: string }> = [];
        const buildClear = (paramToRemove: string) => {
          const next = new URLSearchParams();
          if (view !== "todo") next.set("view", view);
          if (mode !== "all" && paramToRemove !== "mode") next.set("mode", mode);
          if (channelFilter !== "all" && paramToRemove !== "channel") next.set("channel", channelFilter);
          if (categoryFilter !== "all" && paramToRemove !== "category") next.set("category", categoryFilter);
          if (searchQuery) next.set("q", searchQuery);
          if (sortMode !== "newest" && paramToRemove !== "sort") next.set("sort", sortMode);
          return `/chatbot/inbox?${next.toString()}`;
        };
        if (channelFilter !== "all") activeChips.push({ label: CHANNEL_LABELS[channelFilter] || channelFilter, clearHref: buildClear("channel") });
        if (categoryFilter !== "all") {
          const cat = CATEGORY_LABELS[categoryFilter];
          activeChips.push({ label: cat ? `${cat.emoji} ${cat.label}` : categoryFilter, clearHref: buildClear("category") });
        }
        if (sortMode !== "newest" && SORT_OPTIONS[sortMode]) {
          activeChips.push({ label: `${SORT_OPTIONS[sortMode].emoji} ${SORT_OPTIONS[sortMode].label}`, clearHref: buildClear("sort") });
        }
        const activeCount = activeChips.length;
        return (
          <details className="group" {...(activeCount > 0 ? {} : {})}>
            <summary className="list-none cursor-pointer select-none flex items-center gap-2 flex-wrap text-xs">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-neutral-100 text-neutral-700 hover:bg-neutral-200 transition border border-neutral-200 font-medium">
                <Filter size={11} />
                Filter
                {activeCount > 0 && (
                  <span className="bg-neutral-900 text-white rounded-full px-1.5 text-[10px] font-bold">{activeCount}</span>
                )}
                <span className="text-neutral-400 group-open:rotate-90 transition-transform">›</span>
              </span>
              {/* Aktive Filter-Chips — auch sichtbar wenn Klapp-Bereich zu */}
              {activeChips.map((chip, i) => (
                <Link key={i} href={chip.clearHref}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-blue-50 text-blue-800 border border-blue-200 text-[11px] hover:bg-blue-100"
                  onClick={(e) => e.stopPropagation()}
                  title="Filter entfernen"
                >
                  {chip.label}
                  <X size={10} />
                </Link>
              ))}
            </summary>

            {/* Aufgeklappter Filter-Bereich */}
            <div className="mt-3 space-y-2.5 pl-1">
              <div className="flex items-center gap-x-3 gap-y-2 flex-wrap text-xs">
                <span className="text-neutral-500 font-medium shrink-0 w-20">Kanal</span>
                <div className="flex gap-1.5 flex-wrap">
                  {["all", "instagram", "whatsapp", "web"].map(c => (
                    <Link key={c}
                      href={`/chatbot/inbox?${new URLSearchParams({
                        ...(view !== "todo" ? { view } : {}),
                        ...(mode !== "all" ? { mode } : {}),
                        ...(c !== "all" ? { channel: c } : {}),
                        ...(categoryFilter !== "all" ? { category: categoryFilter } : {}),
                        ...(searchQuery ? { q: searchQuery } : {}),
                      }).toString()}`}
                      className={`px-2.5 py-1 rounded-full transition ${
                        channelFilter === c ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
                      }`}
                    >
                      {c === "all" ? "Alle" : CHANNEL_LABELS[c] || c}
                    </Link>
                  ))}
                </div>
              </div>

              <div className="flex items-center gap-x-3 gap-y-2 flex-wrap text-xs">
                <span className="text-neutral-500 font-medium shrink-0 w-20">Kategorie</span>
                <div className="flex gap-1.5 flex-wrap items-center">
                  <ClassifyBackfillButton />
                  <Link href={`/chatbot/inbox?${new URLSearchParams({
                      ...(view !== "todo" ? { view } : {}),
                      ...(mode !== "all" ? { mode } : {}),
                      ...(channelFilter !== "all" ? { channel: channelFilter } : {}),
                      ...(searchQuery ? { q: searchQuery } : {}),
                    }).toString()}`}
                    className={`px-2.5 py-1 rounded-full transition ${
                      categoryFilter === "all" ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
                    }`}>
                    Alle
                  </Link>
                  {Object.entries(CATEGORY_LABELS).map(([key, meta]) => {
                    const cnt = categoryCounts[key] || 0;
                    return (
                      <Link key={key}
                        href={`/chatbot/inbox?${new URLSearchParams({
                          ...(view !== "todo" ? { view } : {}),
                          ...(mode !== "all" ? { mode } : {}),
                          ...(channelFilter !== "all" ? { channel: channelFilter } : {}),
                          ...(searchQuery ? { q: searchQuery } : {}),
                          category: key,
                        }).toString()}`}
                        className={`px-2.5 py-1 rounded-full inline-flex items-center gap-1 transition ${
                          categoryFilter === key ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
                        }`}>
                        <span>{meta.emoji}</span>{meta.label}
                        {cnt > 0 && <span className={categoryFilter === key ? "text-white/70" : "text-neutral-400"}>· {cnt}</span>}
                      </Link>
                    );
                  })}
                </div>
              </div>

              <div className="flex items-center gap-x-3 gap-y-2 flex-wrap text-xs">
                <span className="text-neutral-500 font-medium shrink-0 w-20">Sortieren</span>
                <div className="flex gap-1.5 flex-wrap">
                  {Object.entries(SORT_OPTIONS).map(([key, meta]) => (
                    <Link key={key}
                      href={`/chatbot/inbox?${new URLSearchParams({
                        ...(view !== "todo" ? { view } : {}),
                        ...(mode !== "all" ? { mode } : {}),
                        ...(channelFilter !== "all" ? { channel: channelFilter } : {}),
                        ...(categoryFilter !== "all" ? { category: categoryFilter } : {}),
                        ...(searchQuery ? { q: searchQuery } : {}),
                        ...(key !== "newest" ? { sort: key } : {}),
                      }).toString()}`}
                      className={`px-2.5 py-1 rounded-full inline-flex items-center gap-1 transition ${
                        sortMode === key ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
                      }`}>
                      <span>{meta.emoji}</span> {meta.label}
                    </Link>
                  ))}
                </div>
              </div>
            </div>
          </details>
        );
      })()}

      {/* Sessions Liste — immer als atmende Card-Liste mit Abstand, damit auch
          längere Listen nicht erdrückend wirken (vorher war Default eine
          dichte Card-Wand, jetzt einheitlich). */}
      <div>
        {filteredSessions.length === 0 ? (
          <div className="p-12 text-center text-neutral-400">
            <Bot size={32} className="mx-auto mb-2 text-neutral-300" />
            Keine Sessions in diesem Filter
          </div>
        ) : (
          <Suspense fallback={null}>
            <ul className="space-y-2">
              {filteredSessions.map((s, idx) => {
                const meta = STATUS_LABELS[s.status] || STATUS_LABELS.active;
                const Icon = meta.icon;
                const st = stats[s.id] || { botCount: 0, humanCount: 0 };
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
                // Default-Visual: Box + Badge in neutralem Grau, aber linker
                // Strich leicht grün (emerald-200) als sanfter Akzent.
                const DEFAULT_VISUAL: CatVis = {
                  box: "border-l-emerald-200", tint: "bg-neutral-50/50",
                  badge: "bg-neutral-50 text-neutral-600 border-neutral-200",
                };
                // Kategorie-Visual IMMER setzen — auch in der Default-View
                // ("In Bearbeitung") sollen die farbigen Balken links sichtbar
                // sein, damit man Sessions auf einen Blick einordnen kann.
                const visual = (s.category && CATEGORY_VISUAL[s.category]) || DEFAULT_VISUAL;
                // Wenn die Session schon gelesen wurde (Name nicht mehr fett),
                // wird der linke Balken neutral grau — die Kategorie-Farbe steht
                // dann nur noch im Badge. So sieht man auf einen Blick:
                // schon-gesehen vs. noch ungelesen.
                const boxBorder = !isUnseen ? "border-l-neutral-200" : visual.box;
                // Immer atmende Card-Form, unabhängig vom Filter.
                const baseLi = `rounded-xl border border-neutral-200 hover:border-emerald-300 hover:shadow-sm transition-all border-l-4 ${boxBorder}`;
                const effectiveBg = visual.tint;
                const badgeClass = visual.badge ?? "bg-neutral-100 text-neutral-600 border-transparent";
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
                    {/* Delete-Button unten-rechts — für Spam-Sweep schnell
                        erreichbar. Halbtransparent (opacity-20) damit es nicht
                        vom Lesen ablenkt; voll sichtbar bei Hover über Card. */}
                    <div className="absolute bottom-2 right-2 z-10 opacity-20 group-hover:opacity-100 transition">
                      <DeleteSessionButton
                        sessionId={s.id}
                        customerName={(s as { customer_full_name?: string | null }).customer_full_name || s.customer_name || null}
                      />
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
                        {/* DETERMINISTISCHER Status-Badge — einer pro Session.
                            Zeigt klar was der Mitarbeiter sehen muss. */}
                        {(() => {
                          const us = uiStatusMap[s.id];
                          if (us === "todo_draft") return (
                            <span className="bg-blue-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide" title="Bot-Entwurf wartet auf dein Approve">
                              📝 Entwurf bereit
                            </span>
                          );
                          if (us === "todo_unread") return (
                            <span
                              className="group/wait inline-flex items-center gap-1 cursor-default"
                              title="Wartet auf dich — Kundin hat geschrieben, niemand hat geantwortet"
                            >
                              <span className="relative inline-flex">
                                <span className="w-2.5 h-2.5 rounded-full bg-pink-500 ring-2 ring-amber-300" />
                                <span className="absolute inset-0 w-2.5 h-2.5 rounded-full bg-pink-500 animate-ping opacity-40" />
                              </span>
                              <span className="max-w-0 group-hover/wait:max-w-[140px] overflow-hidden whitespace-nowrap transition-[max-width] duration-300 ease-out text-pink-700 font-bold text-[10px] uppercase tracking-wide">
                                <span className="pl-0.5">Wartet auf dich</span>
                              </span>
                            </span>
                          );
                          if (us === "autobot") return (
                            <span className="bg-green-100 text-green-800 border border-green-300 text-[10px] font-medium px-1.5 py-0.5 rounded-full" title="Bot hat autonom geantwortet — gegenchecken empfohlen">
                              🤖 Bot hat geantwortet
                            </span>
                          );
                          if (us === "answered_team") return (
                            <span className="bg-blue-100 text-blue-700 text-[10px] font-medium px-1.5 py-0.5 rounded-full" title="Mitarbeiterin hat zuletzt geantwortet — wartet auf Kundin">
                              ✅ Du hast geantwortet
                            </span>
                          );
                          if (us === "answered_human") return (
                            <span className="bg-neutral-100 text-neutral-600 text-[10px] font-medium px-1.5 py-0.5 rounded-full" title="Beantwortet">
                              ✅ Beantwortet
                            </span>
                          );
                          if (us === "done") return (
                            <span className="bg-neutral-200 text-neutral-600 text-[10px] font-medium px-1.5 py-0.5 rounded-full">
                              ✓ Erledigt
                            </span>
                          );
                          return null;
                        })()}
                        {(s as { human_only?: boolean }).human_only && (
                          <span
                            className="bg-amber-100 text-amber-800 border border-amber-300 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full inline-flex items-center gap-0.5"
                            title="Markiert als 'Mitarbeiter benötigt!' — Bot pausiert für diese Session, ein Mensch muss ran"
                          >
                            <AlertTriangle size={10} className="text-amber-700" />
                            Mitarbeiter benötigt!
                          </span>
                        )}
                        {/* 🏢 B2B-AUTOBOT-WARNING: Gewerbe-Lead + autonomer Bot-Versand
                            → kritisch: B2B-Anfragen gehören NIE auf Autobot,
                            Mitarbeiterin muss persönlich gegenchecken */}
                        {s.category === "gewerbe" && (stats[s.id]?.autobotCount || 0) > 0 && (
                          <span
                            className="bg-red-600 text-white border border-red-700 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full inline-flex items-center gap-0.5 animate-pulse"
                            title="Autobot bei Gewerbe-Anfrage — bitte sofort gegenchecken! B2B-Leads gehören nicht auf Autobot."
                          >
                            <AlertTriangle size={10} />
                            Autobot bei Gewerbe!
                          </span>
                        )}
                        {/* Auto-Hinweis: Kundin hat Foto geschickt + Session ist
                            in Bearbeitung → "Mitarbeiter benötigt!" (orange).
                            Wird NICHT in der DB persistiert — rein abgeleitet aus
                            "letzte Kunden-Message hat ein Bild + steht in todo".
                            Der Bot generiert weiterhin Drafts, aber der Badge
                            macht klar: hier muss ein Mensch ran. */}
                        {!(s as { human_only?: boolean }).human_only
                          && stats[s.id]?.lastUserHasPhoto
                          && (uiStatusMap[s.id] === "todo_unread" || uiStatusMap[s.id] === "todo_draft") && (
                          <span
                            className="bg-amber-100 text-amber-800 border border-amber-300 text-[10px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded-full inline-flex items-center gap-0.5"
                            title="Kundin hat ein Foto geschickt — der Bot kann das nicht alleine beurteilen. Bitte als Mitarbeiter:in beantworten."
                          >
                            <AlertTriangle size={10} className="text-amber-700" />
                            Mitarbeiter benötigt!
                          </span>
                        )}
                        {/* 📲 IG-DIVERGENZ-BADGE: IG sagt unread, Dashboard sagt schon gesehen
                            → Mitarbeiterin hat in der IG-App was als "ungelesen" markiert
                            (oder ein Dashboard-Action ist noch nicht zu Meta durchgekommen).
                            Sanftes Sekundär-Signal — keine Alarm-Stufe. */}
                        {(() => {
                          const igUnread = (s as { ig_unread_count?: number | null }).ig_unread_count || 0;
                          if (igUnread === 0) return null;
                          // Nur als Divergenz zeigen, wenn Dashboard schon "gesehen" — sonst ist das ohnehin "wartet auf dich".
                          const seenAt = (s as { last_seen_by_agent_at?: string | null }).last_seen_by_agent_at;
                          const customerAt = (s as { last_customer_msg_at?: string | null }).last_customer_msg_at;
                          const dashboardSeen = seenAt && customerAt && new Date(seenAt) >= new Date(customerAt);
                          if (!dashboardSeen) return null;
                          return (
                            <span
                              className="bg-sky-50 text-sky-700 border border-sky-200 text-[10px] font-medium px-1.5 py-0.5 rounded-full inline-flex items-center gap-0.5"
                              title={`Auf Instagram noch ${igUnread} Nachricht${igUnread > 1 ? "en" : ""} ungelesen (im Dashboard bereits gesehen). Tipp: Im Dashboard "Erledigt" klicken — synchronisiert zu IG.`}
                            >
                              📱 IG ungelesen{igUnread > 1 ? ` (${igUnread})` : ""}
                            </span>
                          );
                        })()}
                        {(() => {
                          const due = (s as { followup_due_at?: string | null }).followup_due_at;
                          const reason = (s as { followup_reason?: string | null }).followup_reason;
                          if (!due) return null;
                          const dueDate = new Date(due);
                          const overdue = dueDate.getTime() < Date.now();
                          return (
                            <span
                              className={`border text-[10px] font-medium px-1.5 py-0.5 rounded-full inline-flex items-center gap-0.5 ${
                                overdue
                                  ? "bg-violet-200 text-violet-900 border-violet-400"
                                  : "bg-violet-100 text-violet-700 border-violet-200"
                              }`}
                              title={`Follow-Up ${overdue ? "fällig" : ""} am ${dueDate.toLocaleDateString("de-DE")}${reason ? ` — ${reason}` : ""}`}
                            >
                              <Bell size={9} /> {overdue ? "Follow-Up fällig" : `→ ${dueDate.toLocaleDateString("de-DE")}`}
                            </span>
                          );
                        })()}
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
                        {/* Session-Status nur zeigen wenn besonders (nicht "active",
                            das ist der Default und redundant — siehe Mode-Badge + Status-Badge). */}
                        {s.status !== "active" && s.status !== "closed" && (
                          <>
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full ${meta.color}`}>
                              <Icon size={11} />
                              {meta.label}
                            </span>
                            <span className="text-neutral-300">·</span>
                          </>
                        )}
                        <span className="text-neutral-500">Ava von <strong>{s.bot_signature_name || "?"}</strong></span>

                        {/* Aktueller Bot-Modus — Farbe je nachdem ob Bot in DIESER
                            Session schon aktiv war. Wenn ja: voll gefärbt.
                            Wenn noch nichts passiert ist: neutral grau (= "Modus
                            ist gesetzt, Bot wartet aber noch"). */}
                        {(() => {
                          // BADGE ZEIGT WIE DIE SESSION TATSÄCHLICH LIEF, nicht nur
                          // die aktuelle bot_mode-Einstellung. Sonst zeigt eine
                          // Session mit lauter Bot-Entwürfen "Manuell" — falsch.
                          const currentMode = (s.bot_mode as string | null) || "off";
                          const currentModeLabel: Record<string, string> = {
                            "auto":            "🤖 Auto-Antwort",
                            "selective_auto":  "🧠 Smart-Auto",
                            "assisted":        "🤝 Assistiert",
                            "off":             "✋ Manuell",
                          };
                          // Tatsächliche letzte Interaktion herleiten:
                          // - assistant + auto_sent → Bot hat autonom gesendet (Autobot)
                          // - assistant + !auto_sent → Bot-Entwurf von Mitarbeiterin freigegeben (Assistiert)
                          // - human_agent → Mitarbeiterin hat selbst getippt (Manuell)
                          // - pending Draft (Bot baut gerade) → Assistiert (Bot involviert)
                          // - last = user / nichts → current mode anzeigen ("Was passiert als Nächstes")
                          let label: string;
                          let color: string;
                          let tooltipPrefix: string;
                          if (pendingDraftSet.has(s.id)) {
                            label = "🤝 Assistiert";
                            color = "bg-blue-100 text-blue-800 border-blue-200";
                            tooltipPrefix = "Bot-Entwurf wartet auf Freigabe";
                          } else if (st.lastMsgRole === "assistant" && st.lastMsgAutoSent) {
                            label = "🤖 Autobot";
                            color = "bg-green-100 text-green-800 border-green-200";
                            tooltipPrefix = "Letzte Antwort: Bot hat autonom gesendet";
                          } else if (st.lastMsgRole === "assistant" && !st.lastMsgAutoSent) {
                            label = "🤝 Assistiert";
                            color = "bg-blue-100 text-blue-800 border-blue-200";
                            tooltipPrefix = "Letzte Antwort: vom Bot generiert + Mitarbeiterin freigegeben";
                          } else if (st.lastMsgRole === "human_agent") {
                            label = "✋ Manuell";
                            color = "bg-neutral-100 text-neutral-700 border-neutral-200";
                            tooltipPrefix = "Letzte Antwort: Mitarbeiterin selbst getippt";
                          } else {
                            // last = user (noch keine Antwort) → was wird als Nächstes passieren?
                            label = currentModeLabel[currentMode] || currentModeLabel.off;
                            color = currentMode === "off"
                              ? "bg-neutral-50 text-neutral-500 border-neutral-200"
                              : "bg-neutral-50 text-neutral-500 border-neutral-200";
                            tooltipPrefix = `Modus ${label} — wartet auf nächste Aktion`;
                          }
                          return (
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${color}`}
                              title={`${tooltipPrefix} · Modus aktuell: ${currentModeLabel[currentMode] || currentModeLabel.off}`}
                            >
                              {label}
                            </span>
                          );
                        })()}
                        {/* "Mitarbeiter eingegriffen"-Badge entfernt — redundant.
                            Der Mode-Badge oben zeigt jetzt schon "✋ Manuell" wenn
                            die letzte Antwort vom Mitarbeiter kam, bzw. "🤝 Assistiert"
                            wenn ein Bot-Entwurf freigegeben wurde. */}
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
                          {(st.autobotCount || 0) > 0 && (
                            <span
                              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-200 text-[10px] font-medium"
                              title={`Bot hat ${st.autobotCount}× autonom geantwortet — bitte gegenchecken und ggf. Training-Hinweis geben`}
                            >
                              🤖 autobot · {st.autobotCount}
                            </span>
                          )}
                          {((s as { team_notes?: string | null }).team_notes || "").trim().length > 0 && (
                            <span
                              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200 text-[10px] font-medium"
                              title={(s as { team_notes?: string | null }).team_notes || ""}
                            >
                              <StickyNote size={9} /> Notiz
                            </span>
                          )}
                          {((s as { ig_unread_count?: number }).ig_unread_count ?? 0) > 0 && (
                            <span
                              className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full bg-fuchsia-100 text-fuchsia-800 border border-fuchsia-200 text-[10px] font-medium"
                              title={`Auf Instagram noch ${(s as { ig_unread_count?: number }).ig_unread_count} ungelesen — in der IG-App noch nicht geöffnet`}
                            >
                              📷 Insta-ungelesen · {(s as { ig_unread_count?: number }).ig_unread_count}
                            </span>
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
