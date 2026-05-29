/**
 * Pre-LLM Stock+ETA Injector — strukturelle Lösung gegen
 * "Bot kennt das Lager nicht und schwammt mit '2-8 Wochen' rum,
 *  obwohl Dashboard konkretes ETA 25.06.2026 zeigt".
 *
 * Architektur-Prinzip (siehe CHATBOT_ARCHITECTURE.md §1.1):
 *   Pre-LLM-Inject statt LLM-Decide.
 *
 *   Wenn die Kundin einen konkreten Farbcode (z.B. 5P18A) erwähnt, hat
 *   der Bot durch den Color-Code-Injector bereits die Liste der Varianten.
 *   Aber er kennt NICHT deren aktuellen Stock-Status — also fragt er das
 *   get_stock_eta-Tool. Wenn er dabei die Länge weglässt → multi_length_
 *   results → Bot kapituliert → schwammige Antwort.
 *
 *   Lösung: bereits beim Color-Code-Match den AKTUELLEN Stock-Status +
 *   ETA pro Variante mit-injizieren. Der Bot hat dann die Antwort direkt
 *   im Prompt und muss das Tool nicht mal mehr aufrufen.
 *
 * Source of Truth:
 *   readDashboardAlerts() liest das Google Sheet "Dashboard"-Tab.
 *   Diese Funktion verkapselt:
 *     - nullbestand (lagerG=0 ohne Nachschub bzw. mit perOrder ETAs)
 *     - kritisch (lagerG niedrig)
 *     - unterwegs (Bestellungen in Anlieferung mit Ankunft-Datum)
 *
 * Caching:
 *   60s in-Memory-Cache, damit jeder LLM-Call nicht das Sheet hammered.
 *   Sheet wird ohnehin nur alle paar Minuten aktualisiert.
 *
 * Sibling-Sweep (welche verwandten Fälle deckt das ab):
 *   - "2-8 Wochen" Vagueness → ersetzt durch konkretes ETA
 *   - "ausverkauft" ohne ETA → ETA wird mitgeliefert wenn vorhanden
 *   - Bot fragt get_stock_eta mit fehlender Länge → multi_length_results
 *     → schwammige Antwort. Mit Pre-Inject wird der Tool-Call überflüssig.
 *   - Bot kennt die richtige Länge nicht obwohl Kundin sie nannte → wir
 *     listen ALLE Längen und kennzeichnen die genannte als "← Kundinnen-
 *     gewünschte Länge".
 *
 * Defensive:
 *   - DB-/Sheet-Fehler → null zurückgeben, kein Crash
 *   - Bei 0 Matches: nichts injecten (kein Noise im Prompt)
 *   - Cache-Miss bei Sheet-Down: stiller Fallback, Bot ruft Tool wie
 *     bisher (zero-regression-Garantie)
 */
import { readDashboardAlerts, type AlertProduct } from "@/lib/stock-sheets";
import { fetchOrderIdByName } from "@/lib/order-name-map";
import { filterArchivedFromStock } from "@/lib/filter-archived-orders";
import type { ColorCodeMatch } from "./intent-color-codes";

// ── In-Memory-Cache für Dashboard-Daten ─────────────────────────────
type DashboardSnapshot = {
  nullbestand: AlertProduct[];
  kritisch: AlertProduct[];
  unterwegs: AlertProduct[];
  lastUpdated: string | null;
};

let dashboardCache: DashboardSnapshot | null = null;
let dashboardCachedAt = 0;
const DASHBOARD_CACHE_TTL_MS = 60 * 1000; // 60s — Sheet wird alle paar Min upgedated

async function getCachedDashboard(): Promise<DashboardSnapshot | null> {
  const now = Date.now();
  if (dashboardCache && now - dashboardCachedAt < DASHBOARD_CACHE_TTL_MS) {
    return dashboardCache;
  }
  try {
    // Apply the same DB-overrides as the dashboard stock views:
    //   - drop archived orders (stocked/cancelled) from perOrder
    //   - replace sheet ankunft with the precise ETA from DB
    //     (per-position eta > shipment eta > order eta)
    const [result, orderIdByName] = await Promise.all([
      readDashboardAlerts(),
      fetchOrderIdByName(),
    ]);
    dashboardCache = {
      nullbestand: filterArchivedFromStock(result.nullbestand, orderIdByName),
      kritisch: filterArchivedFromStock(result.kritisch, orderIdByName),
      unterwegs: filterArchivedFromStock(result.unterwegs, orderIdByName).filter(
        (d) => d.unterwegsG > 0,
      ),
      lastUpdated: result.lastUpdated,
    };
    dashboardCachedAt = now;
    return dashboardCache;
  } catch (e) {
    console.warn("[stock-eta-inject] dashboard fetch error:", (e as Error).message);
    return dashboardCache; // alten Cache zurückgeben statt null, wenn vorhanden
  }
}

