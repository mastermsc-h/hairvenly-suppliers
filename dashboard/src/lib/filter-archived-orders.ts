import type { AlertProduct, TopsSellerSection } from "@/lib/stock-sheets";
import type { OrderMeta } from "@/lib/order-name-map";
import { isArchived } from "@/lib/order-name-map";

/** Format ISO YYYY-MM-DD to German DD.MM.YYYY for display in stock sheets. */
function formatDeDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

/**
 * Build the "ankunft" display string from an OrderMeta.
 * Returns null if there's nothing to display.
 *
 * Priority:
 *   1. Per-position ETA (from order_items.eta, joined via product_colors)
 *      if there's a match for the AlertProduct's Shopify name.
 *      Multiple distinct values → "T1: 28.05. · T2: 15.06.2026"
 *   2. Partial shipment ETAs (un-arrived order_shipments) — concatenated.
 *   3. The order's main ETA from orders.eta.
 *   4. Fallback: keep original sheet ankunft.
 */
/**
 * Normalize a product name for fuzzy token matching:
 *  - lowercase
 *  - drop punctuation (#, ♡, etc.)
 *  - split into tokens >=3 chars
 *  - drop method/line/material stopwords (only color-words + length remain)
 */
function normalizeForMatch(s: string): Set<string> {
  const STOP = new Set([
    "extensions", "extension", "tape", "tapes", "bonding", "bondings",
    "tressen", "weft", "wefts", "clip", "clipins", "ponytail", "ponytails",
    "russisch", "russische", "russisches", "russischen",
    "usbekisch", "usbekische", "usbekischen", "us",
    "glatt", "glatte", "glattes", "wellig", "wellige", "welliges",
    "echthaar", "haar", "haare", "keratin", "mini", "standard",
    "classic", "invisible", "genius", "butterfly",
  ]);
  return new Set(
    s.toLowerCase()
      .replace(/[^a-zäöüß0-9\s]/g, " ")
      .split(/\s+/)
      .filter(t => t.length >= 3 && !STOP.has(t))
  );
}

/**
 * Token-Stamm-Match: behandelt Flexionen wie "aschbraun" ≈ "aschbraune".
 * Erlaubt, wenn beide Tokens >=4 Zeichen UND einer Prefix vom anderen ist.
 */
function tokensMatchByStem(t1: string, t2: string): boolean {
  if (t1 === t2) return true;
  if (t1.length < 4 || t2.length < 4) return false;
  return t1.startsWith(t2) || t2.startsWith(t1);
}

/**
 * Fuzzy-Match: Sheet-AlertProduct-Name vs DB-name_shopify-Key.
 *
 * Beispiele:
 *   "Pearl White Russische Bondings 60cm" vs "#PEARL WHITE RUSSISCHE BONDINGS GLATT 1G"
 *     → A={pearl,white,60cm} ∩ B={pearl,white} → 2 Treffer → match
 *   "Norvegian Russische Bondings 60cm" vs "#NORVEGIAN RUSSISCHE BONDINGS GLATT 1G"
 *     → A={norvegian,60cm} ∩ B={norvegian} → 1 Treffer, B hat nur 1 Token → match
 *   "2A Aschbraun Tape 55cm" vs "#2A ASCHBRAUNE US WELLIGE TAPE EXTENSIONS 55CM"
 *     → "aschbraun" ≈ "aschbraune" (Prefix) → match
 *
 * Schwelle:
 *   - Wenn beide Sets >2 Tokens haben: braucht ≥2 Matches (Defense gegen FP)
 *   - Wenn entweder A oder B nur 1-2 Tokens hat: 1 Match reicht (kleine Sets,
 *     jedes Token ist signifikant — eine 1-Token-DB-Color ist eindeutig)
 */
function fuzzyMatchProductKey(sheetName: string, dbKey: string): boolean {
  const a = normalizeForMatch(sheetName);
  const b = normalizeForMatch(dbKey);
  if (a.size === 0 || b.size === 0) return false;
  let overlap = 0;
  for (const t of a) {
    for (const t2 of b) {
      if (tokensMatchByStem(t, t2)) {
        overlap++;
        break;
      }
    }
  }
  const minSize = Math.min(a.size, b.size);
  const required = minSize <= 2 ? 1 : 2;
  return overlap >= required;
}

