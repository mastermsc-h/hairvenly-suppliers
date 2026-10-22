/**
 * Reine (I/O-freie) Zuordnungslogik Katalog-Farbe → Shopify-Produkt.
 *
 * Hintergrund (22.10.2026): Shopify-Titel werden laufend umbenannt
 * ("#EBONY STANDARD RUSSISCHE TAPE EXTENSIONS GLATT ♡" →
 * "#Ebony I Tiefes Schwarz I Echthaar I Standard Tape Extensions I RU Glatt ♡"
 * → "#Ebony | Tiefes Schwarz | …"). name_shopify als Schlüssel veraltet damit
 * ständig. Stabil sind nur die Produkt-ID und (meist) der Handle.
 *
 * Zuordnung in dieser Reihenfolge:
 *   1. Handle aus product_colors.shopify_url (überlebt Umbenennungen)
 *      — nur akzeptiert, wenn Methode/Länge des Produkts zur Katalog-Zeile passen
 *   2. Methoden-Collection (+ Länge) + Farb-Token am Titelanfang ("#Ebony …")
 *      — nur bei genau EINEM Kandidaten, sonst unaufgelöst (kein Raten)
 *
 * Keine Imports → von Node direkt ausführbar (Backfill-/Audit-Skripte).
 */

export interface ShopifyProductLite {
  id: string; // GID gid://shopify/Product/…
  title: string;
  handle: string;
  status: string;
  collections: string[]; // Collection-Handles
  variants: { id: string; title: string }[];
}

export interface CatalogColorLite {
  id: string;
  supplierName: string;
  methodName: string;
  lengthValue: string; // "60cm", "45cm", "150g", "one size"
  nameHairvenly: string;
  nameSupplier: string | null;
  nameShopify: string | null;
  shopifyUrl: string | null;
}

export type LinkSource = "handle" | "match";

export interface LinkResult {
  productId: string;
  variantId: string | null;
  source: LinkSource;
}

/** Produktlinie eines Lieferanten: Amanda = russisch glatt, Ebru/Eyfel = usbekisch wellig. */
function lineOf(supplierName: string): "ru" | "us" | null {
  const s = supplierName.toLowerCase();
  if (s.includes("amanda")) return "ru";
  if (s.includes("ebru") || s.includes("eyfel") || s.includes("china")) return "us";
  return null;
}

const methodKey = (m: string) => m.toLowerCase().replace(/[^a-z]/g, "");

/** "45cm" → "45", "150g" → null */
function cmOf(lengthValue: string): string | null {
  const m = lengthValue.match(/^(\d{2})\s*cm$/i);
  return m ? m[1] : null;
}

/**
 * Collection-Handle(s) pro Linie + Methode (+ Länge). Abgeleitet aus dem
 * Shopify-Collection-Bestand vom 22.10.2026. Ebru-Tapes/-Bondings liegen
 * nicht vollständig in tapes-wellig/bondings-wellig, aber zuverlässig in
 * den Längen-Collections (tapes-45cm …).
 */
function collectionsFor(line: "ru" | "us", method: string, lengthValue: string): string[] | null {
  const k = methodKey(method);
  const cm = cmOf(lengthValue);
  if (line === "ru") {
    switch (k) {
      case "standardtapes": return ["russische-normal-tapes"];
      case "minitapes": return ["mini-tapes"];
      case "bondings": return ["bondings-glatt"];
      case "classicweft": return ["tressen-russisch-classic-v2"];
      case "geniusweft": return ["tressen-russisch-genius"];
      case "invisibleweft": return ["tressen-russisch-invisible"];
      case "clipins": return ["clip-extensions"];
      // Ponytail: in Shopify gibt es nur die US-wellige Linie — russische
      // Katalog-Ponytails bleiben bewusst unverknüpft (sonst Fehlzuordnung).
    }
    return null;
  }
  switch (k) {
    case "tapes": return cm ? [`tapes-${cm}cm`] : null;
    case "bondings": return cm ? [`bondings-${cm}cm`] : null;
    case "invisibletapes": return ["invisible-tapes-wellig-65cm"];
    case "butterflytressen": return ["tressen-usbekisch-butterfly"];
    case "classictressen": return ["tressen-usbekisch-classic"];
    case "geniusweft": return ["tressen-usbekisch-genius-v2"];
    case "ponytail": return ["ponytail-extensions"];
  }
  return null;
}

/** Zusätzliche Titel-Plausibilität pro Methode (trennt z.B. Tapes von Invisible Tapes). */
function titleFitsMethod(line: "ru" | "us", method: string, lengthValue: string, title: string): boolean {
  const t = title.toLowerCase();
  const k = methodKey(method);
  if (line === "us") {
    if (/\bru\b|russisch/.test(t)) return false;
  } else if (/us wellig|usbekisch/.test(t)) {
    return false;
  }
  if (k === "tapes" && /invisible/.test(t)) return false;
  if (k === "invisibletapes" && !/invisible/.test(t)) return false;
  const cm = cmOf(lengthValue);
  // Ebru-Produkte tragen die Länge im Titel ("… 85 cm …") — muss passen.
  if (line === "us" && cm) {
    const lens = [...t.matchAll(/(\d{2})\s*cm/g)].map((m) => m[1]);
    if (lens.length > 0 && !lens.includes(cm)) return false;
  }
  return true;
}

