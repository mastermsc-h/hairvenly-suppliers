/**
 * Chatbot-Tools: was Ava aufrufen kann.
 *
 * Jedes Tool hat:
 * - schema: was Claude weiß (Name, Beschreibung, Input)
 * - execute: was tatsächlich passiert
 *
 * Neue Tools hinzufügen = einfach hier registrieren.
 */
import type Anthropic from "@anthropic-ai/sdk";
import { createServiceClient } from "@/lib/supabase/server";
import { calcPacks, type Method, type PriceRow } from "@/lib/chatbot/pricing";
import { readDashboardAlerts, readInventorySheet } from "@/lib/stock-sheets";
import { fetchOrderIdByName } from "@/lib/order-name-map";
import { filterArchivedFromStock } from "@/lib/filter-archived-orders";
import { BUSINESS_CONFIG } from "@/lib/chatbot/business-config";

export interface ToolContext {
  sessionId: string;
  signatureName: string;
}

export interface ToolResult {
  output: string;
  meta?: Record<string, unknown>;
}

type ToolDef = {
  schema: Anthropic.Tool;
  execute: (input: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>;
};

// ── get_price ───────────────────────────────────────────────────────────────
const getPrice: ToolDef = {
  schema: {
    name: "get_price",
    description:
      "Berechnet den Preis für Haarverlängerungen. Nutze IMMER dieses Tool bei Preisanfragen — niemals selbst rechnen. " +
      "Gibt Anzahl Packungen, Gesamtgramm und Endpreis zurück.",
    input_schema: {
      type: "object",
      properties: {
        method: {
          type: "string",
          enum: ["tape", "mini_tape", "bondings", "tressen", "genius_weft", "invisible_tape", "clip_in", "ponytail"],
          description: "Befestigungsmethode",
        },
        length_cm: {
          type: "number",
          description: "Gewünschte Länge in cm (60 für russisch, 45/55/65/85 für usbekisch). Bei Clip-in/Ponytail egal.",
        },
        needed_grams: {
          type: "number",
          description: "Wie viel Gramm der Kunde braucht (z.B. 100 für Verdichtung, 150 für Verlängerung, 175+ für dickes Haar)",
        },
        supplier_line: {
          type: "string",
          enum: ["amanda", "ebru"],
          description: "amanda = Russisch Glatt (nur 60cm), ebru = Usbekisch Wellig (45-85cm)",
        },
      },
      required: ["method", "length_cm", "needed_grams", "supplier_line"],
    },
  },
  async execute(input) {
    const supabase = createServiceClient();
    const { data } = await supabase
      .from("chatbot_prices")
      .select("method, length_cm, gram_label, gram_per_pack, price_eur, supplier_line")
      .eq("active", true);
    const prices = (data ?? []) as PriceRow[];
    const result = calcPacks(
      prices,
      input.method as Method,
      input.length_cm as number,
      input.needed_grams as number,
      input.supplier_line as "amanda" | "ebru",
    );
    if (!result) {
      return { output: `Keine Preisdaten gefunden für ${input.method} ${input.length_cm}cm in der Linie ${input.supplier_line}.` };
    }
    return {
      output: JSON.stringify({
        packs: result.packs,
        pack_grams: result.pack_grams,
        total_grams: result.total_grams,
        price_per_pack: result.price_per_pack,
        total_price: result.total_price,
        method_label: result.method_label,
        length_cm: result.length_cm,
        suggested_message: result.message,
      }),
    };
  },
};

// ── search_faq ──────────────────────────────────────────────────────────────
const searchFaq: ToolDef = {
  schema: {
    name: "search_faq",
    description:
      "Sucht in der Hairvenly-Wissensdatenbank nach FAQs. Nutze das für Wissensfragen zu: " +
      "Methoden-Unterschieden, Pflege, Versand, Retouren, Zahlung, Gewerberabatt, Längen, Haarqualitäten.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Suchbegriff oder die Kundenfrage in eigenen Worten",
        },
      },
      required: ["query"],
    },
  },
  async execute(input) {
    const supabase = createServiceClient();
    const query = (input.query as string).split(/\s+/).filter(w => w.length > 2).join(" | ");
    const { data } = await supabase
      .from("chatbot_faq")
      .select("question, answer, topic")
      .eq("active", true)
      .textSearch("question", query, { type: "websearch", config: "german" })
      .limit(3);
    if (!data || data.length === 0) {
      // Fallback: ilike
      const { data: fallback } = await supabase
        .from("chatbot_faq")
        .select("question, answer, topic")
        .eq("active", true)
        .or(`question.ilike.%${input.query}%,answer.ilike.%${input.query}%`)
        .limit(3);
      if (!fallback || fallback.length === 0) {
        return { output: "Keine passende FAQ gefunden. Wenn unsicher: nutze transfer_to_human." };
      }
      return { output: JSON.stringify(fallback) };
    }
    return { output: JSON.stringify(data) };
  },
};

// Deutsche Stop-Wörter — werden aus der Suche ausgefiltert
const STOP_WORDS = new Set([
  "wann", "wie", "was", "wo", "warum", "ob",
  "kommen", "kommt", "kommen", "wieder", "rein", "zurück", "da", "raus",
  "ist", "sind", "war", "waren", "wird", "werden",
  "die", "der", "das", "den", "dem", "des",
  "ein", "eine", "einen", "einem", "einer", "eines",
  "in", "im", "an", "auf", "mit", "von", "zu", "für", "bei", "aus",
  "und", "oder", "aber", "noch",
  "mein", "meine", "meinen", "deine", "deinen", "ihr", "ihre",
  "ich", "du", "wir", "ihr", "sie",
  "nicht", "kein", "keine", "auch", "schon", "noch",
  "habt", "habe", "hat", "haben", "hätte", "hättest",
  "kannst", "können", "könnt", "möchte", "möchtest", "würdet",
  "soll", "sollte", "muss",
  "vielleicht", "eventuell", "möglich",
  "gerade", "aktuell", "momentan", "derzeit",
  "verfügbar", "vorrätig", "lager", "lagernd",  // Suchworte die selbst beschreibend sind
  "ausverkauft",
  "auch", "doch", "denn", "ja", "nein",
]);

function cleanSearchTokens(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[?!.,;:]/g, " ")
    .split(/\s+/)
    .filter(t => t.length > 1 && !STOP_WORDS.has(t));
}

