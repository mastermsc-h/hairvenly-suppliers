/**
 * SINGLE SOURCE OF TRUTH für alle Chatbot-Schutzschichten.
 *
 * Architektur-Prinzip (siehe CHATBOT_ARCHITECTURE.md §1.1 + §4):
 *   Statt zwei separater Pipelines (Webhook respond.ts + Web-Chat
 *   /api/chat/route.ts), die jeweils ihre eigenen Sanitizer-Reihenfolgen
 *   pflegen mussten, gibt es jetzt EIN Modul. Beide Routes rufen
 *   ausschließlich die hier exportierten Funktionen.
 *
 * Konsequenz: Wer einen NEUEN Schutz hinzufügen will (Sanitizer,
 * Pre-LLM-Injector, Validator), ändert EINE Datei. Beide Pipelines
 * erben automatisch. Drift unmöglich.
 *
 * NICHT enthalten (bewusst):
 *   - tool_result-spezifische Validators (ETA-Linien-Mismatch, Stock-Leak):
 *     die brauchen tool_results-Context, den nur respond.ts hat. Sie
 *     bleiben in respond.ts als „erweiterte Stufe". Web-Chat braucht
 *     sie nicht weil es keine vergleichbaren Tool-Aufrufe macht.
 *   - Contact-Intent-BYPASS (Template-Antwort statt LLM-Call): bleibt
 *     in jeder Route, weil das die GESAMTE Antwort ersetzt und kein
 *     LLM-Call mehr stattfindet.
 *
 * Die hier zentralisierten Schichten greifen IMMER, in BEIDEN Pipelines.
 */

import { buildColorCodeContext, validateNegativeClaims, type ColorCodeMatch } from "./intent-color-codes";
import { buildStockEtaContext } from "./intent-stock-eta";
import { enforceBusinessFacts } from "./intent-contact";
import { applyAllOutputSanitizers } from "./output-sanitizers";
import { detectDayQueries, buildDayQueryHint, type DayQueryMatch } from "./intent-day-query";
import { analyzeConversationReopen, buildConversationReopenHint, type ConversationReopenAnalysis } from "./intent-conversation-reopen";

/**
 * Context, der zwischen Pre-LLM und Post-LLM weitergegeben wird.
 * Hält alle Daten, die die Post-Sanitizer für Validation brauchen.
 */
export type ChatbotPipelineContext = {
  /** Original-Customer-Text — für Heuristiken (z.B. „hat Kundin Foto angefragt?") */
  customerText: string;
  /** Pre-LLM Color-Code-Matches — Validator vergleicht später Bot-Output dagegen */
  colorCodeMatches: ColorCodeMatch[];
  /** Optional: hat die Kundin EXPLIZIT nach Fotos gefragt? (reaktive Foto-Antworten erlaubt) */
  customerAskedForPhotos?: boolean;
  /** Optional: Farbnamen → Shopify-URL (für Auto-URL-Inject im Sanitizer) */
  colorUrlMap?: Map<string, string>;
  /** Pre-LLM Day-Query-Matches — Validator vergleicht später Bot-Output gegen
   *  die tatsächlichen offen/zu-Status der referenzierten Tage. */
  dayQueryMatches?: DayQueryMatch[];
  /** Pre-LLM Conversation-Reopen-Analyse — wenn isReopenWithoutText, soll
   *  der Post-LLM-Pfad Force-Draft setzen falls Bot trotzdem alte Themen
   *  reaktiviert (Preis-Berechnung, Produkt-Empfehlung mit Zahlen). */
  conversationReopen?: ConversationReopenAnalysis;
};

/**
 * Erkennt deterministisch ob die Kundin nach Fotos/Videos gefragt hat.
 * Heuristik: Frage-Verb + Medien-Wort in den letzten 1-2 Customer-Messages.
 *
 * Wird hier zentralisiert, damit beide Pipelines dieselbe Logik nutzen.
 */