function buildAnkunftFromMeta(meta: OrderMeta, productName?: string): string | null {
  // 1) Per-position ETA: look up by Shopify product name (AlertProduct.product).
  //    If multiple ETAs exist for this product in this order (split delivery),
  //    show the EARLIEST one — that's the precise next-arrival date for at least
  //    some of the stock.
  if (productName) {
    // (a) exact name_shopify match
    const positionEtas = meta.itemEtasByShopify.get(productName);
    if (positionEtas && positionEtas.length > 0) {
      return `ca. Ankunft: ${formatDeDate(positionEtas[0])}`;
    }
    // (b) Bug 2026-05-30: Sheet-AlertProduct-Namen sind oft NICHT
    //     identisch zu DB-name_shopify ("Pearl White Russische Bondings 60cm"
    //     vs "#PEARL WHITE RUSSISCHE BONDINGS GLATT 1G"). Fuzzy-match per
    //     normalisierten Tokens (Color-Name + optional Length/Variant).
    //     Wenn mehrere Keys matchen, nehmen wir das früheste ETA aller Treffer.
    let earliestFuzzy: string | null = null;
    for (const [dbKey, etas] of meta.itemEtasByShopify.entries()) {
      if (etas.length === 0) continue;
      if (fuzzyMatchProductKey(productName, dbKey)) {
        const candidate = etas[0]; // etas already sorted asc
        if (!earliestFuzzy || candidate < earliestFuzzy) earliestFuzzy = candidate;
      }
    }
    if (earliestFuzzy) {
      return `ca. Ankunft: ${formatDeDate(earliestFuzzy)}`;
    }

    // (c) Wenn KEINE per-Position-ETA gefunden ABER der Shopify-Name in
    //     arrivedShopifyNames steht → alle Items dieses Produkts waren in
    //     einer angekommenen Teillieferung. Bot soll NICHT auf order.eta
    //     zurückfallen — das Produkt ist physisch da.
    //     Fuzzy-Variante: auch wenn nur ein arrivedShopify-Eintrag fuzzy
    //     matched, gilt das als "ist da" für diese Bestellung.
    if (meta.arrivedShopifyNames && meta.arrivedShopifyNames.size > 0) {
      if (meta.arrivedShopifyNames.has(productName)) return null;
      for (const arrivedName of meta.arrivedShopifyNames) {
        if (strictFuzzyMatch(productName, arrivedName)) return null;
      }
    }
  }
  // 2) Partial shipments — use earliest un-arrived ETA
  if (meta.shipmentEtas.length > 0) {
    return `ca. Ankunft: ${formatDeDate(meta.shipmentEtas[0])}`;
  }
  // 3) Order-level ETA — aber NUR wenn diese in der Zukunft liegt.
  //    Bug 2026-05-30: orders.eta wird beim Order-Anlegen einmal gesetzt
  //    und oft nicht aktualisiert wenn die per-Position-ETAs später ins
  //    Sheet kommen. Eine VERGANGENE orders.eta ist schlechter als kein
  //    Override → wir lassen dann die Original-Sheet-ankunft stehen.
  if (meta.eta) {
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const etaDate = new Date(meta.eta + "T00:00:00Z");
    if (etaDate.getTime() >= today.getTime()) {
      return `ca. Ankunft: ${formatDeDate(meta.eta)}`;
    }
    // vergangenes orders.eta → kein Override (return null → original sheet bleibt)
  }
  return null;
}

/**
 * Identifiziert den Produkt-TYP aus einem Shopify-Namen — damit nicht
 * verschiedene Produkte (Tape vs Clip-Ins vs Bondings) versehentlich als
 * "gleicher Artikel" gematcht werden, nur weil die Farbe gleich ist.
 * Returns null wenn keine eindeutige Zuordnung erkannt.
 */