// ── get_stock_eta (live aus Stock Calculation Sheet) ────────────────────────
const getStockEta: ToolDef = {
  schema: {
    name: "get_stock_eta",
    description:
      "Prüft live im Lager-System wann ausverkaufte Produkte wieder verfügbar sind. " +
      "Liest aus dem Google Sheet 'Stock Calculation' und gibt die ETA der bestellten Auslandsware zurück. " +
      "Nutze IMMER bei Fragen wie 'wann ist X wieder da?'.\n\n" +
      "**WICHTIG für die Suche:** Übergib NUR die produktrelevanten Keywords — NIEMALS die ganze Frage.\n" +
      "Beispiele:\n" +
      "  - Kunde: 'Wann kommen die russischen Tapes in Ebony wieder rein?' → search: 'ebony russisch tape'\n" +
      "  - Kunde: 'Habt ihr Pearl White 65cm vorrätig?' → search: 'pearl white 65cm'\n" +
      "  - Kunde: 'Wann ist Honey Bonding wieder da?' → search: 'honey bonding'\n" +
      "Maximal 3–4 Keywords: Farbe + Methode + ggf. Länge. Keine Frage-Wörter wie 'wann', 'wieder', 'rein'.\n\n" +
      "⚠️ LÄNGE IST PFLICHT wenn aus Foto-Caption, URL oder Text erkennbar! " +
      "Bestände unterscheiden sich PRO LÄNGE (45cm/55cm/65cm/85cm/60cm) — wenn du die Länge weglässt, bekommst du " +
      "evtl. Treffer aus ALLEN Längen vermischt und kannst dich nicht auf einen Stock-Status festlegen. " +
      "Beispiele:\n" +
      "  - Foto-Caption '#4/27T24 US WELLIGE TAPE EXTENSIONS 65CM' → search: '4/27t24 tape 65cm'\n" +
      "  - URL '.../tape-extensions-65cm' → search MUSS '65cm' enthalten\n" +
      "  - Kunde tippt '4/27T24 in 55cm' → search: '4/27t24 tape 55cm'\n" +
      "Wenn KEINE Länge bekannt: frag die Kundin VORHER, statt zu raten.\n\n" +
      "⚠️ FARBE/FARB-CODE IST PFLICHT. Suchen wie 'wellig tape 65cm' oder 'russisch bondings' OHNE Farbe " +
      "werden vom Tool abgelehnt (status: search_too_broad).",
    input_schema: {
      type: "object",
      properties: {
        search: {
          type: "string",
          description: "Produkt-Keywords (Farbe + Methode + ggf. Länge), z.B. 'ebony russisch tape', 'pearl white 65cm bonding'",
        },
      },
      required: ["search"],
    },
  },
  async execute(input) {
    try {
      const search = (input.search as string).toLowerCase();
      // Stop-Wörter rausfiltern, damit der Bot auch mit ganzen Sätzen klarkommt
      const tokens = cleanSearchTokens(search);
      // Sicherheitsnetz: bei 0 tokens → kein Match möglich
      if (tokens.length === 0) {
        return {
          output: JSON.stringify({
            status: "search_empty",
            message: "Such-Begriff war zu unspezifisch. Frag den Kunden nach Farbe + Methode + ggf. Länge.",
          }),
        };
      }

      // ── SEARCH-TOO-BROAD-GUARD ────────────────────────────────────────────
      // User-Bug 2026-05-26: Bot rief get_stock_eta zweimal auf — einmal mit
      // konkreter Farbe (z.B. "4/27t24"), einmal mit reiner Methode/Länge
      // ("wellig tape 65cm"). Der zweite Call matchte ALLE Wellig-65cm-Tapes,
      // viele mit qty>0 → Tool returnte "in_stock". Bot kombinierte dann
      // beide Results zu „4/27T24 ist auf Lager + ETA 25.06", obwohl Sheet
      // klar qty=0 für 4/27T24 sagt.
      //
      // Lösung: Wenn die Such-Tokens AUSSCHLIESSLICH aus Methode/Linie/Länge/
      // Material/Subtype bestehen (kein Farb-Identifier) → search_too_broad
      // zurück. Bot MUSS dann mit Farbname oder Farb-Code (z.B. "4/27T24",
      // "5P18A") erneut suchen.
      const BROAD_NOISE = new Set([
        // Methods
        "tape", "tapes", "bonding", "bondings", "weft", "wefts", "clip", "clips",
        "tresse", "tressen", "extension", "extensions",
        // Line / texture
        "russisch", "russische", "russischer", "russisches", "russischen", "ru",
        "usbekisch", "usbekische", "usbekischer", "usbekisches", "us",
        "wellige", "wellig", "welliges", "glatt", "glatte", "glatten", "glattes",
        // Subtype
        "standard", "mini", "genius", "classic", "invisible", "butterfly",
        // Material / Produktart
        "echthaar", "echte", "haar", "haare", "premium", "luxury", "keratin",
        "ponytail", "ponytails",
        // Pure Deskriptoren (KEINE branded color modifier — smoky/macadamia/cherry
        // bleiben absichtlich draussen!)
        "braun", "braune", "brauner", "blond", "blonde", "blonder",
      ]);
      const NUMERIC_RE = /^\d+(cm|g|gr|gramm)?$/i;
      const hasColorIdentifier = tokens.some(t =>
        !BROAD_NOISE.has(t) && !NUMERIC_RE.test(t)
      );
      if (!hasColorIdentifier) {
        console.warn(`[get_stock_eta] SEARCH_TOO_BROAD — tokens=${JSON.stringify(tokens)} hat keinen Farb-Identifier`);
        return {
          output: JSON.stringify({
            status: "search_too_broad",
            message:
              "Such-Begriff ist zu allgemein — er enthält nur Methode/Länge/Linie, keine konkrete Farbe oder Farb-Code. " +
              "Bitte ZWINGEND erneut mit Farbname (z.B. 'ebony') oder Farb-Code (z.B. '4/27T24', '5P18A', '3T8A') suchen. " +
              "OHNE Farb-Identifier bekommst du gleichzeitig 30+ Treffer und kannst keine valide Antwort zur Kundin geben. " +
              "Wenn du die Farbe nicht kennst: frag die Kundin nach Farbcode/Foto, NICHT raten.",
            received_tokens: tokens,
          }),
        };
      }

      const isRussisch = /\bruss/.test(search);
      const isUsbekisch = /\busbek/.test(search);

      // Match-Logik mit ZWEI Stufen:
      // Stufe 1 (strict): alle Tokens müssen vorkommen (substring-Match)
      // Stufe 2 (loose): falls 0 Treffer, retry OHNE numerische Längen-/Gramm-Tokens
      //                  ("60cm", "225g") da Produktnamen diese nicht immer enthalten
      //                  (Clip-Ins haben [225g] aber kein "60cm" im Namen).
      // WORD-BOUNDARY-MATCHING für reine Buchstaben-Token (= Farb-Namen).
      // Beispiel: search="taupe" sollte NUR Produkte mit "TAUPE" als ganzes Wort
      // matchen, NICHT "SMOKY TAUPE" wo "taupe" Teil eines zusammengesetzten
      // Namens ist. Sonst lieferte das Tool fälschlich SMOKY TAUPE-Treffer für
      // eine TAUPE-Suche.
      //
      // Numerische Token (60cm, 225g) und Methoden-Wörter (russisch, tape,
      // bonding etc.) bleiben Substring-Match — da macht das Wort-Boundary
      // mehr Probleme als es löst.
      const NUMERIC_LENGTH_GRAM = /^\d+(cm|g|gramm|gr)$/i;
      // Substring-Matching für alle Tokens — verhindert Verluste bei deutschen
      // Deklinationen ("dunkelbraun" → "dunkelbraune") und zusammengesetzten
      // Wörtern ("schwarz" → "tiefschwarz", "mocha" → "mochamelt" als eigene
      // Farbe... obwohl letzteres je nach Suche evtl. nicht gewollt ist).
      // Das TAUPE/SMOKY-TAUPE-Problem wird durch den COMPOUND-COLOR-GUARD
      // unten gefangen (Output-Sanitizer fängt nur URL-Mismatch, nicht aber
      // den Fall dass der Bot „SMOKY TAUPE" mit korrekter SMOKY-URL ausgibt
      // obwohl die Kundin nur „TAUPE" suchte).
      const buildMatcher = (toks: string[]) => (text: string) => {
        const hay = text.toLowerCase();
        return toks.every(t => hay.includes(t));
      };
      const matchTokens = buildMatcher(tokens);
      const looseTokens = tokens.filter(t => !NUMERIC_LENGTH_GRAM.test(t));
      const matchLoose = buildMatcher(looseTokens);

      // ── COMPOUND-COLOR-GUARD ────────────────────────────────────────────
      // Aus product_colors automatisch detektiert (siehe scripts/tmp/build-
      // modifiers-v2.mjs): wenn der Produktname EINEN dieser Modifier-Tokens
      // als Wort enthält und der Search-String diesen Modifier NICHT enthält,
      // ist es eine ANDERE Farbe — Match ablehnen.
      //
      //   "smoky"     → SMOKY TAUPE  (vs. TAUPE)
      //   "macadamia" → MACADAMIA GLOW (vs. GLOW)
      //   "cherry"    → CHERRY RED (vs. RED)
      //   "3t"        → 3T PEARL WHITE (vs. PEARL WHITE)
      //   "5m"        → 5M/SILVER (vs. SILVER)
      //
      // Wenn neue Compound-Farben dazukommen: script erneut laufen lassen
      // und Liste hier ergänzen.
      const COMPOUND_MODIFIERS = ["smoky", "macadamia", "cherry", "3t", "5m"];
      const modifierRegexes = COMPOUND_MODIFIERS.map(m => ({
        mod: m,
        // Word-Boundary: matched "smoky" in "#smoky", " smoky ", "/smoky/", aber NICHT
        // in "smokyfoo" (kein Boundary nach y). Für Modifier wie "3t" greift derselbe
        // Pattern (3 ist Word-Char, t ist Word-Char, Boundary an Anfang+Ende reicht).
        re: new RegExp(`(^|[^a-z0-9])${m}([^a-z0-9]|$)`, "i"),
      }));
      const searchHasModifier = new Set(
        modifierRegexes.filter(({ re }) => re.test(search)).map(({ mod }) => mod)
      );
      const passesCompoundGuard = (text: string): boolean => {
        for (const { mod, re } of modifierRegexes) {
          if (!re.test(text)) continue;
          if (!searchHasModifier.has(mod)) {
            // Haystack hat Compound-Modifier, Search nicht → andere Farbe
            return false;
          }
        }
        return true;
      };

      // 1) Lade Dashboard (Unterwegs + Nullbestand) + DB-Overrides anwenden
      //    (archivierte Bestellungen raus, ETA aus DB präzisieren)
      const [dashRes, orderIdByName] = await Promise.all([
        readDashboardAlerts(),
        fetchOrderIdByName(),
      ]);
      const unterwegs = filterArchivedFromStock(dashRes.unterwegs, orderIdByName).filter(
        (d) => d.unterwegsG > 0,
      );
      const nullbestand = filterArchivedFromStock(dashRes.nullbestand, orderIdByName);
      const lastUpdated = dashRes.lastUpdated;

      // 2) Lade beide Inventory-Sheets (Russisch + Usbekisch) — für "vorrätig"-Check
      const sheets: Array<"Russisch - GLATT" | "Usbekisch - WELLIG"> = [];
      if (!isUsbekisch) sheets.push("Russisch - GLATT");
      if (!isRussisch)  sheets.push("Usbekisch - WELLIG");
      const inventoryRows = (await Promise.all(sheets.map(s => readInventorySheet(s))))
        .flatMap(r => r.rows.map(row => ({ ...row, _sheet: r === undefined ? "" : "" })));

      const matchAndGuard = (text: string) => matchTokens(text) && passesCompoundGuard(text);
      let inventoryMatches = inventoryRows.filter(r => matchAndGuard(`${r.collection} ${r.product}`));
      let inUnterwegs = unterwegs.filter(item => matchAndGuard(`${item.collection} ${item.product}`));
      let inNullbestand = nullbestand.filter(item => matchAndGuard(`${item.collection} ${item.product}`));

      // FALLBACK: wenn strict 0 Treffer hat UND wir haben Längen/Gramm-Tokens entfernt,
      // versuche nochmal loose. Beispiel: Bot sucht "RAW 60cm 225g Clip" — Produktname
      // im Sheet ist "#RAW - INVISIBLE CLIP EXTENSIONS - SCHWARZBRAUN [225g]" (kein "60cm").
      // Strict scheitert wegen "60cm", loose findet den Treffer.
      if (
        inventoryMatches.length === 0 &&
        inUnterwegs.length === 0 &&
        inNullbestand.length === 0 &&
        looseTokens.length > 0 &&
        looseTokens.length < tokens.length
      ) {
        const matchLooseAndGuard = (text: string) => matchLoose(text) && passesCompoundGuard(text);
        inventoryMatches = inventoryRows.filter(r => matchLooseAndGuard(`${r.collection} ${r.product}`));
        inUnterwegs = unterwegs.filter(item => matchLooseAndGuard(`${item.collection} ${item.product}`));
        inNullbestand = nullbestand.filter(item => matchLooseAndGuard(`${item.collection} ${item.product}`));
        console.log(`[get_stock_eta] loose-fallback aktiviert (Tokens: ${JSON.stringify(tokens)} → ${JSON.stringify(looseTokens)}), Treffer: inv=${inventoryMatches.length}, unterwegs=${inUnterwegs.length}, null=${inNullbestand.length}`);
      }

      // URL-LOOKUP: pro Produkt-Variante die ECHTE shopify_url aus product_colors holen.
      // Der Bot hatte vorher nur eine globale URL pro Farbname (also nur EINE für alle
      // Längen+Methoden zusammen) und hat dann andere URLs halluziniert. Jetzt: pro
      // konkretem product-String (name_shopify im Katalog) ein 1:1-Mapping.
      const normalizeProductName = (s: string) =>
        s.toUpperCase().replace(/\s+/g, " ").replace(/[♡♥]/g, "").trim();
      const svcForUrls = createServiceClient();
      const allProductNames = [
        ...inventoryMatches.map(r => r.product),
        ...inUnterwegs.map(m => m.product),
        ...inNullbestand.map(p => p.product),
      ].filter(Boolean);
      const urlMap = new Map<string, string>();
      if (allProductNames.length > 0) {
        const { data: urlRows } = await svcForUrls
          .from("product_colors")
          .select("name_shopify, shopify_url")
          .not("name_shopify", "is", null)
          .not("shopify_url", "is", null);
        const byNorm = new Map<string, string>();
        for (const row of (urlRows as { name_shopify: string; shopify_url: string }[] | null) || []) {
          byNorm.set(normalizeProductName(row.name_shopify), row.shopify_url);
        }
        for (const name of allProductNames) {
          const url = byNorm.get(normalizeProductName(name));
          if (url) urlMap.set(name, url);
        }
      }
      const urlFor = (productName: string): string | null => urlMap.get(productName) || null;

      // ── NEARBY-LENGTH-ALTERNATIVE-LOOKUP ────────────────────────────────
      // User-Wunsch 2026-05-27: Wenn die gewünschte Länge ausverkauft / unterwegs
      // ist, soll der Bot automatisch eine NAHE Länge in derselben Farbe +
      // Methode + Linie als Alternative anbieten — unabhängig von der ETA.
      // Beispiel: 4/27T24 65cm ausverkauft → 55cm (10cm kürzer) sofort verfügbar
      // → Bot empfiehlt das proaktiv.
      //
      // ASYMMETRISCHER cm-Cap (User-Vorgabe 2026-05-27):
      //   - Längere Variante (kann trimmen lassen): bis +20cm OK
      //     z.B. Kundin will 65cm → 85cm-Variante (20cm zu lang) ist akzeptabel
      //   - Kürzere Variante (kein Material nachfügen): max -10cm
      //     z.B. Kundin will 65cm → 55cm OK, 45cm zu drastisch
      let nearbyAlternative: { product: string; collection: string; length_cm: number; cm_diff: number; shopify_url: string | null } | null = null;
      const requestedLengthMatch = search.match(/\b(\d{2,3})\s*cm\b/i);
      if (requestedLengthMatch) {
        const requestedCm = parseInt(requestedLengthMatch[1], 10);
        const lengthTokenRe = /^\d{2,3}cm$/i;
        const tokensWithoutLength = tokens.filter(t => !lengthTokenRe.test(t));
        if (tokensWithoutLength.length > 0) {
          const matchSameColor = buildMatcher(tokensWithoutLength);
          const candidates = inventoryRows
            .filter(r => matchSameColor(`${r.collection} ${r.product}`) && passesCompoundGuard(`${r.collection} ${r.product}`))
            .filter(r => r.quantity > 0)
            .map(r => {
              const text = `${r.collection} ${r.product}`;
              const lenMatch = text.match(/\b(\d{2,3})\s*cm\b/i);
              let lenCm: number | null = lenMatch ? parseInt(lenMatch[1], 10) : null;
              // RUSSISCH-IMPLICIT: Russisch-Glatt-Produkte tragen keine cm-Angabe
              // im Namen (Convention) — die Länge ist immer 60cm. User-Bug
              // 2026-05-27: Bot übersah Latte Balayage 60cm Russisch glatt als
              // Alternative zu 55cm-Anfrage, weil lenCm=null → rausgefiltert.
              if (lenCm === null && (/\bruss/i.test(text) || /\bglatt/i.test(text))) {
                lenCm = 60;
              }
              return { row: r, lenCm };
            })
            .filter(c => c.lenCm !== null && c.lenCm !== requestedCm)
            .map(c => ({
              ...c,
              signedDiff: (c.lenCm as number) - requestedCm,
              cmDiff: Math.abs((c.lenCm as number) - requestedCm),
            }))
            .filter(c => {
              // Längere Länge: bis +20cm OK (Kundin trimmt nach)
              // Kürzere Länge: bis -10cm OK (mehr Verlust ist drastisch)
              if (c.signedDiff > 0) return c.signedDiff <= 20;
              if (c.signedDiff < 0) return c.signedDiff >= -10;
              return false;
            })
            .sort((a, b) => a.cmDiff - b.cmDiff);
          if (candidates.length > 0) {
            const best = candidates[0];
            nearbyAlternative = {
              product: best.row.product,
              collection: best.row.collection,
              length_cm: best.lenCm as number,
              cm_diff: best.cmDiff,
              shopify_url: best.row.url || urlFor(best.row.product) || null,
            };
          }
        }
      }

      // ── LENGTH-DISAMBIGUATION-GUARD ────────────────────────────────────
      // User-Bug 2026-05-27: Bot suchte "4/27t24" OHNE Länge. Matchte
      // 4/27T24 in 45cm/55cm/65cm/85cm + Bondings. 4 davon qty>0, nur die
      // 65cm-Variante qty=0. Bot sagte "auf Lager" basierend auf 45/55cm,
      // aber URL und ETA waren für 65cm. Kundin las "auf Lager", Shopify
      // (65cm) zeigte "Ausverkauft" — Vertrauensbruch.
      //
      // Lösung: Wenn matched-products mehrere distinkte Längen haben UND
      // die Suche keine explizite Länge nennt, status=multi_length_results
      // mit per-Länge-Aufschlüsselung. Bot muss Kundin nach Länge fragen
      // ODER per-Länge antworten — KEINE Cross-Length-Aussage mehr.
      const extractLength = (text: string): string | null => {
        const m = text.match(/\b(\d{2,3})\s*cm\b/i);
        return m ? `${m[1]}cm` : null;
      };
      const searchHasExplicitLength = /\b\d{2,3}\s*cm\b/i.test(search);
      if (!searchHasExplicitLength) {
        // Sammle alle Längen aus allen 3 Listen
        const allMatchedTexts = [
          ...inventoryMatches.map(r => `${r.collection} ${r.product}`),
          ...inUnterwegs.map(m => `${m.collection} ${m.product}`),
          ...inNullbestand.map(p => `${p.collection} ${p.product}`),
        ];
        const lengths = new Set<string>();
        for (const t of allMatchedTexts) {
          const len = extractLength(t);
          if (len) lengths.add(len);
        }
        // >1 distinkte Länge gefunden → Bot muss Kundin nach Länge fragen
        // (oder selber aus Foto/Caption ableiten — falls Foto-Caption Länge
        // hatte aber Bot sie nicht im search übergeben hat)
        if (lengths.size > 1) {
          // Per-Länge-Aufschlüsselung mit Stock-Status, ETA und shopify_url.
          // Frühestes ETA-Datum statt erstes perOrder-Item (User-Bug
          // 2026-05-28: vorher kam "Anfang Juni" statt "25.06.2026" weil
          // die perOrder-Reihenfolge zufällig war).
          const earliestDe = (m: { perOrder?: { ankunft?: string }[] }): string => {
            if (!m.perOrder || m.perOrder.length === 0) return "bald";
            const dated = m.perOrder.map(o => {
              const dm = (o.ankunft || "").match(/(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})/);
              if (!dm) return { iso: null as string | null, text: o.ankunft || "" };
              const [, d, mo, y] = dm;
              const yy = y.length === 2 ? `20${y}` : y;
              return {
                iso: `${yy}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`,
                text: `${d.padStart(2, "0")}.${mo.padStart(2, "0")}.${yy}`,
              };
            });
            dated.sort((a, b) => (a.iso || "9999").localeCompare(b.iso || "9999"));
            return dated[0]?.text || dated[0]?.iso || "bald";
          };
          type PerLengthBucket = {
            in_stock: { product: string; shopify_url: string | null }[];
            unterwegs: { product: string; eta: string; shopify_url: string | null }[];
            oos: { product: string; shopify_url: string | null }[];
          };
          const perLength: Record<string, PerLengthBucket> = {};
          const ensure = (len: string): PerLengthBucket => {
            if (!perLength[len]) perLength[len] = { in_stock: [], unterwegs: [], oos: [] };
            return perLength[len];
          };
          for (const r of inventoryMatches) {
            const len = extractLength(`${r.collection} ${r.product}`) || "unknown";
            const bucket = ensure(len);
            const entry = { product: r.product, shopify_url: urlFor(r.product) };
            (r.quantity > 0 ? bucket.in_stock : bucket.oos).push(entry);
          }
          for (const m of inUnterwegs) {
            const len = extractLength(`${m.collection} ${m.product}`) || "unknown";
            ensure(len).unterwegs.push({
              product: m.product,
              eta: earliestDe(m),
              shopify_url: urlFor(m.product),
            });
          }
          for (const p of inNullbestand) {
            const len = extractLength(`${p.collection} ${p.product}`) || "unknown";
            ensure(len).oos.push({ product: p.product, shopify_url: urlFor(p.product) });
          }
          console.warn(`[get_stock_eta] MULTI_LENGTH_RESULTS — search="${search}" lengths=${[...lengths].join(",")}`);
          return {
            output: JSON.stringify({
              status: "multi_length_results",
              message:
                "Diese Farbe existiert in mehreren Längen mit UNTERSCHIEDLICHEM Stock-Status. " +
                "Du DARFST NICHT pauschal 'auf Lager' oder 'ausverkauft' sagen — der Stock unterscheidet sich pro Länge. " +
                "\n\n**SO ANTWORTEST DU JETZT:**\n" +
                "1. Wenn die Kundin eine konkrete Länge erwähnt hat (Text/Foto-Caption/URL): " +
                "   nutze per_length[<länge>] für deine Antwort — DU HAST DIE DATEN UNTEN. " +
                "   Beispiel: per_length['55cm'] hat .in_stock / .unterwegs[].eta / .oos. " +
                "   Wenn .unterwegs nicht leer ist, nenne das konkrete ETA-Datum (z.B. 'kommt ca. 25.06.2026 wieder'). " +
                "   NIEMALS schwammig '2-8 Wochen' sagen wenn ein konkretes ETA in den Daten steht.\n" +
                "2. Wenn KEINE Länge erkennbar ist: frag die Kundin kurz 'in welcher Länge?'. " +
                "   Zähle die anderen Längen NICHT proaktiv auf — die Kundin sucht eine bestimmte.\n" +
                "3. URL: nimm AUSSCHLIESSLICH die shopify_url aus diesem Output für die konkrete Länge. " +
                "   NIEMALS URLs selbst zusammenbauen oder raten.",
              per_length: perLength,
              available_lengths: [...lengths].sort(),
              searched_for: search,
            }),
          };
        }
      }

      // ENTSCHEIDUNGSBAUM:

      // A) Produkt nicht in Inventory UND nicht in Unterwegs/Nullbestand → existiert nicht im Sortiment
      if (inventoryMatches.length === 0 && inUnterwegs.length === 0 && inNullbestand.length === 0) {
        return {
          output: JSON.stringify({
            status: "not_in_catalog",
            message:
              "Dieses Produkt finde ich NICHT in unserem Sortiment — weder im Lager, noch ausverkauft, noch unterwegs. " +
              "Möglich: (1) Produkt existiert nicht bei uns / (2) Farbe heißt bei uns anders / (3) Such-Begriff war ungenau. " +
              "Antworte EHRLICH: 'Ich finde [X] gerade nicht in unserer Liste — meinst du vielleicht eine ähnliche Farbe? " +
              "Oder soll ich kurz nachfragen lassen?' und nutze ggf. transfer_to_human.",
            searched_for: search,
          }),
        };
      }

      // KOMBINIERTER STATUS: wenn SOWOHL etwas im Lager als auch etwas unterwegs ist
      // (verschiedene Varianten/Längen) → BEIDE Infos zurückgeben.
      // Vorher: B (unterwegs) feuerte zuerst → Bot hat nie erfahren dass es 65cm sofort gibt.
      const withStockEarly = inventoryMatches.filter(r => r.quantity > 0);
      if (withStockEarly.length > 0 && inUnterwegs.length > 0) {
        const extractDate = (s: string): { iso: string | null; text: string } => {
          const m = s.match(/(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})/);
          if (!m) return { iso: null, text: s };
          const [, d, mo, y] = m;
          const yy = y.length === 2 ? `20${y}` : y;
          const iso = `${yy}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
          return { iso, text: `${d.padStart(2, "0")}.${mo.padStart(2, "0")}.${yy.slice(-2)}` };
        };
        const comingSoon = inUnterwegs.slice(0, 3).map(m => {
          const dated = m.perOrder.map(o => ({ ...extractDate(o.ankunft || ""), raw: o.ankunft }));
          dated.sort((a, b) => (a.iso || "9999").localeCompare(b.iso || "9999"));
          return {
            product: m.product,
            collection: m.collection,
            earliest_eta: dated[0]?.text || dated[0]?.raw || "bald",
            shopify_url: urlFor(m.product),
          };
        });
        return {
          output: JSON.stringify({
            status: "in_stock_partial_unterwegs",
            message:
              "WICHTIG: Manche Varianten sind SOFORT VERFÜGBAR, andere sind unterwegs. " +
              "Erwähne BEIDES: erst was sofort da ist (das ist die beste Option für die Kundin!), " +
              "dann was später kommt. " +
              "Beispiel: 'Soft Blond Balayage hätten wir in 65cm sofort verfügbar 💕 " +
              "In 55cm/85cm ist die Farbe gerade unterwegs (ca. Anfang Juni). " +
              "Magst du die 65cm nehmen oder lieber auf die andere Länge warten?' " +
              "URL-REGEL: Wenn du einen Produkt-Link postest, nimm AUSSCHLIESSLICH die " +
              "shopify_url aus diesem Tool-Output. NIEMALS selbst URLs bauen oder raten.",
            available_now: withStockEarly.slice(0, 5).map(r => ({
              product: r.product,
              collection: r.collection,
              shopify_url: urlFor(r.product),
            })),
            coming_soon: comingSoon,
            sheet_last_updated: lastUpdated,
          }),
        };
      }

      // B) Produkt unterwegs → NUR DAS FRÜHESTE ETA zurückgeben (kein "erste Lieferung" Leak)
      if (inUnterwegs.length > 0) {
        // Hilfsfunktion: extrahiere Datum aus "ca. Ankunft: 30.05.2026" → "30.05.2026"
        const extractDate = (s: string): { iso: string | null; text: string } => {
          const m = s.match(/(\d{1,2})[.\/](\d{1,2})[.\/](\d{2,4})/);
          if (!m) return { iso: null, text: s };
          const [, d, mo, y] = m;
          const yy = y.length === 2 ? `20${y}` : y;
          const iso = `${yy}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
          return { iso, text: `${d.padStart(2, "0")}.${mo.padStart(2, "0")}.${yy.slice(-2)}` };
        };
        // Pro Produkt das früheste Datum finden
        const products = inUnterwegs.slice(0, 3).map(m => {
          const dated = m.perOrder.map(o => ({ ...extractDate(o.ankunft || ""), raw: o.ankunft }));
          dated.sort((a, b) => (a.iso || "9999").localeCompare(b.iso || "9999"));
          const earliest = dated[0];
          return {
            product: m.product,
            collection: m.collection,
            // KEINE konkreten Mengen!
            earliest_eta: earliest?.text || earliest?.raw || "bald",
            earliest_eta_iso: earliest?.iso || null,
            shopify_url: urlFor(m.product),
          };
        });
        return {
          output: JSON.stringify({
            status: "unterwegs",
            message:
              "Produkt ist unterwegs. Verwende NUR 'earliest_eta' für die Antwort und formuliere weich: " +
              "z.B. 'ca. Ende Mai, also etwa 30.05.' — NIEMALS sagen 'erste Lieferung' oder 'zweite Lieferung'! " +
              "EIN Datum reicht. " +
              "URL-REGEL: Wenn du einen Produkt-Link postest, nimm AUSSCHLIESSLICH die " +
              "shopify_url aus diesem Tool-Output. NIEMALS selbst URLs bauen oder raten.",
            sheet_last_updated: lastUpdated,
            products,
            // nearby_alternative wird mit zurückgegeben, aber NICHT mehr aktiv in
            // der Tool-Message für "biete an" beworben — Bot soll Produkt-Daten
            // selbst interpretieren und nur die echte Lieferzeit nennen.
            ...(nearbyAlternative ? { nearby_alternative: nearbyAlternative } : {}),
          }),
        };
      }

      // C) Produkt ausverkauft (Nullbestand) ohne Nachschub
      if (inNullbestand.length > 0) {
        // Bei "kein ETA" → IMMER Alternative anbieten falls Nachbar-Länge in Stock
        return {
          output: JSON.stringify({
            status: "out_of_stock_no_eta",
            message:
              "Aktuell ausverkauft, keine bestätigte Nachschub-Lieferung im System. " +
              "Antworte ehrlich: 'leider noch kein bestätigtes Lieferdatum'." +
              (nearbyAlternative
                ? " ALTERNATIVE: Biete proaktiv die Nachbar-Länge in derselben Farbe an (siehe 'nearby_alternative'-Feld). " +
                  "Phrasierung: 'Wir hätten die Farbe in [X]cm sofort verfügbar (nur [Y]cm Unterschied) — magst du die nehmen?'"
                : " Biete ggf. Alternative oder nutze transfer_to_human."),
            products_found: inNullbestand.slice(0, 3).map(p => `${p.product} (${p.collection})`),
            ...(nearbyAlternative ? { nearby_alternative: nearbyAlternative } : {}),
          }),
        };
      }

      // D) Im Inventory gefunden mit echtem Bestand → verfügbar
      // WICHTIG: Bot bekommt KEINE konkreten Zahlen mehr (kein 'quantity', kein
      // 'total_weight_g'). Stattdessen nur eine qualitative Stufe — sonst leakt
      // er die Zahl wörtlich an den Kunden.
      const withStock = inventoryMatches.filter(r => r.quantity > 0);
      if (withStock.length > 0) {
        const bucketize = (g: number): "comfortable" | "limited" | "tight" => {
          if (g >= 300) return "comfortable"; // ≥ 300g — entspannt
          if (g >= 150) return "limited";     // 150-299g — begrenzt
          return "tight";                      // < 150g — sehr wenig
        };
        const overallBucket = bucketize(
          withStock.reduce((s, r) => s + (r.totalWeight || 0), 0)
        );
        return {
          output: JSON.stringify({
            status: "in_stock",
            availability_level: overallBucket,
            message:
              overallBucket === "comfortable"
                ? "Produkt ist gut verfügbar (≥300g). Sag dem Kunden NUR 'haben wir da' — knapp, ohne Mengen, ohne Übertreibungen. Verweise auf den Shop. Falls passend: frag nach gewünschten Gramm für Preisangabe. NIEMALS konkrete Lagerzahlen nennen!"
                : overallBucket === "limited"
                ? "Produkt ist verfügbar, der Lagervorrat geht aber langsam zur Neige. Sag dem Kunden weich: 'haben wir noch da' (ohne 'in begrenzter Menge' zu sagen — das klingt nach Verpackungsmenge). Optional dezenter Hinweis: 'der Vorrat wird langsam knapp'. NIEMALS konkrete Gramm- oder Stückzahlen!"
                : "Produkt ist nur noch in kleinem Lagervorrat. Sag dem Kunden: 'haben wir noch da — schau aber gerne schnell, da der Vorrat langsam knapp wird.' NIEMALS sagen 'in begrenzter Menge à Xg' (das klingt nach Verpackungs-Größe und ist verwirrend). NIEMALS konkrete Zahlen!",
            products: withStock.slice(0, 5).map(r => ({
              product: r.product,
              collection: r.collection,
              shopify_url: urlFor(r.product),
              // KEINE quantity/total_weight_g mehr im Output!
            })),
            url_rule: "Wenn du einen Produkt-Link schickst, kopiere AUSSCHLIESSLICH die shopify_url aus diesem Output. NIEMALS URLs selbst zusammenbauen, erfinden oder raten.",
          }),
        };
      }

      // E) Im Inventory gefunden, aber Quantity = 0 → AUSVERKAUFT
      //    (war früher "uncertain → transfer_to_human", was den Bot fälschlich eskalieren ließ)
      const zeroStockMatches = inventoryMatches.filter(r => r.quantity === 0);
      if (zeroStockMatches.length > 0) {
        return {
          output: JSON.stringify({
            status: "out_of_stock",
            message:
              "Produkt ist im Sortiment, aber AKTUELL AUSVERKAUFT (Bestand = 0). Es ist KEIN Nachschub " +
              "im Unterwegs-System eingetragen. Sag dem Kunden ehrlich: 'das ist gerade ausverkauft, " +
              "kein bestätigtes Lieferdatum'." +
              (nearbyAlternative
                ? " ALTERNATIVE: Nenne die Nachbar-Länge in derselben Farbe konkret (siehe 'nearby_alternative'-Feld). " +
                  "Phrasierung: 'Wir hätten sie in [X]cm sofort verfügbar — magst du die nehmen?' " +
                  "(KEINE Differenz-Erklärung. KEINE proaktiven Farb-Alternativen.)"
                : " Frage zurück was die Kundin als Nächstes braucht — NIE proaktiv andere Farben vorschlagen, " +
                  "solange die Kundin nicht explizit nach Alternativen fragt.") +
              " NIEMALS sagen 'haben wir sofort da' für diese Produkte!",
            products_out_of_stock: zeroStockMatches.slice(0, 3).map(r => ({
              product: r.product,
              collection: r.collection,
            })),
            ...(nearbyAlternative ? { nearby_alternative: nearbyAlternative } : {}),
          }),
        };
      }

      // F) Fallback (sollte selten passieren) — nichts klares gefunden
      return {
        output: JSON.stringify({
          status: "uncertain",
          message:
            "Produkt im Sortiment, aber kein eindeutiger Bestand sichtbar (weder vorrätig noch ausverkauft markiert). " +
            "Antworte ehrlich 'Ich kann das nicht sicher sagen' und nutze transfer_to_human.",
          products_found: inventoryMatches.slice(0, 3).map(r => r.product),
        }),
      };
    } catch (e) {
      return {
        output:
          `Fehler beim Lager-Check: ${(e as Error).message}. ` +
          `Sag dem Kunden ehrlich 'Lass mich das eben checken' und nutze transfer_to_human.`,
      };
    }
  },
};