export function detectCustomerAskedForPhotos(customerText: string): boolean {
  if (!customerText) return false;
  const t = customerText.toLowerCase();
  const hasMediaWord = /\b(foto|fotos|video|videos|bild|bilder|aufnahme|aufnahmen)\b/.test(t);
  if (!hasMediaWord) return false;
  // Frage-Verb in der Nähe?
  return /\b(kannst|könnt|könnt ihr|magst|hast|habt|schick|sendet|machst|zeig)\b/.test(t) ||
         /\?/.test(t);
}

/**
 * PRE-LLM CONTEXT-INJECTION.
 *
 * Läuft BEVOR der System-Prompt an Anthropic geht. Fügt verifizierte
 * DB-Fakten als System-Blöcke an, damit der Bot keine falschen Annahmen
 * mehr treffen kann („kenne ich nicht").
 *
 * Returns: erweiterter System-Prompt + Context-Handle, das später an
 * applyPostLlmSanitizers gegeben wird.
 *
 * Jeder neue Pre-LLM-Injector wird HIER eingebaut. Beide Pipelines
 * erben den Schutz automatisch.
 */
/**
 * Detect: hat die letzte Bot-/MA-Nachricht der Kundin eine Warteliste
 * angeboten ("Magst du, dass ich dich auf die Benachrichtigungsliste setze")
 * UND ist die aktuelle Kundinnen-Message ein klares JA?
 *
 * Wenn ja, soll der Bot SOFORT das create_reservation Tool aufrufen statt
 * nur einen Bestätigungstext zu schreiben (ohne Tool-Call wäre die
 * Warteliste-Versprechung leer).
 */
