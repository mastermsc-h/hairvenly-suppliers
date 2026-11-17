/**
 * Preis-Sync Shopify → chatbot_prices (täglich per Cron).
 *
 * HINTERGRUND (Analyse 17.11.2026): chatbot_prices stand seit 03.05.2026
 * still, Shopify-Preise wurden seitdem erhöht → der Bot hat in 33 Auto-
 * Antworten zu niedrige Preise genannt (z.B. US-Tapes 65cm 49,75 € statt
 * 58,99 €). Der Preis-Guard hat das nicht gemerkt, weil er nur prüft, OB
 * get_price aufgerufen wurde — und get_price liest dieselbe veraltete Tabelle.
 *
 * Bug-Klasse: „Bot-Wissen veraltet gegenüber der Quelle" (Sibling von
 * ETA-aus-Sheet statt DB). Strukturelle Lösung: Shopify ist die einzige
 * Preisquelle, die Tabelle wird täglich daraus abgeleitet.
 *
 * Sicherheitsnetz (Zero-Regression): Eine Zeile wird nur überschrieben, wenn
 *   - mindestens MIN_SUPPORT aktive Shopify-Produkte die Regel treffen,
 *   - ≥ MIN_AGREE der Varianten denselben Preis haben (Einzel-Sale stört nicht),
 *   - die Änderung zwischen −30 % und +40 % liegt.
 * Alles andere wird NICHT geschrieben, sondern im Report als „prüfen" markiert.
 *
 * Diese Datei ist importfrei (bis auf Typen), damit der Smoke-Test sie
 * direkt transpilieren kann.
 */

export interface ShopifyProductLite {
  title: string;
  variants: { title: string; price: string }[];
}

export interface PriceKey {
  method: string;
  supplier_line: "amanda" | "ebru";
  length_cm: number | null;
  gram_label: string | null;
}

export interface CurrentPriceRow extends PriceKey {
  price_eur: number;
  active: boolean;
}

interface PriceRule extends PriceKey {
  /** true wenn Produkt (normalisierter Titel) zur Zeile gehört */
  product: (t: string) => boolean;
  /** optional: nur bestimmte Varianten (z.B. Clip-in 150g) */
  variant?: (v: string) => boolean;
}

export const MIN_SUPPORT = 3;
export const MIN_AGREE = 0.6;
export const MAX_DROP = 0.3;
export const MAX_RISE = 0.4;

const EXCLUDE = /farbmuster|teststr[äa]hne|zubeh[öo]r|gutschein|b[üu]rste|klammer|schablone|microring/;
const RU = (t: string) => /\bru glatt\b|russisch glatt|russische/.test(t);
const US = (t: string) => /\bus wellig|usbekisch/.test(t);
const len = (t: string, cm: number) => new RegExp(`\\b${cm}\\s*cm\\b`).test(t);

/** Titel vereinheitlichen: Kleinbuchstaben, „ I " als Trenner wie „ | ". */
export function normTitle(title: string): string {
  return title.toLowerCase().replace(/\s+i\s+/g, " | ").replace(/♡/g, "").replace(/\s+/g, " ").trim();
}

const isTape = (t: string) => /tape/.test(t) && !/mini|invisible/.test(t);
const isClassic = (t: string) => /classic weft|tressen classic|classic tressen/.test(t);

export const PRICE_RULES: PriceRule[] = [
  { method: "tape", supplier_line: "amanda", length_cm: 60, gram_label: null, product: (t) => isTape(t) && RU(t) },
  ...[45, 55, 65, 85].map((cm): PriceRule => ({
    method: "tape", supplier_line: "ebru", length_cm: cm, gram_label: null,
    product: (t) => isTape(t) && US(t) && new RegExp(`tape extensions\\s*${cm}\\s*cm`).test(t),
  })),
  { method: "mini_tape", supplier_line: "amanda", length_cm: 60, gram_label: null, product: (t) => /mini tape/.test(t) },
  { method: "bondings", supplier_line: "amanda", length_cm: 60, gram_label: null, product: (t) => /bonding/.test(t) && RU(t) },
  ...[65, 85].map((cm): PriceRule => ({
    method: "bondings", supplier_line: "ebru", length_cm: cm, gram_label: null,
    product: (t) => /bonding/.test(t) && US(t) && len(t, cm),
  })),
  { method: "tressen", supplier_line: "amanda", length_cm: 60, gram_label: null, product: (t) => isClassic(t) && RU(t) },
  { method: "tressen", supplier_line: "ebru", length_cm: 65, gram_label: null, product: (t) => isClassic(t) && US(t) },
  { method: "genius_weft", supplier_line: "amanda", length_cm: 60, gram_label: null, product: (t) => /genius weft/.test(t) && RU(t) },
  { method: "genius_weft", supplier_line: "ebru", length_cm: 65, gram_label: null, product: (t) => /genius weft/.test(t) && US(t) },
  // invisible_tape (Amanda) = Invisible Weft / Butterfly Tressen RU, 50 g (FAQ „Tressen-Varianten").
  { method: "invisible_tape", supplier_line: "amanda", length_cm: 60, gram_label: null, product: (t) => /butterfly/.test(t) && RU(t) },
  // invisible_tape (Ebru 65cm) bewusst OHNE Regel: in Shopify gibt es dort zwei
  // verschiedene Produkte (Butterfly Tressen 65cm und Invisible Tapes 65cm) —
  // nicht raten, Zeile bleibt im Report als „kein eindeutiges Produkt".
  ...(["100g", "150g", "225g"] as const).map((g): PriceRule => ({
    method: "clip_in", supplier_line: "amanda", length_cm: 60, gram_label: g,
    product: (t) => /invisible clip/.test(t),
    variant: (v) => v.toLowerCase().replace(/\s+/g, "").startsWith(g),
  })),
  { method: "ponytail", supplier_line: "ebru", length_cm: 65, gram_label: "130g", product: (t) => /ponytail|zopfverl[äa]ngerung/.test(t) },
];