// ── analyze_hair_photo (Vision via Claude) ──────────────────────────────────
const analyzeHairPhoto: ToolDef = {
  schema: {
    name: "analyze_hair_photo",
    description:
      "Wenn der Kunde ein Foto seiner Haare geschickt hat: analysiere die Farbe und schlage passende " +
      "Hairvenly-Farben vor. Bei <80% Sicherheit → transfer_to_human() aufrufen.",
    input_schema: {
      type: "object",
      properties: {
        observation: {
          type: "string",
          description: "Was du im Foto siehst (Haarfarbe, Highlights, Helligkeit, kühl/warm)",
        },
      },
      required: ["observation"],
    },
  },
  async execute(input) {
    // Vision wird über Multimodal-Messages an Claude direkt gehandhabt (Bild + Frage in einem Call)
    // Dieses Tool bestätigt nur die Beobachtung und liefert verfügbare Farben
    const supabase = createServiceClient();
    const { data } = await supabase
      .from("chatbot_prices")
      .select("supplier_line, length_cm")
      .eq("active", true);
    return {
      output: JSON.stringify({
        observation: input.observation,
        instruction:
          "Wenn du dir bei der Farbempfehlung NICHT 100% sicher bist (z.B. starke Highlights, schwierige Lichtverhältnisse, " +
          "Wunschfarbe ungenau), rufe transfer_to_human() mit reason='Farbberatung mit Foto, brauche Stylistin-Bestätigung' auf.",
        available_lines: ["amanda (Russisch Glatt 60cm)", "ebru (Usbekisch Wellig 45/55/65/85cm)"],
      }),
    };
  },
};

