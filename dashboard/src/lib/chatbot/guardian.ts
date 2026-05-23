/**
 * Wächter-Service: analysiert kürzlich aktive Chats und erzeugt Alerts
 * bei kritischen Mustern. Wird via /api/chat/guardian getriggert.
 */
import Anthropic from "@anthropic-ai/sdk";
import { createServiceClient } from "@/lib/supabase/server";

const MODEL = "claude-haiku-4-5";

const GUARDIAN_PROMPT = `Du bist ein Qualitäts-Wächter für ein Hairvenly-Kundenservice-Team. Du analysierst kurz einen Chatverlauf und identifizierst KRITISCHE Probleme.

Analysiere den Chat. Wenn EINS oder MEHRERE der folgenden Muster zutreffen, gib JSON-Array mit Alerts zurück. Wenn nichts kritisch ist → leeres Array [].

ALERT-TYPEN (nur prüfen — nicht zwanghaft welche finden):
- "unhappy_customer": Kunde ist frustriert, sauer, enttäuscht (Sprachmuster: "schade", "nicht zufrieden", "echt jetzt?", lange Beschwerden, Caps-Lock)
- "lost_deal_risk": Kunde hat klare Kaufabsicht gezeigt (konkrete Methode/Farbe/Menge genannt) aber Team hat nicht abgeschlossen (kein "soll ich dir den Link schicken?", kein Termin-Vorschlag, kein Closing)
- "missed_followup": Team hat eine offene Frage gestellt aber dann nichts gemacht wenn Kunde nicht antwortet — oder umgekehrt: Kunde hat konkrete Frage gestellt die nie beantwortet wurde
- "no_alternative_offered": Team hat eine konkrete Kunden-Anfrage (z.B. Wunschtermin am Datum X, bestimmtes Produkt, bestimmte Farbe) abgelehnt OHNE eine Alternative anzubieten. Beispiele die IMMER einen Alert auslösen MÜSSEN:
   • "am 29.05. leider kein Termin mehr frei" ohne nach Flexibilität (paar Tage vor/nach) zu fragen oder Benachrichtigung bei Frei-Werden anzubieten
   • "leider ausverkauft" ohne Alternative (andere Länge, andere Linie, Benachrichtigung, ETA)
   • "geht leider nicht" ohne Workaround-Vorschlag
   Severity: WARNING (oder critical wenn Kundin Dringlichkeit signalisiert — "dringend", "brauche unbedingt")
- "bad_phrase_used": Team hat deflectierend geantwortet ("leider nicht", "schau auf der Webseite") ohne Alternative anzubieten
- "rude_or_dismissive": Team-Antwort war kurz angebunden, unfreundlich, hat den Kunden abgewimmelt
- "no_effort": Team hat nur Standard-Floskeln geliefert, keine Mühe gegeben (3-Wort-Antworten ohne Inhalt, generische Sätze)
- "info_inkorrekt_risk": Team hat möglicherweise falsche Info gegeben (widersprüchlich, vage Preisangaben, "ungefähr")

OUTPUT (nur JSON-Array, sonst nichts):
[
  {
    "severity": "critical" | "warning" | "info",
    "alert_type": "lost_deal_risk",
    "description": "Konkret was passiert ist (1 Satz mit Zitat-Schnipsel)",
    "suggestion": "Was der Mitarbeiter/Bot konkret tun sollte (1 Satz, aktionierbar)",
    "team_member": "Name" | null
  }
]

WICHTIG:
- Nur echte Probleme melden — nicht jeden Chat als kritisch markieren
- 'critical' nur bei: Lost Deal mit klarem Verkaufssignal, frustrierte Kunden, falsche Infos
- 'warning' bei: missed_followup, bad_phrase, no_effort
- 'info' bei: kleine Verbesserungspotenziale
- Max 3 Alerts pro Chat
- Wenn alles ok: []

CHAT:
`;

interface AlertOut {
  severity: "critical" | "warning" | "info";
  alert_type: string;
  description: string;
  suggestion: string;
  team_member?: string | null;
}