export function keyOf(k: PriceKey): string {
  return `${k.method}|${k.supplier_line}|${k.length_cm ?? ""}|${k.gram_label ?? ""}`;
}

export interface DerivedPrice extends PriceKey {
  price: number | null;
  /** Anzahl getroffener Produkte */
  support: number;
  /** Anteil der Varianten mit dem häufigsten Preis */
  agree: number;
  samples: string[];
}

/** Pro Regel den Shopify-Preis ableiten (häufigster Variantenpreis). */
export function derivePrices(products: ShopifyProductLite[]): DerivedPrice[] {
  const prods = products
    .map((p) => ({ t: normTitle(p.title), raw: p.title, variants: p.variants }))
    .filter((p) => !EXCLUDE.test(p.t));
  return PRICE_RULES.map((rule) => {
    const hits = prods.filter((p) => rule.product(p.t));
    const prices: number[] = [];
    let support = 0;
    for (const p of hits) {
      const vs = rule.variant ? p.variants.filter((v) => rule.variant!(v.title)) : p.variants;
      if (vs.length === 0) continue;
      support++;
      for (const v of vs) {
        const n = Number(v.price);
        if (Number.isFinite(n) && n > 0) prices.push(Math.round(n * 100) / 100);
      }
    }
    const counts = new Map<number, number>();
    for (const n of prices) counts.set(n, (counts.get(n) ?? 0) + 1);
    let price: number | null = null, best = 0;
    for (const [n, c] of counts) if (c > best || (c === best && price !== null && n > price)) { price = n; best = c; }
    return {
      method: rule.method, supplier_line: rule.supplier_line, length_cm: rule.length_cm, gram_label: rule.gram_label,
      price, support, agree: prices.length ? best / prices.length : 0,
      samples: hits.slice(0, 3).map((h) => h.raw),
    };
  });
}

export type PlanStatus = "update" | "unchanged" | "check";

export interface PlanRow extends PriceKey {
  status: PlanStatus;
  old_price: number | null;
  new_price: number | null;
  reason?: string;
}

/** Vergleicht Tabelle mit Shopify und entscheidet pro Zeile, was passieren darf. */
export function planPriceUpdates(current: CurrentPriceRow[], derived: DerivedPrice[]): PlanRow[] {
  const byKey = new Map(derived.map((d) => [keyOf(d), d]));
  return current.filter((r) => r.active).map((row): PlanRow => {
    const base = { method: row.method, supplier_line: row.supplier_line, length_cm: row.length_cm, gram_label: row.gram_label, old_price: row.price_eur };
    const d = byKey.get(keyOf(row));
    if (!d) return { ...base, status: "check", new_price: null, reason: "Kein eindeutiges Shopify-Produkt zugeordnet" };
    if (d.price === null || d.support < MIN_SUPPORT) return { ...base, status: "check", new_price: d.price, reason: `Nur ${d.support} passende Shopify-Produkte gefunden` };
    if (d.agree < MIN_AGREE) return { ...base, status: "check", new_price: d.price, reason: `Shopify-Preise uneinheitlich (${Math.round(d.agree * 100)} % gleich)` };
    if (Math.abs(d.price - row.price_eur) < 0.005) return { ...base, status: "unchanged", new_price: d.price };
    const change = (d.price - row.price_eur) / row.price_eur;
    if (change < -MAX_DROP || change > MAX_RISE) {
      return { ...base, status: "check", new_price: d.price, reason: `Änderung ${change > 0 ? "+" : ""}${Math.round(change * 100)} % — zu groß für automatische Übernahme` };
    }
    return { ...base, status: "update", new_price: d.price };
  });
}

/** Preis in den Schreibweisen, wie er in FAQ-Texten vorkommt (72,50 / 72.50 / 72,5). */
export function priceSpellings(p: number): string[] {
  const fixed = p.toFixed(2);
  const out = new Set([fixed, fixed.replace(".", ",")]);
  if (fixed.endsWith("0")) { const short = p.toFixed(1); out.add(short); out.add(short.replace(".", ",")); }
  if (fixed.endsWith(".00")) out.add(String(Math.round(p)));
  return [...out];
}

/** Packungszahlen, deren Summen in FAQ-Texten typischerweise stehen (z.B. „6 Packungen = 435 €"). */
export const FAQ_PACK_MULTIPLES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12];

/**
 * Findet FAQ-Antworten, die einen alten (inzwischen geänderten) Preis nennen —
 * als Stückpreis ODER als daraus gerechnete Summe (Sibling-Fall: „150g = 435 €"
 * enthält 72,50 nicht wörtlich, ist aber genauso veraltet).
 */
export function findStaleFaqPrices(
  faqs: { id: string; question: string; answer: string }[],
  oldPrices: number[],
): { id: string; question: string; prices: string[] }[] {
  const amounts = [...new Set(oldPrices.flatMap((p) => FAQ_PACK_MULTIPLES.map((k) => Math.round(p * k * 100) / 100)))];
  const out: { id: string; question: string; prices: string[] }[] = [];
  for (const f of faqs) {
    const hits: string[] = [];
    for (const p of amounts) {
      for (const s of priceSpellings(p)) {
        // Zahl als eigenständiger Betrag (nicht Teil einer größeren Zahl)
        const re = new RegExp(`(^|[^0-9.,])${s.replace(/[.]/g, "\\.")}(?![0-9])`);
        if (re.test(f.answer)) { hits.push(s); break; }
      }
    }
    if (hits.length) out.push({ id: f.id, question: f.question, prices: hits });
  }
  return out;
}
