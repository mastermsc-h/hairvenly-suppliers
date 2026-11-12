/**
 * Reiner Lager-Matcher für die Chatbot-Warteliste (chat_reservations).
 *
 * Kein I/O: bekommt die wartenden Reservierungen + die bereits gelesenen
 * Stock-Sheet-Daten und liefert pro Reservierung einen Status. Genutzt vom
 * manuellen „Lager-Check"-Button und vom täglichen Cron
 * (/api/cron/reservations-check) — beide gehen durch denselben Code.
 * Smoke-Test: scripts/smoke/reservation-stock-check.spec.mjs
 *
 * Herausgelöst aus scanReservationsAgainstStock() (chat-reservations.ts),
 * Matching-Logik unverändert übernommen.
 */
import type { AlertProduct, InventoryRow } from "@/lib/stock-sheets";
import { berlinTodayIso, pickEta } from "@/lib/chatbot/eta-pick";

export type ReservationStockStatus = "in_stock" | "unterwegs" | "out_of_stock" | "unknown" | "service_item";

export interface StockCheckResult {
  reservationId: string;
  productName: string;
  status: ReservationStockStatus;
  eta?: string;
  matchedProduct?: string;
  /** Shopify-URL der gematchten Lager-Zeile (nur bei in_stock) */
  matchedUrl?: string;
  /**
   * Nur bei in_stock: Anzahl verschiedener Lager-Varianten (Produkt × Gewicht ×
   * Linie), die auf die Reservierung passen — egal ob mit Bestand. 1 = die
   * Reservierung beschreibt GENAU eine Variante → eindeutig (Voraussetzung für
   * die automatische Benachrichtigung). >1 = z.B. Clip ohne Gramm-Angabe.
   */
  variantCount?: number;
  reason?: string;
}

export interface ReservationForMatch {
  id: string;
  product_name: string;
  color: string | null;
  method: string | null;
  line?: "russisch" | "usbekisch" | null;
  length_cm?: number | null;
  method_kind?: string | null;
  structured_complete?: boolean | null;
}

export interface StockSnapshot {
  /** Lager-Zeilen aus „Russisch - GLATT" bzw. „Usbekisch - WELLIG" */
  ru: InventoryRow[];
  uz: InventoryRow[];
  /** "Total Weight for …"-Zeilen je Tab (fertig geschriebene Collections), optional für Tests */
  ruCompleted?: string[];
  uzCompleted?: string[];
  /** Dashboard-Alerts, bereits um archivierte Bestellungen bereinigt */
  unterwegs: AlertProduct[];
  nullbestand: AlertProduct[];
}

// Gewicht einer Sheet-Zeile: Lager-Zeilen haben unitWeight; Alert-Zeilen
// (unterwegs/nullbestand) nur variant ("150") bzw. "[150g]" im Produktnamen.
// Ohne diesen Fallback griff der Gewichtsfilter bei „unterwegs" nie →
// „RAW Clip-Ins 225g" bekam die ETA der [150g]-Variante.
function rowGrams(row: { unitWeight?: number; variant?: string | null; product?: string }): number | null {
  if (row.unitWeight) return row.unitWeight;
  const v = row.variant ? parseInt(row.variant, 10) : NaN;
  if (Number.isFinite(v) && v > 0) return v;
  const m = (row.product || "").match(/\[(\d{2,4})\s*g\]/i);
  return m ? parseInt(m[1], 10) : null;
}

// ETA wie beim Bot (eta-pick): frühester ZUKÜNFTIGER Termin, nie ein
// vergangenes Datum. Alle Termine überfällig → "überfällig".
function etaFor(perOrder: AlertProduct["perOrder"] | undefined, todayIso: string): string {
  const picked = pickEta(perOrder, todayIso);
  if (picked.text) return picked.text;
  return picked.overdue ? "überfällig" : "bald";
}

