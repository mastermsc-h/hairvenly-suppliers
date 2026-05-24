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
import { enforceBusinessFacts } from "./intent-contact";
import { applyAllOutputSanitizers } from "./output-sanitizers";

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
export async function applyPreLlmContext(
  systemPrompt: string,
  customerText: string,
  /**
   * Optional: letzte N Customer-Messages aus Session-History (für Folge-Fragen,
   * wo der relevante Keyword/Code nur in früheren Messages stand).
   */
  recentCustomerHistory?: string[]
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