// ── transfer_to_human ───────────────────────────────────────────────────────
const transferToHuman: ToolDef = {
  schema: {
    name: "transfer_to_human",
    description:
      "Übergibt das Gespräch an eine Mitarbeiterin. Nutze bei: Unsicherheit, Frustration, komplexen Problemen, " +
      "expliziter Bitte um Menschen, oder bei Themen die du nicht zuverlässig lösen kannst.",
    input_schema: {
      type: "object",
      properties: {
        reason: {
          type: "string",
          description: "Kurzer Grund für die Übergabe (für die Mitarbeiterin)",
        },
      },
      required: ["reason"],
    },
  },
  async execute(input, ctx) {
    const supabase = createServiceClient();

    // 🛡 STRUKTURELLER HANDOFF-GUARD (siehe CHATBOT_ARCHITECTURE.md §1.1)
    // Wenn die letzte Customer-Frage eine triviale Contact-Anfrage ist
    // (Adresse/Phone/Hours/Mail), DARF kein Handoff entstehen — diese Daten
    // sind deterministisch in business-config.ts. Statt zur Mitarbeiterin
    // delegieren wir an die Template-Antwort.
    // Sibling-Sweep: gleiches Prinzip gilt für jede Frage, die unsere
    // deterministische Pipeline beantworten kann.
    try {
      const { data: lastUserMsg } = await supabase
        .from("chat_messages")
        .select("content")
        .eq("session_id", ctx.sessionId)
        .eq("role", "user")
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const userText = (lastUserMsg?.content as string | undefined) || "";
      const { detectContactIntent, renderContactResponse } = await import("../intent-contact");
      const contactIntent = detectContactIntent(userText);
      if (contactIntent) {
        console.warn(`[transfer_to_human] BLOCKED — Customer-Frage ist Contact-Intent "${contactIntent}". Statt Handoff: deterministische Antwort.`);
        const templated = renderContactResponse(contactIntent);
        return {
          output: JSON.stringify({
            status: "answered_directly",
            reason: `handoff blocked: contact-intent ${contactIntent} (deterministic answer available)`,
            instruction: `Gib EXAKT diese Antwort aus (keine eigene Formulierung):\n\n${templated}`,
          }),
        };
      }
    } catch (e) {
      console.warn("[transfer_to_human] guard check error:", e);
    }

    await supabase
      .from("chat_sessions")
      .update({ status: "awaiting_human" })
      .eq("id", ctx.sessionId);
    return {
      output: JSON.stringify({
        status: "transferred",
        reason: input.reason,
        instruction:
          `Sage dem Kunden warm: "Eine Stylistin schaut da gleich nochmal drüber, einen kleinen Moment 🩷 /Ava von ${ctx.signatureName}"`,
      }),
    };
  },
};