export async function analyzeSession(sessionId: string): Promise<AlertOut[]> {
  const svc = createServiceClient();
  const { data: msgs } = await svc
    .from("chat_messages")
    .select("role, content, created_at")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true })
    .limit(40);

  // Auch kurze Sessions (2 Messages: 1 Kunde + 1 Team-Antwort) müssen geprüft werden,
  // weil genau dort oft "abgewimmelt"-Antworten passieren ohne Alternative.
  if (!msgs || msgs.length < 2) return [];

  const transcript = msgs.map(m => {
    const role = m.role === "user" ? "Kunde" : m.role === "assistant" ? "Bot" : "Team";
    return `[${role}] ${(m.content || "").slice(0, 400)}`;
  }).join("\n");

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  try {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 600,
      messages: [{ role: "user", content: GUARDIAN_PROMPT + transcript }],
    });
    let raw = response.content[0].type === "text" ? response.content[0].text : "[]";
    raw = raw.trim();
    if (raw.startsWith("```")) {
      raw = raw.split("```")[1];
      if (raw.startsWith("json")) raw = raw.substring(4);
      raw = raw.trim();
    }
    const alerts = JSON.parse(raw);
    return Array.isArray(alerts) ? alerts.slice(0, 3) : [];
  } catch (e) {
    console.error("[guardian] analyze failed:", e);
    return [];
  }
}

export async function persistAlerts(sessionId: string, alerts: AlertOut[]): Promise<number> {
  if (alerts.length === 0) return 0;
  const svc = createServiceClient();
  let inserted = 0;
  for (const a of alerts) {
    const { error } = await svc.from("chatbot_guardian_alerts").insert({
      session_id: sessionId,
      severity: a.severity,
      alert_type: a.alert_type,
      team_member: a.team_member || null,
      description: a.description,
      suggestion: a.suggestion,
    });
    if (!error) inserted++;
    // Bei Duplicate (gleicher Typ + Session + Tag): einfach skippen
  }
  return inserted;
}

/**
 * Deterministischer Wait-Time-Check: findet Sessions wo die Kundin seit >12h
 * geschrieben hat und niemand geantwortet hat. Filtert triviale Antworten
 * (danke, ok, alles klar etc.) raus — die brauchen keine Antwort.
 */