// Verschiedene Varianten zählen — dieselbe Variante kann im Sheet unter
// mehreren Collections stehen, das macht sie nicht mehrdeutig.
function countVariants(rows: { product: string; unitWeight: number; _line: string }[]): number {
  return new Set(rows.map(r => `${r._line}|${r.product.trim().toLowerCase()}|${r.unitWeight}`)).size;
}

/**
 * Vollständigkeit der Lager-Tabs. Apps Script (fetchShopifyInventoryData,
 * Trigger 9 + 18 Uhr) baut die Tabs in Batches neu auf — wer mittendrin liest,
 * bekommt eine halbe Tabelle (beobachtet 12.11.2026: RU 1 → 100 → … Zeilen über
 * 20+ Minuten). Darauf darf weder ein Status gespeichert noch eine Kundin
 * angeschrieben werden.
 *
 * Signal: Das Script arbeitet die Collections strikt in Listen-Reihenfolge ab
 * (collectionGroups FirstSheet = Usbekisch, SecondSheet = Russisch in Code.js)
 * und schreibt "Total Weight for <Collection>", sobald eine fertig ist.
 * Steht die Total-Zeile der LETZTEN Collection eines Tabs da, ist der Tab
 * komplett. (Collections, die es in Shopify nicht gibt — z.B. „Invisible Mini
 * Tapes" — überspringt das Script ohne Total-Zeile; deshalb nicht jede prüfen.)
 * Ändert sich die letzte Collection in Code.js, schlägt der Check laut fehl
 * (sicher) → hier nachziehen.
 */
export const LAST_COLLECTION = {
  uz: "Ponytail Extensions kaufen",
  ru: "Russische Invisible Tressen (Glatt) | Butterfly Weft",
};
/** Zusätzliche Untergrenze (Stand 11/2026: ~320 RU, ~300 UZ Zeilen). */
export const MIN_INVENTORY_ROWS_PER_SHEET = 100;

/** null = Snapshot vollständig, sonst Grund für den Abbruch. */
export function snapshotProblem(stock: StockSnapshot): string | null {
  for (const [key, label] of [["ru", "Russisch"], ["uz", "Usbekisch"]] as const) {
    const rows = stock[key];
    if (rows.length < MIN_INVENTORY_ROWS_PER_SHEET) {
      return `Lager-Sheet ${label} unvollständig (${rows.length} Zeilen, erwartet ≥ ${MIN_INVENTORY_ROWS_PER_SHEET}) — vermutlich läuft gerade der Sheet-Refresh`;
    }
    const done = stock[key === "ru" ? "ruCompleted" : "uzCompleted"];
    if (done && !done.some(c => c.trim().toLowerCase() === LAST_COLLECTION[key].toLowerCase())) {
      return `Lager-Sheet ${label} unvollständig (letzte Collection „${LAST_COLLECTION[key]}" noch nicht fertig) — vermutlich läuft gerade der Sheet-Refresh`;
    }
  }
  return null;
}