/** Kleinbuchstaben, nur a-z/0-9 + Umlaute (für Joined-Vergleich "Bergen blond" = "Bergenblond"). */
const flat = (s: string) =>
  s.toLowerCase().normalize("NFC").replace(/[^a-z0-9äöüß]/g, "");

/** Wörter des Farb-Abschnitts eines Titels: "#5M/Silver Gesträhntes … | Echthaar …" → ["5msilver","gesträhntes",…] */
function titleColorWords(title: string): string[] {
  const head = title.replace(/^[^#]*#/, "").split(/\s+[|I]\s+|\s*\|\s*/)[0] ?? "";
  return head.split(/\s+/).map(flat).filter(Boolean);
}

/** Wörter, die in Katalog-Farbnamen vorkommen, aber nicht zur Farbe gehören. */
const COLOR_NOISE = /\b(us|wellige?|russische?|glatt|invisible|tressen|tape|tapes|extensions?|bondings?|keratin|ru)\b/gi;

function colorCandidates(c: CatalogColorLite): string[] {
  const out: string[] = [];
  const push = (s: string | null | undefined) => {
    if (!s) return;
    const f = flat(s.replace(COLOR_NOISE, " "));
    if (f && !out.includes(f)) out.push(f);
  };
  push(c.nameHairvenly);
  push(c.nameSupplier);
  // Alt-Titel: Farbe direkt nach "#" ("TRESSEN #EBONY TIEFSCHWARZ …" → "EBONY")
  const hash = c.nameShopify?.match(/#\s*([^\s#|♡]+(?:\s+(?:BLOND|BLONDE|WHITE|MELT|FUDGE|CACAO|BROWN|CREAM))?)/i);
  if (hash) push(hash[1]);
  // Shopify schreibt die Farbe uneinheitlich "Norvegian" / "Norwegian".
  for (const f of [...out]) {
    if (f.includes("norvegian")) push(f.replace("norvegian", "norwegian"));
  }
  return out;
}

/** Passt eine Farbe auf den Titelanfang? Vergleicht verbundene Präfixe ganzer Wörter. */
function colorMatchesTitle(color: string, title: string): boolean {
  const words = titleColorWords(title);
  let acc = "";
  for (const w of words) {
    acc += w;
    if (acc === color) return true;
    if (acc.length >= color.length) return false;
  }
  return false;
}

function handleFromUrl(url: string | null): string | null {
  return url?.match(/\/products\/([^/?#]+)/)?.[1] ?? null;
}

/** Variante bei Mehr-Varianten-Produkten (Clip-ins: 100g/150g/225g). */
function pickVariant(p: ShopifyProductLite, lengthValue: string): string | null | undefined {
  if (p.variants.length <= 1) return null; // Single-Variant → keine Varianten-ID nötig
  const want = lengthValue.toLowerCase().replace(/\s+/g, "");
  const v = p.variants.find((x) => x.title.toLowerCase().replace(/\s+/g, "") === want);
  return v ? v.id : undefined; // undefined = Variante nicht gefunden
}

function fitsCatalogRow(p: ShopifyProductLite, c: CatalogColorLite): boolean {
  const line = lineOf(c.supplierName);
  if (!line) return false;
  // Handle-Treffer: Collection ist kein Muss (einzelne Produkte hängen nicht
  // in der Längen-Collection) — Titel-/Längen-/Varianten-Check reicht. Die
  // Farbe wird bewusst NICHT geprüft: Farben wurden umbenannt (Lila → Violett,
  // Orange → Kupfer), der Handle ist hier die verlässlichere Quelle.
  if (!titleFitsMethod(line, c.methodName, c.lengthValue, p.title)) return false;
  return pickVariant(p, c.lengthValue) !== undefined;
}

export function linkCatalogColor(
  c: CatalogColorLite,
  products: ShopifyProductLite[],
  byHandle: Map<string, ShopifyProductLite>,
): LinkResult | null {
  // 1) Handle
  const h = handleFromUrl(c.shopifyUrl);
  const ph = h ? byHandle.get(h) : undefined;
  if (ph && fitsCatalogRow(ph, c)) {
    return { productId: ph.id, variantId: pickVariant(ph, c.lengthValue) ?? null, source: "handle" };
  }

  // 2) Collection + Farb-Token
  const line = lineOf(c.supplierName);
  if (!line) return null;
  const cols = collectionsFor(line, c.methodName, c.lengthValue);
  if (!cols) return null;
  const pool = products.filter(
    (p) =>
      p.collections.some((x) => cols.includes(x)) &&
      titleFitsMethod(line, c.methodName, c.lengthValue, p.title) &&
      pickVariant(p, c.lengthValue) !== undefined,
  );
  for (const color of colorCandidates(c)) {
    const hits = pool.filter((p) => colorMatchesTitle(color, p.title));
    // Mehrere Treffer: aktive Produkte bevorzugen, sonst lieber unaufgelöst.
    const active = hits.filter((p) => p.status === "ACTIVE");
    const pick = hits.length === 1 ? hits[0] : active.length === 1 ? active[0] : null;
    if (pick) return { productId: pick.id, variantId: pickVariant(pick, c.lengthValue) ?? null, source: "match" };
    if (hits.length > 1) return null;
  }
  return null;
}

/** Normalisierter Titel-Schlüssel für Sheet-Namen ↔ Titel-Historie. */
export function normTitle(s: string): string {
  return s.toUpperCase().replace(/[♡♥]/g, "").replace(/\s+/g, " ").trim();
}

export { handleFromUrl };