async function scanLongWaitSessions(maxAgeHours: number = 12 * 7 * 24): Promise<number> {
  const svc = createServiceClient();
  // Trigger erhöht auf 18h (von 12h) — User-Anweisung. Nur Sessions wo die
  // Kundin LÄNGER als 18h Realzeit gewartet hat.
  const triggerAge = new Date(Date.now() - 18 * 3600 * 1000).toISOString();
  const tooOld = new Date(Date.now() - maxAgeHours * 3600 * 1000).toISOString();

  // Sessions wo last_customer_msg_at zwischen tooOld und triggerAge liegt
  // UND last_seen_by_agent_at entweder null oder älter als last_customer_msg_at
  // UND status nicht 'closed'
  const { data: sessions } = await svc
    .from("chat_sessions")
    .select("id, last_customer_msg_at, last_seen_by_agent_at, customer_name, customer_full_name")
    .lt("last_customer_msg_at", triggerAge)
    .gt("last_customer_msg_at", tooOld)
    .neq("status", "closed")
    .limit(200);

  if (!sessions || sessions.length === 0) return 0;

  // Sehr-kurze-Strings sind immer trivial (Emojis, "ok", "👍" etc.)
  const isObviouslyTrivial = (text: string): boolean => {
    const t = text.trim();
    return t.length < 4;
  };

  // KI-Klassifikation: Braucht diese Kundenmessage eine Antwort vom Team?
  // Wir geben dem Haiku-Modell die letzten 3-5 Messages als Kontext und es
  // entscheidet: "needs_answer" oder "conversation_done". Das ist viel
  // verlässlicher als Regex-Pattern weil's Kontext + Mehrdeutigkeit versteht.
  // Beispiele:
  //   "Okiiiii danke" nach erschöpfender Beratung → done
  //   "Danke, aber wann kommt es wieder?" → needs_answer
  //   "Aah hab den Link schon gefunden 😊" → done
  //   "Habt ihr die Farbe in 65cm?" → needs_answer
  const NEEDS_ANSWER_PROMPT = `Du analysierst einen Hairvenly-Kundenservice-Chat. Schau dir die letzten Nachrichten an und entscheide: Braucht die LETZTE Kundennachricht noch eine Antwort vom Team — oder hat die Kundin das Gespräch ihrerseits "abgeschlossen" (Höflichkeitsfloskel, Bestätigung, Selbst-gefunden)?

Beispiele "conversation_done" (KEINE Antwort mehr nötig):
- "Okiiiii danke!"
- "Super, vielen Dank ❤️"
- "Aah hab den Link selbst schon gefunden 😊"
- "Alles klar, dann buche ich selbst"
- "Perfekt, jetzt weiß ich Bescheid"
- "Danke dir 🙏"
- Reine Emoji-Antwort

Beispiele "needs_answer" (Antwort/Aktion vom Team nötig):
- "Habt ihr die Farbe in 65cm?"
- "Danke, aber wann kommt sie wieder rein?"  ← hat Frage trotz "danke"
- "[Foto]"  ← Bild allein = will Farb-/Längen-Einschätzung
- "Ah okay und wieviele brauche ich?"
- jede Nachricht mit Fragezeichen ODER neuer offener Bitte

Output: NUR EIN WORT — entweder "needs_answer" oder "conversation_done". Sonst nichts.

CHAT (chronologisch, letzte Nachricht ist relevant):
`;

  const classifyNeedsAnswer = async (
    contextMsgs: Array<{ role: string; content: string }>,
  ): Promise<"needs_answer" | "conversation_done"> => {
    const transcript = contextMsgs.map(m => {
      const role = m.role === "user" ? "Kunde"
        : m.role === "assistant" ? "Bot"
        : "Team";
      return `[${role}] ${(m.content || "").slice(0, 300)}`;
    }).join("\n");
    try {
      const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
      const response = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 10,
        messages: [{ role: "user", content: NEEDS_ANSWER_PROMPT + transcript }],
      });
      const raw = (response.content[0].type === "text" ? response.content[0].text : "").trim().toLowerCase();
      if (raw.includes("conversation_done")) return "conversation_done";
      return "needs_answer";
    } catch (e) {
      console.warn("[guardian] classifyNeedsAnswer failed, default needs_answer:", (e as Error).message);
      return "needs_answer"; // Safe default — lieber alarmieren als verpassen
    }
  };

  // Business-Hours-Check: wurde die Kundennachricht WÄHREND der Öffnungszeit
  // gesendet? Wenn nicht (Wochenende/Nacht), kein Alert — das ist normal dass
  // nicht direkt geantwortet wird.
  const wasSentDuringBusinessHours = (iso: string): boolean => {
    const d = new Date(iso);
    // Berlin-Zeit, Wochentag + Stunde
    const fmt = new Intl.DateTimeFormat("de-DE", {
      timeZone: "Europe/Berlin",
      weekday: "long",
      hour: "2-digit",
      minute: "2-digit",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = Object.fromEntries(fmt.formatToParts(d).map(p => [p.type, p.value]));
    const weekday = parts.weekday || "";
    const hour = Number(parts.hour || "0");
    const isoDate = `${parts.year}-${parts.month}-${parts.day}`;
    // Wochenende → false
    if (weekday === "Samstag" || weekday === "Sonntag") return false;
    // Bremen-Feiertage 2026 (identisch zu business-hours.ts)
    const holidays2026 = new Set([
      "2026-01-01", "2026-04-03", "2026-04-06", "2026-05-01",
      "2026-05-14", "2026-05-25", "2026-10-03", "2026-10-31",
      "2026-12-25", "2026-12-26",
    ]);
    if (holidays2026.has(isoDate)) return false;
    // 10:00-18:00 Uhr
    return hour >= 10 && hour < 18;
  };

  let inserted = 0;
  for (const s of sessions) {
    // Letzten ~5 Messages laden — als Kontext für die KI-Klassifikation.
    const { data: ctxMsgs } = await svc
      .from("chat_messages")
      .select("content, created_at, role")
      .eq("session_id", s.id)
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(5);
    if (!ctxMsgs || ctxMsgs.length === 0) continue;
    // Letzte Message muss von user sein (Reihenfolge: DESC, also [0] = neueste)
    if (ctxMsgs[0].role !== "user") continue;

    const lastUserText = ctxMsgs[0].content || "";
    // Sehr kurze Floskeln direkt rausfiltern — kein KI-Call nötig
    if (isObviouslyTrivial(lastUserText)) continue;

    // last_seen_by_agent_at > last_customer_msg_at → schon abgehandelt
    if (s.last_seen_by_agent_at && s.last_customer_msg_at &&
        new Date(s.last_seen_by_agent_at) >= new Date(s.last_customer_msg_at)) {
      continue;
    }

    // BUSINESS-HOURS-CHECK: Nur alarmieren wenn die Kundennachricht
    // WÄHREND der Öffnungszeit (Mo-Fr 10-18, ohne Feiertage) kam.
    if (!s.last_customer_msg_at || !wasSentDuringBusinessHours(s.last_customer_msg_at)) {
      continue;
    }

    // KI-Klassifikation: Braucht die letzte Kundennachricht im Kontext
    // wirklich noch eine Antwort? Haiku versteht Kontext + Mehrdeutigkeit
    // viel besser als Regex. Bei Unsicherheit → safe default = needs_answer.
    const contextChronological = ctxMsgs.slice().reverse().map(m => ({
      role: m.role,
      content: m.content || "",
    }));
    const verdict = await classifyNeedsAnswer(contextChronological);
    if (verdict === "conversation_done") {
      console.log(`[guardian/long_wait] Session ${s.id.slice(0,8)} → conversation_done (kein Alert)`);
      continue;
    }

    const hoursWaiting = Math.round((Date.now() - new Date(s.last_customer_msg_at).getTime()) / 3600 / 1000);
    const customerDisplay = s.customer_full_name || s.customer_name || "Kundin";
    const { error } = await svc.from("chatbot_guardian_alerts").insert({
      session_id: s.id,
      severity: hoursWaiting > 48 ? "critical" : "warning",
      alert_type: "long_wait_no_answer",
      description: `${customerDisplay} wartet seit ${hoursWaiting}h auf eine Antwort: „${lastUserText.slice(0, 120)}…"`,
      suggestion: `Session öffnen und antworten — bei >48h ist's kritisch. Falls keine Antwort nötig (Höflichkeitsfloskel), als erledigt markieren.`,
    });
    if (!error) inserted++;
    // Duplicate-Index dedupt automatisch (gleicher type + session + Tag)
  }
  return inserted;
}

/** Wächter-Lauf über Sessions die in den letzten 24h aktiv waren */
export async function runGuardianScan(opts: { limit?: number; hours?: number } = {}): Promise<{
  scanned: number;
  alerts_created: number;
}> {
  const hours = opts.hours ?? 24;
  const limit = opts.limit ?? 50;
  const svc = createServiceClient();
  const cutoff = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  const { data: sessions } = await svc
    .from("chat_sessions")
    .select("id")
    .gte("last_message_at", cutoff)
    .order("last_message_at", { ascending: false })
    .limit(limit);

  let scanned = 0;
  let totalAlerts = 0;

  // Schritt 1: deterministischer Wait-Time-Check (kein LLM nötig)
  try {
    const longWaitAlerts = await scanLongWaitSessions();
    totalAlerts += longWaitAlerts;
    console.log(`[guardian] long-wait scan: ${longWaitAlerts} neue Alerts`);
  } catch (e) {
    console.error("[guardian] long-wait scan failed:", e);
  }

  // Schritt 2: Haiku-basierte Analyse der aktiven Sessions
  for (const s of sessions || []) {
    try {
      const alerts = await analyzeSession(s.id);
      const n = await persistAlerts(s.id, alerts);
      totalAlerts += n;
      scanned++;
    } catch (e) {
      console.error("[guardian] session failed:", s.id, e);
    }
  }
  return { scanned, alerts_created: totalAlerts };
}