function productTypeOf(name: string): string | null {
  const n = name.toLowerCase();
  // Reihenfolge wichtig: spezifischere zuerst (mini tape vor tape, etc.)
  if (n.includes("mini tape")) return "minitape";
  if (n.includes("clip extensions") || n.includes("clip-ins") || n.includes("clipins")) return "clip";
  if (n.includes("bondings") || n.includes("bonding")) return "bondings";
  if (n.includes("genius weft")) return "geniusweft";
  if (n.includes("classic weft")) return "classicweft";
  if (n.includes("invisible butterfly") || n.includes("butterfly")) return "butterfly";
  if (n.includes("tressen") || n.includes("weft")) return "weft";
  if (n.includes("tape extensions") || /\btape\b/.test(n)) return "tape"; // Standard Tape
  if (n.includes("ponytail")) return "ponytail";
  return null;
}

/**
 * Strict-fuzzy: wie fuzzyMatchProductKey aber zusätzlich die Produkt-Typen
 * müssen übereinstimmen (oder mindestens einer null sein). Verhindert das
 * versehentliche Matchen Std-Tape ↔ Clip-Ins über gleiche Farbnamen.
 */
function strictFuzzyMatch(a: string, b: string): boolean {
  const ta = productTypeOf(a);
  const tb = productTypeOf(b);
  if (ta && tb && ta !== tb) return false; // verschiedene Produkttypen → niemals match
  return fuzzyMatchProductKey(a, b);
}

/**
 * Prüft ob das gesuchte Shopify-Produkt in einer angekommenen Teillieferung
 * dieser Bestellung war (und es keine weitere offene Position dieses Produkts
 * mehr gibt). Wenn ja → das Sheet zeigt die Bestellung noch als unterwegs,
 * obwohl sie physisch angekommen ist → perOrder-Eintrag soll entfernt werden.
 *
 * Wichtig: 'gleicher Produkt-Typ' (Tape vs Clip vs Bondings) wird strikt
 * unterschieden — sonst hält eine offene Clip-Ins-Position die angekommene
 * Std-Tape-Position fälschlich als 'noch unterwegs'.
 */
function isProductArrivedInOrder(meta: OrderMeta, productName: string): boolean {
  if (!meta.arrivedShopifyNames || meta.arrivedShopifyNames.size === 0) return false;
  // Noch offene per-Position-ETA für DASSELBE Produkt (gleicher Typ)?
  if (meta.itemEtasByShopify.has(productName)) return false;
  for (const dbKey of meta.itemEtasByShopify.keys()) {
    if (strictFuzzyMatch(productName, dbKey)) return false;
  }
  // Keine offenen Positionen desselben Typs — ist der Name in arrivedShopifyNames?
  if (meta.arrivedShopifyNames.has(productName)) return true;
  for (const arrivedName of meta.arrivedShopifyNames) {
    if (strictFuzzyMatch(productName, arrivedName)) return true;
  }
  return false;
}

/**
 * For each perOrder entry whose name maps to a known order in our DB,
 * override the `ankunft` (ETA) field with the order's manually-set ETA.
 *
 * Why: Stock sheets reflect a static ETA from Shopify/Apps Script. Our DB
 * has the manually-updated ETA per order (which can shift earlier or later
 * based on real-world status updates). The DB is the source of truth.
 *
 * Sheet format example: "ca. Ankunft: 02.06.2026"
 * We replicate that format.
 */
export function overrideEtaFromDb(
  items: AlertProduct[],
  orderIdByName?: Record<string, OrderMeta>,
): AlertProduct[] {
  if (!orderIdByName) return items;
  return items.map((item) => {
    let changed = false;
    const newPerOrder = item.perOrder.map((o) => {
      const meta = orderIdByName[o.name];
      if (!meta) return o;
      const newAnkunft = buildAnkunftFromMeta(meta, item.product);
      if (!newAnkunft || newAnkunft === o.ankunft) return o;
      changed = true;
      return { ...o, ankunft: newAnkunft };
    });
    if (!changed) return item;
    return { ...item, perOrder: newPerOrder };
  });
}