export function matchReservationsAgainstStock(
  rows: ReservationForMatch[],
  stock: StockSnapshot,
  todayIso: string = berlinTodayIso(),
): StockCheckResult[] {
  const { unterwegs, nullbestand } = stock;
  // 🔑 LINE-AWARENESS: jede Inventory-Row trägt jetzt ihre Linie aus dem
  // Sheet-Namen — verhindert falsche Cross-Line-Matches (z.B. "Mocha Melt
  // US Wellige Tape" matchte fälschlich "MOCHAMELT STANDARD RUSSISCHE TAPE").
  type LineTaggedRow = InventoryRow & { _line: "russisch" | "usbekisch" };
  const allInventory: LineTaggedRow[] = [
    ...stock.ru.map(r => ({ ...r, _line: "russisch" as const })),
    ...stock.uz.map(r => ({ ...r, _line: "usbekisch" as const })),
  ];

  // Line-Extraction aus Sheet-Row (für unterwegs/nullbestand die collection-Strings haben)
  const extractLineFromText = (text: string): "russisch" | "usbekisch" | null => {
    const t = text.toLowerCase();
    if (/\b(russisch|russische|glatt|glatte|ru\s*glatt)\b/.test(t)) return "russisch";
    if (/\b(usbekisch|usbekische|wellig|wellige|us\s*wellig)\b/.test(t)) return "usbekisch";
    return null;
  };

  // STOP-Words: NUR reine Beschreiber, die KEINE Method/Subtype-Bedeutung haben.
  // ⚠️ NICHT IN STOP (wichtig!): tape/tapes/extension/extensions/standard/mini/
  //    genius/classic/invisible/bondings/tressen/clip/weft/ponytail — diese
  //    Tokens unterscheiden Method×Subtype und MÜSSEN im Match drinbleiben,
  //    sonst matched z.B. "Standard Tape" fälschlich gegen "Invisible Clip Extensions"
  //    nur weil beide die gleiche Farbe haben. (Bug-Report 2026-05)
  const STOP = new Set([
    "und", "in", "die", "der", "das", "den", "ein", "eine", "mit", "für", "auf",
    "russisch", "russische", "russischer", "usbekisch", "usbekische", "usbekischer",
    "us", "wellige", "wellig", "glatt", "glatte", "glatten",
    "echthaar", "echte", "haar", "haare",
    "braun", "braune", "brauner", "blond", "blonde", "blonder",
    "balayage", "ombre", "ombré", "solide",
    "premium", "luxury",
  ]);

  // Service-Items (nicht Inventar) — Klasse C
  const SERVICE_ITEM_RE = /^\s*(farbring|farbprobe|broschüre|broschuere|pflegeset|musterset|katalog|beratung|gutschein|voucher)\s*$/i;

  // Gewicht-/Längen-Token aus Suchstring extrahieren (Klasse B):
  // Sheet hat unitWeight als eigene Spalte, NICHT im Produktnamen → "150g"
  // muss als separates Filter dienen, nicht als Substring-Token.
  const GRAM_RE = /(\d{2,4})\s*g(?:ramm)?\b/i;
  const LENGTH_CM_RE = /(\d{2,3})\s*cm\b/i;

  const tokenize = (s: string): string[] => {
    return s
      .toLowerCase()
      .replace(/[^a-z0-9äöüß/\s\-]+/gi, " ")
      .split(/[\s\-]+/)
      .filter(t => t && t.length > 1 && !STOP.has(t));
  };

  // Subtype-Awareness: "Standard Tapes" ist DEFAULT — Sheet-Collections im
  // Usbekisch-Bereich heißen nur "Tapes Wellig 65cm" (ohne expliziten
  // "Standard"-Prefix). Wir strippen "standard" aus tokens UND verlangen
  // dass haystack KEINEN expliziten anderen Subtype enthält
  // (Mini/Genius/Classic/Invisible). So matched Standard ↔ ungenanntes
  // Subtype, ohne fälschlich Mini/Genius zu treffen.
  const classifySubtype = (s: string | undefined): {
    wantsMini: boolean; wantsGenius: boolean; wantsClassic: boolean; wantsInvisible: boolean; wantsDefault: boolean;
  } => {
    const txt = (s || "").toLowerCase();
    const wantsMini = /\bmini\b/.test(txt);
    const wantsGenius = /\bgenius\b/.test(txt);
    const wantsClassic = /\bclassic\b/.test(txt);
    const wantsInvisible = /\b(invisible|butterfly)\b/.test(txt);
    return {
      wantsMini, wantsGenius, wantsClassic, wantsInvisible,
      wantsDefault: !wantsMini && !wantsGenius && !wantsClassic && !wantsInvisible,
    };
  };

  // ── COMPOUND-COLOR-GUARD ──────────────────────────────────────────────
  // Aus product_colors automatisch detektiert (siehe scripts/tmp/build-
  // modifiers-v2.mjs): Modifier-Token, die einen anderen Farbnamen schaffen.
  //   smoky     → SMOKY TAUPE  (vs. TAUPE)
  //   macadamia → MACADAMIA GLOW (vs. GLOW)
  //   cherry    → CHERRY RED (vs. RED)
  //   3t        → 3T PEARL WHITE (vs. PEARL WHITE)
  //   5m        → 5M/SILVER (vs. SILVER)
  // Bei neuen Compound-Farben: script erneut laufen lassen, Liste ergänzen.
  const COMPOUND_MODIFIERS = ["smoky", "macadamia", "cherry", "3t", "5m"];
  const modifierRegexes = COMPOUND_MODIFIERS.map(m => ({
    mod: m,
    re: new RegExp(`(^|[^a-z0-9])${m}([^a-z0-9]|$)`, "i"),
  }));

  // Match-Helper mit Plural-Toleranz + Subtype-Conflict-Check + Compound-Guard
  const matchTokens = (toks: string[], wants: ReturnType<typeof classifySubtype>, searchText: string) => {
    // searchHasModifier: hat der Reservierungs-String selbst diesen Modifier?
    // Wir vergleichen das ORIGINAL-text (nicht die Tokens), damit auch
    // "Smoky Taupe" als "smoky" detektiert wird (in Tokens steht ja "smoky" + "taupe").
    const searchHasModifier = new Set(
      modifierRegexes.filter(({ re }) => re.test(searchText)).map(({ mod }) => mod)
    );
    return (text: string) => {
    const hay = text.toLowerCase();
    // Token-Substring-Check (mit Plural-Toleranz)
    for (const t of toks) {
      if (hay.includes(t)) continue;
      if (t.length > 2 && t.endsWith("s") && hay.includes(t.slice(0, -1))) continue;
      if (t.length > 3 && t.endsWith("en") && hay.includes(t.slice(0, -2))) continue;
      return false;
    }
    // COMPOUND-COLOR-GUARD: wenn haystack einen Modifier-Token enthält,
    // den die Reservierung NICHT erwähnt → ANDERE Farbe → Reject.
    // Gilt auch UMGEKEHRT: wenn Reservierung "SMOKY TAUPE" sagt aber row
    // nur "TAUPE" → searchHas={smoky}, hay enthält nicht "smoky" → kein
    // Reject hier, aber matchTokens scheitert eh weil "smoky"-Token in
    // toks fehlt im hay. Symmetrie durch Token-Match.
    for (const { mod, re } of modifierRegexes) {
      if (!re.test(text)) continue;
      if (!searchHasModifier.has(mod)) return false;
    }
    // Subtype-Conflict-Check: haystack-Subtype muss zu wants passen
    const hayMini = /\bmini[\s-]?tape/i.test(text);
    const hayGenius = /\bgenius\b/i.test(text);
    const hayClassic = /\bclassic\b/i.test(text);
    // ⚠️ Wichtig: Bei Clip-Extensions ist "Invisible" Marken-Bestandteil (alle
    // Hairvenly-Clip-Ins heißen "Invisible Clip Extensions"), KEIN Subtype.
    // Bei Tape/Tresse/Bonding hingegen IST "Invisible" ein echter Subtype
    // (Invisible Wefts / Butterfly Wefts).
    // → Invisible-Subtype-Check nur wenn search NICHT explizit Clip ist.
    const searchIsClip = toks.some(t => /^clip$/i.test(t)) || toks.some(t => /^ins$/i.test(t));
    const hayInvisible = /\b(invisible|butterfly)\b/i.test(text);
    if (wants.wantsMini !== hayMini) return false;
    if (wants.wantsGenius !== hayGenius) return false;
    if (wants.wantsClassic !== hayClassic) return false;
    if (!searchIsClip && wants.wantsInvisible !== hayInvisible) return false;
    return true;
    };
  };

  // ── STRUKTURIERTER MATCH-HELPER ───────────────────────────────────────
  // Wenn die Reservierung structured_complete=true ist (Linie + Länge +
  // method_kind alle gesetzt), nutzen wir AUSSCHLIESSLICH diese 3 Felder
  // + die Farbe für den Match. Keine Heuristik, keine Subtype-Inferenz.
  // Single-Source-of-Truth, deterministisch.
  const METHOD_KIND_RE: Record<string, RegExp> = {
    tape:           /\bstandard\s+(russische|tape|usbekisch)|\b(?<!mini\s)tape(?:\s|s|$)/i,
    mini_tape:      /\bmini[\s-]?tape/i,
    genius_weft:    /\bgenius[\s-]?(weft|tresse|tressen)/i,
    classic_weft:   /\bclassic[\s-]?(weft|tresse|tressen)/i,
    invisible_weft: /\b(invisible|butterfly)[\s-]?(weft|tresse|tressen)/i,
    bonding:        /\bbonding/i,
    clip:           /\b(invisible|standard)?\s*clip[\s-]?(extension|ext|in)/i,
    ponytail:       /\bponytail/i,
  };
  const structuredMatch = (
    row: { collection?: string; product?: string; unitWeight?: number; variant?: string | null; _line?: "russisch" | "usbekisch" },
    res: { line: string | null; length_cm: number | null; method_kind: string | null; color: string | null; grams: number | null },
  ): boolean => {
    const text = `${row.collection || ""} ${row.product || ""}`.toLowerCase();
    // Gewicht (z.B. Clip-Ins 150g/225g) — Sheet führt es als eigene Spalte
    if (res.grams !== null) {
      const g = rowGrams(row);
      if (g !== null && Math.abs(g - res.grams) > 5) return false;
    }
    // Line
    if (res.line) {
      const rowLine = row._line || extractLineFromText(row.collection || "");
      if (!rowLine || rowLine !== res.line) return false;
    }
    // Length: explicit in text muss matchen; bei russisch impliziert 60cm
    if (res.length_cm !== null) {
      const productLengthMatch = text.match(LENGTH_CM_RE);
      if (productLengthMatch) {
        if (parseInt(productLengthMatch[1], 10) !== res.length_cm) return false;
      } else {
        // Keine Länge im Produkt → russisch=60 implicit
        if (res.line === "russisch" && res.length_cm !== 60) return false;
        // Usbekisch ohne explizite Länge im Produkt → kein Match (cm muss klar sein)
        if (res.line === "usbekisch") return false;
      }
    }
    // Method-Kind
    if (res.method_kind) {
      const re = METHOD_KIND_RE[res.method_kind];
      if (re && !re.test(text)) return false;
      // Cross-Method-Conflict: andere method_kinds dürfen NICHT matchen
      // (z.B. wenn "tape" gewünscht, darf row kein "mini tape" oder "bonding" sein)
      for (const [other, otherRe] of Object.entries(METHOD_KIND_RE)) {
        if (other === res.method_kind) continue;
        // Edge: tape vs mini_tape — tape soll nicht auf mini matchen
        if (otherRe.test(text)) {
          // Wenn die gewünschte method_kind im text dennoch klar matched, OK
          if (re && re.test(text) && res.method_kind === "tape" && other === "mini_tape") {
            // tape-Pattern soll nicht auf "mini tape"-Produkte fallen
            return false;
          }
          // Generelle Cross-Method-Conflict: andere Method dominiert → reject
          if (res.method_kind === "tape" && (other === "mini_tape" || other === "bonding" || other === "clip" || other === "ponytail")) return false;
          if (res.method_kind === "mini_tape" && other === "tape") {
            // tape-Pattern triggert auch bei "mini tape"-Produkten → OK
            continue;
          }
          // Andere Methods sollten nicht überschneiden
          if (["bonding","clip","ponytail","genius_weft","classic_weft","invisible_weft"].includes(res.method_kind) && other !== res.method_kind) {
            return false;
          }
        }
      }
    }
    // Color: tokens müssen alle als Substring vorkommen
    if (res.color) {
      // Gewicht aus der Farbe raus ("#EBONY 150g") — steht nie im Produktnamen
      const colorTokens = res.color.replace(GRAM_RE, " ").toLowerCase().split(/[\s\-_/]+/).filter(t => t.length > 1);
      for (const ct of colorTokens) {
        if (!text.includes(ct)) return false;
      }
      // Compound-Color-Guard auch hier: wenn haystack einen Modifier hat
      // den die Reservierung nicht erwähnt → andere Farbe
      const searchHasModifier = new Set(
        modifierRegexes.filter(({ re }) => re.test(res.color || "")).map(({ mod }) => mod)
      );
      for (const { mod, re } of modifierRegexes) {
        if (!re.test(text)) continue;
        if (!searchHasModifier.has(mod)) return false;
      }
    }
    return true;
  };

  const results: StockCheckResult[] = [];
  for (const r of rows) {
    // SERVICE-ITEM-Check FRÜH (Klasse C) — "Farbring" etc. sind nicht im Lager
    if (SERVICE_ITEM_RE.test(r.product_name || "")) {
      results.push({
        reservationId: r.id,
        productName: r.product_name,
        status: "service_item",
        reason: "Kein Inventar-Item — separat handhaben (Marketing/Service)",
      });
      continue;
    }

    // ── STRUKTURIERTER PFAD ─────────────────────────────────────────────
    // Wenn MA die Maske komplett ausgefüllt hat (structured_complete=true),
    // nutzen wir den deterministischen strukturierten Matcher und überspringen
    // die Heuristik komplett.
    const rWithStruct = r as typeof r & {
      line?: "russisch" | "usbekisch" | null;
      length_cm?: number | null;
      method_kind?: string | null;
      structured_complete?: boolean;
    };
    if (rWithStruct.structured_complete && rWithStruct.line && rWithStruct.length_cm && rWithStruct.method_kind) {
      const structFields = {
        line: rWithStruct.line,
        length_cm: rWithStruct.length_cm,
        method_kind: rWithStruct.method_kind,
        color: r.color,
        grams: (() => {
          const gm = [r.color, r.method, r.product_name].filter(Boolean).join(" ").match(GRAM_RE);
          return gm ? parseInt(gm[1], 10) : null;
        })(),
      };
      const sMatch = (row: Parameters<typeof structuredMatch>[0]) => structuredMatch(row, structFields);
      const matchedS = allInventory.filter(row => sMatch(row));
      const stockedS = matchedS.filter(row => row.quantity > 0);
      if (stockedS.length > 0) {
        results.push({
          reservationId: r.id, productName: r.product_name, status: "in_stock",
          matchedProduct: stockedS[0].product, matchedUrl: stockedS[0].url || undefined,
          variantCount: countVariants(matchedS),
        });
        continue;
      }
      const onTheWayS = unterwegs.filter(u => sMatch(u));
      if (onTheWayS.length > 0) {
        const eta = etaFor(onTheWayS[0].perOrder, todayIso);
        results.push({ reservationId: r.id, productName: r.product_name, status: "unterwegs", eta, matchedProduct: onTheWayS[0].product });
        continue;
      }
      const oosS = nullbestand.filter(p => sMatch(p));
      if (oosS.length > 0) {
        results.push({ reservationId: r.id, productName: r.product_name, status: "out_of_stock", matchedProduct: oosS[0].product });
        continue;
      }
      results.push({ reservationId: r.id, productName: r.product_name, status: "unknown", reason: "Strukturierter Match fand kein Produkt" });
      continue;
    }

    // ── FALLBACK: HEURISTIK-PFAD ────────────────────────────────────────
    // Reservierung hat noch keine strukturierten Felder → alter Free-Text-Match.
    const searchStr = [r.color, r.method, r.product_name].filter(Boolean).join(" ");

    // Gewicht-/Längen-Filter extrahieren (Klasse B)
    let targetGrams: number | null = null;
    let targetLengthCm: number | null = null;
    const gMatch = searchStr.match(GRAM_RE);
    if (gMatch) targetGrams = parseInt(gMatch[1], 10);
    const lMatch = searchStr.match(LENGTH_CM_RE);
    if (lMatch) targetLengthCm = parseInt(lMatch[1], 10);
    // Gewicht- und Längen-Marker aus dem Suchstring entfernen — werden
    // jetzt als separates Match-Kriterium gegen unitWeight bzw. Produktname behandelt.
    const cleanedSearch = searchStr
      .replace(GRAM_RE, " ")
      .replace(LENGTH_CM_RE, " ");

    // Subtype-Klassifizierung: basiert auf method UND product_name, weil
    // manche Reservierungen den Subtype nur im product_name haben.
    const subtypeSrc = `${r.method || ""} ${r.product_name || ""}`;
    const wants = classifySubtype(subtypeSrc);

    // 🔑 LINE-Extraction aus Reservierung: explizite Schlüsselworte
    // ("us wellige", "russisch", etc.) → Filter auf gleiche Linie im Sheet.
    // Wenn KEINE Linie genannt → unspecified, matched gegen beide Linien.
    const reservationLine = extractLineFromText(searchStr);

    // "standard" ist DEFAULT-Subtype → strip aus tokens (sonst scheitert
    // Match gegen Usbekisch-Sheet wo die Collection nur "Tapes Wellig" heißt,
    // kein "Standard"-Prefix). Bei wantsMini/Genius/Classic/Invisible bleibt
    // der explizite Subtype-Token natürlich im Set.
    let tokens = tokenize(cleanedSearch);
    if (wants.wantsDefault) {
      tokens = tokens.filter(t => t !== "standard");
    }
    if (tokens.length === 0) {
      results.push({ reservationId: r.id, productName: r.product_name, status: "unknown", reason: "Keine identifizierbaren Such-Tokens" });
      continue;
    }
    // searchStr ist der Original-Reservierungs-Text (Farbe + Method + Name),
    // den der Compound-Guard analysiert um Modifier-Tokens zu erkennen.
    const tokenMatch = matchTokens(tokens, wants, searchStr);
    // Farb-Identität: "balayage"/"ombré" sind STOP-Wörter (Beschreiber), gehören
    // aber teils zum Farbnamen — „Latte Balayage" traf sonst auch „Latte Brown".
    // Nennt die Reservierungs-FARBE so ein Wort, muss die Zeile es auch tragen.
    const colorIdentity = (r.color || "").toLowerCase().match(/\b(balayage|ombr[eé])\b/g) ?? [];
    const colorIdentityOk = (text: string) => {
      const hay = text.toLowerCase().replace(/ombré/g, "ombre");
      return colorIdentity.every(w => hay.includes(w.replace("é", "e")));
    };

    // Match-Helper: berücksichtigt Tokens + Subtype + Gewicht + Länge + Linie
    const fullMatch = (row: { collection?: string; product?: string; unitWeight?: number; variant?: string | null; _line?: "russisch" | "usbekisch" }) => {
      const text = `${row.collection || ""} ${row.product || ""}`;
      // 🔑 LINIEN-FILTER: wenn Reservierung explizite Linie hat, MUSS row dazu passen
      if (reservationLine) {
        const rowLine = row._line || extractLineFromText(row.collection || "");
        if (rowLine && rowLine !== reservationLine) return false;
      }
      if (!tokenMatch(text)) return false;
      if (!colorIdentityOk(text)) return false;
      if (targetGrams !== null) {
        const g = rowGrams(row);
        if (g !== null && Math.abs(g - targetGrams) > 5) return false;
      }
      if (targetLengthCm !== null) {
        const productLengthMatch = text.match(LENGTH_CM_RE);
        if (productLengthMatch && parseInt(productLengthMatch[1], 10) !== targetLengthCm) return false;
        // RUSSISCH-IMPLICIT: Russisch-Tapes/Bondings/Wefts haben KEIN "60cm" im
        // Produktnamen (Convention). Wenn Reservierung explizit z.B. 65cm fordert
        // UND row ist russisch → ist immer 60cm → reject.
        // (User-Bug 2026-05-27: "NORVEGIAN Standard Tapes 65cm" matchte fälschlich
        //  "#NORVEGIAN STANDARD RUSSISCHE TAPE EXTENSIONS GLATT" — das ist 60cm.)
        if (!productLengthMatch) {
          const rowLine = row._line || extractLineFromText(row.collection || "");
          if (rowLine === "russisch" && targetLengthCm !== 60) return false;
        }
      }
      return true;
    };

    const matched = allInventory.filter(row => fullMatch(row));
    const stocked = matched.filter(row => row.quantity > 0);
    if (stocked.length > 0) {
      results.push({
        reservationId: r.id,
        productName: r.product_name,
        status: "in_stock",
        matchedProduct: stocked[0].product,
        matchedUrl: stocked[0].url || undefined,
        variantCount: countVariants(matched),
      });
      continue;
    }
    const onTheWay = unterwegs.filter(u => fullMatch(u));
    if (onTheWay.length > 0) {
      const eta = etaFor(onTheWay[0].perOrder, todayIso);
      results.push({
        reservationId: r.id,
        productName: r.product_name,
        status: "unterwegs",
        eta,
        matchedProduct: onTheWay[0].product,
      });
      continue;
    }
    const oos = nullbestand.filter(p => fullMatch(p));
    if (oos.length > 0) {
      results.push({
        reservationId: r.id,
        productName: r.product_name,
        status: "out_of_stock",
        matchedProduct: oos[0].product,
      });
      continue;
    }
    results.push({ reservationId: r.id, productName: r.product_name, status: "unknown" });
  }  return results;
}

