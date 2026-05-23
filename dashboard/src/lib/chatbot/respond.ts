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

// getBusinessHoursContext: extrahiert nach @/lib/chatbot/business-hours
// damit auch der Webhook (Audio-Bypass) sie nutzen kann.
import { getBusinessHoursContext } from "./business-hours";
import { stripColorUrlMismatch, limitUrls } from "./output-sanitizers";

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
  methodLines: Map<string, Set<"russisch" | "usbekisch" | "andere">>; // welche Linien je Methode
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
  // Linie-Suffix-Map: macht Methoden-Namen eindeutig pro Linie.
  // Wichtig für Methoden wie "Classic Weft" (nur russisch) vs "Classic Tressen"
  // (nur usbekisch) oder "Genius Weft" (beide Linien — je nach Lieferant).
  // Der Bot sah vorher nur den nackten Namen → konnte nicht sehen welche Linie.
  // Jetzt wird der Linien-Suffix Teil des Namens → Klarheit garantiert.
  const lineSuffix = (sup: string) =>
    sup.toLowerCase().includes("russisch")  ? "Russisch"
    : sup.toLowerCase().includes("usbekisch") ? "Usbekisch"
    : sup.toLowerCase().includes("china")    ? "China"
    : "";
  for (const [supLabel, items] of grouped.entries()) {
    txt += `### ${supLabel}\n`;
    const suffix = lineSuffix(supLabel);
    for (const it of items) {
      const lens = it.lengths.length > 0 ? it.lengths.join(", ") : "(keine Länge hinterlegt)";
      // Display-Name mit Linien-Suffix — nur wenn nicht schon im Namen
      const displayName = suffix && !it.name.toLowerCase().includes(suffix.toLowerCase())
        ? `${it.name} ${suffix}`
        : it.name;
      txt += `- **${displayName}**: ${lens}\n`;
    }
    txt += "\n";
  }
  // Cross-Line-Methoden hervorheben — Methoden, die unter mehreren Linien existieren
  // (z.B. Genius Weft, Bondings, Tapes). WICHTIG für Klärungs-Fragen wie
  // "habt ihr Classic und Genius in beiden Strukturen?". Bot soll bei vagen
  // Anfragen NIEMALS willkürlich eine Linie picken — sondern beide nennen.
  const methodToLines = new Map<string, Set<string>>();
  for (const m of methodMap.values()) {
    const baseName = m.name; // Original-Name ohne Linien-Suffix
    if (!methodToLines.has(baseName)) methodToLines.set(baseName, new Set());
    methodToLines.get(baseName)!.add(m.supplier);
  }
  const conceptToVariants = new Map<string, Array<{ method: string; line: string; lengths: string[] }>>();
  for (const m of methodMap.values()) {
    // Concept = Method-Name OHNE die typischen Linien-Suffixe Tressen/Weft
    // → "Classic Tressen" + "Classic Weft" = Concept "Classic"
    // → "Genius Weft" (beide Linien) = Concept "Genius"
    const concept = m.name.replace(/\s*(Tressen|Weft)\s*$/i, "").trim();
    if (!concept) continue;
    if (!conceptToVariants.has(concept)) conceptToVariants.set(concept, []);
    conceptToVariants.get(concept)!.push({ method: m.name, line: m.supplier, lengths: m.lengths });
  }
  const multiLineConcepts = Array.from(conceptToVariants.entries())
    .filter(([, variants]) => new Set(variants.map(v => v.line)).size > 1);
  if (multiLineConcepts.length > 0) {
    txt += "### 🔀 PRODUKTE DIE ES IN BEIDEN LINIEN GIBT (wichtig für Klärungs-Fragen!)\n";
    txt += "Wenn eine Kundin nur den Produktnamen nennt ('Classic', 'Genius', 'Tapes') OHNE Linie zu sagen, dann gib IMMER BEIDE Linien an — NIEMALS eine willkürlich auswählen.\n\n";
    for (const [concept, variants] of multiLineConcepts) {
      txt += `**${concept}** gibt es in:\n`;
      for (const v of variants) {
        const lens = v.lengths.length > 0 ? v.lengths.join(", ") : "(keine Länge)";
        txt += `  - ${v.method} (${v.line}): ${lens}\n`;
      }
      txt += "\n";
    }
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
  // methodLines: für JEDEN Methodennamen die Set von Linien, in denen er
  // existiert. WICHTIG: viele Methoden gibt's in BEIDEN Linien (Bondings,
  // Genius Weft, Ponytail) — eine 1:1-Map wäre falsch.
  const methodLines = new Map<string, Set<"russisch" | "usbekisch" | "andere">>();
  for (const m of methodMap.values()) {
    const key = m.name.toLowerCase();
    if (!ml.has(key)) ml.set(key, new Set());
    for (const len of m.lengths) {
      const lenKey = len.toLowerCase().replace(/\s+/g, "");
      valid.add(`${key}|${lenKey}`);
      ml.get(key)!.add(lenKey);
    }
    const line: "russisch" | "usbekisch" | "andere" =
      m.supplier.toLowerCase().includes("russisch") ? "russisch"
      : m.supplier.toLowerCase().includes("usbekisch") ? "usbekisch"
      : "andere";
    if (!methodLines.has(key)) methodLines.set(key, new Set());
    methodLines.get(key)!.add(line);
    // Supplier-Label vereinfachen (Legacy — wird nur informativ benutzt)
    msup.set(key, m.supplier.toLowerCase().includes("amanda") ? "amanda" :
                  m.supplier.toLowerCase().includes("eyfel") ? "eyfel" : "");
  }
  return { promptText: txt, validCombos: valid, methodLengths: ml, methodSupplier: msup, methodLines };
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
  systemPrompt += "- 🔗 WICHTIG: Wenn du eine konkrete Farbe (COLDNESS, ASH MELT, FROSTY, CAPPUCCINO etc.) empfiehlst oder nennst, packe IMMER die passende Shopify-URL direkt hinter den Farbnamen. Niemals einen Farbnamen 'nackt' lassen. Die Kundin muss DIREKT klicken und das Produkt sehen können — sonst muss sie selbst suchen.\n";
  systemPrompt += "  Wenn dir aus dem Tool-Output keine URL bekannt ist, NICHT die Farbe nennen.\n";
  systemPrompt += "- 🚫 NIEMALS proaktiv 'extra Fotos/Videos' anbieten — auch nicht via Übergabe ('Magst du, dass unsere Farb-Expertin dir extra Fotos schickt?'). Das ist ein heikler Service, den nur die Stylistin selektiv vergibt. Nur reaktiv erlaubt, wenn die Kundin EXPLIZIT um Fotos/Videos fragt.\n";
  systemPrompt += "- ✂️ KEINE selbstreferenziellen Klammer-Disclaimer am Ende (z.B. '_(Kurz: die exakte Längen-Methoden-Kombi muss ich dir noch sauber benennen — Kollegin durchsprechen.)_'). Das wirkt unsicher und verwirrt die Kundin. Wenn du etwas wirklich abklären musst, sag's klar im Hauptteil, nicht als nachträgliche Klammer.\n";
  systemPrompt += "- 🔁 NIE wiederholen was die Kundin BEREITS WEISS oder gerade SELBST GESAGT hat. Wenn sie schreibt 'hab schon gesehen dass ich über planity buchen kann' → KEIN Planity-Link mehr! Wenn sie sagt 'ich weiß dass es 60cm gibt' → erklär nicht nochmal dass es 60cm gibt. Stattdessen: kurz bestätigen + zum nächsten Schritt (z.B. Farbberatung anbieten, Frage stellen, abschicken). Sonst wirkt der Bot dumm und nicht zuhörend.\n";
  systemPrompt += "- 🔁 Konkrete Beispiele für 'NICHT WIEDERHOLEN':\n";
  systemPrompt += "  • Kundin: 'hab planity schon gefunden' → NICHT nochmal Planity-Link. RICHTIG: 'Super 💕 Falls du vorher noch Fragen zur Farbe hast — schick gerne ein Foto bei Tageslicht.'\n";
  systemPrompt += "  • Kundin: 'ich weiß dass Mini Tapes 60cm sind' → NICHT erklären dass Mini Tapes 60cm sind.\n";
  systemPrompt += "  • Kundin: 'ich brauche 6 Pakete' → NICHT zurückfragen wie viele Pakete sie braucht.\n";
  systemPrompt += "- 🏪 SALON-TERMIN vs. ONLINE-BESTELLUNG unterscheiden:\n";
  systemPrompt += "  • Wenn die Kundin einen TERMIN VOR ORT bucht (Verdichtung, Auffüllen, Verlängerung im Salon) → die Stylistin sieht ihr Haar direkt persönlich. KEIN Foto vorab nötig, keine Farb-Vorabberatung anbieten. Antworten kurz halten — Termin-Info reicht.\n";
  systemPrompt += "  • Nur bei ONLINE-Bestellung von Tapes/Bondings/Tressen mit Farbberatung-Bedarf → Foto-Option erwähnen.\n";
  systemPrompt += "  • Beispiel: Kundin fragt nach Termin zur Verdichtung mit Mini Tapes → kurze Bestätigung + Hinweis dass sie über Planity buchen kann. KEIN 'schick mir ein Foto'-Angebot, weil die Stylistin sie persönlich sieht.\n";

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
    .select("role, content, tool_calls, tool_results, attachments, external_id, reply_to_external_id, created_at")
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

  // ── CRITICAL_RULES: ans absolute Prompt-Ende.
  // LLMs gewichten Anweisungen am Ende des System-Prompts am stärksten.
  // Diese Top-5 sind harte Pflichtregeln die der Bot historisch ignoriert hat.
  systemPrompt += `

## 🚨🚨🚨 KRITISCHE REGELN — MUSST DU IMMER BEFOLGEN 🚨🚨🚨

Diese 5 Regeln werden auch NACH deiner Antwort vom System gecheckt und ggf. korrigiert. Aber besser: halte sie direkt ein, damit deine Antwort authentisch wirkt.

1. **MAX 3 LINKS PRO ANTWORT.** Egal wie viele Farben/Produkte du nennst, NIEMALS mehr als 3 \`hairvenly.de\`-URLs in einer Antwort. Wenn du mehr Produkte erwähnen willst — nur den Namen ohne Link.

2. **PROAKTIV KEINE EXTRA-FOTOS/VIDEOS ANBIETEN.** NIE schreiben "Magst du, dass unsere Farb-Expertin/Stylistin dir extra Fotos oder Videos schickt?" — auch nicht via Übergabe. Nur reaktiv, wenn die Kundin EXPLIZIT nach Fotos/Videos GEFRAGT hat (mit Fragezeichen + "habt ihr"/"könnt ihr"/"magst du"/"hättet ihr").

3. **KEIN KLAMMER-DISCLAIMER AM ENDE.** NIEMALS sowas wie "_(Kurz: die exakte Längen-Methoden-Kombi muss ich dir noch sauber benennen — Kollegin durchsprechen.)_" oder "(PS: ...)" oder "Kurz: ich muss das nochmal abklären." Wenn du etwas wirklich abklären musst → SAG ES KLAR IM HAUPTTEIL, nicht als nachträgliche Klammer.

4. **FARBNAMEN IMMER MIT URL.** Wenn du eine konkrete Farbe (**COLDNESS**, **ASH MELT**, **CAPPUCCINO** etc.) empfiehlst, IMMER die passende Shopify-URL direkt darunter. Wenn dir aus dem Tool keine URL bekannt ist → NICHT die Farbe nennen.

5. **NIEMALS LIEFERANTEN-NAMEN.** Amanda, Eyfel, Ebru, China sind INTERNE Codes. Sprich IMMER von der Haarqualität: "Russisch glatt" / "Usbekisch wellig".

🔁 Halte dich an diese 5 Regeln BEIM ERSTEN MAL. Sonst korrigiert das System und die Antwort wirkt holpriger.`;

  // Wichtig: systemPrompt (= persona + avatar + training + strategies) bleibt STABIL
  // pro Avatar und wird via Prompt-Caching wiederverwendet. Variable Teile
  // (openTurnsHint, sorry-hint, greetingHint, urlRule) gehen in einen separaten Block —
  // werden nicht gecacht, sind aber pro Call eh klein.
  const systemPromptStable = systemPrompt;
  const systemPromptVariable = openTurnsHint + greetingHint + existenceRule + urlRule + styleRule;

  // Set aller external_ids in dieser Session — für Reply-Lookup. Wenn eine
  // Customer-Message eine reply_to_external_id hat, die NICHT in diesem Set
  // ist, dann referenziert sie eine Nachricht außerhalb unseres Verlaufs
  // (zu alt, Story-Reply, vor Webhook-Onboarding). Der Bot bekommt dann
  // einen klaren Hint, damit er nicht erraten muss worum's geht.
  const knownExternalIds = new Set(
    (msgs || [])
      .map(m => (m as { external_id?: string | null }).external_id)
      .filter((v): v is string => !!v)
  );

  const messages: Anthropic.MessageParam[] = [];
  for (const m of msgs) {
    if (m.role === "user") {
      // External-Reply-Hint: Customer hat auf eine Nachricht geantwortet, die
      // wir nicht im Verlauf haben → Bot muss freundlich um Klärung bitten.
      const replyToExt = (m as { reply_to_external_id?: string | null }).reply_to_external_id;
      const isExternalReply = !!replyToExt && !knownExternalIds.has(replyToExt);
      // Foto-Anhänge als Image-Blocks an Claude weitergeben (Vision)
      // WICHTIG: wir holen das Bild SELBST und übergeben Base64 — Anthropic
      // Vision API respektiert robots.txt und IG CDN blockt externe Fetcher.
      const attachments = (m.attachments as { type: string; url: string }[] | null) || [];
      const images = attachments.filter(a => a.type === "image" && a.url);
      const hasEphemeral = attachments.some(a => a.type === "ephemeral");
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
      } else if (hasEphemeral) {
        // Ephemeral-Foto (View-Once) — Bild ist NICHT sichtbar, weder für uns
        // noch für die Stylistin. Bot muss ehrlich kommunizieren, NICHT raten.
        const customerText = (m.content || "").trim();
        // Wenn die Customer-Message NUR aus [Einmal-Foto …] besteht, ist das
        // Mitteilung an den Bot. Ansonsten ist Text dabei — den separat
        // beibehalten, aber klar markieren dass das Foto unsichtbar ist.
        const customerTextWithoutMarker = customerText.replace(/^\[Einmal-Foto[^\]]*\]\s*/i, "").replace(/^\[Foto\]\s*/i, "").trim();
        const hint = "[SYSTEM-HINWEIS — NICHT VOM KUNDEN]\nDie Kundin hat hier ein Foto als EINMAL-ANSICHT (View-Once) geschickt. Du KANNST dieses Bild NICHT sehen — die URL ist leer und auch die Stylistin kann es später nicht öffnen. NIEMALS so tun, als hättest du das Bild gesehen oder die Farbe einschätzen können. Bitte die Kundin freundlich, das Bild als normales Foto noch mal zu schicken.";
        if (customerTextWithoutMarker) {
          messages.push({ role: "user", content: hint + "\n\nKunden-Text (separat zum Foto): " + customerTextWithoutMarker });
        } else {
          messages.push({ role: "user", content: hint });
        }
      } else if (isExternalReply) {
        // Customer-Message ist eine Reply auf eine Nachricht, die wir nicht
        // im Verlauf haben. Bot muss freundlich um Klärung bitten statt zu
        // raten worum es geht.
        const externalHint = "[SYSTEM-HINWEIS — NICHT VOM KUNDEN]\nDiese Kundennachricht ist eine direkte Antwort auf eine FRÜHERE Nachricht, die NICHT in unserem Gesprächsverlauf ist (zu alt, Story-Reply oder vor unserer Aufzeichnung). Du weißt also NICHT auf welche konkrete vorherige Nachricht/Produkt/Frage sich die Kundin bezieht. NIEMALS raten oder annehmen.\n\nWenn die aktuelle Nachricht für sich allein verständlich ist (z.B. konkrete Bestellanfrage mit Farbnamen + Mengen), darfst du normal antworten. Wenn unklar bleibt worauf sie sich bezieht, frage freundlich nach — z.B.: 'Hi 💕 du beziehst dich auf eine ältere Nachricht — magst du mir kurz auf die Sprünge helfen, worum's konkret geht?'";
        messages.push({ role: "user", content: externalHint + "\n\nKunden-Nachricht: " + (m.content || "") });
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

  // SAFETY-NET 1tcm: URL-Color-Mismatch (TAUPE vs SMOKY TAUPE etc.)
  // Wenn Bot **TAUPE** sagt aber URL "smoky-taupe" enthält → URL strippen.
  finalText = stripColorUrlMismatch(finalText);

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
  // ABER: Wenn die Kundin EXPLIZIT nach Bildern/Videos gefragt hat, darf der
  // Bot reaktiv zustimmen.
  //
  // STRENGE VORAUSSETZUNG: in den letzten ~3 Customer-Messages muss explizit
  // nach Fotos/Videos/Bildern GEFRAGT worden sein (mit Frage-Verb wie "habt
  // ihr", "könnt ihr", "schickt ihr", "magst", "hättest").
  // Übergabe-Marker im Bot-Reply allein reicht NICHT — sonst kann der Bot
  // proaktiv "Farb-Expertin schickt dir extra Fotos" pushen, was verboten ist.
  {
    // Hat die Kundin in den letzten 3 Customer-Messages NACH Fotos/Videos GEFRAGT?
    const recentCustomerMsgs = (msgs || []).filter(m => m.role === "user").slice(-3);
    const customerAskedForPhotos = recentCustomerMsgs.some(m => {
      const txt = (m.content || "").toLowerCase();
      const hasMediaWord = /\b(fotos?|videos?|bilder|aufnahmen|aufnahme)\b/.test(txt);
      // Frage-Indikator: ? im Text ODER bittende Verben
      const hasQuestion = /\?/.test(txt) ||
        /\b(habt\s+ihr|hättet\s+ihr|hättest|könnt\s+ihr|könntet\s+ihr|magst|wäre.{0,20}möglich|gibt['e\s]+es|schickt\s+(mir|ihr))\b/i.test(txt);
      return hasMediaWord && hasQuestion;
    });

    const extraPhotoOfferPatterns: RegExp[] = [
      // "Wir können dir auch gerne extra Fotos oder Videos von ... machen"
      /(^|\n)[^\n]*\b(wir|ich)\b[^\n]{0,40}\b(können|kann|könnten|machen|mache|schicken|sende|filmen)\b[^\n]{0,80}\b(extra |zusätzliche? )?(fotos? (oder|und) videos?|videos? (oder|und) fotos?|extra fotos?|extra videos?)\b[^\n]*(\n|$)/gi,
      // "Magst du, dass unsere Farb-Expertin/Kollegin dir extra Fotos/Videos schickt?"
      /(^|\n)[^\n]*\bmagst\s+du[^\n]{0,80}\b(extra\s+)?(fotos?|videos?|bilder)\b[^\n]{0,40}\b(schickt?|schicken|sendet?|senden|machen?|aufnimmt)\b[^\n]*(\n|$)/gi,
      // "Ich kann dir ein Video von der Farbe schicken/machen"
      /(^|\n)[^\n]*\bich (kann|könnte) dir (ein |noch ein )?(video|extra foto)[^\n]*(\n|$)/gi,
      // "Wir filmen die Farbe"
      /(^|\n)[^\n]*\bwir filmen (dir |die )[^\n]*(\n|$)/gi,
    ];
    let dropped = false;
    for (const pat of extraPhotoOfferPatterns) {
      finalText = finalText.replace(pat, (match) => {
        if (customerAskedForPhotos) return match; // reaktiv OK
        dropped = true;
        return "\n";
      });
    }
    if (dropped) {
      console.warn("[respond] DROPPED proaktives Extra-Foto/Video-Angebot (Kundin hat NICHT explizit gefragt — siehe FAQ color-advice-no-proactive-extra-photos)");
      finalText = finalText.replace(/\n{3,}/g, "\n\n").trim();
    }
  }

  // SAFETY-NET 1w: Selbstreferenzielle Klammer-Disclaimer entfernen.
  // Der Bot fügt gerne am Ende sowas an wie:
  //   "_(Kurz: die exakte Längen-Methoden-Kombi muss ich dir nochmal sauber
  //    benennen — schreibe dir die Optionen gleich mit der Kollegin durch.)_"
  // Das ist unnötiges Meta-Geschwätz und verwirrt die Kundin. Strippen.
  {
    const selfReferentialDisclaimerPatterns: RegExp[] = [
      // Markdown-Italic-Klammer: "_(Kurz: ...)_" — auch ohne führende Newline
      /_\(\s*(kurz|hinweis|p\.?s\.?|nb)[:\s][^()]{0,400}\)_/gi,
      // Klammer ohne Italic-Marker: "(Kurz: ...)"
      /(?:^|\n)\s*\(\s*(kurz|hinweis|p\.?s\.?|nb)[:\s][^()]{0,400}\)\s*/gi,
      // ohne Klammern, mit "Kurz: die exakte X muss ich noch mit der Kollegin abklären"
      /(?:^|\n)\s*kurz:?\s+die\s+(exakte|genauen?|richtige[rn]?|finalen?)[^.\n]{0,250}\b(kolleg|stylistin|abklären|abstimmen|durchsprechen|nachfragen|nochmal|noch\s+mal)\b[^.\n]{0,150}\.?/gi,
      // "PS: ich muss das nochmal mit der Kollegin durchsprechen"
      /(?:^|\n)\s*p\.?\s*s\.?:?\s+[^.\n]{0,200}\b(kolleg|stylistin|abklären|abstimmen|durchsprechen)\b[^.\n]{0,150}\.?/gi,
      // Italic ohne Klammer: "_Kurz: ich muss das mit der Kollegin abklären._"
      /(?:^|\n)\s*_kurz:?\s+[^_\n]{0,300}\b(kolleg|stylistin|abklären|abstimmen|durchsprechen|nochmal|noch\s+mal)\b[^_\n]{0,150}_/gi,
    ];
    let strippedDisclaimer = false;
    for (const pat of selfReferentialDisclaimerPatterns) {
      const before = finalText;
      finalText = finalText.replace(pat, "");
      if (before !== finalText) strippedDisclaimer = true;
    }
    if (strippedDisclaimer) {
      console.warn("[respond] STRIPPED selbstreferenziellen Klammer-Disclaimer am Ende");
      finalText = finalText.replace(/\n{3,}/g, "\n\n").trim();
    }
  }

  // SAFETY-NET 1url: Farbnamen ohne URL → URL aus Tool-Results nachschlagen
  // und automatisch anhängen. Sonst muss die Kundin selbst suchen.
  try {
    // Sammle alle Color-Name → URL Paare aus den Tool-Results
    const colorUrlMap = new Map<string, string>();
    for (const result of allToolResults) {
      try {
        const parsed = JSON.parse(result.content) as Record<string, unknown>;
        // get_stock_eta liefert verschiedene Listen mit product+shopify_url
        const lists: Array<Record<string, unknown>[]> = [];
        for (const key of ["coming_soon", "still_coming", "sold_out_or_coming", "inventory_available", "variants"]) {
          const v = parsed[key];
          if (Array.isArray(v)) lists.push(v as Record<string, unknown>[]);
        }
        // get_available_colors liefert colors[]
        const colors = parsed.colors;
        if (Array.isArray(colors)) lists.push(colors as Record<string, unknown>[]);
        for (const list of lists) {
          for (const item of list) {
            const url = String(item.shopify_url || "");
            const product = String(item.product || item.name_shopify || "");
            const colorName = String(item.color_name || item.name_hairvenly || "");
            if (!url) continue;
            // Extrahiere Farbnamen aus Produkt- oder Color-Name (in Großbuchstaben)
            const candidates: string[] = [];
            if (colorName) candidates.push(colorName);
            // Aus product_shopify_name: "#COLDNESS - HELLBLOND ..." → "COLDNESS"
            const m = product.match(/^#?([A-ZÄÖÜ][A-ZÄÖÜ\s/+\-_0-9]{1,40})\s+[-–—]/);
            if (m) candidates.push(m[1].trim());
            // Auch nested variants[] mit eigenen URLs (get_available_colors)
            const variants = item.variants;
            if (Array.isArray(variants)) {
              for (const v of variants as Record<string, unknown>[]) {
                if (v.shopify_url) {
                  // Verwende selbe colorName für variant-URLs falls vorhanden
                  if (colorName) colorUrlMap.set(colorName.toUpperCase().trim(), String(v.shopify_url));
                }
              }
            }
            for (const c of candidates) {
              const key = c.toUpperCase().trim();
              if (key.length >= 3 && !colorUrlMap.has(key)) {
                colorUrlMap.set(key, url);
              }
            }
          }
        }
      } catch { /* skip */ }
    }

    if (colorUrlMap.size > 0) {
      let addedUrls = 0;
      // Pattern für hervorgehobene Farbnamen: **COLDNESS**, **ASH MELT**, *FROSTY* etc.
      // Match: Markdown-bold-Farbname am Anfang einer Liste-Zeile, ohne URL danach
      finalText = finalText.replace(
        /(^|\n)([•\-*]\s*)\*\*([A-ZÄÖÜ][A-ZÄÖÜ\s/+\-_0-9]{2,40})\*\*([^\n]*)/g,
        (match, prefix, bullet, colorName, rest) => {
          const key = colorName.toUpperCase().trim();
          const url = colorUrlMap.get(key);
          if (!url) return match;
          // Schon eine URL in rest? → unverändert lassen
          if (/https?:\/\//.test(rest)) return match;
          // Auch in den nächsten 2 Zeilen prüfen ob URL kommt
          const afterIdx = (match as string).length;
          const tail = finalText.slice(finalText.indexOf(match) + afterIdx, finalText.indexOf(match) + afterIdx + 200);
          if (/^\s*\n\s*https?:\/\//.test(tail)) return match;
          addedUrls++;
          return `${prefix}${bullet}**${colorName}**${rest}\n  ${url}`;
        }
      );
      if (addedUrls > 0) {
        console.warn(`[respond] AUTO-ADDED ${addedUrls} URL(s) zu Farb-Empfehlungen die der Bot ohne Link genannt hatte`);
      }
    }
  } catch (e) {
    console.warn("[respond] Farb-URL-Auto-Nachschlag fehlgeschlagen:", (e as Error).message);
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

  // SAFETY-NET 1m: FALSCHE NEGATIV-AUSSAGEN ÜBER METHODE × LINIE
  // Häufige Halluzination: Bot sagt "Genius Weft gibt's nur in russisch glatt,
  // nicht in usbekisch wellig" — aber Genius Weft existiert in BEIDEN Linien.
  // Wir prüfen jede solche Behauptung gegen die echte methodLines-Map.
  try {
    const ml = catalog.methodLines;
    // Methoden-Aliase (Wortform im Bot-Text → DB-Key)
    const aliases: Array<[RegExp, string]> = [
      [/\bgenius[\s-]?weft\b/gi, "genius weft"],
      [/\bgenius[\s-]?tressen\b/gi, "genius weft"],
      [/\bclassic[\s-]?tressen\b/gi, "classic tressen"],
      [/\bclassic[\s-]?weft\b/gi, "classic weft"],
      [/\binvisible[\s-]?weft\b/gi, "invisible weft"],
      [/\binvisible[\s-]?butterfly\b/gi, "invisible weft"],
      [/\bmini[\s-]?tapes?\b/gi, "minitapes"],
      [/\bstandard[\s-]?tapes?\b/gi, "standard tapes"],
      [/\btapes?\b/gi, "tapes"], // fallback (wird je nach Kontext gemappt)
      [/\bbondings?\b/gi, "bondings"],
      [/\bclip[\s-]?ins?\b/gi, "clip-ins"],
      [/\bponytails?\b/gi, "ponytail"],
    ];
    // Negativ-Behauptungs-Patterns über Linien
    // z.B. "Genius Weft gibt es leider nur in russisch glatt"
    //      "Genius Weft haben wir nicht in usbekisch wellig"
    //      "Genius Weft gibt's nur in der russisch-glatten Linie, nicht in usbekisch wellig"
    const lineNegativePatterns = [
      // "X gibt es leider nur in <line>"
      /\b([A-ZÄÖÜa-zäöü][a-zäöü\s-]{2,30}?)\s+gibt\s+(es\s+)?(leider\s+)?nur\s+in\s+(?:der\s+)?(russisch[\s-]?glatte?[rn]?|usbekisch[\s-]?wellige?[rn]?|glatt(?:en|er|e)?|wellig(?:en|er|e)?)\s+linie?/gi,
      // "X haben wir nur in <line>"
      /\b([A-ZÄÖÜa-zäöü][a-zäöü\s-]{2,30}?)\s+haben\s+wir\s+(leider\s+)?nur\s+in\s+(?:der\s+)?(russisch[\s-]?glatte?[rn]?|usbekisch[\s-]?wellige?[rn]?|glatt(?:en|er|e)?|wellig(?:en|er|e)?)/gi,
      // "X gibt es nicht in <line>"
      /\b([A-ZÄÖÜa-zäöü][a-zäöü\s-]{2,30}?)\s+gibt\s+es\s+(?:leider\s+)?nicht\s+in\s+(?:der\s+)?(russisch[\s-]?glatte?[rn]?|usbekisch[\s-]?wellige?[rn]?|glatt(?:en|er|e)?|wellig(?:en|er|e)?)/gi,
    ];

    const resolveMethod = (snippet: string): string | null => {
      // Aliase greifen lassen — nimm den ersten der matched
      const s = snippet.trim();
      for (const [re, key] of aliases) {
        if (re.test(s)) return key;
      }
      return null;
    };
    const resolveLine = (snippet: string): "russisch" | "usbekisch" | null => {
      const s = snippet.toLowerCase();
      if (/russisch|glatt/.test(s)) return "russisch";
      if (/usbekisch|wellig/.test(s)) return "usbekisch";
      return null;
    };

    let correctionInfo: string | null = null;
    for (const pat of lineNegativePatterns) {
      finalText = finalText.replace(pat, (match, methodSnippet, _l2, _l3, lineSnippet) => {
        // bei manchen Patterns gibt es ein leeres _l3 (das "leider")
        const ls = typeof _l3 === "string" && /russisch|usbekisch|glatt|wellig/i.test(_l3)
          ? _l3
          : lineSnippet;
        const methodKey = resolveMethod(methodSnippet);
        const negatedLine = resolveLine(ls);
        if (!methodKey || !negatedLine) return match;
        const actualLines = ml.get(methodKey);
        if (!actualLines) return match;

        // "X gibt es nur in Russisch glatt" — behauptet, dass es NICHT in usbekisch existiert
        // (oder umgekehrt)
        const otherLine = negatedLine === "russisch" ? "usbekisch" : "russisch";

        // Im "gibt es nicht in Y" Pattern ist negatedLine = Y (also die behauptet leere Linie)
        // Im "gibt es nur in Y" Pattern ist negatedLine = Y, andere = otherLine ist behauptet leer
        const isOnlyPattern = /\bnur\b/i.test(match);
        const claimedEmptyLine = isOnlyPattern ? otherLine : negatedLine;

        if (actualLines.has(claimedEmptyLine)) {
          // FALSCH! Methode existiert in der angeblich leeren Linie.
          const methodLabel = methodSnippet.trim();
          const lineLabel = claimedEmptyLine === "russisch" ? "Russisch glatt" : "Usbekisch wellig";
          correctionInfo = `${methodLabel} existiert auch in ${lineLabel}`;
          console.warn(`[respond] FALSE NEGATIVE METHOD-LINE: "${match}" — ${methodKey} existiert in BEIDEN Linien (${Array.from(actualLines).join(", ")})`);
          // Ersatz: Sicherheits-Variante
          return `${methodLabel} hätten wir tatsächlich in beiden Linien — lass mich kurz die richtigen Längen und Verfügbarkeiten raussuchen`;
        }
        return match;
      });
    }
    if (correctionInfo) {
      finalText = finalText.replace(/\n{3,}/g, "\n\n").trim();
    }
  } catch (e) {
    console.warn("[respond] Methode-Linie-Validator fehlgeschlagen:", (e as Error).message);
  }

  // SAFETY-NET 1eph: EPHEMERAL-HALLUZINATION
  // Wenn die letzten Customer-Messages ephemeral-Fotos (View-Once) enthielten,
  // darf der Bot NIE so tun, als hätte er das Bild gesehen. "Danke für deine
  // Fotos" / "Deine Haarfarbe schaut..." sind direkte Halluzinationen — wir
  // ersetzen den Eröffnungssatz durch eine ehrliche Variante.
  try {
    // Prüfe ob in den letzten 5 Customer-Messages eine ephemeral war
    const recentCustomerMsgs = (msgs || []).filter(m => m.role === "user").slice(-5);
    const sawEphemeralRecently = recentCustomerMsgs.some(m => {
      const att = (m.attachments as { type: string }[] | null) || [];
      return att.some(a => a.type === "ephemeral");
    });
    if (sawEphemeralRecently) {
      const hallucinationPatterns = [
        // "Danke für deine Fotos 💕" / "Danke für dein Bild 💕" am Anfang
        /^\s*(danke|vielen\s+dank)[^.\n]{0,30}\b(foto|fotos|bild|bilder)[^.\n]{0,20}[💕💌🤍✨🌸]*\s*\n+/i,
        // "Auf deinem Foto sehe ich" / "Deine Haarfarbe schaut" / "ich sehe ein wunderschönes ..."
        /\b(auf\s+deinem\s+foto\s+sehe\s+ich|ich\s+sehe[^.\n]{0,30}(haarfarbe|haar|farbe|braun|blond)|deine\s+haarfarbe\s+(schaut|sieht|ist)|dein\s+haar\s+(ist|sieht|schaut)|ich\s+kann\s+sehen)\b[^.\n]*\.?\s*\n?/gi,
      ];
      let stripped = false;
      for (const pat of hallucinationPatterns) {
        const before = finalText;
        finalText = finalText.replace(pat, "");
        if (before !== finalText) stripped = true;
      }
      if (stripped) {
        console.warn("[respond] STRIPPED ephemeral-Halluzination: Bot tat so als hätte er View-Once-Foto gesehen");
        // Einen ehrlichen Hinweis ans Anfang setzen
        const honestPrefix = "Dein Foto ist als Einmal-Ansicht geschickt — leider können wir das nicht sehen 🥲 Magst du es nochmal als normales Foto schicken? Dann kann unsere Farb-Expertin dir eine passende Empfehlung geben ✨\n\n";
        // Nur einfügen wenn der Reply noch substantiell ist (sonst kompletter Replace)
        finalText = honestPrefix + finalText.trim();
        finalText = finalText.replace(/\n{3,}/g, "\n\n").trim();
      }
    }
  } catch (e) {
    console.warn("[respond] ephemeral-Halluzinations-Sanitizer fehlgeschlagen:", (e as Error).message);
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

      // Erweiterte Verb-Liste — alles was eine Mitarbeiterin "gleich" tun
      // könnte: schauen/gucken/sehen/prüfen/checken/lesen, plus die alten
      // Meldungs-Verben. Pattern erlaubt jetzt bis zu 60 Zeichen zwischen
      // "sich" und "gleich" — damit Sätze wie
      // "Farb-Expertin schaut sich deine Fotos gleich persönlich an"
      // gematcht werden (vorher nicht — "deine Fotos" stand dazwischen).
      const replacements: Array<[RegExp, string]> = [
        // Variante A — Person + Verb + sich + (irgendwas) + gleich + (optional persönlich/an)
        // (z.B. "Farb-Expertin schaut sich deine Fotos gleich persönlich an"
        // wird komplett ersetzt durch "Farb-Expertin meldet sich [time] bei dir")
        [new RegExp(
          `\\b(meine\\s+|eine\\s+|unsere\\s+)?(kollegin|farb-?expertin|stylistin|mitarbeiterin|farb-?beraterin)\\s+` +
          `(meldet|schreibt|kommt|antwortet|kümmert|schaut|guckt|sieht|prüft|checkt|liest|bearbeitet|beantwortet)` +
          `\\s+sich(?:\\s+[^.!?\\n]{0,60})?\\s+(gleich|in\\s+kürze|sofort|in\\s+ein\\s+paar\\s+minuten)` +
          `(?:\\s+persönlich)?` +
          `(?:\\s+(an|für\\s+dich|für\\s+euch))?\\b`,
          "gi",
         ),
         `$1$2 meldet sich ${replacementLabel} bei dir`],
        // Variante B — Verb + dich/dir/euch + gleich
        [/\b(schreibe|melde|sage|antworte|kümmere)\s+(dir|euch|mich)\s+gleich(\s+mit\s+der\s+kollegin\s+durch)?/gi,
         `melde mich ${replacementLabel} bei dir`],
        // Variante C — "meldet sich gleich"
        [/\b(meldet\s+sich\s+(gleich|in\s+kürze|kurz)\s+(bei\s+dir|zurück|persönlich)?)/gi,
         `meldet sich ${replacementLabel} bei dir`],
        // Variante D — "schreibe dir gleich"
        [/\bschreibe?\s+(dir|euch)\s+(die\s+\w+\s+)?gleich(\s+durch)?/gi,
         biz2.status === "closed"
           ? `schreibe dir ${biz2.reason === "Wochenende" ? "Montag" : "morgen"} die Details`
           : `schreibe dir die Details noch heute oder spätestens ${biz2.nextOpenLabel}`],
        // Variante E — "schaut/guckt sich [...] gleich an" (Person implizit
        // — fängt Sätze ohne explizit genannte Person ab, z.B. wenn die
        // Person schon im Vorsatz erwähnt wurde)
        [/\b(schaut|guckt|sieht|prüft|checkt|liest)\s+sich\s+([^.!?\n]{0,60})\s+gleich\b/gi,
         `$1 sich $2 ${replacementLabel}`],
        // Variante F — Bare "gleich persönlich" / "gleich für dich"
        [/\bgleich\s+(persönlich|für\s+dich|für\s+euch)\b/gi,
         `${replacementLabel} $1`],
      ];
      for (const [re, repl] of replacements) {
        finalText = finalText.replace(re, repl);
      }
      // Post-Cleanup nach Replacement: "meldet sich X bei dir und meldet sich Y" → "meldet sich X bei dir mit Y"
      // (entsteht wenn das Pattern den Block + ein nachfolgendes "und meldet sich" parallel zueinander hat)
      finalText = finalText.replace(
        /meldet sich ([^.!?\n]{3,60}) bei dir\s+und\s+meldet sich(?:\s+mit)?\s+/gi,
        "meldet sich $1 bei dir mit ",
      );
      finalText = finalText.replace(
        /meldet sich ([^.!?\n]{3,60}) bei dir\.\s*([A-ZÄÖÜ][^.!?\n]{0,40})\s+meldet sich/gi,
        "meldet sich $1 bei dir. $2 meldet",
      );
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
      console.warn("[respond] METHOD×LENGTH mismatch detected (silent fix):", corrections.join("; "));
      // Stilles Korrigieren — validateMethodLengthCombos hat den Text bereits
      // bereinigt (falsche Kombi raus, URL gestrippt). KEIN Klammer-Disclaimer
      // anhängen — das wirkt unsicher und verwirrt die Kundin. Wenn der Text
      // nach der Korrektur zu kurz/inhaltsleer ist, übernimmt die Mitarbeiterin
      // beim Review.
      finalText = validatedText;
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

  // SAFETY-NET 3: Max 3 URLs pro Antwort. Mehr wirkt überladen und macht
  // Mitarbeiterin/Kundin nervös. Überzählige werden gestrippt.
  finalText = limitUrls(finalText, 3);

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