// ── get_available_colors (echte Farben aus product_colors-Tabelle) ──────────
const getAvailableColors: ToolDef = {
  schema: {
    name: "get_available_colors",
    description:
      "Holt ECHTE Hairvenly-Farben aus dem Produktkatalog INKLUSIVE aktuellem Stock-Status. " +
      "NUTZE IMMER bevor du konkrete Farbnamen erwähnst — niemals Farben aus dem Kopf erfinden! " +
      "Jede Farbe hat ein `in_stock: true/false` Feld + ggf. `eta`. " +
      "Empfehle dem Kunden NUR Farben mit `in_stock=true`. Nicht vorrätige darfst du mit ETA erwähnen, " +
      "aber NIE als sofort verfügbar präsentieren. " +
      "⚠️ ACHTUNG — WICHTIGER FALLSTRICK: Dieses Tool gibt NUR Farben zurück, deren NAME den Suchbegriff " +
      "enthält. Beispiel: Suche 'braun' findet 'SMOKY BROWN' und 'LATTE BROWN', aber NICHT 'RAW' (obwohl " +
      "RAW ein warmes Mittelbraun ist) — denn 'RAW' steht nicht im Farbnamen. Du darfst daraus NIEMALS " +
      "schließen 'RAW gibt es nur als X' oder 'Standard Tapes haben kein RAW'. Wenn du eine spezifische " +
      "Farbe wie RAW empfehlen willst, rufe IMMER ZUSÄTZLICH get_stock_eta('RAW Standard Tapes Russisch') " +
      "auf um die echte Verfügbarkeit pro Methode zu prüfen. " +
      "Filter optional nach Methode (tape/bondings/tressen/etc.) und/oder Haarqualität (russisch/usbekisch).",
    input_schema: {
      type: "object",
      properties: {
        method: {
          type: "string",
          description: "Methode-Name z.B. 'Tapes', 'Bondings', 'Tressen', 'Clip-ins', 'Ponytail' oder leer für alle",
        },
        supplier_line: {
          type: "string",
          enum: ["russisch", "usbekisch", "any"],
          description: "russisch (Premium, glatt) oder usbekisch (wellig). 'any' für beide.",
        },
        search: {
          type: "string",
          description: "Optional: Filter nach Farbton (z.B. 'blond', 'braun', 'schwarz', 'rot')",
        },
      },
    },
  },
  async execute(input) {
    const svc = createServiceClient();
    const method = (input.method as string | undefined)?.toLowerCase();
    const supplierLine = (input.supplier_line as string | undefined)?.toLowerCase();
    const search = (input.search as string | undefined)?.toLowerCase();

    // product_colors → product_lengths → product_methods → suppliers
    // Nur bot_active = true einbeziehen
    const { data, error } = await svc.from("product_colors").select(`
      name_hairvenly,
      name_shopify,
      shopify_url,
      description,
      equivalent_in_other_line,
      length:product_lengths!product_colors_length_id_fkey(
        value,
        unit,
        method:product_methods!product_lengths_method_id_fkey(
          name,
          supplier:suppliers!product_methods_supplier_id_fkey(name)
        )
      )
    `).not("name_hairvenly", "is", null).eq("bot_active", true).limit(800);

    if (error) return { output: `Fehler: ${error.message}` };

    type Row = {
      name_hairvenly: string;
      name_shopify: string | null;
      shopify_url: string | null;
      description: string | null;
      equivalent_in_other_line: string | null;
      length?: { value?: number; unit?: string; method?: { name?: string; supplier?: { name?: string } | null } | null } | null;
    };
    let rows = (data as unknown as Row[]) || [];

    // Synonym-Mapping: bei Such-Begriffen auf Farbcodes erweitern
    // Damit Bot "schwarz" findet auch wenn Russisch nur "EBONY/TIEFSCHWARZ" nutzt
    const SYNONYMS: Record<string, string[]> = {
      schwarz:      ["schwarz", "tiefschwarz", "ebony", "raw", "1a", "natural"],
      dunkelbraun:  ["dunkelbraun", "schwarzbraun", "smoky brown", "expresso", "espresso", "raw"],
      braun:        ["braun", "mittelbraun", "hellbraun", "dunkelbraun"],
      blond:        ["blond", "blonde"],
      hellblond:    ["hellblond", "platin", "pearl white", "snowy"],
      dunkelblond:  ["dunkelblond", "honey", "honig", "champagne"],
      rot:          ["rot", "red", "cherry", "kupfer", "copper"],
    };
    const searchTerms = search
      ? (SYNONYMS[search] ?? [search])
      : null;

    // Method-Filter (lokal — flexibler als SQL-LIKE)
    if (method && method !== "any") {
      rows = rows.filter(r => {
        const m = (r.length?.method?.name || "").toLowerCase();
        // Map vom Bot-Begriff zu DB-Namen
        if (method.includes("tape") && (m.includes("tape") || m.includes("minitape"))) return true;
        if (method.includes("bond") && m.includes("bond")) return true;
        if (method.includes("tress") && m.includes("weft")) return true;
        if (method.includes("clip") && m.includes("clip")) return true;
        if (method.includes("ponytail") && m.includes("ponytail")) return true;
        if (method.includes("weft") && m.includes("weft")) return true;
        return m.includes(method);
      });
    }

    // Supplier-Filter
    if (supplierLine === "russisch") {
      rows = rows.filter(r => (r.length?.method?.supplier?.name || "").toLowerCase().includes("amanda"));
    } else if (supplierLine === "usbekisch") {
      rows = rows.filter(r => {
        const s = (r.length?.method?.supplier?.name || "").toLowerCase();
        return s.includes("eyfel") || s.includes("ebru");
      });
    }

    // Such-Filter — sucht in Kurzname, Shopify-Volltitel UND Beschreibung
    // Beschreibung ist der wichtigste Hit: "warmes Mittelbraun" findet RAW
    // auch wenn "braun" nicht im Produktnamen steht.
    if (searchTerms) {
      rows = rows.filter(r => {
        const hay = `${r.name_hairvenly} ${r.name_shopify || ""} ${r.description || ""}`.toLowerCase();
        return searchTerms.some(t => hay.includes(t));
      });
    }

    // Stock-Daten parallel laden — für jeden Catalog-Eintrag prüfen wir ob aktuell verfügbar
    // (readDashboardAlerts cached intern; ist nur ein API-Call zum Sheet)
    // + DB-Overrides: archivierte Bestellungen raus, ETAs aus DB
    const [dashRes2, orderIdByName2] = await Promise.all([
      readDashboardAlerts(),
      fetchOrderIdByName(),
    ]);
    const unterwegs = filterArchivedFromStock(dashRes2.unterwegs, orderIdByName2).filter(
      (d) => d.unterwegsG > 0,
    );
    const nullbestand = filterArchivedFromStock(dashRes2.nullbestand, orderIdByName2);
    // Auch reine Inventory-Sheets für "in_stock" Status
    const sheets: Array<"Russisch - GLATT" | "Usbekisch - WELLIG"> = [];
    if (supplierLine === "russisch")       sheets.push("Russisch - GLATT");
    else if (supplierLine === "usbekisch") sheets.push("Usbekisch - WELLIG");
    else                                   sheets.push("Russisch - GLATT", "Usbekisch - WELLIG");
    const stockRows = (await Promise.all(sheets.map(s => readInventorySheet(s))))
      .flatMap(r => r.rows);

    // Normalisierung für Match: name_shopify ↔ stock row.product
    const normN = (s: string) => s.toUpperCase().replace(/\s+/g, " ").replace(/[♡♥]/g, "").trim();
    const stockByName = new Map<string, { quantity: number; totalWeight: number }>();
    for (const sr of stockRows) {
      stockByName.set(normN(sr.product), { quantity: sr.quantity, totalWeight: sr.totalWeight });
    }
    const unterwegsByName = new Map<string, { etaText: string }>();
    for (const u of unterwegs) {
      const eta = u.perOrder[0]?.ankunft || "bald";
      unterwegsByName.set(normN(u.product), { etaText: eta });
    }
    const nullbestandSet = new Set(nullbestand.map(p => normN(p.product)));

    // Eindeutige Farbnamen — sammle Methoden, Längen, URLs UND Stock-Status.
    // WICHTIG: variants[] enthält URL PRO Methode+Länge — der Bot soll daraus
    // den richtigen Link wählen, nicht "shopify_url" der nur die erste Variante ist.
    type ColorVariant = { method: string; length: string; shopify_url: string | null };
    type ColorEntry = {
      lengths: Set<string>;
      methods: Set<string>;
      variants: ColorVariant[];
      shopify_url: string | null; // BACKWARD-COMPAT: erste URL als Quick-Fallback
      description: string | null;
      equivalent_in_other_line: string | null;
      in_stock: boolean;
      eta: string | null;
    };
    const colorMap = new Map<string, ColorEntry>();
    for (const r of rows) {
      if (!r.name_hairvenly) continue;
      const entry = colorMap.get(r.name_hairvenly) || {
        lengths: new Set(), methods: new Set(), variants: [], shopify_url: null,
        description: null, equivalent_in_other_line: null, in_stock: false, eta: null,
      };
      if (r.description && !entry.description) entry.description = r.description;
      if (r.equivalent_in_other_line && !entry.equivalent_in_other_line) entry.equivalent_in_other_line = r.equivalent_in_other_line;
      const lenStr = r.length?.value ? `${r.length.value}${r.length.unit || "cm"}` : "";
      const methodName = r.length?.method?.name || "";
      if (lenStr) entry.lengths.add(lenStr);
      if (methodName) entry.methods.add(methodName);
      // Pro Methode+Länge eine Variante mit der KORREKTEN URL
      if (methodName && r.shopify_url) {
        const dup = entry.variants.some(v => v.method === methodName && v.length === lenStr && v.shopify_url === r.shopify_url);
        if (!dup) entry.variants.push({ method: methodName, length: lenStr, shopify_url: r.shopify_url });
      }
      if (r.shopify_url && !entry.shopify_url) entry.shopify_url = r.shopify_url;

      // Stock-Status: schaue ob dieser Catalog-Eintrag im Sheet vorrätig ist
      if (r.name_shopify) {
        const stockInfo = stockByName.get(normN(r.name_shopify));
        if (stockInfo && stockInfo.totalWeight > 0) {
          entry.in_stock = true;
        }
        // ETA falls unterwegs
        const uw = unterwegsByName.get(normN(r.name_shopify));
        if (uw && !entry.eta) entry.eta = uw.etaText;
        // Nullbestand-Hinweis (komplett aus, kein Nachschub)
        if (nullbestandSet.has(normN(r.name_shopify)) && !entry.in_stock && !entry.eta) {
          entry.eta = "aktuell ausverkauft, kein Nachschub";
        }
      }
      colorMap.set(r.name_hairvenly, entry);
    }

    if (colorMap.size === 0) {
      return {
        output: JSON.stringify({
          status: "no_match",
          message:
            "Keine Farben mit diesen Filtern gefunden. Frag den Kunden nach Methode + Haarqualität (russisch/usbekisch), " +
            "oder rufe das Tool ohne Filter auf um alle verfügbaren Farben zu sehen.",
          filters: { method, supplier_line: supplierLine, search },
        }),
      };
    }

    const colors = Array.from(colorMap.entries()).map(([name, info]) => ({
      name,
      description: info.description,
      equivalent_in_other_line: info.equivalent_in_other_line,  // direkte Cross-Linie-Matches (gepflegt im Katalog)
      methods: Array.from(info.methods),
      lengths: Array.from(info.lengths),
      // variants enthält PRO METHODE+LÄNGE die EXAKTE URL — Bot muss aus dieser
      // Liste die richtige wählen wenn er einer Kundin eine spezifische Methode
      // empfiehlt (z.B. Mini Tapes → Variante mit method="Minitapes" nehmen,
      // NICHT die mit method="Standard Tapes").
      variants: info.variants,
      // shopify_url bleibt als Quick-Fallback für Cases ohne spezifische Methode
      shopify_url: info.shopify_url,
      in_stock: info.in_stock,
      eta: info.eta,
    }));

    // Sortiere: in_stock zuerst, dann mit ETA, dann ohne
    colors.sort((a, b) => {
      if (a.in_stock !== b.in_stock) return a.in_stock ? -1 : 1;
      if (!!a.eta !== !!b.eta) return a.eta ? -1 : 1;
      return 0;
    });

    const filteredBySearch = !!searchTerms;
    return {
      output: JSON.stringify({
        status: "ok",
        message:
          (filteredBySearch
            ? `⚠️ WARNUNG: Diese Liste ist NUR GEFILTERT nach Namen die '${search}' enthalten. ` +
              `Farben wie RAW (warmes Mittelbraun) erscheinen NICHT obwohl sie inhaltlich passen würden. ` +
              `Schließe NICHT aus dieser Liste 'X ist nur in Methode Y verfügbar' — das wäre falsch! ` +
              `Wenn du eine spezifische Farbe wie RAW empfehlen willst, ruf get_stock_eta für genau diese ` +
              `Methode auf um die echte Verfügbarkeit zu prüfen. ` : "") +
          `${colors.length} ECHTE Farben gefunden — NUR diese darfst du dem Kunden nennen. ` +
          "Bei kuratierten Empfehlungen (3-5 passende statt alle): " +
          "WICHTIG bei URL-Wahl: variants[] enthält pro Methode+Länge die KORREKTE shopify_url. " +
          "Wenn du eine spezifische Methode empfiehlst (z.B. Mini Tapes), nimm aus variants[] " +
          "die Variante mit dem passenden method-Wert — NICHT pauschal das oberste shopify_url. " +
          "Standard Tapes haben URLs mit 'standard-tape', Mini Tapes mit 'mini-tape', " +
          "Bondings mit 'bondings', Genius Weft mit 'genius-weft', Clip-Ins mit 'clip-extensions'. " +
          "Wenn null: nur den Namen nennen.",
        filters: { method, supplier_line: supplierLine, search },
        colors,
      }),
    };
  },
};

