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
 * Liefert den aktuellen Geschäftszeit-Status in Europe/Berlin.
 * Öffnungszeit: Mo-Fr 10:00-18:00 Uhr, ohne Bremen-Feiertage.
 *
 * Wichtig fürs Bot-Wording: "gleich"/"in Kürze"/"meine Kollegin schreibt dir
 * gleich" sind nur OK während Geschäftszeit. Außerhalb muss der Bot die
 * nächste Öffnung kommunizieren, damit die Kundin nicht vergebens wartet.
 */
function getBusinessHoursContext(): {
  status: "open_wide" | "open_closing_soon" | "closed";
  isOpen: boolean;                  // open_wide ODER open_closing_soon
  nowLabel: string;                 // "Freitag 20:15"
  reason: string;                   // "Wochenende" / "Feierabend" / "vor Öffnung" / "Feiertag" / "kurz vor Feierabend"
  nextOpenLabel: string;            // "Montag ab 10:00 Uhr" / "morgen früh ab 10:00 Uhr"
  realisticHandoverLabel: string;   // "gleich" (open_wide) / "noch heute oder spätestens morgen früh" (closing_soon) / nextOpen (closed)
  nextWorkdayLabel: string;         // "morgen früh" wenn Mo-Do, "Montag früh" wenn Freitag/Wochenende — immer der nächste ECHTE Werktag
  todayWeekday: string;             // "Freitag"
} {
  const now = new Date();
  const berlinFmt = new Intl.DateTimeFormat("de-DE", {
    timeZone: "Europe/Berlin",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const parts = Object.fromEntries(berlinFmt.formatToParts(now).map(p => [p.type, p.value]));
  const weekday = parts.weekday || "";
  const hour = Number(parts.hour || "0");
  const minute = Number(parts.minute || "0");
  const isoDate = `${parts.year}-${parts.month}-${parts.day}`;

  // Bremen-Feiertage 2026 (bundesweite + Reformationstag seit 2018)
  const bremenHolidays2026 = new Set([
    "2026-01-01", "2026-04-03", "2026-04-06", "2026-05-01",
    "2026-05-14", "2026-05-25", "2026-10-03", "2026-10-31",
    "2026-12-25", "2026-12-26",
  ]);
  const isHoliday = bremenHolidays2026.has(isoDate);

  const weekendDays = new Set(["Samstag", "Sonntag"]);
  const isWeekend = weekendDays.has(weekday);
  const inWorkHours = hour >= 10 && hour < 18;
  const isOpenAtAll = !isWeekend && !isHoliday && inWorkHours;

  // CLOSING-SOON: weniger als 60 Min vor 18:00 — Anfragen können realistisch
  // nicht mehr "gleich" abgearbeitet werden. Erwartung muss runtergeschraubt
  // werden auf "noch heute, sonst morgen früh".
  const minutesUntilClose = (18 - hour) * 60 - minute;
  const isClosingSoon = isOpenAtAll && minutesUntilClose <= 60 && minutesUntilClose > 0;

  let status: "open_wide" | "open_closing_soon" | "closed" = "closed";
  if (isOpenAtAll && !isClosingSoon) status = "open_wide";
  else if (isClosingSoon) status = "open_closing_soon";

  const isOpen = isOpenAtAll;
  const nowLabel = `${weekday} ${parts.hour}:${parts.minute}`;
  let reason = "geöffnet";
  if (isHoliday) reason = "Feiertag";
  else if (isWeekend) reason = "Wochenende";
  else if (hour < 10) reason = "vor Öffnung";
  else if (hour >= 18) reason = "Feierabend";
  else if (isClosingSoon) reason = `kurz vor Feierabend (noch ${minutesUntilClose} Min bis 18:00)`;

  // Nächste Öffnung berechnen — auch bei closing_soon nützlich
  let nextOpenLabel = "Mo-Fr 10:00-18:00 Uhr";
  if (weekday === "Freitag" && (hour >= 18 || isClosingSoon)) {
    nextOpenLabel = "Montag ab 10:00 Uhr";
  } else if (weekday === "Samstag") {
    nextOpenLabel = "Montag ab 10:00 Uhr";
  } else if (weekday === "Sonntag") {
    nextOpenLabel = "morgen früh ab 10:00 Uhr";
  } else if (!isOpenAtAll && hour < 10) {
    nextOpenLabel = "heute ab 10:00 Uhr";
  } else if (!isOpenAtAll && hour >= 18) {
    nextOpenLabel = "morgen früh ab 10:00 Uhr";
  } else if (isHoliday) {
    nextOpenLabel = "am nächsten Werktag ab 10:00 Uhr";
  } else if (isClosingSoon && weekday !== "Freitag") {
    nextOpenLabel = "morgen früh ab 10:00 Uhr";
  }

  // realisticHandoverLabel: was kann der Bot REALISTISCH versprechen?
  let realisticHandoverLabel: string;
  if (status === "open_wide") {
    realisticHandoverLabel = "gleich (Mitarbeiterinnen sind jetzt im Salon)";
  } else if (status === "open_closing_soon") {
    realisticHandoverLabel = `noch heute, spätestens aber ${nextOpenLabel}`;
  } else {
    realisticHandoverLabel = nextOpenLabel;
  }

  // nextWorkdayLabel: was bedeutet "morgen" REALISTISCH? Am Freitag → "Montag".
  // Am Mo-Do → "morgen". Am Samstag → "Montag". Am Sonntag → "morgen" (= Montag).
  let nextWorkdayLabel: string;
  if (weekday === "Freitag" || weekday === "Samstag") {
    nextWorkdayLabel = "Montag früh";
  } else if (weekday === "Sonntag") {
    nextWorkdayLabel = "morgen früh"; // Montag
  } else {
    // Mo-Do — morgen ist ein Werktag, außer es ist ein Feiertag (vereinfacht: dann auch "Montag")
    nextWorkdayLabel = "morgen früh";
  }

  return { status, isOpen, nowLabel, reason, nextOpenLabel, realisticHandoverLabel, nextWorkdayLabel, todayWeekday: weekday };
}

/**
 * Entfernt / ersetzt interne Lagerzahlen aus dem Bot-Output.
 * Wenn Claude trotz System-Prompt mal "850g auf Lager" schreibt, fangen wir
 * das hier ab und ersetzen mit kunden-sicheren Phrasen.
 */
/**
 * Lädt die echte Methoden×Längen-Matrix aus product_methods + product_lengths.
 * Wird in den System-Prompt eingebaut (cacheable) UND vom Sanitizer benutzt,
 * um halluzinierte Kombinationen ("55cm Standard Russisch Tapes" — gibt's nicht!)
 * zu erkennen und zu korrigieren.
 */
async function loadProductCatalog(): Promise<{
  promptText: string;
  validCombos: Set<string>;          // "methodKey|lengthKey", normalisiert lowercase
  methodLengths: Map<string, Set<string>>; // method (lower) → set of lengths (e.g. "55cm","60cm")
  methodSupplier: Map<string, string>;     // method (lower) → "amanda"/"eyfel"
}> {
  const svc = createServiceClient();
  const [{ data: methods }, { data: lengths }, { data: suppliers }] = await Promise.all([
    svc.from("product_methods").select("id, name, supplier_id, sort_order").order("sort_order"),
    svc.from("product_lengths").select("id, method_id, value").order("sort_order"),
    svc.from("suppliers").select("id, name"),
  ]);
  const supName = new Map<string, string>();
  for (const s of suppliers || []) supName.set(s.id, (s.name || "").toLowerCase());

  // Method-ID → { name, qualityLabel (KUNDENSICHTBAR — NIE Lieferantenname!), lengths }
  // Lieferanten-Namen (Amanda, Eyfel, China) sind INTERN und dürfen NIE im Bot-Output landen.
  // Mapping passiert auf die kundenfreundliche Haarqualität:
  //   Amanda  → "Russisch glatt"
  //   Eyfel   → "Usbekisch wellig"
  const methodMap = new Map<string, { name: string; supplier: string; lengths: string[] }>();
  for (const m of methods || []) {
    const sup = supName.get(m.supplier_id) || "";
    const qualityLabel = sup.includes("amanda") ? "Russisch glatt"
                       : sup.includes("eyfel")  ? "Usbekisch wellig"
                       : sup.includes("china")  ? "China-Linie"
                       : "Sonstige";
    methodMap.set(m.id, { name: m.name, supplier: qualityLabel, lengths: [] });
  }
  for (const l of lengths || []) {
    const mm = methodMap.get(l.method_id);
    if (mm) mm.lengths.push(l.value);
  }

  // promptText
  let txt = "## 🏭 ECHTER PRODUKTKATALOG — METHODEN × LÄNGEN MATRIX (verbindlich aus der DB)\n\n";
  txt += "Dies ist die EINZIGE Quelle der Wahrheit für welche Längen es pro Methode gibt. ";
  txt += "Wenn eine Kundin nach einer Methode+Länge-Kombi fragt, die hier NICHT steht: ";
  txt += "sofort klären, nicht ungeprüft übernehmen. NIEMALS Längen erfinden oder annehmen.\n\n";
  // Gruppiert nach Supplier
  const grouped = new Map<string, Array<{ name: string; lengths: string[] }>>();
  for (const m of methodMap.values()) {
    if (!grouped.has(m.supplier)) grouped.set(m.supplier, []);
    grouped.get(m.supplier)!.push({ name: m.name, lengths: m.lengths });
  }
  for (const [supLabel, items] of grouped.entries()) {
    txt += `### ${supLabel}\n`;
    for (const it of items) {
      const lens = it.lengths.length > 0 ? it.lengths.join(", ") : "(keine Länge hinterlegt)";
      txt += `- **${it.name}**: ${lens}\n`;
    }
    txt += "\n";
  }
  txt += "💡 Beispiele für UNMÖGLICHE Kombis (NIE bestätigen):\n";
  txt += "- 55cm Standard Tapes in Russisch glatt → 55cm gibt's NUR bei Tapes in Usbekisch wellig\n";
  txt += "- 65cm Mini Tapes → Mini Tapes nur in 60cm\n";
  txt += "- 45cm Bondings in Russisch glatt → nur 60cm verfügbar\n\n";
  txt += "🔒 NIEMALS Lieferanten-Namen erwähnen (Amanda, Eyfel, Ebru, China etc.). ";
  txt += "Das sind INTERNE Bezeichnungen. Kundin spricht IMMER von der Haarqualität: ";
  txt += "'Russisch glatt' oder 'Usbekisch wellig'.\n";

  // validCombos: methodNameLower|length
  const valid = new Set<string>();
  const ml = new Map<string, Set<string>>();
  const msup = new Map<string, string>();
  for (const m of methodMap.values()) {
    const key = m.name.toLowerCase();
    if (!ml.has(key)) ml.set(key, new Set());
    for (const len of m.lengths) {
      const lenKey = len.toLowerCase().replace(/\s+/g, "");
      valid.add(`${key}|${lenKey}`);
      ml.get(key)!.add(lenKey);
    }
    // Supplier-Label vereinfachen
    msup.set(key, m.supplier.toLowerCase().includes("amanda") ? "amanda" :
                  m.supplier.toLowerCase().includes("eyfel") ? "eyfel" : "");
  }
  return { promptText: txt, validCombos: valid, methodLengths: ml, methodSupplier: msup };
}

/**
 * Sanitizer für halluzinierte Methode×Länge-Kombis.
 * Findet Patterns wie "55cm Standard Tapes", "Standard Tapes in 55cm",
 * "60cm Mini Tapes (Russisch glatt)" — und prüft gegen die echte DB-Matrix.
 * Bei ungültiger Kombi: korrigierende Klammer einfügen + zugehörige URL strippen.
 */
function validateMethodLengthCombos(
  text: string,
  validCombos: Set<string>,
  methodLengths: Map<string, Set<string>>,
): { text: string; corrections: string[] } {
  const corrections: string[] = [];
  // Alias → kanonischer Method-Key (lowercase) wie in product_methods.name
  const methodAliases: Array<{ pattern: RegExp; canonical: string }> = [
    { pattern: /\bstandard[ -]?tapes?\b/gi,                  canonical: "standard tapes" },
    { pattern: /\bmini[ -]?tapes?\b/gi,                      canonical: "minitapes" },
    { pattern: /\bbondings?\b/gi,                            canonical: "bondings" },
    { pattern: /\bclassic[ -]?weft\b/gi,                     canonical: "classic weft" },
    { pattern: /\binvisible[ -]?weft\b/gi,                   canonical: "invisible weft" },
    { pattern: /\bgenius[ -]?(?:weft|tresse)\b/gi,           canonical: "genius weft" },
    { pattern: /\bclip[ -]?ins?\b/gi,                        canonical: "clip-ins" },
    { pattern: /\bclassic[ -]?tressen?\b/gi,                 canonical: "classic tressen" },
    { pattern: /\bponytails?\b/gi,                           canonical: "ponytail" },
  ];

  // Pattern: "XXcm [...] Methode" oder "Methode [...] XXcm" innerhalb 0-25 Zeichen
  // Wir nehmen jeden Method-Treffer und schauen ob in der Umgebung eine cm-Angabe steht
  const lengthRe = /(\d{2,3})\s*(?:cm)\b/gi;

  for (const alias of methodAliases) {
    const matches = Array.from(text.matchAll(alias.pattern));
    for (const m of matches) {
      const idx = m.index || 0;
      const around = text.slice(Math.max(0, idx - 25), Math.min(text.length, idx + m[0].length + 25));
      const lenMatches = Array.from(around.matchAll(lengthRe));
      for (const lm of lenMatches) {
        const lenStr = `${lm[1]}cm`;
        const combo = `${alias.canonical}|${lenStr}`;
        if (!validCombos.has(combo)) {
          const validForMethod = methodLengths.get(alias.canonical);
          const allowed = validForMethod ? [...validForMethod].join(", ") : "?";
          corrections.push(`${lenStr} ${alias.canonical} → existiert nicht (verfügbar: ${allowed})`);
        }
      }
    }
  }
  if (corrections.length === 0) return { text, corrections };

  // Wenn ungültige Kombi gefunden: alle hairvenly.de/products-URLs entfernen,
  // weil die wahrscheinlich auch falsch verlinkt sind. Plus Hinweis-Notiz unten.
  let cleaned = text;
  const urlRe = /https?:\/\/(?:www\.)?hairvenly\.de\/products\/[A-Za-z0-9_\-/]+/gi;
  cleaned = cleaned.replace(urlRe, "");
  cleaned = cleaned.replace(/\n{3,}/g, "\n\n").trim();
  return { text: cleaned, corrections };
}

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

  // PRODUKTKATALOG-MATRIX — verbindliche Methoden×Längen aus der DB
  // Das verhindert Halluzinationen wie "55cm Standard Russisch Tapes" (gibt's nicht!).
  // 55cm gibt's nur bei Eyfel-Tapes (usbekisch wellig).
  const catalog = await loadProductCatalog();
  systemPrompt += "\n\n" + catalog.promptText;
  systemPrompt += "\n## 🚨 PFLICHTREGEL FÜR PRODUKTANGABEN\n";
  systemPrompt += "- Nenne NIEMALS eine Länge zu einer Methode, die NICHT in der Matrix oben steht.\n";
  systemPrompt += "- Wenn die Kundin selbst eine Länge nennt: prüfe gegen die Matrix. Wenn sie zu der Methode nicht existiert → freundlich klären, NICHT übernehmen.\n";
  systemPrompt += "- Beispiel: Kundin schreibt 'Standard Tapes in 55cm' → Antwort: 'In Russisch glatt haben wir Standard Tapes nur in 60cm. 55cm gibt es bei uns nur bei den Tapes in Usbekisch wellig. Was passt besser zu dir?'\n";
  systemPrompt += "- NIE Längen erfinden, runden oder annehmen.\n";
  systemPrompt += "- 🔒 NIEMALS Lieferanten-Namen erwähnen: Amanda, Eyfel, Ebru, China, etc. Das sind INTERNE Codes. Kundin spricht IMMER von der Haarqualität (Russisch glatt / Usbekisch wellig).\n";

  // GESCHÄFTSZEIT-KONTEXT
  // Bot muss wissen ob aktuell Öffnungszeit ist UND wie viel Zeit noch übrig ist.
  // Drei Stufen: open_wide ("gleich" OK), open_closing_soon (kurz vor Feierabend,
  // realistisch "noch heute oder morgen früh"), closed (nächste Öffnung).
  const biz = getBusinessHoursContext();
  systemPrompt += "\n## 🕒 AKTUELLE GESCHÄFTSZEIT\n";
  systemPrompt += `- Jetzt ist: **${biz.nowLabel} (Europe/Berlin)**\n`;
  systemPrompt += `- Status: **${biz.status === "open_wide" ? "✅ GEÖFFNET" : biz.status === "open_closing_soon" ? "⚠️ KURZ VOR FEIERABEND" : "❌ GESCHLOSSEN"}** (${biz.reason})\n`;
  systemPrompt += `- Öffnungszeiten: Mo-Fr 10:00-18:00 Uhr (ohne Feiertage in Bremen)\n`;
  systemPrompt += `- Realistische Wartezeit-Erwartung für Übergaben an Mitarbeiterinnen: **${biz.realisticHandoverLabel}**\n`;

  if (biz.status === "open_wide") {
    systemPrompt += `- Bei Übergaben darfst du 'meldet sich gleich', 'schreibt dir in Kürze' o.ä. nutzen — die Mitarbeiterinnen sind JETZT da und haben noch Zeit.\n`;
    systemPrompt += `- 🚨 ABER: Wenn die Übergabe-Aufgabe erst MORGEN passieren kann (z.B. Stylistin macht morgens Fotos), prüfe ob morgen ein Werktag ist:\n`;
    systemPrompt += `  - Heute ist **${biz.todayWeekday}** → "morgen" = **${biz.nextWorkdayLabel}**\n`;
    systemPrompt += `  - Am Freitag heißt "morgen" immer **Montag früh**, NIE "Samstag" — am Wochenende ist der Salon zu.\n`;
  } else if (biz.status === "open_closing_soon") {
    systemPrompt += `- 🚨 NICHT 'gleich' versprechen — die Mitarbeiterinnen haben nur noch wenig Zeit bis Feierabend.\n`;
    systemPrompt += `- Realistisch kommunizieren: 'Wir versuchen noch heute, spätestens aber ${biz.nextOpenLabel} schreibt dir die Kollegin' o.ä.\n`;
    systemPrompt += `- Bei komplexeren Themen direkt 'spätestens ${biz.nextOpenLabel}' sagen — nicht falsche Hoffnung machen.\n`;
  } else {
    systemPrompt += `- 🚨 NICHT 'gleich' / 'in Kürze' / 'sofort' / 'schreibt dir durch' verwenden — wir sind aktuell ${biz.reason.toLowerCase()}.\n`;
    systemPrompt += `- Stattdessen ehrlich kommunizieren: '${biz.nextOpenLabel} meldet sich eine Kollegin mit den Details bei dir 💌' o.ä.\n`;
  }
  systemPrompt += `- Sachfragen (Verfügbarkeit, Preise, allgemeine Infos) darfst du immer direkt beantworten — die Einschränkung gilt nur für Übergaben an Mitarbeiterinnen.\n`;


  // WISSENSDATENBANK (chatbot_faq) — statische Fakten die IMMER gelten.
  // Vorher gar nicht im Prompt — die 46 Einträge waren ungenutzt. Jetzt alle
  // aktiven werden geladen und kommen als feste Wissensbasis in den Prompt.
  // Hier rein gehören keine situativen Korrekturen, sondern dauerhafte Wahrheiten:
  // Methoden-Specs, Längen, Pflege-Tipps, Service-Infos, Preisstrukturen.
  const { data: faqs } = await svc
    .from("chatbot_faq")
    .select("topic, question, answer")
    .eq("active", true)
    .order("topic")
    .order("order_idx");
  if (faqs && faqs.length > 0) {
    systemPrompt += "\n\n## 📚 WISSENSDATENBANK — feste Fakten und FAQ\n";
    systemPrompt += "Diese Fakten sind IMMER wahr und gelten unabhängig vom konkreten Gespräch. Bei Widerspruch zwischen einem Trainings-Beispiel und der Wissensdatenbank: die Wissensdatenbank gewinnt.\n\n";
    // gruppiert nach topic für bessere Lesbarkeit
    const byTopic = new Map<string, { question: string; answer: string }[]>();
    for (const f of faqs) {
      const t = f.topic || "allgemein";
      if (!byTopic.has(t)) byTopic.set(t, []);
      byTopic.get(t)!.push({ question: f.question, answer: f.answer });
    }
    for (const [topic, items] of byTopic) {
      systemPrompt += `### ${topic}\n`;
      for (const it of items) {
        systemPrompt += `**F:** ${it.question}\n**A:** ${it.answer}\n\n`;
      }
    }
  }

  // Trainings-Beispiele:
  // 1. ALLE angepinnten (pinned=true) — bleiben dauerhaft im Bot-Sichtfeld
  // 2. Plus die 20 RELEVANTESTEN nicht-gepinnten — Auswahl nach Themen-Match
  //    mit der aktuellen Kunden-Message, nicht nur Datum.
  //    So fallen wichtige Korrekturen nicht mehr aus dem Sichtfeld nur weil sie
  //    alt sind — sie kommen zurück sobald die Kundin nach dem Thema fragt.
  // Keywords aus der letzten Kunden-Message extrahieren für themen-bezogenes
  // Trainings-Retrieval. Stop-Wörter raus, Mindest-Länge 3, max 6 Keywords.
  const STOPWORDS = new Set([
    "der", "die", "das", "und", "oder", "ich", "mir", "mich", "du", "dir", "dich",
    "ist", "war", "sind", "wäre", "wären", "habe", "hab", "hat", "hatte", "haben",
    "nicht", "kein", "keine", "auch", "noch", "schon", "mal", "ein", "eine", "einen",
    "mit", "von", "zu", "auf", "in", "an", "für", "bei", "über", "unter", "aus",
    "was", "wie", "wo", "wann", "warum", "wer", "ob", "denn", "nur", "sehr", "ganz",
    "kann", "können", "möchte", "möchten", "will", "willst", "wollen", "soll", "sollte",
    "mein", "meine", "dein", "deine", "ihr", "ihre", "euer", "eure",
    "danke", "hey", "hallo", "hi", "ja", "nein", "ok", "gut", "super",
    "bitte", "gerne", "vielleicht", "etwa", "etwas", "ungefähr",
  ]);
  const { data: lastUserMsgRow } = await svc
    .from("chat_messages")
    .select("content")
    .eq("session_id", sessionId)
    .eq("role", "user")
    .is("deleted_at", null)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  let keywords: string[] = [];
  if (lastUserMsgRow?.content) {
    keywords = (lastUserMsgRow.content as string)
      .toLowerCase()
      .replace(/[^a-z0-9äöüß\s]/g, " ")
      .split(/\s+/)
      .filter((w: string) => w.length >= 3 && !STOPWORDS.has(w))
      .slice(0, 6);
  }

  const [{ data: pinnedTraining }, { data: relevantTraining }, { data: recentTraining }] = await Promise.all([
    // 1) Alle gepinnten Trainings — immer dabei
    svc.from("chatbot_training")
      .select("id, user_message, good_answer, bad_answer, feedback, avatar_name, context_messages, pinned")
      .eq("active", true)
      .eq("pinned", true)
      .or(`avatar_name.is.null,avatar_name.eq.${signatureName}`)
      .order("created_at", { ascending: false }),
    // 2) Themenbezogen: Trainings deren user_message ODER feedback ein Keyword
    //    aus der aktuellen Kunden-Message enthält. Egal wie alt.
    keywords.length > 0
      ? svc.from("chatbot_training")
          .select("id, user_message, good_answer, bad_answer, feedback, avatar_name, context_messages, pinned")
          .eq("active", true)
          .or(`avatar_name.is.null,avatar_name.eq.${signatureName}`)
          .or(keywords.map(k => `user_message.ilike.%${k}%,feedback.ilike.%${k}%`).join(","))
          .order("created_at", { ascending: false })
          .limit(15)
      : Promise.resolve({ data: [] }),
    // 3) Plus die 10 absolut neuesten als Recency-Backstop
    svc.from("chatbot_training")
      .select("id, user_message, good_answer, bad_answer, feedback, avatar_name, context_messages, pinned")
      .eq("active", true)
      .or(`avatar_name.is.null,avatar_name.eq.${signatureName}`)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);
  const trainingIds = new Set<string>();
  type TrainingRow = NonNullable<typeof pinnedTraining>[number];
  const training: TrainingRow[] = [];
  for (const t of [...(pinnedTraining || []), ...(relevantTraining || []), ...(recentTraining || [])]) {
    if (!trainingIds.has(t.id)) {
      trainingIds.add(t.id);
      training.push(t);
    }
  }
  // Cap auf 25 damit Prompt nicht explodiert — Pin + Relevant haben Vorrang
  // weil sie zuerst hinzugefügt wurden.
  training.splice(25);
  if (training.length > 0) {
    systemPrompt += "\n\n## DEINE TRAININGS-BEISPIELE\n";
    systemPrompt += "Diese Beispiele zeigen dir den GANZEN Gesprächsverlauf — nicht nur die Einzelfrage. ";
    systemPrompt += "Achte besonders auf STRATEGIE-HINWEISE: sie sagen dir WIE du in ähnlichen Situationen vorgehen sollst. ";
    systemPrompt += "📌-Beispiele sind ANGEPINNT — die musst du IMMER befolgen, sie sind besonders wichtig.\n\n";
    for (let i = 0; i < training.length; i++) {
      const t = training[i];
      const scope = t.avatar_name ? `nur für ${t.avatar_name}` : "für alle Avatare";
      const pin = t.pinned ? "📌 ANGEPINNT — " : "";
      systemPrompt += `### Beispiel ${i + 1} (${pin}${scope})\n`;
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

  // PRODUKT-EXISTENZ-REGEL: niemals Produkt-Variante bestätigen die nicht
  // 100% sicher aus FAQ / Tool-Output kommt. Halluzination = Vertrauens-Bruch.
  const existenceRule = `\n\n## 🚫 PRODUKT-EXISTENZ-REGEL — KOMPROMISSLOS
Bevor du eine Methode-Länge-Kombi bestätigst ("ja, gibt es in 85cm"), MUSS dies erfüllt sein:
• Du hast die Wissensdatenbank-FAQ "Längen pro Methode" gelesen UND die Kombi steht dort, ODER
• Du hast get_stock_eta / get_available_colors aufgerufen UND einen Treffer für diese exakte Kombi bekommen.

Wenn weder noch: NIEMALS bestätigen. Stattdessen ehrlich:
"In [Methode] haben wir leider keine [Länge]. Vorhanden wären [echte Längen]. Magst du eine davon?"

NIEMALS:
❌ "Tressen in 85cm" — gibt es nicht
❌ "Mini Tapes Usbekisch wellig" — gibt es nicht (Mini Tapes nur russisch glatt)
❌ Erfundene Preise ohne Tool-Aufruf
❌ Aus einer Methode (z.B. Tapes 85cm gibt's) schließen dass andere (Tressen 85cm) auch existiert

NIE Phantasie-Daten ausgeben. Lieber ehrlich "haben wir nicht" + Alternative.`;

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
  const systemPromptVariable = openTurnsHint + greetingHint + existenceRule + urlRule + styleRule;

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

  // SAFETY-NET 1eta: ETA-LINIEN-KONSISTENZ
  // Häufiger Halluzinationsfehler: Bot bekommt vom get_stock_eta-Tool ETAs
  // für beide Linien (Russisch glatt + Usbekisch wellig) zurück, und labelt
  // dann ein Usbekisch-Datum als "Russisch glatt"-Datum (oder umgekehrt).
  // Wir parsen die Tool-Results und prüfen, ob jedes erwähnte Datum wirklich
  // zur erwähnten Linie passt. Bei Mismatch: Datum strippen + ehrlich machen.
  try {
    type EtaEntry = { collection: string; eta: string; product: string };
    const etaEntries: EtaEntry[] = [];
    for (let i = 0; i < allToolCalls.length; i++) {
      const call = allToolCalls[i];
      if (call.name !== "get_stock_eta") continue;
      const result = allToolResults.find(r => r.tool_use_id === call.id);
      if (!result) continue;
      try {
        const parsed = JSON.parse(result.content) as Record<string, unknown>;
        // Format aus tools/index.ts: status + verschiedene Felder
        const lists: Array<Record<string, unknown>[]> = [];
        for (const key of ["coming_soon", "still_coming", "sold_out_or_coming", "inventory_available"]) {
          const v = parsed[key];
          if (Array.isArray(v)) lists.push(v as Record<string, unknown>[]);
        }
        for (const list of lists) {
          for (const item of list) {
            const coll = String(item.collection || "");
            const eta  = String(item.earliest_eta || item.eta || "");
            const prod = String(item.product || "");
            if (coll && eta) etaEntries.push({ collection: coll, eta, product: prod });
          }
        }
      } catch { /* malformed tool result — skip */ }
    }

    if (etaEntries.length > 0) {
      // Map ETA-Datum (normalisiert) → Set<linie>
      const normalizeDate = (s: string): string | null => {
        // "15.06.2026" / "15.06.26" / "15.06." / "15.6.26" alle auf "15.06"
        const m = s.match(/(\d{1,2})[.\/](\d{1,2})/);
        if (!m) return null;
        return `${m[1].padStart(2, "0")}.${m[2].padStart(2, "0")}`;
      };
      const lineOf = (collection: string): "russisch" | "usbekisch" | "unknown" => {
        const c = collection.toLowerCase();
        if (c.includes("russ") || c.includes("glatt")) return "russisch";
        if (c.includes("usbek") || c.includes("wellig")) return "usbekisch";
        return "unknown";
      };
      const etaLineMap = new Map<string, Set<"russisch" | "usbekisch" | "unknown">>();
      for (const e of etaEntries) {
        const norm = normalizeDate(e.eta);
        if (!norm) continue;
        if (!etaLineMap.has(norm)) etaLineMap.set(norm, new Set());
        etaLineMap.get(norm)!.add(lineOf(e.collection));
      }

      // Suche im Bot-Text alle Datums-Erwähnungen (DD.MM.) mit ihrem Kontext
      // (~120 Zeichen davor → suche nach Linien-Stichwort)
      const datePattern = /\((\d{1,2})[.\/](\d{1,2})\.?\)/g;
      let mismatchFound = false;
      finalText = finalText.replace(datePattern, (match, d1, d2, offset) => {
        const norm = `${String(d1).padStart(2, "0")}.${String(d2).padStart(2, "0")}`;
        const linesForDate = etaLineMap.get(norm);
        if (!linesForDate) return match; // Datum nicht aus Tool — lassen

        const before = finalText.slice(Math.max(0, (offset as number) - 200), offset as number).toLowerCase();
        const mentionsRuss = /\b(russisch\s+glatt|russ\.\s*glatt|glatt)\b/.test(before);
        const mentionsUsbek = /\b(usbekisch\s+wellig|wellig|usbek)\b/.test(before);

        // Mismatch: Text sagt "russisch glatt" aber Datum ist NUR in usbekisch
        if (mentionsRuss && !linesForDate.has("russisch") && linesForDate.has("usbekisch")) {
          mismatchFound = true;
          console.warn(`[respond] ETA-LINIEN-MISMATCH gestrippt: "${match}" — Text sagt "Russisch glatt", Datum ist aber nur in Usbekisch-Sheet`);
          return "(genaues Datum klärt dir die Kollegin)";
        }
        if (mentionsUsbek && !linesForDate.has("usbekisch") && linesForDate.has("russisch")) {
          mismatchFound = true;
          console.warn(`[respond] ETA-LINIEN-MISMATCH gestrippt: "${match}" — Text sagt "Usbekisch wellig", Datum ist aber nur in Russisch-Sheet`);
          return "(genaues Datum klärt dir die Kollegin)";
        }
        return match;
      });
      if (mismatchFound) {
        // Aufräumen: doppelte Leerzeichen / "ca. (genaues Datum klärt..."
        finalText = finalText
          .replace(/\bca\.\s*\(genaues Datum/gi, "(genaues Datum")
          .replace(/  +/g, " ")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
      }
    }
  } catch (e) {
    console.warn("[respond] ETA-Linien-Validator fehlgeschlagen:", (e as Error).message);
  }

  // SAFETY-NET 1y: NIEMALS proaktiv extra Fotos/Videos der Tressen anbieten.
  // ABER: Wenn die Kundin selbst nach extra Bildern/Videos gefragt hat, darf der
  // Bot reaktiv zustimmen — mit Verweis dass die Stylistin sich darum kümmert
  // (sobald sie im Salon ist). Wir unterscheiden:
  //   PROAKTIV-PITCH (verboten):    "Wir können dir gerne extra Fotos/Videos machen 💕"
  //   REAKTIVE ÜBERGABE (erlaubt):  "Klar, sobald die Kollegin Montag wieder im Salon ist,
  //                                  schickt sie dir gerne weitere Bilder ✨"
  //
  // Heuristik: wenn der Satz einen Übergabe-Marker enthält ("Kollegin", "Stylistin",
  // "Farb-Expertin", "im Salon", "Mo-Fr", "Montag", "ab 10", "sobald wir wieder")
  // ist es eine reaktive Antwort — wir lassen sie durch.
  {
    const isReactiveHandover = (line: string): boolean => {
      const handoverMarkers = /(kollegin|stylistin|farb-?expertin|im\s+salon|mo[\s-]?fr|montag|dienstag|mittwoch|donnerstag|freitag|sobald\s+wir\s+wieder|ab\s+\d{1,2}(:\d{2}|\s*uhr)|werktag)/i;
      return handoverMarkers.test(line);
    };
    const extraPhotoOfferPatterns: RegExp[] = [
      // "Wir können dir auch gerne extra Fotos oder Videos von ... machen"
      /(^|\n)[^\n]*\b(wir|ich)\b[^\n]{0,40}\b(können|kann|könnten|machen|mache|schicken|sende|filmen)\b[^\n]{0,80}\b(extra |zusätzliche? )?(fotos? (oder|und) videos?|videos? (oder|und) fotos?|extra fotos?|extra videos?)\b[^\n]*(\n|$)/gi,
      // "Ich kann dir ein Video von der Farbe schicken/machen"
      /(^|\n)[^\n]*\bich (kann|könnte) dir (ein |noch ein )?(video|extra foto)[^\n]*(\n|$)/gi,
      // "Wir filmen die Farbe"
      /(^|\n)[^\n]*\bwir filmen (dir |die )[^\n]*(\n|$)/gi,
    ];
    let dropped = false;
    for (const pat of extraPhotoOfferPatterns) {
      finalText = finalText.replace(pat, (match) => {
        // Reaktive Übergabe → durchlassen, sonst blocken
        if (isReactiveHandover(match)) return match;
        dropped = true;
        return "\n";
      });
    }
    if (dropped) {
      console.warn("[respond] DROPPED proaktives Extra-Foto/Video-Angebot (kein Übergabe-Marker — siehe FAQ color-advice-no-proactive-extra-photos)");
      finalText = finalText.replace(/\n{3,}/g, "\n\n").trim();
    }
  }

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

  // SAFETY-NET 1a: HALLUZINIERTE URLs eliminieren + Methoden-Mismatch-Check
  // (1) Jede hairvenly.de/products-URL wird gegen product_colors verifiziert.
  // (2) Wenn die Bot-Antwort eine bestimmte Methode erwähnt ("Mini Tapes",
  //     "Standard Tapes", "Bondings", "Tressen", "Clip-Ins"), muss der URL-Slug
  //     dazu passen. Wenn z.B. "Mini Tapes" steht aber URL contains "standard-tape",
  //     ist die URL falsch (Methode-Mismatch) und wird entfernt.
  try {
    const urlPattern = /https?:\/\/(?:www\.)?hairvenly\.de\/(?:products|collections)\/[A-Za-z0-9_\-/]+/gi;
    const foundUrls = Array.from(new Set(finalText.match(urlPattern) || []));
    if (foundUrls.length > 0) {
      const { data: valid } = await svc
        .from("product_colors")
        .select("shopify_url")
        .in("shopify_url", foundUrls);
      const validSet = new Set((valid || []).map(r => r.shopify_url));

      // Methoden-Hinweise im Text suchen — was hat der Bot der Kundin versprochen?
      const lowerText = finalText.toLowerCase();
      const mentionedMethods: Array<{ method: string; mustContain: string[]; mustNotContain: string[] }> = [];
      if (/\bmini[ -]?tape/i.test(finalText)) {
        mentionedMethods.push({ method: "Mini Tapes", mustContain: ["mini-tape"], mustNotContain: ["standard-russische-tape", "standard-usbekische-tape", "standard-tape"] });
      } else if (/\bstandard[ -]?tape/i.test(finalText) || (lowerText.includes("tape") && !/\bmini\b/i.test(finalText))) {
        mentionedMethods.push({ method: "Standard Tapes", mustContain: ["tape"], mustNotContain: ["mini-tape", "genius-weft", "invisible-tressen", "bondings", "clip-extensions"] });
      }
      if (/\bbondings?\b/i.test(finalText)) {
        mentionedMethods.push({ method: "Bondings", mustContain: ["bondings"], mustNotContain: ["tape-extensions", "tressen", "clip-extensions"] });
      }
      if (/\bgenius[ -]?(?:weft|tresse)/i.test(finalText)) {
        mentionedMethods.push({ method: "Genius Weft", mustContain: ["genius-weft"], mustNotContain: ["tape-extensions", "bondings", "invisible-tressen", "clip-extensions"] });
      }
      if (/\bclip[ -]?ins?\b/i.test(finalText)) {
        mentionedMethods.push({ method: "Clip-Ins", mustContain: ["clip-extensions"], mustNotContain: ["tape-extensions", "tressen", "bondings", "genius-weft"] });
      }

      for (const url of foundUrls) {
        if (!validSet.has(url)) {
          console.warn(`[respond] DROPPED hallucinated URL: ${url}`);
        } else if (mentionedMethods.length > 0) {
          const lowerUrl = url.toLowerCase();
          const mismatch = mentionedMethods.find(m =>
            !m.mustContain.some(c => lowerUrl.includes(c)) ||
            m.mustNotContain.some(c => lowerUrl.includes(c))
          );
          if (!mismatch) continue;
          console.warn(`[respond] DROPPED method-mismatch URL: ${url} — Text erwähnt "${mismatch.method}", URL-Slug passt nicht`);
        } else {
          continue;
        }
        // URL entfernen — Markdown + nackt
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

  // SAFETY-NET 1c1: WOCHENENDE-FALLE — "morgen früh" am Freitag/Samstag.
  // Bot schreibt manchmal "morgen früh ab 10" obwohl heute Freitag ist und
  // morgen Samstag (Salon zu). Kundin wartet vergebens bis Montag.
  // Wir ersetzen "morgen" → "Montag" wenn aktuell Freitag/Samstag ist.
  {
    const bizMorgen = getBusinessHoursContext();
    if (bizMorgen.todayWeekday === "Freitag" || bizMorgen.todayWeekday === "Samstag") {
      const beforeMorgen = finalText;
      const replacements: Array<[RegExp, string]> = [
        // "morgen früh ab 10" / "morgen früh ab 10 Uhr"
        [/\bmorgen\s+früh\s+ab\s+10(\s*uhr)?\b/gi, "Montag früh ab 10 Uhr"],
        // "morgen früh wieder im Salon"
        [/\bmorgen\s+früh\s+wieder\s+im\s+salon\b/gi, "Montag früh wieder im Salon"],
        // "morgen früh" (generisch)
        [/\bmorgen\s+früh\b/gi, "Montag früh"],
        // "(ab Morgen)" / "morgen um 10"
        [/\bmorgen\s+um\s+10(\s*uhr)?\b/gi, "Montag ab 10 Uhr"],
        // "morgen wieder erreichbar" / "morgen ab"
        [/\bmorgen\s+wieder\s+(erreichbar|im\s+salon|im\s+studio|da)/gi, "Montag wieder $1"],
        [/\bmorgen\s+ab\s+10\b/gi, "Montag ab 10 Uhr"],
        // "ab morgen" → "ab Montag"
        [/\bab\s+morgen\b/gi, "ab Montag"],
      ];
      for (const [re, repl] of replacements) {
        finalText = finalText.replace(re, repl);
      }
      if (beforeMorgen !== finalText) {
        console.warn(`[respond] SCRUBBED Wochenende-Falle: "morgen" → "Montag" (heute ist ${bizMorgen.todayWeekday})`);
      }
    }
  }

  // SAFETY-NET 1c2: "gleich"-Phrasen wenn closed ODER closing_soon ersetzen.
  // Bei closed → nächste Öffnung. Bei closing_soon → realistische Variante
  // "noch heute, sonst morgen früh".
  // Verhindert dass die Kundin am Freitag 17:35 "gleich" liest und dann
  // bis Montag wartet.
  {
    const biz2 = getBusinessHoursContext();
    if (biz2.status !== "open_wide") {
      const beforeBiz = finalText;
      // Wording-Ziel je Status:
      const replacementLabel =
        biz2.status === "closed"
          ? biz2.nextOpenLabel
          : `noch heute, spätestens ${biz2.nextOpenLabel}`;

      const replacements: Array<[RegExp, string]> = [
        [/\b(meine\s+|eine\s+|unsere\s+)?(kollegin|farb-?expertin|stylistin|mitarbeiterin)\s+(meldet|schreibt|kommt|antwortet|kümmert)\s+sich\s+(gleich|in\s+kürze|sofort|kurz\s+(durch|gleich)|gleich\s+(durch|bei\s+dir))/gi,
         `$1$2 meldet sich ${replacementLabel}`],
        [/\b(schreibe|melde|sage)\s+(dir|euch)\s+gleich(\s+mit\s+der\s+kollegin\s+durch)?/gi,
         `melde mich ${replacementLabel} bei dir`],
        [/\b(meldet\s+sich\s+(gleich|in\s+kürze|kurz)\s+bei\s+dir)/gi,
         `meldet sich ${replacementLabel} bei dir`],
        [/\bschreibe?\s+dir\s+(die\s+\w+\s+)?gleich(\s+durch)?/gi,
         biz2.status === "closed"
           ? `schreibe dir ${biz2.reason === "Wochenende" ? "Montag" : "morgen"} die Details`
           : `schreibe dir die Details noch heute oder spätestens ${biz2.nextOpenLabel}`],
      ];
      for (const [re, repl] of replacements) {
        finalText = finalText.replace(re, repl);
      }
      if (beforeBiz !== finalText) {
        console.warn(`[respond] SCRUBBED "gleich"-Phrasen → "${replacementLabel}" (Status: ${biz2.status})`);
      }
    }
  }

  // SAFETY-NET 1d: LIEFERANTEN-NAMEN ENTFERNEN
  // Amanda, Eyfel, Ebru, China — alles intern. Niemals zur Kundin raus.
  // Mappt automatisch auf die kundensichtbare Haarqualität.
  {
    const beforeSupplier = finalText;
    const supplierReplacements: Array<[RegExp, string]> = [
      // "Eyfel Ebru" / "Eyfel-Ebru" Kombination
      [/\bEyfel[ -]?Ebru\b/gi, "Usbekisch wellig"],
      // "Eyfel-Tapes", "Eyfel Bondings" etc → "Usbekisch wellige Tapes/Bondings"
      [/\bEyfel[ -]?(Tapes?|Bondings?|Tressen|Clip[ -]?Ins?|Genius[ -]?Weft|Ponytails?)\b/gi, "Usbekisch wellige $1"],
      // "Amanda-Tapes", "Amanda Bondings" → "Russisch glatte Tapes/..."
      [/\bAmanda[ -]?(Tapes?|Bondings?|Tressen|Clip[ -]?Ins?|Genius[ -]?Weft|Ponytails?|Mini[ -]?Tapes?|Standard[ -]?Tapes?)\b/gi, "Russisch glatte $1"],
      // "China-Tapes" → "China-Linie" verstecken
      [/\bChina[ -]?(Tapes?|Bondings?|Tressen|Clip[ -]?Ins?|Linie)\b/gi, "$1"],
      // Standalone-Erwähnungen — vorsichtig, nur als ganzes Wort
      // "bei Amanda" / "von Amanda" / "(Amanda)"
      [/\b(bei|von|aus|unsere?n?)\s+Amanda\b/gi, "$1 Russisch glatt"],
      [/\b(bei|von|aus|unsere?n?)\s+Eyfel\b/gi, "$1 Usbekisch wellig"],
      [/\(Amanda\)/g, "(Russisch glatt)"],
      [/\(Eyfel(?:[ -]?Ebru)?\)/gi, "(Usbekisch wellig)"],
      // Letzter Backstop: nackte Erwähnungen — durch generischen Begriff ersetzen
      [/\bAmanda\b/g, "unsere Russisch-glatt-Linie"],
      [/\bEyfel(?:[ -]?Ebru)?\b/gi, "unsere Usbekisch-wellig-Linie"],
      [/\bEbru\b/g, ""],
    ];
    for (const [re, repl] of supplierReplacements) {
      finalText = finalText.replace(re, repl);
    }
    if (beforeSupplier !== finalText) {
      console.warn("[respond] SCRUBBED Lieferanten-Namen aus Bot-Output");
      finalText = finalText.replace(/  +/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    }
  }

  // SAFETY-NET 1c: METHODEN×LÄNGEN-VALIDIERUNG gegen echte DB-Matrix
  // Wenn der Bot z.B. "55cm Standard Tapes Russisch glatt" schreibt — das gibt's
  // nicht (Standard Tapes nur in 60cm). Hier korrigieren wir das, strippen
  // Produkt-URLs und hängen eine Klarstellung an.
  try {
    const { text: validatedText, corrections } = validateMethodLengthCombos(
      finalText,
      catalog.validCombos,
      catalog.methodLengths,
    );
    if (corrections.length > 0) {
      console.warn("[respond] METHOD×LENGTH mismatch detected:", corrections.join("; "));
      finalText = validatedText;
      // Korrektive Notiz freundlich anhängen — Bot soll bewusst klären statt blind weiter
      finalText += "\n\n_(Kurz: die exakte Längen-Methoden-Kombi muss ich dir nochmal sauber benennen — schreibe dir die Optionen gleich mit der Kollegin durch.)_";
    }
  } catch (e) {
    console.warn("[respond] method×length validation failed:", (e as Error).message);
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
