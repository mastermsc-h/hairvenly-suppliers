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
      "**WICHTIG für die Suche:** Übergib NUR die produktrelevanten Keywords — NIEMALS die ganze Frage. " +
      "Beispiele:\n" +
      "  - Kunde: 'Wann kommen die russischen Tapes in Ebony wieder rein?' → search: 'ebony russisch tape'\n" +
      "  - Kunde: 'Habt ihr Pearl White 65cm vorrätig?' → search: 'pearl white 65cm'\n" +
      "  - Kunde: 'Wann ist Honey Bonding wieder da?' → search: 'honey bonding'\n" +
      "Maximal 3–4 Keywords: Farbe + Methode + ggf. Länge. Keine Frage-Wörter wie 'wann', 'wieder', 'rein'.",
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

      const isRussisch = /\bruss/.test(search);
      const isUsbekisch = /\busbek/.test(search);

      // Match-Logik mit ZWEI Stufen:
      // Stufe 1 (strict): alle Tokens müssen vorkommen (substring-Match)
      // Stufe 2 (loose): falls 0 Treffer, retry OHNE numerische Längen-/Gramm-Tokens
      //                  ("60cm", "225g") da Produktnamen diese nicht immer enthalten
      //                  (Clip-Ins haben [225g] aber kein "60cm" im Namen).
      const buildMatcher = (toks: string[]) => (text: string) => {
        const hay = text.toLowerCase();
        return toks.every(t => hay.includes(t));
      };
      const matchTokens = buildMatcher(tokens);
      const NUMERIC_LENGTH_GRAM = /^\d+(cm|g|gramm|gr)$/i;
      const looseTokens = tokens.filter(t => !NUMERIC_LENGTH_GRAM.test(t));
      const matchLoose = buildMatcher(looseTokens);

      // 1) Lade Dashboard (Unterwegs + Nullbestand)
      const { unterwegs, nullbestand, lastUpdated } = await readDashboardAlerts();

      // 2) Lade beide Inventory-Sheets (Russisch + Usbekisch) — für "vorrätig"-Check
      const sheets: Array<"Russisch - GLATT" | "Usbekisch - WELLIG"> = [];
      if (!isUsbekisch) sheets.push("Russisch - GLATT");
      if (!isRussisch)  sheets.push("Usbekisch - WELLIG");
      const inventoryRows = (await Promise.all(sheets.map(s => readInventorySheet(s))))
        .flatMap(r => r.rows.map(row => ({ ...row, _sheet: r === undefined ? "" : "" })));

      let inventoryMatches = inventoryRows.filter(r => matchTokens(`${r.collection} ${r.product}`));
      let inUnterwegs = unterwegs.filter(item => matchTokens(`${item.collection} ${item.product}`));
      let inNullbestand = nullbestand.filter(item => matchTokens(`${item.collection} ${item.product}`));

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
        inventoryMatches = inventoryRows.filter(r => matchLoose(`${r.collection} ${r.product}`));
        inUnterwegs = unterwegs.filter(item => matchLoose(`${item.collection} ${item.product}`));
        inNullbestand = nullbestand.filter(item => matchLoose(`${item.collection} ${item.product}`));
        console.log(`[get_stock_eta] loose-fallback aktiviert (Tokens: ${JSON.stringify(tokens)} → ${JSON.stringify(looseTokens)}), Treffer: inv=${inventoryMatches.length}, unterwegs=${inUnterwegs.length}, null=${inNullbestand.length}`);
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
          };
        });
        return {
          output: JSON.stringify({
            status: "unterwegs",
            message:
              "Produkt ist unterwegs. Verwende NUR 'earliest_eta' für die Antwort und formuliere weich: " +
              "z.B. 'ca. Ende Mai, also etwa 30.05.' — NIEMALS sagen 'erste Lieferung' oder 'zweite Lieferung'! " +
              "Es interessiert die Kundin nicht ob es eine oder mehrere Lieferungen gibt. " +
              "EIN Datum reicht. Keine 'erste Lieferung'-Phrasen!",
            sheet_last_updated: lastUpdated,
            products,
          }),
        };
      }

      // C) Produkt ausverkauft (Nullbestand) ohne Nachschub
      if (inNullbestand.length > 0) {
        return {
          output: JSON.stringify({
            status: "out_of_stock_no_eta",
            message:
              "Aktuell ausverkauft, keine bestätigte Nachschub-Lieferung im System. " +
              "Antworte ehrlich: 'leider noch kein bestätigtes Lieferdatum' und biete ggf. Alternative " +
              "oder nutze transfer_to_human.",
            products_found: inNullbestand.slice(0, 3).map(p => `${p.product} (${p.collection})`),
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
              // KEINE quantity/total_weight_g mehr im Output!
            })),
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
              "kein bestätigtes Lieferdatum'. Schlag eine ECHTE ALTERNATIVE vor (andere Farbe, andere Methode, " +
              "selbe Qualität) — niemals eskaliere wenn du selbst eine Alternative anbieten kannst. " +
              "NIEMALS sagen 'haben wir sofort da' für diese Produkte!",
            products_out_of_stock: zeroStockMatches.slice(0, 3).map(r => ({
              product: r.product,
              collection: r.collection,
            })),
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
    const { unterwegs, nullbestand } = await readDashboardAlerts();
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

    // Eindeutige Farbnamen — sammle Methoden, Längen, URLs UND Stock-Status
    type ColorEntry = {
      lengths: Set<string>;
      methods: Set<string>;
      shopify_url: string | null;
      description: string | null;
      equivalent_in_other_line: string | null;
      in_stock: boolean;
      eta: string | null;
    };
    const colorMap = new Map<string, ColorEntry>();
    for (const r of rows) {
      if (!r.name_hairvenly) continue;
      const entry = colorMap.get(r.name_hairvenly) || {
        lengths: new Set(), methods: new Set(), shopify_url: null,
        description: null, equivalent_in_other_line: null, in_stock: false, eta: null,
      };
      if (r.description && !entry.description) entry.description = r.description;
      if (r.equivalent_in_other_line && !entry.equivalent_in_other_line) entry.equivalent_in_other_line = r.equivalent_in_other_line;
      if (r.length?.value) entry.lengths.add(`${r.length.value}${r.length.unit || "cm"}`);
      if (r.length?.method?.name) entry.methods.add(r.length.method.name);
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
          "Bei kuratierten Empfehlungen (3-5 passende statt alle): wenn shopify_url da ist, " +
          "füge sie als Link mit dem Kurznamen ein (z.B. [Pearl White](https://...)). " +
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
      "Legt eine WARTELISTEN-RESERVIERUNG an: Kunde möchte benachrichtigt werden, sobald ein " +
      "aktuell nicht verfügbares Produkt (unterwegs/ausverkauft) wieder da ist. " +
      "Nutze NUR wenn die Kundin EXPLIZIT 'ja' sagt zu deinem Angebot 'magst du dass wir dich " +
      "benachrichtigen?' — niemals ungefragt anlegen. " +
      "Bestätige der Kundin nach dem Anlegen kurz: 'Hab ich notiert — wir melden uns sobald die da ist 💕'",
    input_schema: {
      type: "object",
      properties: {
        product_name: {
          type: "string",
          description: "Konkretes Produkt, möglichst genau (z.B. 'EBONY Russisch Standard Tapes' oder 'Smoky Brown Bondings').",
        },
        color: {
          type: "string",
          description: "Farb-Name (z.B. 'RAW', '#2A', 'EBONY')",
        },
        method: {
          type: "string",
          description: "Methode (z.B. 'Standard Tapes', 'Mini Tapes', 'Bondings', 'Tressen')",
        },
        eta_hint: {
          type: "string",
          description: "ETA-Hinweis falls bekannt (z.B. 'Anfang Juni' oder 'ca. 04.06.2026'). Aus get_stock_eta wenn vorhanden.",
        },
        product_url: {
          type: "string",
          description: "Shopify-URL des Produkts falls bekannt.",
        },
        notes: {
          type: "string",
          description: "Optionale Notiz für die Mitarbeiterin, z.B. 'Kundin braucht es bis 15.06 für Hochzeit'.",
        },
      },
      required: ["product_name"],
    },
  },
  async execute(input, ctx) {
    const { createReservation } = await import("@/lib/actions/chat-reservations");
    try {
      const r = await createReservation({
        sessionId:   ctx.sessionId,
        productName: input.product_name as string,
        color:       input.color as string | undefined,
        method:      input.method as string | undefined,
        etaHint:     input.eta_hint as string | undefined,
        productUrl:  input.product_url as string | undefined,
        notes:       input.notes as string | undefined,
      });
      return {
        output: JSON.stringify({
          status: "ok",
          reservation_id: r.id,
          message:
            "Reservierung angelegt. Bestätige der Kundin jetzt kurz: 'Hab ich notiert — wir melden uns sobald die da ist 💕'. " +
            "Eine Mitarbeiterin sieht die Reservierung im Dashboard und meldet sich aktiv wenn die Ware da ist. " +
            "VERSPRICH KEIN exaktes Datum, außer eta_hint ist klar bekannt.",
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
      "Bot soll am Ende immer auch auf Planity verweisen: https://www.planity.com/de-DE/hairvenly-28217-bremen",
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
          message: "Kein passender Service gefunden. Verweise die Kundin auf Planity für die volle Preisliste: https://www.planity.com/de-DE/hairvenly-28217-bremen",
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
          "Füge IMMER am Ende den Planity-Link hinzu für 'alle Preise + Termin buchen': " +
          "https://www.planity.com/de-DE/hairvenly-28217-bremen — formuliere natürlich, nicht wie Liste.",
        services,
        planity_link: "https://www.planity.com/de-DE/hairvenly-28217-bremen",
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