// ── create_reservation ──────────────────────────────────────────────────────
const createReservationTool: ToolDef = {
  schema: {
    name: "create_reservation",
    description:
      "Legt eine ODER MEHRERE Warteliste-Reservierung(en) an: Kundin möchte benachrichtigt " +
      "werden, sobald nicht verfügbare Produkte wieder da sind. " +
      "Nutze NUR wenn die Kundin EXPLIZIT 'ja' sagt zu deinem Angebot 'magst du dass wir dich " +
      "benachrichtigen?' — niemals ungefragt anlegen. " +
      "WICHTIG: Bei mehreren Farben/Produkten alle in EINEM Tool-Call über das 'products'-Array " +
      "eintragen — niemals einzelne Aufrufe. Das ist atomar und vermeidet Lücken. " +
      "Beispiel: Kundin will über Viking Blond UND Norvegian in Tape 65cm benachrichtigt werden → " +
      "products: [{product_name:'Viking Blond Tape 65cm', color:'Viking Blond', method:'Standard Tapes'}, " +
      "{product_name:'Norvegian Tape 65cm', color:'Norvegian', method:'Standard Tapes'}]. " +
      "Bestätige der Kundin nach dem Anlegen kurz: 'Hab ich notiert — wir melden uns sobald die da sind 💕'.",
    input_schema: {
      type: "object",
      properties: {
        products: {
          type: "array",
          description: "Liste der Produkte für die Warteliste-Eintrag erstellt werden soll. Bei einer einzelnen Farbe → Array mit einem Element. Bei mehreren Farben → mehrere Elemente. NIEMALS einzelne Tool-Calls für mehrere Produkte machen.",
          items: {
            type: "object",
            properties: {
              product_name: { type: "string", description: "Konkretes Produkt (z.B. 'EBONY Russisch Standard Tapes 60cm')" },
              color:        { type: "string", description: "Farb-Name (z.B. 'RAW', '#2A', 'EBONY')" },
              method:       { type: "string", description: "Methode (z.B. 'Standard Tapes', 'Mini Tapes', 'Bondings', 'Tressen')" },
              eta_hint:     { type: "string", description: "ETA-Hinweis falls aus get_stock_eta bekannt" },
              product_url:  { type: "string", description: "Shopify-URL falls bekannt" },
            },
            required: ["product_name"],
          },
        },
        // Backward-compat: einzelnes Produkt direkt am Root
        product_name: { type: "string", description: "DEPRECATED — nutze 'products' Array. Nur für einzelne Reservierung als Schnellweg." },
        color:        { type: "string", description: "DEPRECATED — nutze 'products' Array." },
        method:       { type: "string", description: "DEPRECATED — nutze 'products' Array." },
        eta_hint:     { type: "string", description: "DEPRECATED — nutze 'products' Array." },
        product_url:  { type: "string", description: "DEPRECATED — nutze 'products' Array." },
        notes:        { type: "string", description: "Gemeinsame interne Notiz für alle Produkte dieses Calls (z.B. 'Kundin braucht es für Hochzeit 15.06')" },
      },
    },
  },
  async execute(input, ctx) {
    const { createReservation } = await import("@/lib/actions/chat-reservations");
    try {
      // Normalisiere Input: entweder products-Array oder Einzel-Form
      type ProductInput = { product_name: string; color?: string; method?: string; eta_hint?: string; product_url?: string };
      let list: ProductInput[] = [];
      const productsRaw = input.products as ProductInput[] | undefined;
      if (Array.isArray(productsRaw) && productsRaw.length > 0) {
        list = productsRaw.filter(p => p?.product_name?.trim());
      } else if (input.product_name) {
        list = [{
          product_name: input.product_name as string,
          color:        input.color as string | undefined,
          method:       input.method as string | undefined,
          eta_hint:     input.eta_hint as string | undefined,
          product_url:  input.product_url as string | undefined,
        }];
      }
      if (list.length === 0) {
        return { output: JSON.stringify({ status: "error", message: "Kein Produkt übergeben — products-Array muss mindestens einen Eintrag haben." }) };
      }
      const sharedNotes = input.notes as string | undefined;
      const created: { id: string; product_name: string }[] = [];
      const failed: string[] = [];
      for (const p of list) {
        try {
          const r = await createReservation({
            sessionId:   ctx.sessionId,
            productName: p.product_name,
            color:       p.color,
            method:      p.method,
            etaHint:     p.eta_hint,
            productUrl:  p.product_url,
            notes:       sharedNotes,
          });
          created.push({ id: r.id, product_name: p.product_name });
        } catch (e) {
          failed.push(`${p.product_name}: ${(e as Error).message}`);
        }
      }
      return {
        output: JSON.stringify({
          status: failed.length > 0 ? "partial" : "ok",
          created_count: created.length,
          created,
          failed,
          message:
            created.length === 1
              ? `1 Reservierung angelegt. Bestätige der Kundin kurz: 'Hab ich notiert — wir melden uns sobald die da ist 💕'.`
              : `${created.length} Reservierungen angelegt (${created.map(c => c.product_name).join(", ")}). Bestätige der Kundin kurz: 'Hab ich notiert — wir melden uns sobald die da sind 💕'.`,
        }),
      };
    } catch (e) {
      return { output: `Reservierung-Fehler: ${(e as Error).message}` };
    }
  },
};

