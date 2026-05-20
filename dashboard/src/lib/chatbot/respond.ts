/**
 * Bot-Antwort für eine bestehende Session generieren + speichern.
 * Wird von Webhook-Handlern aufgerufen (Instagram/WhatsApp) sowie von /api/chat.
 */
import Anthropic from "@anthropic-ai/sdk";
import { createServiceClient } from "@/lib/supabase/server";
import { TOOLS, TOOL_SCHEMAS, type ToolContext } from "@/lib/chatbot/tools";

const MODEL = "claude-sonnet-4-5";
const MAX_ITER = 5;

/**
 * Lädt ein Bild selbst und gibt Base64 + MIME zurück.
 * Workaround: Anthropic Vision API respektiert robots.txt — Instagram CDN
 * blockt externe Fetcher. Daher müssen WIR das Bild fetchen und Base64 senden.
 * Gibt null zurück bei Fehlern (Bild expired / nicht erreichbar) — Caller
 * lässt das Bild dann einfach weg.
 */
async function fetchImageAsBase64(url: string): Promise<{ mediaType: string; data: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 Hairvenly-Bot" },
    });
    if (!res.ok) {
      console.warn(`[respond] image fetch HTTP ${res.status} for ${url.slice(0, 80)}…`);
      return null;
    }
    const contentType = (res.headers.get("content-type") || "image/jpeg").split(";")[0].trim();
    // Nur Image-Typen erlauben (kein HTML wenn Link tot)
    if (!contentType.startsWith("image/")) {
      console.warn(`[respond] image fetch wrong content-type: ${contentType}`);
      return null;
    }
    const buf = await res.arrayBuffer();
    const data = Buffer.from(buf).toString("base64");
    // Anthropic akzeptiert: jpeg, png, gif, webp
    const allowed = ["image/jpeg", "image/png", "image/gif", "image/webp"];
    const mediaType = allowed.includes(contentType) ? contentType : "image/jpeg";
    return { mediaType, data };
  } catch (e) {
    console.warn(`[respond] image fetch failed for ${url.slice(0, 80)}: ${(e as Error).message}`);
    return null;
  }
}

/**
 * Falls Claude in einen Stutter-Loop fällt und denselben Text 2× hintereinander
 * schreibt (z.B. "Ich bin da... Magst du... Ich bin da... Magst du..."),
 * halbieren wir die Antwort.
 */
function dedupRepeatedHalf(text: string): string {
  const t = text.trim();
  if (t.length < 80) return t;

  // Aggressiver Check: wenn die ersten 50 Zeichen IM SELBEN TEXT nochmal auftauchen
  // (nicht direkt am Anfang) → Bot hat sich wiederholt, schneide ab dem Wiederbeginn.
  // Toleriert auch leicht abweichende zweite Hälfte (Claude kürzt manchmal).
  const PREFIX_LEN = 50;
  const prefix = t.slice(0, PREFIX_LEN);
  const secondOccur = t.indexOf(prefix, PREFIX_LEN + 5);
  if (secondOccur > 0 && secondOccur < t.length * 0.9) {
    return t.slice(0, secondOccur).trim();
  }
  return t;
}

/**
 * Teilt lange Texte an Absatz-Grenzen in Stücke <= maxLen Zeichen.
 * Instagram-Messaging-API: 1000 Zeichen pro Message → wir splitten ab 700 sicher.
 */
export function splitLongMessage(text: string, maxLen = 700): string[] {
  const trimmed = text.trim();
  if (trimmed.length <= maxLen) return [trimmed];
  const paragraphs = trimmed.split(/\n\n+/);
  const parts: string[] = [];
  let buf = "";
  for (const p of paragraphs) {
    const candidate = buf ? `${buf}\n\n${p}` : p;
    if (candidate.length <= maxLen) {
      buf = candidate;
    } else {
      if (buf) parts.push(buf);
      // Wenn ein einzelner Absatz selbst zu lang ist: hart splitten an Satz-Grenze
      if (p.length > maxLen) {
        const sentences = p.split(/(?<=[.!?])\s+/);
        let sbuf = "";
        for (const s of sentences) {
          const sc = sbuf ? `${sbuf} ${s}` : s;
          if (sc.length <= maxLen) sbuf = sc;
          else {
            if (sbuf) parts.push(sbuf);
            sbuf = s.length > maxLen ? s.slice(0, maxLen) : s;
          }
        }
        if (sbuf) buf = sbuf;
        else buf = "";
      } else {
        buf = p;
      }
    }
  }
  if (buf) parts.push(buf);
  return parts.filter(p => p.trim().length > 0);
}