export function detectWaitlistConfirmation(
  customerText: string,
  lastBotMessage: string | null | undefined,
): boolean {
  if (!customerText || !lastBotMessage) return false;
  // Bot/MA hat Warteliste angeboten?
  const offerPattern = /\b(benachrichtigungsliste|warteliste|bescheid\s+geben|melden\s+uns?(\s+sobald)?|notiere\s+(ich\s+)?dich|merke\s+ich\s+(mir|für\s+dich)\s+vor)\b/i;
  if (!offerPattern.test(lastBotMessage)) return false;
  // 🛡 Bug 2026-05-30: Pattern matched auch Bestätigungen wie "Hab ich notiert
  // — wir melden uns sobald die da sind". Echtes Offer braucht Frage-Indikator
  // (magst du?, soll ich?, willst du?, ?). Wenn Frage-Indikator fehlt, ist's
  // eine Post-Confirm-Bestätigung — kein neues Offer → false. Plus: wenn die
  // Bot-Message bereits eine Confirm-Phrase enthält ("Hab ich notiert", "auf
  // die Liste gesetzt"), war der Reservierungs-Schritt schon abgeschlossen.
  const questionIndicatorRe = /(\?|\bmagst\s+du\b|\bwillst\s+du\b|\bsoll\s+ich\b|\bmöchtest\s+du\b|\bdarf\s+ich\b)/i;
  const confirmationRe = /\b(hab[\s']?(e\s+)?(ich|dich)?\s*(dich\s+)?(notiert|vorgemerkt|gespeichert|eingetragen|auf\s+(die|der)\s+(warte|benachrichtigungs)?liste)|trag[e]?\s+dich\s+ein|ist\s+notiert)/i;
  if (!questionIndicatorRe.test(lastBotMessage)) return false;
  if (confirmationRe.test(lastBotMessage)) return false;
  // Kundinnen-Antwort ist klares JA?
  // (kurz, affirmativ, keine offene Rückfrage)
  const t = customerText.trim().toLowerCase().replace(/[💕❤🩷✨🥰😊👍🙂🙏]/g, "").trim();
  if (t.length > 60) return false;  // zu lang → enthält wahrscheinlich neue Anfrage
  if (/\?/.test(t)) return false;   // Rückfrage, kein klares Ja
  const yesPatterns = [
    /^j+a+\b/i,                                  // "ja", "jaaa"
    /^gerne\b/i,
    /^perfekt\b/i,
    /^super\b/i,
    /^okay?\b/i,
    /^klar\b/i,
    /^bitte\b/i,
    /\boh\s+ja\b/i,
    /\bwäre\s+(super|gut|toll|nice|cool)\b/i,
    /\bsehr\s+gerne\b/i,
    /\bauf\s+jeden\s+fall\b/i,
    /\bja\s+(bitte|gerne|super)/i,
    /\b(yes|ok|okidoki|deal)\b/i,
    // Order-Intent-Phrasen — die Kundin signalisiert „ich will sie haben"
    // (Sibling-Sweep 2026-05-27: ohne diese Patterns blieb create_reservation
    //  bei Sätzen wie "Bestelle mir die dann direkt" aus)
    /\bbestell[\s\w]{0,10}\bmir\b/i,             // "bestelle mir", "bestell mir"
    /\b(nehm|nimm)[\s\w]{0,5}\sich\b/i,          // "nehm ich", "nimm ich"
    /\bkauf[\sw]*\sich\b/i,                       // "kaufe ich", "kauf ich"
    /\bmöcht[a-z]*\s+(sie|die|ich)\b.{0,20}\b(kauf|bestell|haben|nehm)/i,
    /\bsetz(\sdu|t\sdu)?\s+mich\s+(drauf|auf\s+die\s+liste)/i, // "setz mich drauf"
    /\bgib\s+(mir|bescheid)/i,                   // "gib mir bescheid"
    /\bhalt\s+mich\s+auf\s+dem\s+laufenden/i,
    /\bbenachrichtig\s+mich/i,
  ];
  return yesPatterns.some(p => p.test(t));
}

export async function applyPreLlmContext(
  systemPrompt: string,
  customerText: string,
  /**
   * Optional: letzte N Customer-Messages aus Session-History (für Folge-Fragen,
   * wo der relevante Keyword/Code nur in früheren Messages stand).
   */
  recentCustomerHistory?: string[],
  /**
   * Optional: letzte Bot-/MA-Nachricht — für Waitlist-Confirmation-Detection
   * (Bot bot Warteliste an, Kundin sagt ja → instruiere create_reservation).
   */
  lastBotMessage?: string | null,
  /**
   * Optional: vollständige Session-Messages (chronologisch, oldest first) mit
   * role + content + created_at — für Conversation-Reopen-Detection.
   * Wenn nicht übergeben, wird Reopen-Check übersprungen.
   */
  recentMsgsTyped?: Array<{ role: "user" | "assistant" | "human_agent" | "system"; content: string | null; created_at: string }>,
): Promise<{
  /** Unveränderter stable systemPrompt — geht in den GECACHTEN Block */
  systemPrompt: string;
  /**
   * Dynamische Hints, die PRO Customer-Frage variieren (Color-Code-Lookup-
   * Treffer etc.). Caller MUSS diesen Teil als SEPARATEN, UNCACHED Block
   * an Anthropic schicken — sonst zerschießt es bei jeder Anfrage den
   * Cache des stable-Blocks.
   *
   * Architektur-Note (CHATBOT_ARCHITECTURE.md §1.1): jeder dynamische
   * Inhalt MUSS hier raus, nicht in systemPrompt mergen.
   */
  dynamicHint: string;
  ctx: ChatbotPipelineContext;
}> {
  const ctx: ChatbotPipelineContext = {
    customerText,
    colorCodeMatches: [],
    customerAskedForPhotos: detectCustomerAskedForPhotos(customerText),
  };

  // Konkateniere Conversation-Context für die Detection.
  const detectionBuffer = recentCustomerHistory && recentCustomerHistory.length > 0
    ? [...recentCustomerHistory, customerText].filter(Boolean).join("\n\n")
    : customerText;

  let dynamicHint = "";

  // ── 🎨 COLOR-CODE-INJECTOR ──────────────────────────────────────
  try {
    const { hint, matches } = await buildColorCodeContext(detectionBuffer);
    ctx.colorCodeMatches = matches;
    if (hint) {
      dynamicHint += "\n\n" + hint + "\n";
    }
  } catch (e) {
    console.warn("[pipeline] color-code-injector error:", e);
  }

  // ── 📦 STOCK+ETA-INJECTOR ──────────────────────────────────────
  // Für jeden detected Color-Code: aktuellen Lager-/ETA-Status aus dem
  // Dashboard-Sheet mit-injecten. Damit kennt der Bot konkrete ETAs
  // (z.B. "25.06.2026") und muss nicht selber 2-8-Wochen-Antworten
  // erfinden oder das get_stock_eta-Tool nachträglich aufrufen.
  if (ctx.colorCodeMatches.length > 0) {
    try {
      const stockHint = await buildStockEtaContext(ctx.colorCodeMatches, detectionBuffer);
      if (stockHint) {
        dynamicHint += "\n\n" + stockHint + "\n";
      }
    } catch (e) {
      console.warn("[pipeline] stock-eta-injector error:", e);
    }
  }

  // ── 📋 WAITLIST-CONFIRMATION-INJECTOR ───────────────────────────
  // Bot hat in der letzten Nachricht Warteliste/Benachrichtigung angeboten,
  // Kundin hat JA gesagt → der Bot MUSS jetzt das create_reservation Tool
  // aufrufen. Ohne dieses Hint vergisst der LLM manchmal den Tool-Call und
  // schreibt nur "Hab ich notiert" — die Reservierung existiert dann gar
  // nicht in der DB. User-Bug 2026-05-27.
  if (detectWaitlistConfirmation(customerText, lastBotMessage)) {
    dynamicHint += "\n\n🚨 WAITLIST-CONFIRMATION DETECTED:\n" +
      "Die Kundin hat soeben ZUGESTIMMT zu deinem Warteliste-Angebot " +
      "(\"" + (lastBotMessage || "").slice(0, 120).replace(/"/g, "'") + "...\").\n" +
      "DU MUSST JETZT das `create_reservation` Tool aufrufen — mit den Produkten/" +
      "Farben/Längen aus dem bisherigen Verlauf. Wenn mehrere Farben besprochen " +
      "wurden: alle in EINEM Tool-Call über das products-Array. " +
      "Nach erfolgreichem Tool-Call antworte SEHR KURZ: " +
      "'Hab ich notiert — wir melden uns sobald sie da sind 💕'. " +
      "OHNE Tool-Call ist diese Bestätigung eine LEERE Zusage, die nirgends " +
      "gespeichert wird. NICHT vergessen!\n";
  }

  // ── 📅 DAY-QUERY-INJECTOR ───────────────────────────────────────
  // Kundin fragt nach "morgen", "übermorgen", einem Wochentag oder dem
  // Wochenende → deterministisch berechnen ob OFFEN oder ZU und als
  // Hint injizieren. Verhindert Bug 2026-05-29 (Freitag, Bot bestätigt
  // "morgen 10-18 offen" obwohl morgen Samstag). Sibling-Sweep: deckt
  // morgen/übermorgen/heute/Wochentage/Wochenende in einem Pass ab.
  try {
    const dayMatches = detectDayQueries(detectionBuffer);
    if (dayMatches.length > 0) {
      ctx.dayQueryMatches = dayMatches;
      const dayHint = buildDayQueryHint(dayMatches);
      if (dayHint) dynamicHint += dayHint;
    }
  } catch (e) {
    console.warn("[pipeline] day-query-injector error:", e);
  }

  // ── 🔄 CONVERSATION-REOPEN-DETECTOR ─────────────────────────────
  // Erkennt: letzte Customer-Msg ist attachment/emoji-only UND Gap zur
  // letzten Text-Customer-Msg > 48h → Bot soll alte unbeantwortete
  // Sach-Themen (Preis/Verfügbarkeit) NICHT automatisch reaktivieren.
  // Verhindert Bug 2026-05-30: Bot reaktiviert 9 Tage alte Preis-Frage
  // weil Kundin nur [Foto] schickt.
  if (recentMsgsTyped && recentMsgsTyped.length > 0) {
    try {
      const reopen = analyzeConversationReopen(recentMsgsTyped);
      if (reopen.isReopenWithoutText) {
        ctx.conversationReopen = reopen;
        const hint = buildConversationReopenHint(reopen);
        if (hint) dynamicHint += hint;
      }
    } catch (e) {
      console.warn("[pipeline] conversation-reopen-detector error:", e);
    }
  }

  // ── 📦 STOCK-INJECTOR (TODO) — wenn gebaut, dynamicHint ergänzen
  // ── 👩 STYLISTINNEN-INJECTOR (TODO) — wenn gebaut, dynamicHint ergänzen

  return { systemPrompt, dynamicHint, ctx };
}

/**
 * POST-LLM SANITIZER PIPELINE.
 *
 * Läuft NACH dem LLM-Output. Korrigiert / strippt Halluzinationen
 * mit DB-Fakten (aus ctx) und Universal-Regeln (Markdown-Strip,
 * Redundanz-Strip, etc.).
 *
 * Returns: korrigierter Text + Flag ob sich was geändert hat
 * (damit die Pipeline ein Stream-Korrektur-Event senden kann, falls
 * der ungereinigte Text bereits an den Client gestreamt wurde).
 *
 * Reihenfolge (BEWUSST gewählt):
 *   1. enforceBusinessFacts  — Adresse/Phone/Mail/Hours gegen Config
 *   2. validateNegativeClaims — falsche „X gibt es nicht"-Lügen strippen
 *   3. applyAllOutputSanitizers — Universal-Sanitizer-Chain
 *
 * Jeder neue Post-LLM-Sanitizer wird HIER eingebaut. Beide Pipelines
 * erben den Schutz automatisch.
 */
export function applyPostLlmSanitizers(
  text: string,
  ctx: ChatbotPipelineContext
): { text: string; changed: boolean } {
  const original = text;
  let out = text;

  // ── 1) BUSINESS-FAKTEN (Adresse/Phone/Mail) ─────────────────────
  try {
    const enforced = enforceBusinessFacts(out);
    out = enforced.text;
  } catch (e) {
    console.warn("[pipeline] enforceBusinessFacts error:", e);
  }

  // ── 2) NEGATIVE-CLAIM-VALIDATOR ─────────────────────────────────
  // „Tape 65cm gibt es nicht in 2T18A" obwohl DB sagt: es existiert
  // → Bot lügt → wir strippen die Lüge.
  if (ctx.colorCodeMatches.length > 0) {
    try {
      out = validateNegativeClaims(out, ctx.colorCodeMatches);
    } catch (e) {
      console.warn("[pipeline] validateNegativeClaims error:", e);
    }
  }

  // ── 3) UNIVERSAL-SANITIZER-CHAIN ────────────────────────────────
  // Inkludiert:
  //   - stripSelfReferentialDisclaimer (Klammer-Disclaimer am Ende)
  //   - stripProactivePhotoOffer (nur reaktiv erlaubt)
  //   - scrubWeekendTrap, scrubClosedHandover (Geschäftszeit-aware)
  //   - scrubSupplierNames (Amanda/Eyfel-Tabu)
  //   - stripColorUrlMismatch (TAUPE vs SMOKY TAUPE)
  //   - autoAddColorUrls (Farbnamen → Shopify-URL)
  //   - limitUrls (max 3 URLs/Antwort)
  //   - stripRedundantFollowupQuestion (keine "Welche X?" nach exhaustiver Liste)
  //   - stripMarkdownFormatting (kein **Bold**, kein _italic_)
  //   - emDashBrake (Em-Dash-Tic begrenzen)
  try {
    out = applyAllOutputSanitizers(out, {
      customerAskedForPhotos: ctx.customerAskedForPhotos === true,
      colorUrlMap: ctx.colorUrlMap,
    });
  } catch (e) {
    console.warn("[pipeline] applyAllOutputSanitizers error:", e);
  }

  return { text: out, changed: out !== original };
}