// ── get_salon_service_price ─────────────────────────────────────────────────
const getSalonServicePrice: ToolDef = {
  schema: {
    name: "get_salon_service_price",
    description:
      "Holt SERVICE-Preise und Dauer für Vor-Ort-Termine im Hairvenly-Salon Bremen " +
      "(Einarbeitung, Hochsetzen, Entfernen, Coloration, Balayage, Strähnen, Schnitt). " +
      "Das ist ANDERS als get_price (= Produkt-Preise für Extension-Verkauf): " +
      "dieses Tool gibt die DIENSTLEISTUNG am Salon-Tag zurück. " +
      "Nutze es wenn Kundin nach Service-Preisen fragt ('was kostet einarbeiten?', " +
      "'wie viel kostet eine Verlängerung?', 'was kostet Bondings 100g?'). " +
      "Optional Filter nach Service-Begriff (z.B. 'bonding', 'tape', 'balayage'). " +
      `Bot soll am Ende immer auch auf ${BUSINESS_CONFIG.booking_provider_name} verweisen: ${BUSINESS_CONFIG.planity_url}`,
    input_schema: {
      type: "object",
      properties: {
        search: {
          type: "string",
          description: "Optional: Service-Begriff (z.B. 'bondings', 'tapes', 'balayage', 'coloration', 'strähnen', 'tressen', 'entfernen', 'hochsetzen', 'mini tapes', 'invisible')",
        },
        haartyp: {
          type: "string",
          enum: ["wellig", "glatt", "any"],
          description: "Optional: Haartyp-Filter — 'wellig' = Usbekisch, 'glatt' = Russisch",
        },
        gramm: {
          type: "number",
          description: "Optional: spezifische Menge (50, 75, 100, 125, 150)",
        },
      },
    },
  },
  async execute(input) {
    const svc = createServiceClient();
    const search = (input.search as string | undefined)?.toLowerCase();
    const haartyp = (input.haartyp as string | undefined)?.toLowerCase();
    const gramm = input.gramm as number | undefined;

    const { data, error } = await svc
      .from("salon_services")
      .select("category, service, price_min, price_max, duration_min")
      .eq("active", true)
      .order("display_order", { ascending: true })
      .limit(120);

    if (error) return { output: `Fehler: ${error.message}` };
    let rows = (data || []) as Array<{ category: string; service: string; price_min: number | null; price_max: number | null; duration_min: number | null }>;

    if (search) {
      rows = rows.filter(r =>
        `${r.category} ${r.service}`.toLowerCase().includes(search)
      );
    }
    if (haartyp === "wellig") {
      rows = rows.filter(r => /wellig|usbekisch/i.test(r.category) || !/glatt|russisch/i.test(r.category));
    } else if (haartyp === "glatt") {
      rows = rows.filter(r => /glatt|russisch|invisible|mini tapes/i.test(r.category));
    }
    if (gramm) {
      rows = rows.filter(r => new RegExp(`\\b${gramm}g\\b`, "i").test(r.service));
    }

    if (rows.length === 0) {
      return {
        output: JSON.stringify({
          status: "not_found",
          message: `Kein passender Service gefunden. Verweise die Kundin auf ${BUSINESS_CONFIG.booking_provider_name} für die volle Preisliste: ${BUSINESS_CONFIG.planity_url}`,
        }),
      };
    }

    const services = rows.slice(0, 20).map(r => ({
      category: r.category,
      service: r.service,
      price: r.price_max ? `${r.price_min}-${r.price_max}€` : `${r.price_min}€`,
      duration: r.duration_min ? `${r.duration_min} Min` : null,
    }));

    return {
      output: JSON.stringify({
        status: "ok",
        count: services.length,
        message:
          "Nenne der Kundin den/die relevanten Preise KURZ und KLAR — max. 2-3 Services pro Antwort. " +
          `Füge IMMER am Ende den ${BUSINESS_CONFIG.booking_provider_name}-Link hinzu für 'alle Preise + Termin buchen': ` +
          `${BUSINESS_CONFIG.planity_url} — formuliere natürlich, nicht wie Liste.`,
        services,
        // Key bleibt "booking_link" — Tool-Output ist nicht prompt-cached
        booking_link: BUSINESS_CONFIG.planity_url,
        booking_provider: BUSINESS_CONFIG.booking_provider_name,
      }),
    };
  },
};

export const TOOLS: Record<string, ToolDef> = {
  get_price:                getPrice,
  search_faq:               searchFaq,
  get_stock_eta:            getStockEta,
  get_available_colors:     getAvailableColors,
  get_salon_service_price:  getSalonServicePrice,
  analyze_hair_photo:       analyzeHairPhoto,
  create_reservation:       createReservationTool,
  transfer_to_human:        transferToHuman,
};

export const TOOL_SCHEMAS = Object.values(TOOLS).map((t) => t.schema);