/**
 * Entfernt / ersetzt interne Lagerzahlen aus dem Bot-Output.
 * Wenn Claude trotz System-Prompt mal "850g auf Lager" schreibt, fangen wir
 * das hier ab und ersetzen mit kunden-sicheren Phrasen.
 */
function sanitizeStockLeaks(text: string): string {
  let t = text;
  // Verbotene Fachwörter ersetzen — Persona-Regel "Einfache Sprache" hart durchsetzen
  // (Claude ignoriert die Regel manchmal trotz System-Prompt — daher Post-Filter)
  t = t.replace(/\bGrammatur\b/g, "Menge");
  t = t.replace(/\bgrammatur\b/g, "menge");
  t = t.replace(/\b(zur|über die|nach der)\s+Grammatur\b/gi, (_m, p) => `${p} Menge`);
  // "vormerken" / "reservieren wir dir" — Bot kann nicht reservieren
  t = t.replace(/\bich\s+(merke|reserviere|leg(?:e)?)\s+dir\b/gi, "wir notieren dir");
  // ZUERST: Phrase "in begrenzter Menge" raus — Bot mischt das oft mit
  // Verpackungsgrößen ("in begrenzter Menge à 25g") was wie Restposten klingt.
  // Wenn "à Xg" folgt, behalten wir nur das.
  t = t.replace(/\(?\s*(?:in\s+)?begrenzter?\s+Menge\s*(?=à\s*\d+\s*g)/gi, "");
  // Sonst komplett raus inkl. umliegende Klammern/Kommata
  t = t.replace(/\s*,?\s*\(?(?:in\s+)?begrenzter?\s+Menge\)?\s*/gi, " ");
  // ZUERST: "Bestand 0" / "Quantity 0" / "Quantity = 0" → ausverkauft
  // (vor den anderen Patterns, sonst frisst die generische Regel die 0)
  t = t.replace(/\b(?:Lager(?:bestand)?|Bestand)\s*[:=]?\s*0\s*g?\b/gi, "ausverkauft");
  t = t.replace(/\bQuantity\s*[:=]?\s*0\b/gi, "ausverkauft");
  // "850g auf Lager", "850 g verfügbar", "(850g verfügbar)", "1200g vorrätig"
  t = t.replace(
    /\(?\s*\d{2,5}\s*g(?:ramm)?\s*(?:auf\s*Lager|verfügbar|vorrätig|im\s*Lager|da)\s*\)?/gi,
    "haben wir da",
  );
  // "850g verfügbar" ohne Klammer-Variante
  t = t.replace(/\b\d{2,5}\s*g(?:ramm)?\b\s*\b(?:verfügbar|vorrätig|am\s*Lager)\b/gi, "verfügbar");
  // "Bestand: 125g" / "Lagerbestand: 850g" (Zahlen ≠ 0, schon oben gemacht)
  t = t.replace(/\b(?:Lager(?:bestand)?|Bestand)\s*[:=]?\s*\d{1,5}\s*g?\b/gi, "verfügbar");
  // "Quantity = 5" (Zahl ≠ 0)
  t = t.replace(/\bQuantity\s*[:=]?\s*\d+\b/gi, "");
  // "noch 4 Stück" / "nur noch 12 Packungen"
  // NUR Stock-Leaks wie "noch 4 Stück" / "nur noch 12 Packungen" abfangen — NICHT
  // normale Preis-Kalkulationen wie "6 Packungen à 25g". Daher Anker auf "noch/nur noch".
  t = t.replace(/\b(noch|nur\s+noch)\s+\d{1,3}\s*(Stück|Packungen)\b/gi, "$1 etwas");
  // "850g im Lager"
  t = t.replace(/\b\d{2,5}\s*g(?:ramm)?\s+im\s+Lager\b/gi, "im Lager");
  // Mehrfach-Leerzeichen / leere Klammern bereinigen
  t = t.replace(/\(\s*\)/g, "");
  t = t.replace(/[ \t]{2,}/g, " ");
  return t;
}

interface RespondResult {
  success: boolean;
  text?: string;
  toolsUsed?: string[];
  toolCalls?: { id: string; name: string; input: Record<string, unknown> }[];
  toolResults?: { tool_use_id: string; content: string }[];
  /** ID des gerade gespeicherten assistant-Eintrags — Caller updated external_id (MID) nach Versand */
  insertedMessageId?: string;
  error?: string;
}

interface RespondOptions {
  /** Wenn true: Text NICHT in chat_messages speichern (für Bot-Begleitung-Entwurf) */
  assisted?: boolean;
}

/**
 * Generiert Bot-Antwort für eine Session basierend auf bisherigem Verlauf,
 * speichert sie als assistant-Message in chat_messages.
 */
export async function respondAsBot(sessionId: string, opts: RespondOptions = {}): Promise<RespondResult> {
  const svc = createServiceClient();

  // Session laden
  const { data: session } = await svc
    .from("chat_sessions")
    .select("id, bot_signature_name, channel, status")
    .eq("id", sessionId)
    .single();
  if (!session) return { success: false, error: "session not found" };
  if (session.status !== "active") return { success: false, error: "session not active" };

  const signatureName = session.bot_signature_name || "Lara";

  // Persona
  const { data: persona } = await svc
    .from("chatbot_persona")
    .select("system_prompt")
    .eq("active", true).limit(1).single();
  if (!persona) return { success: false, error: "no persona" };

  // Avatar
  const { data: avatars } = await svc
    .from("chatbot_avatars")
    .select("name, personality")
    .eq("active", true);
  const avatarRow = (avatars || []).find(a => a.name === signatureName) || (avatars || [])[0];

  // System-Prompt zusammenbauen
  let systemPrompt = persona.system_prompt.replaceAll("{signature_name}", signatureName);
  if (avatarRow) {
    systemPrompt += `\n\n## DEINE PERSÖNLICHKEIT (als ${avatarRow.name})\n${avatarRow.personality}`;
  }

  // Trainings-Beispiele (inkl. Gesprächskontext + Strategie-Hinweise aus Bot-Begleitung)
  const { data: training } = await svc
    .from("chatbot_training")
    .select("user_message, good_answer, bad_answer, feedback, avatar_name, context_messages")
    .eq("active", true)
    .or(`avatar_name.is.null,avatar_name.eq.${signatureName}`)
    .order("created_at", { ascending: false })
    .limit(8);
  if (training && training.length > 0) {
    systemPrompt += "\n\n## DEINE TRAININGS-BEISPIELE\n";
    systemPrompt += "Diese Beispiele zeigen dir den GANZEN Gesprächsverlauf — nicht nur die Einzelfrage. ";
    systemPrompt += "Achte besonders auf STRATEGIE-HINWEISE: sie sagen dir WIE du in ähnlichen Situationen vorgehen sollst.\n\n";
    for (let i = 0; i < training.length; i++) {
      const t = training[i];
      const scope = t.avatar_name ? `nur für ${t.avatar_name}` : "für alle Avatare";
      systemPrompt += `### Beispiel ${i + 1} (${scope})\n`;
      const ctx = (t.context_messages as { role: string; content: string }[] | null) || [];
      if (ctx.length > 0) {
        systemPrompt += "Vorheriger Gesprächsverlauf:\n";
        for (const c of ctx) {
          const who = c.role === "user" ? "Kunde" : "Bot/Mitarbeiter";
          systemPrompt += `  ${who}: ${c.content}\n`;
        }
      }
      systemPrompt += `Kunde fragt jetzt: ${t.user_message}\n`;
      systemPrompt += `→ Gute Antwort: ${t.good_answer}\n`;
      if (t.bad_answer) systemPrompt += `→ FALSCH wäre: ${t.bad_answer}\n`;
      if (t.feedback)   systemPrompt += `→ Hinweis: ${t.feedback}\n`;
      systemPrompt += "\n";
    }
  }

  // Verkaufs-Strategien (höchste Priorität zuerst)
  const { data: strategies } = await svc
    .from("chatbot_strategies")
    .select("name, trigger, steps")
    .eq("active", true)
    .order("priority", { ascending: false })
    .limit(20);
  if (strategies && strategies.length > 0) {
    systemPrompt += "\n\n## VERKAUFS-STRATEGIEN\n";
    systemPrompt += "Wenn der Chat-Kontext zu einer dieser Strategien passt, folge IHRER Reihenfolge:\n\n";
    for (const s of strategies) {
      systemPrompt += `### ${s.name}\n**Trigger:** ${s.trigger}\n${s.steps}\n\n`;
    }
  }

  // Conversation laden — letzte 60 Nachrichten (reduziert von 150 für Kosten)
  // Bei sehr langen Verläufen wird damit ältester Kontext verloren — der wichtige
  // Verlauf der letzten Tage/Stunden bleibt aber vollständig erhalten.
  const { data: msgsDesc } = await svc
    .from("chat_messages")
    .select("role, content, tool_calls, tool_results, attachments, created_at")
    .eq("session_id", sessionId)
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(60);
  const msgs = (msgsDesc || []).slice().reverse();

  if (!msgs || msgs.length === 0) return { success: false, error: "no messages" };

  // OFFENE TURNS ERMITTELN — ALLE Kundennachrichten SEIT der letzten Agent-/
  // Bot-Antwort gehören zusammen. Sorry nur wenn die WERKTAGS-Stunden ≥ 24h
  // sind (Wochenenden zählen nicht — Freitag 18h → Montag 9h = kein Sorry).
  function businessHoursBetween(fromMs: number, toMs: number): number {
    if (toMs <= fromMs) return 0;
    let total = 0;
    const cur = new Date(fromMs);
    const to = new Date(toMs);
    while (cur < to) {
      const day = cur.getDay(); // 0=So, 6=Sa
      const endOfDay = new Date(cur); endOfDay.setHours(24, 0, 0, 0);
      const segEnd = endOfDay < to ? endOfDay : to;
      if (day >= 1 && day <= 5) {
        total += (segEnd.getTime() - cur.getTime()) / 3600000;
      }
      cur.setTime(endOfDay.getTime());
    }
    return total;
  }

  let openTurnsHint = "";
  {
    const tail = msgs.slice(-15).slice().reverse();
    const lastAgentRev = tail.findIndex(m => m.role === "assistant" || m.role === "human_agent");
    const openUsrDesc = lastAgentRev === -1
      ? tail.filter(m => m.role === "user")
      : tail.slice(0, lastAgentRev).filter(m => m.role === "user");

    if (openUsrDesc.length > 0) {
      const orderedOldestFirst = openUsrDesc.slice().reverse();

      // Werktags-Stunden seit der jüngsten offenen Frage bis jetzt
      const youngestT = new Date(orderedOldestFirst[orderedOldestFirst.length - 1].created_at).getTime();
      const businessHoursSinceYoungest = businessHoursBetween(youngestT, Date.now());
      const apologyDue = businessHoursSinceYoungest >= 24;

      if (openUsrDesc.length > 1) {
        openTurnsHint =
          `\n\n## OFFENE KUNDEN-NACHRICHTEN (${openUsrDesc.length} Stück seit letzter Antwort von uns)\n` +
          orderedOldestFirst.map((m, i) => {
            const dt = new Date(m.created_at);
            const fmt = `${dt.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit" })} ${dt.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}`;
            return `${i + 1}. [${fmt}] ${m.content}`;
          }).join("\n");

        openTurnsHint += `\n\n→ ALLE diese Nachrichten gehören zum SELBEN Anliegen (zwischendurch kam keine Antwort von uns). ` +
          `Beantworte sie als ZUSAMMENHÄNGENDEN BLOCK in EINER Antwort — natürlich wie eine echte Mitarbeiterin, ` +
          `nicht stur Punkt für Punkt. Greife die ältere Sachfrage genauso auf wie das spätere Nachhaken.`;
      } else {
        openTurnsHint =
          `\n\n## OFFENE KUNDEN-NACHRICHT\nDer Kunde hat eine Frage, die noch unbeantwortet ist. ` +
          `Achte auf den GESAMTEN bisherigen Verlauf — was wurde schon besprochen (Haarstruktur, Farbe, Methode), ` +
          `was wurde versprochen.`;
      }

      // Sorry-Regel: NUR wenn Werktags-Stunden ≥ 24h
      if (apologyDue) {
        const businessDays = Math.round(businessHoursSinceYoungest / 24);
        openTurnsHint += `\n\n**Antwort-Verzögerung:** ~${businessDays} Werktag${businessDays === 1 ? "" : "e"} ` +
          `(${Math.round(businessHoursSinceYoungest)}h Werktagsstunden) seit der Kundennachricht. ` +
          `→ Bitte mit kurzer ehrlicher Entschuldigung beginnen, dann inhaltlich antworten.`;
      } else {
        openTurnsHint += `\n\n**KEINE Entschuldigung** für die Antwortzeit nötig (Wartezeit innerhalb normaler Werktags-Reaktionszeit, ` +
          `Wochenenden zählen nicht). Direkt inhaltlich antworten.`;
      }
    }
  }
  // BEGRÜSSUNGS-REGEL: dynamisch je nach Zeit seit letztem Bot/Agent-Message
  // Wenn unsere letzte Antwort < 12h her ist → KEINE neue Begrüßung am Anfang
  // (das hatte der User mehrfach explizit gefordert)
  let greetingHint = "";
  {
    const lastOurMsg = msgs.slice().reverse().find(m => m.role === "assistant" || m.role === "human_agent");
    if (lastOurMsg) {
      const hoursAgo = (Date.now() - new Date(lastOurMsg.created_at).getTime()) / 3600000;
      if (hoursAgo < 12) {
        greetingHint = `\n\n## ❌ KEINE BEGRÜSSUNG am Anfang!
Unsere letzte Antwort kam vor ca. ${Math.round(hoursAgo)} Stunden — die Konversation läuft. Beginne NICHT mit "Hey 💕" / "Hallo Liebes" / "Hi 💕" etc.
Starte direkt mit der inhaltlichen Antwort. Beispiel:

❌ "Hey 💕 Zum Versand..."
✅ "Zum Versand..."

❌ "Hallo Liebes! Bei deiner Frage..."
✅ "Bei deiner Frage..."`;
      } else if (hoursAgo > 24 * 7) {
        // Sehr lange Pause → warme Begrüßung erlaubt
        greetingHint = `\n\n## ✅ Begrüßung am Anfang ist OK
Unsere letzte Antwort ist >7 Tage her — eine warme Begrüßung ("Hi Liebes 💕") passt hier.`;
      }
      // Zwischen 12h-7d: keine spezielle Anweisung, Bot entscheidet kontext-basiert
    }
  }

  // STIL-REGEL: Gedankenstriche sparsam, nicht jede Nachricht — sonst KI-typisch
  const styleRule = `\n\n## ✏️ STIL-REGEL — Gedankenstriche sparsam
Der lange Gedankenstrich " — " (Em-Dash) ist nicht verboten. Aber sobald er in fast jeder Nachricht vorkommt, klingt es nach KI.
Faustregel: maximal EINER pro Nachricht, und nur wenn er wirklich passt. Im Zweifel ein Komma oder Punkt nehmen.

Statt jeder Antwort mit Gedankenstrich:
❌ "Soft Blond Balayage in 65cm — sofort verfügbar. Magst du die nehmen — oder lieber warten?"
✅ "Soft Blond Balayage in 65cm haben wir sofort da. Magst du die nehmen oder lieber warten?"

Bleib trotzdem locker und einfach. Kurze Sätze, normale Sprache.`;

  // URL-REGEL: niemals URLs raten oder zusammenbauen. Nur shopify_url aus Tool-Outputs.
  const urlRule = `\n\n## 🔗 URL-REGEL — KOMPROMISSLOS
Wenn du einen Produkt-Link schickst, kopiere die URL AUSSCHLIESSLICH aus dem Feld \`shopify_url\` eines Tool-Outputs (z.B. get_stock_eta, get_available_colors).
NIEMALS selbst URLs zusammenbauen, erraten oder nach Muster bilden — auch wenn die URL "logisch" wirkt. Hairvenly-Produkt-Slugs folgen KEINEM vorhersehbaren Schema (z.B. "soft-balayge-tape-extensions" statt "usbekisch-soft-blond-balayage-65cm-tapes").
Wenn KEIN \`shopify_url\` im Tool-Output steht: schicke KEINEN Link. Schreibe stattdessen nur den Produktnamen.

❌ FALSCH: "hairvenly.de/products/usbekisch-soft-blond-balayage-65cm-tapes" (selbst gebaut)
✅ RICHTIG: exakt der String aus shopify_url, sonst kein Link.`;

  // Wichtig: systemPrompt (= persona + avatar + training + strategies) bleibt STABIL
  // pro Avatar und wird via Prompt-Caching wiederverwendet. Variable Teile
  // (openTurnsHint, sorry-hint, greetingHint, urlRule) gehen in einen separaten Block —
  // werden nicht gecacht, sind aber pro Call eh klein.
  const systemPromptStable = systemPrompt;
  const systemPromptVariable = openTurnsHint + greetingHint + urlRule + styleRule;

  const messages: Anthropic.MessageParam[] = [];
  for (const m of msgs) {
    if (m.role === "user") {
      // Foto-Anhänge als Image-Blocks an Claude weitergeben (Vision)
      // WICHTIG: wir holen das Bild SELBST und übergeben Base64 — Anthropic
      // Vision API respektiert robots.txt und IG CDN blockt externe Fetcher.
      const attachments = (m.attachments as { type: string; url: string }[] | null) || [];
      const images = attachments.filter(a => a.type === "image" && a.url);
      if (images.length > 0) {
        const blocks: Anthropic.ContentBlockParam[] = [];
        for (const img of images) {
          const fetched = await fetchImageAsBase64(img.url);
          if (!fetched) continue; // skippe nicht ladbare Bilder, Bot reagiert dann textbasiert
          blocks.push({
            type: "image",
            source: { type: "base64", media_type: fetched.mediaType as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: fetched.data },
          });
        }
        if (m.content) blocks.push({ type: "text", text: m.content });
        // Wenn alle Bilder skipped + kein Content → trotzdem leeren Text-Hinweis
        if (blocks.length === 0) blocks.push({ type: "text", text: "[Foto konnte nicht geladen werden — bitte Kundin um Neusendung]" });
        messages.push({ role: "user", content: blocks });
      } else {
        messages.push({ role: "user", content: m.content || "" });
      }
    } else if (m.role === "assistant") {
      const blocks: Anthropic.ContentBlockParam[] = [];
      if (m.content) blocks.push({ type: "text", text: m.content });
      const tc = (m.tool_calls as { id: string; name: string; input: Record<string, unknown> }[] | null) || [];
      for (const t of tc) blocks.push({ type: "tool_use", id: t.id, name: t.name, input: t.input });
      if (blocks.length > 0) messages.push({ role: "assistant", content: blocks });
      const tr = (m.tool_results as { tool_use_id: string; content: string }[] | null) || [];
      if (tr.length > 0) {
        messages.push({
          role: "user",
          content: tr.map(r => ({ type: "tool_result" as const, tool_use_id: r.tool_use_id, content: r.content })),
        });
      }
    } else if (m.role === "human_agent") {
      messages.push({ role: "assistant", content: m.content || "" });
    }
  }

  // Letzte Message ist nicht von user (z.B. Mitarbeiter klickte "generieren"
  // obwohl wir schon geantwortet haben). Statt zu crashen: synthetische
  // User-Message anhängen die dem Bot Kontext gibt was zu tun ist.
  if (messages[messages.length - 1].role !== "user") {
    messages.push({
      role: "user",
      content:
        "[INTERNE SYSTEM-NACHRICHT — NICHT VOM KUNDEN]\n\n" +
        "Eine Mitarbeiterin hat 'Antwort generieren' geklickt, obwohl die letzte Message von uns kam. " +
        "Bitte schreibe einen sinnvollen FOLLOW-UP basierend auf dem bisherigen Verlauf. Möglichkeiten:\n" +
        "1. Wenn unsere letzte Antwort offene Fragen enthielt → freundlich nachhaken (z.B. 'Sag Bescheid wenn du was wissen magst 💕')\n" +
        "2. Wenn die Kundin zuvor Interesse gezeigt hat → konkretes Angebot oder Foto-Beratung anbieten\n" +
        "3. Falls Reservierungs-Potenzial (Produkt unterwegs) → nochmal sanft anbieten zu benachrichtigen\n" +
        "4. Wenn der Verlauf positiv endete → kurze Schluss-Geste ('Genieße deine Haare!') + ggf. Bewertung erbitten\n\n" +
        "WICHTIG: SCHREIBE WIRKLICH EINEN TEXT. Kurz und natürlich. Antwortet die Mitarbeiterin nicht passend → sie editiert es eh.",
    });
  }

  // Claude aufrufen — mit Prompt-Caching auf dem stabilen System-Teil + Tool-Defs
  // Cache-TTL = 5 Min. Spart ~75% Input-Token-Kosten auf wiederholten Calls
  // mit gleichem Avatar / gleicher Trainings-Menge / gleichen Strategien.
  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const toolCtx: ToolContext = { sessionId, signatureName };
  const toolsUsed: string[] = [];
  let finalText = "";
  let convo = messages;
  const allToolCalls: { id: string; name: string; input: Record<string, unknown> }[] = [];
  const allToolResults: { tool_use_id: string; content: string }[] = [];

  const systemBlocks: Anthropic.TextBlockParam[] = [
    { type: "text", text: systemPromptStable, cache_control: { type: "ephemeral" } as const },
  ];
  if (systemPromptVariable.trim()) {
    systemBlocks.push({ type: "text", text: systemPromptVariable });
  }
  // Tools-Schema ebenfalls cachen (letztes Tool kriegt cache_control)
  const cachedTools = TOOL_SCHEMAS.map((t, i) =>
    i === TOOL_SCHEMAS.length - 1
      ? { ...t, cache_control: { type: "ephemeral" } as const }
      : t
  );

  for (let iter = 0; iter < MAX_ITER; iter++) {
    const response = await anthropic.messages.create({
      model: MODEL,
      max_tokens: 1024,
      system: systemBlocks,
      tools: cachedTools,
      messages: convo,
    });

    const textBlocks = response.content.filter((b): b is Anthropic.TextBlock => b.type === "text");
    const toolBlocks = response.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");

    // Dedup identische konsekutive Text-Blöcke (Claude-Stutter vermeiden)
    const dedupedTexts: string[] = [];
    for (const tb of textBlocks) {
      const t = (tb.text || "").trim();
      if (!t) continue;
      if (dedupedTexts.length > 0 && dedupedTexts[dedupedTexts.length - 1] === t) continue;
      dedupedTexts.push(t);
    }

    // Text NUR überschreiben wenn diese Iteration auch Text produziert hat
    // (sonst löscht eine letzte tool-only-Iteration den vorigen Text)
    const iterText = dedupedTexts.join("\n").trim();
    if (iterText) finalText = iterText;

    if (toolBlocks.length === 0 || response.stop_reason === "end_turn") break;

    const results: Anthropic.ContentBlockParam[] = [];
    for (const tb of toolBlocks) {
      allToolCalls.push({ id: tb.id, name: tb.name, input: tb.input as Record<string, unknown> });
      const tool = TOOLS[tb.name];
      let output = "";
      if (tool) {
        try {
          const r = await tool.execute(tb.input as Record<string, unknown>, toolCtx);
          output = r.output;
        } catch (e) { output = `Tool-Fehler: ${(e as Error).message}`; }
      }
      toolsUsed.push(tb.name);
      allToolResults.push({ tool_use_id: tb.id, content: output });
      results.push({ type: "tool_result", tool_use_id: tb.id, content: output });
    }
    convo = [
      ...convo,
      { role: "assistant", content: response.content as Anthropic.ContentBlockParam[] },
      { role: "user", content: results },
    ];
  }

  // Fallback: wenn nach MAX_ITER kein Text vorhanden, einen finalen text-only Call
  // damit Claude die Tool-Ergebnisse in eine Antwort verpackt
  if (!finalText) {
    console.warn(`[respond] empty after tool loop — forcing final text-only call (iter done, toolCalls=${allToolCalls.length}, toolResults=${allToolResults.length})`);
    try {
      const finalResp = await anthropic.messages.create({
        model: MODEL,
        max_tokens: 1024,
        system: [
          { type: "text", text: systemPromptStable, cache_control: { type: "ephemeral" } as const },
          { type: "text", text: (systemPromptVariable || "") + "\n\nFasse jetzt die Tool-Ergebnisse zusammen und antworte dem Kunden auf seine letzte Frage. KEINE weiteren Tools aufrufen. SCHREIBE UNBEDINGT EINE KOMPLETTE ANTWORT — auch wenn du dir unsicher bist, formuliere mit den verfügbaren Infos das Beste was du kannst." },
        ],
        messages: convo,
      });
      const finalBlocks = finalResp.content.filter((b): b is Anthropic.TextBlock => b.type === "text");
      const fdedup: string[] = [];
      for (const fb of finalBlocks) {
        const t = (fb.text || "").trim();
        if (!t) continue;
        if (fdedup.length > 0 && fdedup[fdedup.length - 1] === t) continue;
        fdedup.push(t);
      }
      finalText = fdedup.join("\n").trim();
    } catch (e) {
      console.error("[respond] fallback call failed:", (e as Error).message);
    }
  }

  // ZWEITER Fallback: graceful default statt hartem Error.
  // Wenn auch nach Tool-Loop + Fallback nichts kommt, generieren wir manuell eine
  // sichere "weiß-noch-nicht"-Antwort statt zu crashen — Mitarbeiter sieht den
  // Entwurf und kann selbst editieren.
  if (!finalText) {
    // GUARD: Race-Condition-Schutz. Wenn parallel schon eine Antwort durch ist
    // (z.B. Kundin schickt schnell zwei Messages und beide triggern den Bot),
    // soll der Empty-Fallback NICHT als zweite Nachricht raus. Sonst kriegt die
    // Kundin "Lass mich das mit einer Kollegin abklären" direkt nach einer
    // sauberen Antwort.
    const { data: recentOurs } = await svc
      .from("chat_messages")
      .select("created_at, content")
      .eq("session_id", sessionId)
      .in("role", ["assistant", "human_agent"])
      .is("deleted_at", null)
      .order("created_at", { ascending: false })
      .limit(1);
    const lastOurMsg = recentOurs?.[0];
    if (lastOurMsg) {
      const ageSec = (Date.now() - new Date(lastOurMsg.created_at).getTime()) / 1000;
      if (ageSec < 60 && (lastOurMsg.content || "").trim().length > 30) {
        console.warn(`[respond] empty result but parallel response ${Math.round(ageSec)}s ago — suppressing fallback to avoid duplicate "Kollegin abklären"`);
        return { success: true, error: "suppressed_parallel_response" };
      }
    }
    console.error(`[respond] EMPTY response even after fallback — session=${sessionId}, toolsUsed=${toolsUsed.join(",")}, msgCount=${msgs.length}`);
    const toolsHint = toolsUsed.length > 0
      ? ` Ich habe folgende Infos gesammelt: ${toolsUsed.join(", ")}.`
      : "";
    finalText = `Hi 💕 Lass mich das eben mit einer Kollegin abklären — sie meldet sich gleich bei dir.${toolsHint}`;
  }

  // (Hier kommt finalText immer mit etwas drin an — graceful Fallback weiter oben.)

  // SAFETY-NET 1: konkrete Lagerzahlen rausfiltern
  finalText = sanitizeStockLeaks(finalText);

  // SAFETY-NET 1z: Em-Dash-Bremse — erster bleibt, ab dem zweiten ersetzen.
  // Em-Dash an sich ist nicht falsch. Nur das KI-typische Hyperaufkommen
  // (in jeder Nachricht mehrere) wirkt unnatürlich. Wir lassen den ersten
  // " — " / " – " im Text stehen und ersetzen alle weiteren durch ", ".
  // Normale Bindestriche ("Mini-Tape", "65-cm") bleiben sowieso unangetastet.
  {
    const dashRe = / +[—–] +/g;
    let count = 0;
    finalText = finalText.replace(dashRe, (m) => {
      count++;
      return count === 1 ? m : ", ";
    });
    // " —\n" am Zeilenende: nur ersetzen wenn schon einer durchgelassen wurde
    if (count >= 1) {
      finalText = finalText.replace(/\s*[—–]\s*\n/g, "\n");
    }
    // Aufräumen von durch Replace entstandenen Doppel-Kommas etc.
    finalText = finalText
      .replace(/, ,/g, ",")
      .replace(/,\s*\./g, ".")
      .replace(/ ,/g, ",");
  }

  // SAFETY-NET 1a: HALLUZINIERTE URLs eliminieren
  // Jede hairvenly.de/products-URL in der finalen Antwort wird gegen die echte
  // product_colors-Tabelle verifiziert. Unbekannte URLs (vom LLM erfunden) werden
  // entfernt — der Produktname bleibt stehen, der Link verschwindet.
  // Deterministisch, kein LLM-Vertrauen nötig.
  try {
    const urlPattern = /https?:\/\/(?:www\.)?hairvenly\.de\/(?:products|collections)\/[A-Za-z0-9_\-/]+/gi;
    const foundUrls = Array.from(new Set(finalText.match(urlPattern) || []));
    if (foundUrls.length > 0) {
      const { data: valid } = await svc
        .from("product_colors")
        .select("shopify_url")
        .in("shopify_url", foundUrls);
      const validSet = new Set((valid || []).map(r => r.shopify_url));
      for (const url of foundUrls) {
        if (validSet.has(url)) continue;
        console.warn(`[respond] DROPPED hallucinated URL: ${url}`);
        // Markdown-Link [Text](url) → Text   ·   nackte URL → leer
        const escUrl = url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        finalText = finalText.replace(new RegExp(`\\[([^\\]]+)\\]\\(${escUrl}\\)`, "g"), "$1");
        finalText = finalText.replace(new RegExp(escUrl, "g"), "");
      }
      // Aufräumen: doppelte Leerzeilen / einzelne dangling Zeilen die durch Linkentfernung entstehen
      finalText = finalText
        .replace(/^[ \t]*(?:Hier (?:der|ist der)? ?Link[: ]*)?$/gim, "")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
    }
  } catch (e) {
    console.warn("[respond] URL-sanitizer failed:", (e as Error).message);
  }

  // SAFETY-NET 1b: Auto-Lern-Wortfilter aus DB anwenden
  // Wörter/Phrasen die der Mitarbeiter wiederholt entfernt hat, werden hier gnadenlos ersetzt.
  try {
    const { loadActiveWordFilters, applyWordFilters } = await import("@/lib/chatbot/word-filter-learning");
    const filters = await loadActiveWordFilters();
    if (filters.length > 0) finalText = applyWordFilters(finalText, filters);
  } catch (e) {
    console.warn("[respond] word-filter apply failed:", (e as Error).message);
  }

  // SAFETY-NET 2: Dedup wenn ganze Antwort sich wiederholt (Claude-Stutter)
  // Heuristik: wenn finalText aus zwei identischen Hälften besteht, halbieren
  finalText = dedupRepeatedHalf(finalText);

  // Im assisted-Modus: NICHT in chat_messages speichern — der Caller speichert
  // erst nach Mitarbeiter-Approval ggf. die korrigierte Version.
  let insertedMessageId: string | undefined;
  if (!opts.assisted) {
    const { data: ins } = await svc.from("chat_messages").insert({
      session_id:   sessionId,
      role:         "assistant",
      content:      finalText,
      tool_calls:   allToolCalls.length > 0 ? allToolCalls : null,
      tool_results: allToolResults.length > 0 ? allToolResults : null,
    }).select("id").single();
    insertedMessageId = ins?.id;
    await svc.from("chat_sessions")
      .update({ last_message_at: new Date().toISOString() })
      .eq("id", sessionId);
  }

  return {
    success: true,
    text: finalText,
    toolsUsed,
    toolCalls: allToolCalls,
    toolResults: allToolResults,
    insertedMessageId,
  };
}
