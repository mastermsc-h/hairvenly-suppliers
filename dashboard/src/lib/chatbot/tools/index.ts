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

      // Match-Logik: alle Tokens müssen vorkommen, ABER:
      //  - "russisch" matched "russische" (substring)
      //  - "tape" matched "tapes" (substring)
      const matchTokens = (text: string) => {
        const hay = text.toLowerCase();
        return tokens.every(t => hay.includes(t));
      };

      // 1) Lade Dashboard (Unterwegs + Nullbestand)
      const { unterwegs, nullbestand, lastUpdated } = await readDashboardAlerts();

      // 2) Lade beide Inventory-Sheets (Russisch + Usbekisch) — für "vorrätig"-Check
      const sheets: Array<"Russisch - GLATT" | "Usbekisch - WELLIG"> = [];
      if (!isUsbekisch) sheets.push("Russisch - GLATT");
      if (!isRussisch)  sheets.push("Usbekisch - WELLIG");
      const inventoryRows = (await Promise.all(sheets.map(s => readInventorySheet(s))))
        .flatMap(r => r.rows.map(row => ({ ...row, _sheet: r === undefined ? "" : "" })));
      const inventoryMatches = inventoryRows.filter(r => matchTokens(`${r.collection} ${r.product}`));

      // 3) Match in Unterwegs
      const inUnterwegs = unterwegs.filter(item => matchTokens(`${item.collection} ${item.product}`));
      // 4) Match in Nullbestand
      const inNullbestand = nullbestand.filter(item => matchTokens(`${item.collection} ${item.product}`));

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

      // B) Produkt unterwegs → ETA zurückgeben
      if (inUnterwegs.length > 0) {
        const products = inUnterwegs.slice(0, 3).map(m => ({
          product: m.product,
          collection: m.collection,
          lager_aktuell_g: m.lagerG,
          unterwegs_g: m.unterwegsG,
          next_shipments: m.perOrder.map(o => ({
            order: o.name, ankunft: o.ankunft, menge_g: o.menge,
          })),
        }));
        return {
          output: JSON.stringify({
            status: "unterwegs",
            message:
              "Produkte unterwegs gefunden. Nutze die `ankunft`-Information aus next_shipments für die Antwort " +
              "(z.B. 'ca. Ende Mai'). Formuliere als 'ca. / voraussichtlich'.",
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
                ? "Produkt ist verfügbar, aber BEGRENZT (150-300g). Sag dem Kunden: 'haben wir da, nur in begrenzter Menge'. NIEMALS konkrete Gramm- oder Stückzahlen nennen!"
                : "Produkt ist NUR NOCH IN KLEINER MENGE da (<150g). Sag dem Kunden GENAU SO: 'haben wir noch in kleiner Menge da — schau schnell nach, ob das für dich ausreicht.' Das ist ein dezenter Hinweis, dass er sich beeilen sollte ohne Druckverkauf. NIEMALS konkrete Zahlen nennen!",
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

    // Such-Filter — sucht in Kurzname UND im Shopify-Volltitel
    // (damit "schwarz" auch #EBONY findet wenn der Titel "TIEFSCHWARZ" enthält)
    if (searchTerms) {
      rows = rows.filter(r => {
        const hay = `${r.name_hairvenly} ${r.name_shopify || ""}`.toLowerCase();
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
      in_stock: boolean;          // mindestens 1 Variante aktuell vorrätig
      eta: string | null;          // erste gefundene Ankunfts-ETA wenn unterwegs
    };
    const colorMap = new Map<string, ColorEntry>();
    for (const r of rows) {
      if (!r.name_hairvenly) continue;
      const entry = colorMap.get(r.name_hairvenly) || {
        lengths: new Set(), methods: new Set(), shopify_url: null,
        in_stock: false, eta: null,
      };
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
      methods: Array.from(info.methods),
      lengths: Array.from(info.lengths),
      shopify_url: info.shopify_url,  // null wenn noch nicht gepflegt
      in_stock: info.in_stock,        // true = aktuell vorrätig, false = NICHT vorrätig
      eta: info.eta,                  // wenn nicht vorrätig: ETA-Hinweis ('Ende Juni', 'ausverkauft', null)
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

export const TOOLS: Record<string, ToolDef> = {
  get_price:             getPrice,
  search_faq:            searchFaq,
  get_stock_eta:         getStockEta,
  get_available_colors:  getAvailableColors,
  analyze_hair_photo:    analyzeHairPhoto,
  transfer_to_human:     transferToHuman,
};

export const TOOL_SCHEMAS = Object.values(TOOLS).map((t) => t.schema);