// ── Persistenz-Ableitung ────────────────────────────────────────────────
// Was wird pro Reservierung nach einem Lager-Check gespeichert? Rein, damit
// der Smoke-Test die Übergänge festnageln kann.
//   in_stock_since: Zeitpunkt, ab dem die Ware (wieder) als vorrätig erkannt
//   wurde — bleibt stehen, solange sie vorrätig bleibt, wird beim Verlassen
//   von in_stock geleert. So zeigt die Liste „seit wann wartet die Kundin
//   schon unnötig?" und ein erneuter Check verschiebt das Datum nicht.
export interface PreviousStockState {
  id: string;
  last_stock_status: ReservationStockStatus | null;
  in_stock_since: string | null;
}

export interface StockStatusUpdate {
  id: string;
  last_stock_status: ReservationStockStatus;
  last_stock_eta: string | null;
  last_stock_match: string | null;
  last_stock_reason: string | null;
  last_checked_at: string;
  in_stock_since: string | null;
}

export function planStockStatusUpdates(
  previous: PreviousStockState[],
  results: StockCheckResult[],
  nowIso: string,
): StockStatusUpdate[] {
  const prevById = new Map(previous.map(p => [p.id, p]));
  return results.map(r => {
    const prev = prevById.get(r.reservationId);
    const wasInStock = prev?.last_stock_status === "in_stock" && !!prev.in_stock_since;
    return {
      id: r.reservationId,
      last_stock_status: r.status,
      last_stock_eta: r.eta ?? null,
      last_stock_match: r.matchedProduct ?? null,
      last_stock_reason: r.reason ?? null,
      last_checked_at: nowIso,
      in_stock_since: r.status === "in_stock" ? (wasInStock ? prev!.in_stock_since : nowIso) : null,
    };
  });
}