/**
 * Manueller Cache-Invalidate (z.B. nach Sheet-Sync via Apps Script).
 */
export function invalidateDashboardCache(): void {
  dashboardCache = null;
  dashboardCachedAt = 0;
}

// ── Variant-Status pro Color-Code-Variante ──────────────────────────
type VariantStatus = {
  /** Wie im Color-Code-Hint formatiert: "Tapes 55cm" */
  label: string;
  /** Aus product_colors-Lookup: Linie ("Russisch glatt" | "Usbekisch wellig") */
  line: string;
  /** Status der Variante: */
  status:
    | "in_stock"           // Lager > 0, kein Engpass
    | "in_stock_low"       // Lager > 0 aber niedrig (kritisch)
    | "out_of_stock_eta"   // Lager = 0 ABER Unterwegs mit ETA
    | "out_of_stock_no_eta" // Lager = 0 UND kein Unterwegs
    | "unknown";            // Variant nicht im Dashboard gefunden
  /** Frühestes ETA-Datum (DE-Format dd.mm.yyyy) wenn unterwegs */
  earliest_eta?: string;
  /** Roh-Produkt aus Sheet für Audit */
  matched_product?: string;
};

/**
 * Heuristik: matched ein AlertProduct die gewünschte Variante (line + method + length)?
 *
 * Eingabe-Beispiel: variant = { method: "Tapes", line: "Usbekisch wellig", length: "55cm" }
 * Sheet-Produktname: "#5P18A ASCHIG GESTRÄHNTE US WELLIGE TAPE EXTENSIONS 55CM ♡"
 *                    collection: "Tapes Wellig 55cm"
 *
 * Wir prüfen:
 *   - Linie via collection/product-Lower (russisch/glatt vs usbekisch/wellig/us)
 *   - Method-Wurzel (tape, bond, weft, tresse, clip, ponytail, genius, minitape)
 *   - Länge als "55cm" als Substring
 *   - Color-Code als Substring (case-insensitive)
 */
function variantMatchesAlertProduct(
  variant: { method: string; line: string; length: string },
  code: string,
  ap: AlertProduct
): boolean {
  const hay = `${ap.collection} ${ap.product}`.toLowerCase();
  // (a) Color-Code muss vorkommen
  if (!hay.includes(code.toLowerCase())) return false;
  // (b) Linie muss passen
  const isRussLine = variant.line.toLowerCase().includes("russ") || variant.line.toLowerCase().includes("glatt");
  const isUsbekLine = variant.line.toLowerCase().includes("usbek") || variant.line.toLowerCase().includes("wellig");
  const hayIsRuss = /\b(russ|glatt)/.test(hay);
  const hayIsUsbek = /\b(usbek|us\s|wellig)/.test(hay);
  if (isRussLine && !hayIsRuss) return false;
  if (isUsbekLine && !hayIsUsbek) return false;
  // (c) Länge muss passen (numerische Substring-Check)
  if (variant.length) {
    const lenNum = variant.length.replace(/cm/i, "");
    if (lenNum && !new RegExp(`\\b${lenNum}\\s*cm\\b`, "i").test(hay)) {
      // Russisch glatt hat keine cm-Angabe im Sheet-Namen — Konvention 60cm
      const expectsRussImplicit = isRussLine && (variant.length === "60cm" || lenNum === "60");
      if (!expectsRussImplicit) return false;
    }
  }
  // (d) Method-Wurzel muss passen
  const methodLower = variant.method.toLowerCase();
  const methodAliases: Array<[RegExp, RegExp]> = [
    // [variantMethodPattern, sheetHayPattern]
    [/\bmini\s*tape/i, /\bmini\s*-?\s*tape/i],
    [/\bstandard\s*tape|^tape/i, /\btape\b/i],
    [/\bbond/i, /\bbonding/i],
    [/\bclassic\s*tresse|^tresse/i, /\btresse\b/i],
    [/\bclassic\s*weft/i, /\bclassic\s*weft\b/i],
    [/\binvisible\s*weft/i, /\binvisible\s*weft\b/i],
    [/\bgenius\s*weft/i, /\bgenius\s*(weft|tresse)\b/i],
    [/\bclip[\s-]?in/i, /\bclip[\s-]?in/i],
    [/\bponytail/i, /\bponytail\b/i],
  ];
  for (const [vp, hp] of methodAliases) {
    if (vp.test(methodLower)) {
      return hp.test(hay);
    }
  }
  // Fallback: erstes Method-Wort als Substring
  const firstWord = methodLower.split(/\s+/)[0];
  if (firstWord.length >= 4 && hay.includes(firstWord)) return true;
  return false;
}

