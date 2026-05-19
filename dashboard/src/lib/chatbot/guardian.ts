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