/**
 * Remove archived (stocked / cancelled) orders from stock data.
 *
 * Stock sheets reflect Shopify state (which lags). When we mark an order as
 * "Ins Lager eingepflegt" (stocked) or "Storniert" (cancelled), we want it to
 * disappear from all stock views (Unterwegs, Topseller, Nullbestand,
 * Kritisch …) immediately — even though the sheet still mentions it.
 *
 * Strategy:
 *   - For each AlertProduct, drop perOrder entries whose name maps to an
 *     archived order in the orderIdByName map.
 *   - Recompute unterwegsG from the remaining perOrder entries.
 */
export function filterArchivedFromStock(
  items: AlertProduct[],
  orderIdByName?: Record<string, OrderMeta>,
): AlertProduct[] {
  if (!orderIdByName) return items;
  return items.map((item) => {
    // 1) Filter out archived orders
    let kept = item.perOrder.filter((o) => !isArchived(orderIdByName[o.name]));
    // 2) Filter out orders where this product is in an arrived Teillieferung
    //    (Sheet meldet weiter unterwegs, aber DB sagt: ist physisch da)
    kept = kept.filter((o) => {
      const meta = orderIdByName[o.name];
      if (!meta) return true;
      return !isProductArrivedInOrder(meta, item.product);
    });
    // 3) Override ankunft using per-position / shipment / order ETAs (in that priority)
    //    und Quelle markieren: DB-Treffer → etaConfirmed=true (gepflegtes Datum),
    //    kein DB-Datum → Sheet-Wert bleibt, etaConfirmed=false (Schätzung).
    //    So kann der Bot ein unbestätigtes Sheet-Datum nie als fixen Termin ausgeben.
    const withEta = kept.map((o) => {
      const meta = orderIdByName[o.name];
      const dbAnkunft = meta ? buildAnkunftFromMeta(meta, item.product) : null;
      if (dbAnkunft) {
        if (o.ankunft === dbAnkunft && o.etaConfirmed === true) return o;
        return { ...o, ankunft: dbAnkunft, etaConfirmed: true };
      }
      if (o.etaConfirmed === false) return o;
      return { ...o, etaConfirmed: false };
    });
    const dropped = kept.length !== item.perOrder.length;
    const etaChanged = withEta.some((o, i) => o !== kept[i]);
    if (!dropped && !etaChanged) return item;
    const unterwegsG = withEta.reduce((s, o) => s + (o.menge || 0), 0);
    return { ...item, perOrder: withEta, unterwegsG };
  });
}

/**
 * Extract the order "name" (first line) from a topseller orderHeader string
 * like "China 07.04.2026\nca. Ankunft: 02.06.2026".
 */
function headerToOrderName(header: string): string {
  return (header.split("\n")[0] ?? header).trim();
}

/**
 * Same logic as filterArchivedFromStock but for the topseller data structure
 * which uses parallel arrays (orderHeaders[] + each item.perOrder[]).
 *
 * Removes the archived columns from BOTH orderHeaders and every item's
 * perOrder, and recomputes per-item unterwegsG.
 */
export function filterArchivedFromTopseller(
  sections: TopsSellerSection[],
  orderIdByName?: Record<string, OrderMeta>,
): TopsSellerSection[] {
  if (!orderIdByName) return sections;

  return sections.map((sec) => {
    if (sec.orderHeaders.length === 0) return sec;

    // Indices to keep
    const keep: number[] = [];
    sec.orderHeaders.forEach((h, i) => {
      const name = headerToOrderName(h);
      if (!isArchived(orderIdByName[name])) keep.push(i);
    });
    if (keep.length === sec.orderHeaders.length) return sec;

    const newHeaders = keep.map((i) => sec.orderHeaders[i]);

    const newSubSections = sec.sections.map((g) => ({
      ...g,
      items: g.items.map((it) => {
        const newPerOrder = keep.map((i) => it.perOrder[i] ?? 0);
        const unterwegsG = newPerOrder.reduce((s, v) => s + (v || 0), 0);
        return { ...it, perOrder: newPerOrder, unterwegsG };
      }),
    }));

    return { ...sec, orderHeaders: newHeaders, sections: newSubSections };
  });
}