/**
 * Extrahiert das früheste perOrder-ETA-Datum eines AlertProduct als
 * deutsches Datum dd.mm.yyyy (oder null wenn keins).
 */
function earliestEtaOf(ap: AlertProduct): string | null {
  if (!ap.perOrder || ap.perOrder.length === 0) return null;
  const dated = ap.perOrder.map(o => {
    const m = (o.ankunft || "").match(/(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})/);
    if (!m) return { iso: null as string | null, text: o.ankunft || "" };
    const [, d, mo, y] = m;
    const yy = y.length === 2 ? `20${y}` : y;
    const iso = `${yy}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
    const text = `${d.padStart(2, "0")}.${mo.padStart(2, "0")}.${yy}`;
    return { iso, text };
  });
  dated.sort((a, b) => (a.iso || "9999").localeCompare(b.iso || "9999"));
  return dated[0]?.text || null;
}

/**
 * Für jede Color-Code-Match-Variante den aktuellen Stock-Status aus dem
 * Dashboard ermitteln.
 *
 * Returns: gleiche Struktur wie input, aber pro Variante ein status-Feld.
 */
export async function enrichVariantsWithStock(
  matches: ColorCodeMatch[]
): Promise<Map<string, VariantStatus[]>> {
  const out = new Map<string, VariantStatus[]>();
  if (matches.length === 0) return out;
  const dash = await getCachedDashboard();
  if (!dash) return out;

  for (const m of matches) {
    if (!m.found || !m.variants || m.variants.length === 0) continue;
    const statuses: VariantStatus[] = [];
    for (const v of m.variants) {
      const label = `${v.method} ${v.length}`.trim();

      // Suche in jeder Section des Dashboards
      const findIn = (list: AlertProduct[]): AlertProduct | undefined =>
        list.find(ap => variantMatchesAlertProduct(v, m.code, ap));

      const inUnterwegs = findIn(dash.unterwegs);
      const inKritisch = findIn(dash.kritisch);
      const inNullbestand = findIn(dash.nullbestand);

      let status: VariantStatus["status"] = "unknown";
      let earliest: string | undefined;
      let matchedProduct: string | undefined;

      // Entscheidungs-Reihenfolge:
      //   1. Unterwegs mit lagerG=0 → out_of_stock_eta (ETA aus perOrder)
      //   2. Nullbestand (ohne unterwegs) → out_of_stock_no_eta
      //   3. Kritisch → in_stock_low
      //   4. Unterwegs mit lagerG>0 → in_stock (mit Nachschub-Hinweis)
      if (inNullbestand && inUnterwegs) {
        status = "out_of_stock_eta";
        earliest = earliestEtaOf(inUnterwegs) || undefined;
        matchedProduct = inNullbestand.product;
      } else if (inNullbestand) {
        status = "out_of_stock_no_eta";
        matchedProduct = inNullbestand.product;
      } else if (inKritisch) {
        status = inKritisch.lagerG > 0 ? "in_stock_low" : "out_of_stock_no_eta";
        matchedProduct = inKritisch.product;
      } else if (inUnterwegs) {
        // Wenn lagerG>0 → in_stock; sonst out_of_stock_eta (unterwegs ohne Lager)
        if (inUnterwegs.lagerG > 0) {
          status = "in_stock";
        } else {
          status = "out_of_stock_eta";
          earliest = earliestEtaOf(inUnterwegs) || undefined;
        }
        matchedProduct = inUnterwegs.product;
      }

      statuses.push({
        label,
        line: v.line,
        status,
        earliest_eta: earliest,
        matched_product: matchedProduct,
      });
    }
    out.set(m.code.toUpperCase(), statuses);
  }
  return out;
}

/**
 * Baut den Hint-Text für den Pre-LLM-Inject. Wird in den dynamicHint-Block
 * angehängt (NICHT in den stable systemPrompt — wegen Cache-Stabilität).
 *
 * Gibt null zurück wenn nichts zu sagen ist (alle "unknown").
 */
export function buildStockEtaHint(
  enriched: Map<string, VariantStatus[]>,
  requestedLengthCm: number | null
): string | null {
  if (enriched.size === 0) return null;
  // Filter nur Codes mit aussagekräftigen Status
  const lines: string[] = [];
  let anyMeaningful = false;
  lines.push("## 📦 LIVE-LAGER + ETA (deterministisch aus Stock-Sheet — VERBINDLICH)");
  lines.push("");
  for (const [code, statuses] of enriched) {
    const meaningful = statuses.filter(s => s.status !== "unknown");
    if (meaningful.length === 0) continue;
    anyMeaningful = true;
    lines.push(`**${code}** — aktueller Stock + Nachschub:`);
    for (const s of meaningful) {
      const isRequested = requestedLengthCm != null && s.label.toLowerCase().includes(`${requestedLengthCm}cm`);
      const marker = isRequested ? "  ← Kundinnen-gewünschte Länge" : "";
      switch (s.status) {
        case "in_stock":
          lines.push(`  - ${s.line} ${s.label}: AUF LAGER (sofort verfügbar)${marker}`);
          break;
        case "in_stock_low":
          lines.push(`  - ${s.line} ${s.label}: AUF LAGER, aber Vorrat geht zur Neige${marker}`);
          break;
        case "out_of_stock_eta":
          lines.push(`  - ${s.line} ${s.label}: AUSVERKAUFT, Nachschub kommt ca. ${s.earliest_eta || "bald"}${marker}`);
          break;
        case "out_of_stock_no_eta":
          lines.push(`  - ${s.line} ${s.label}: AUSVERKAUFT, kein bestätigtes Lieferdatum${marker}`);
          break;
        default:
          break;
      }
    }
    lines.push("");
  }
  if (!anyMeaningful) return null;
  lines.push("**REGELN für deine Antwort:**");
  lines.push("1. Diese Stock+ETA-Daten sind LIVE aus dem System. Sie überschreiben alles was du sonst denkst.");
  lines.push("2. Wenn AUSVERKAUFT + ETA da steht: nenne das konkrete Datum (z.B. \"kommt ca. 25.06.2026 wieder\"). NIEMALS schwammig \"2-8 Wochen\" oder \"in ein paar Wochen\" sagen, wenn ein konkretes Datum oben steht.");
  lines.push("3. Wenn AUSVERKAUFT ohne ETA: ehrlich sagen \"aktuell ausverkauft, kein bestätigtes Lieferdatum\". Frag was sie als Nächstes braucht oder biete Warteliste an.");
  lines.push("4. Wenn AUF LAGER: kurz \"haben wir da\" — KEINE konkreten Mengen nennen.");
  lines.push("5. Wenn die Kundin eine spezifische Länge erwähnt hat: antworte FOKUSSIERT zu DIESER Länge (mit ← markiert). Zähle nicht alle anderen Längen unnötig auf.");
  lines.push("6. Wenn du diese Live-Daten nutzt, brauchst du get_stock_eta NICHT mehr separat aufzurufen — das wäre Token-Verschwendung.");
  return lines.join("\n");
}

/**
 * Extrahiert die gewünschte Länge aus dem Customer-Text + History.
 * Pattern: "55cm", "55 cm", "in 55", "für 55cm", "länge 55"
 * Bei mehreren Treffern: die zuletzt erwähnte (= aktuellste Anfrage).
 */
export function extractRequestedLengthCm(text: string): number | null {
  if (!text) return null;
  // Sammele alle cm-Angaben
  const matches = [...text.matchAll(/\b(\d{2,3})\s*cm\b/gi)];
  if (matches.length === 0) {
    // Auch ohne "cm" Suffix: "in 55", "für 65", "länge 85"
    const noCm = [...text.matchAll(/\b(?:in|für|fuer|länge|laenge|will|brauche|hätte)\s+(\d{2,3})\b/gi)];
    if (noCm.length === 0) return null;
    const last = noCm[noCm.length - 1];
    const n = parseInt(last[1], 10);
    return [45, 55, 60, 65, 85].includes(n) ? n : null;
  }
  // Letztes cm-Match nehmen
  const last = matches[matches.length - 1];
  const n = parseInt(last[1], 10);
  return [45, 55, 60, 65, 85].includes(n) ? n : null;
}

/**
 * One-Shot-Helper: aus matches + Customer-Text → Hint-String (oder null).
 */
export async function buildStockEtaContext(
  matches: ColorCodeMatch[],
  customerText: string
): Promise<string | null> {
  if (matches.length === 0) return null;
  try {
    const enriched = await enrichVariantsWithStock(matches);
    const reqLen = extractRequestedLengthCm(customerText);
    return buildStockEtaHint(enriched, reqLen);
  } catch (e) {
    console.warn("[stock-eta-inject] buildStockEtaContext error:", (e as Error).message);
    return null;
  }
}
