/**
 * Ladenhüter / Sale-Kandidaten: Produkte mit Lager, die (fast) nichts
 * verkaufen, OBWOHL sie lieferbar waren.
 *
 *   tot      – 0 verkauft an ≥ MIN_AVAIL_DAYS lieferbaren Tagen der letzten 90
 *   fasttot  – verkauft, aber Lager reicht beim Tempo der lieferbaren Tage > N Monate
 *
 * Lieferbarkeit wird rekonstruiert: heutiger Bestand + Verkäufe seit Tag d −
 * Wareneingänge seit Tag d. Ein Produkt, das ausverkauft war und gerade wieder
 * eingelagert wurde, hat 0 Verkäufe in 90 Tagen, ist aber nicht tot — es landet
 * unter "kurz lieferbar" (nicht bewertet). Gleiche Schwelle (60 von 90 Tagen)
 * wie die Ladenhüter-Regel im Bestellalgorithmus.
 *
 * Neue Produkte (Shopify-Anlage < 90 Tage) werden ebenfalls nicht bewertet.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { readDashboardAlerts, readInventorySheet, readTopseller, type AlertProduct } from "./stock-sheets";
import { fetchOrderIdByName, type OrderMeta } from "./order-name-map";
import { shopifyGraphQL } from "./shopify";
import { createServiceClient } from "./supabase/server";
import { buildStockCandidates, type StockCandidatesInput } from "./stock-critical";
import { berlinTodayIso } from "./chatbot/eta-pick";

export const DEAD_WINDOW_DAYS = 90;
export const DEAD_MIN_MONTHS = 12;
/** Mindestens so viele lieferbare Tage im Fenster, sonst keine Bewertung. */
export const MIN_AVAIL_DAYS = 60;
/** Unter dieser Menge ist ein Produkt praktisch nicht verkaufbar (Clip-ins: 1 Stück). */
const MIN_SELLABLE_G = 150;

export interface DeadStockItem extends AlertProduct {
  deadKind: "tot" | "fasttot";
  /** Monate, die das Lager beim Tempo der lieferbaren Tage reicht; null = kein Verkauf. */
  monthsCover: number | null;
  /** Tage seit Anlage in Shopify; null = unbekannt. */
  ageDays: number | null;
  /** Lieferbare Tage in den letzten 90 Tagen (rekonstruiert). */
  availDays: number;
  /** Verkauft (g) in den letzten 90 Tagen laut Tagesverkäufen. */
  sold90G: number;
  /** Lager × aktueller Shopify-Verkaufspreis (EUR); null = Preis unbekannt. */
  valueEur: number | null;
}

export interface RecentlyAvailableItem {
  collection: string;
  product: string;
  sheetKey: "wellig" | "glatt";
  lagerG: number;
  availDays: number;
  sold90G: number;
  valueEur: number | null;
}

export interface DeadStockResult {
  items: DeadStockItem[];
  /** Waren < MIN_AVAIL_DAYS lieferbar (z.B. gerade wieder eingetroffen) → nicht bewertet. */
  recentlyAvailable: RecentlyAvailableItem[];
  tooNew: { count: number; kg: number };
  noData: { count: number; kg: number };
  /** Gesamtlager aller bewerteten Produkte (für den Anteil). */
  totalLagerKg: number;
}

// ── Shopify: Anlagedatum + Verkaufspreise ─────────────────────

const PRODUCT_META_QUERY = `
  query($after: String) {
    products(first: 100, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { handle createdAt variants(first: 10) { nodes { title price } } }
    }
  }`;

type MetaPage = {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: { handle: string; createdAt: string; variants: { nodes: { title: string; price: string }[] } }[];
  };
};

export interface ShopifyProductMeta {
  createdAt: string;
  variants: { title: string; price: number }[];
}

/** handle → Anlagedatum + Varianten-Preise. Fehler → leere Map (Alter/Preis dann unbekannt). */
export async function fetchProductMeta(): Promise<Map<string, ShopifyProductMeta>> {
  const out = new Map<string, ShopifyProductMeta>();
  try {
    let after: string | null = null;
    for (let page = 0; page < 40; page++) {
      const res: { data?: MetaPage } = await shopifyGraphQL<MetaPage>(PRODUCT_META_QUERY, { after }, { allowPartialErrors: true });
      const d = res.data?.products;
      if (!d) break;
      for (const n of d.nodes) {
        out.set(n.handle, {
          createdAt: n.createdAt,
          variants: n.variants.nodes.map((v) => ({ title: v.title, price: Number(v.price) || 0 })),
        });
      }
      if (!d.pageInfo.hasNextPage) break;
      after = d.pageInfo.endCursor;
    }
  } catch {
    // Seite bleibt nutzbar; nur Neu-Ausschluss und Preise fehlen dann
  }
  return out;
}

/** Preis einer Verkaufseinheit (= Stückgewicht im Sheet). Clip-ins: Variante mit passendem Gewicht. */
function unitPrice(meta: ShopifyProductMeta | undefined, clipGrams: string | null): number | null {
  if (!meta || meta.variants.length === 0) return null;
  if (clipGrams) {
    const v = meta.variants.find((x) => gramsOf(x.title) === clipGrams);
    return v && v.price > 0 ? v.price : null;
  }
  // Ein Produkt = eine Verkaufseinheit; bei mehreren Varianten ist die Zuordnung unsicher → kein Preis
  return meta.variants.length === 1 && meta.variants[0].price > 0 ? meta.variants[0].price : null;
}

// ── Verkäufe + Wareneingänge pro Tag ──────────────────────────

/** Schlüssel: Handle, bei Clip-ins zusätzlich die Gewichtsvariante ("handle|100"). */
export interface DailyMovements {
  /** key → (YYYY-MM-DD → verkaufte Stück) */
  sold: Map<string, Map<string, number>>;
  /** key → (YYYY-MM-DD → eingelagerte Gramm) */
  arrivedG: Map<string, Map<string, number>>;
  /** false = Tagesverkäufe fehlen (Tabelle leer/Fehler) → Lieferbarkeit unbekannt */
  ok: boolean;
}

const gramsOf = (s: string | null | undefined) => (s ?? "").match(/(\d{2,3})\s*g\b/i)?.[1] ?? null;
const isClip = (collectionOrMethod: string) => /CLIP/i.test(collectionOrMethod);
const addTo = (m: Map<string, Map<string, number>>, key: string, day: string, v: number) => {
  const inner = m.get(key) ?? new Map<string, number>();
  inner.set(day, (inner.get(day) ?? 0) + v);
  m.set(key, inner);
};

async function selectAll<T>(fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < 100_000; from += 1000) {
    const { data, error } = await fetchPage(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

export async function loadDailyMovements(supabase: SupabaseClient, sinceIso: string): Promise<DailyMovements> {
  const sold = new Map<string, Map<string, number>>();
  const arrivedG = new Map<string, Map<string, number>>();
  try {
    const sales = await selectAll<{ day: string; handle: string | null; variant_title: string | null; units: number }>((from, to) =>
      supabase
        .from("shopify_variant_daily_sales")
        .select("day, handle, variant_title, units")
        .gte("day", sinceIso)
        .order("day")
        .order("variant_id")
        .range(from, to),
    );
    if (sales.length === 0) return { sold, arrivedG, ok: false };
    for (const r of sales) {
      if (!r.handle) continue;
      addTo(sold, r.handle, r.day, r.units);
      const g = gramsOf(r.variant_title);
      if (g) addTo(sold, `${r.handle}|${g}`, r.day, r.units);
    }

    // Wareneingang = Tag der Einlagerung (Status → stocked), bzw. früheres Bestell-ETA
    const events = await selectAll<{ order_id: string; created_at: string }>((from, to) =>
      supabase
        .from("order_events")
        .select("order_id, created_at")
        .eq("event_type", "status_change")
        .ilike("message", "%→ stocked%")
        .gte("created_at", sinceIso)
        .order("created_at")
        .range(from, to),
    );
    const stockedAt = new Map<string, string>();
    for (const e of events) {
      const d = e.created_at.slice(0, 10);
      if (!stockedAt.has(e.order_id) || d < stockedAt.get(e.order_id)!) stockedAt.set(e.order_id, d);
    }
    const ids = [...stockedAt.keys()];
    if (ids.length > 0) {
      const { data: orders } = await supabase.from("orders").select("id, eta, order_date").in("id", ids);
      for (const o of orders ?? []) {
        const eta = typeof o.eta === "string" ? o.eta.slice(0, 10) : null;
        const od = typeof o.order_date === "string" ? o.order_date.slice(0, 10) : null;
        if (eta && eta < stockedAt.get(o.id)! && (!od || eta >= od)) stockedAt.set(o.id, eta);
      }
      const items = await selectAll<{
        order_id: string; quantity: number | null; delivered_quantity: number | null; unit: string | null;
        method_name: string | null; length_value: string | null;
        product_colors: { shopify_handle: string | null } | { shopify_handle: string | null }[] | null;
      }>((from, to) =>
        supabase
          .from("order_items")
          .select("order_id, quantity, delivered_quantity, unit, method_name, length_value, product_colors!color_id(shopify_handle)")
          .in("order_id", ids)
          .order("id")
          .range(from, to) as unknown as PromiseLike<{ data: never[] | null; error: { message: string } | null }>,
      );
      for (const it of items) {
        const pc = Array.isArray(it.product_colors) ? it.product_colors[0] : it.product_colors;
        const handle = pc?.shopify_handle;
        const day = stockedAt.get(it.order_id);
        const g = Number(it.delivered_quantity ?? it.quantity) || 0;
        if (!handle || !day || g <= 0 || (it.unit && it.unit !== "g")) continue;
        const clipG = isClip(it.method_name ?? "") ? gramsOf(it.length_value) : null;
        addTo(arrivedG, clipG ? `${handle}|${clipG}` : handle, day, g);
      }
    }
    return { sold, arrivedG, ok: true };
  } catch {
    return { sold, arrivedG, ok: false };
  }
}

/**
 * Lieferbare Tage + verkaufte Stück im Fenster [todayIso−90, todayIso−1].
 * Rückwärts: Bestand am Ende von Tag d = Bestand am Ende von d+1 + Verkauf(d+1) − Eingang(d+1).
 */
export function reconstructAvailability(input: {
  qtyNow: number;
  unitWeight: number;
  clip: boolean;
  sold: Map<string, number> | undefined;
  arrivedG: Map<string, number> | undefined;
  todayIso: string;
  windowDays?: number;
}): { availDays: number; soldUnits: number } {
  const days = input.windowDays ?? DEAD_WINDOW_DAYS;
  const minUnits = input.clip ? 1 : Math.max(1, Math.ceil(MIN_SELLABLE_G / Math.max(1, input.unitWeight)));
  const today = Date.parse(input.todayIso);
  const dayIso = (offset: number) => new Date(today - offset * 864e5).toISOString().slice(0, 10);
  // Bestand am Ende von "heute" (Sheet-Stand) → zurückrechnen
  let stockEnd = input.qtyNow;
  // heute selbst: Verkäufe/Eingänge von heute zurückdrehen → Ende von gestern
  const todaySold = input.sold?.get(input.todayIso) ?? 0;
  const todayArr = (input.arrivedG?.get(input.todayIso) ?? 0) / Math.max(1, input.unitWeight);
  stockEnd = stockEnd + todaySold - todayArr;
  let availDays = 0;
  let soldUnits = 0;
  for (let k = 1; k <= days; k++) {
    const d = dayIso(k);
    const s = input.sold?.get(d) ?? 0;
    const a = (input.arrivedG?.get(d) ?? 0) / Math.max(1, input.unitWeight);
    soldUnits += s;
    if (s > 0 || stockEnd >= minUnits) availDays++;
    // Ende von Tag d−1
    stockEnd = Math.max(0, stockEnd + s - a);
  }
  return { availDays, soldUnits };
}

// ── Bewertung ─────────────────────────────────────────────────

const handleFromUrl = (u: string | null | undefined) => (u ?? "").match(/\/products\/([^/?#]+)/)?.[1] ?? null;

export function buildDeadStock(
  input: StockCandidatesInput & {
    products: Map<string, ShopifyProductMeta>;
    movements: DailyMovements;
    todayIso?: string;
    now?: number;
  },
): DeadStockResult {
  const now = input.now ?? Date.now();
  const todayIso = input.todayIso ?? berlinTodayIso();
  const items: DeadStockItem[] = [];
  const recentlyAvailable: RecentlyAvailableItem[] = [];
  const tooNew = { count: 0, kg: 0 };
  const noData = { count: 0, kg: 0 };
  let totalLagerG = 0;

  for (const c of buildStockCandidates(input)) {
    const { url, unitWeight, ...d } = c;
    const handle = handleFromUrl(url);
    const meta = handle ? input.products.get(handle) : undefined;
    const created = meta?.createdAt;
    const ageDays = created ? Math.floor((now - Date.parse(created)) / 864e5) : null;
    if (ageDays !== null && ageDays < DEAD_WINDOW_DAYS) {
      tooNew.count++;
      tooNew.kg += d.lagerG / 1000;
      continue;
    }
    const uw = unitWeight && unitWeight > 0 ? unitWeight : null;
    if (!handle || !uw || !input.movements.ok) {
      noData.count++;
      noData.kg += d.lagerG / 1000;
      continue;
    }
    const clip = /CLIP[\s-]?IN/i.test(d.collection);
    const key = clip && d.variant ? `${handle}|${d.variant}` : handle;
    const price = unitPrice(meta, clip ? d.variant : null);
    const valueEur = price !== null ? Math.round((d.lagerG / uw) * price * 100) / 100 : null;
    const { availDays, soldUnits } = reconstructAvailability({
      qtyNow: Math.round(d.lagerG / uw),
      unitWeight: uw,
      clip,
      sold: input.movements.sold.get(key),
      arrivedG: input.movements.arrivedG.get(key),
      todayIso,
    });
    const sold90G = soldUnits * uw;
    if (availDays < MIN_AVAIL_DAYS) {
      recentlyAvailable.push({ collection: d.collection, product: d.product, sheetKey: d.sheetKey, lagerG: d.lagerG, availDays, sold90G, valueEur });
      continue;
    }
    totalLagerG += d.lagerG;
    if (sold90G <= 0) {
      items.push({ ...d, deadKind: "tot", monthsCover: null, ageDays, availDays, sold90G, valueEur });
      continue;
    }
    const perMonth = (sold90G / availDays) * 30;
    const monthsCover = d.lagerG / perMonth;
    if (monthsCover > DEAD_MIN_MONTHS) {
      items.push({ ...d, deadKind: "fasttot", monthsCover: Math.round(monthsCover * 10) / 10, ageDays, availDays, sold90G, valueEur });
    }
  }
  items.sort((a, b) => b.lagerG - a.lagerG);
  recentlyAvailable.sort((a, b) => b.lagerG - a.lagerG);
  return { items, recentlyAvailable, tooNew, noData, totalLagerKg: totalLagerG / 1000 };
}

export async function loadDeadStockInputs() {
  const todayIso = berlinTodayIso();
  const since = new Date(Date.parse(todayIso) - (DEAD_WINDOW_DAYS + 1) * 864e5).toISOString().slice(0, 10);
  const [products, movements] = await Promise.all([
    fetchProductMeta(),
    loadDailyMovements(createServiceClient(), since),
  ]);
  return { products, movements, todayIso };
}

export async function loadDeadStock(): Promise<
  DeadStockResult & { lastUpdated: string | null; orderIdByName: Record<string, OrderMeta> }
> {
  const [alerts, wellig, glatt, { sections: topseller }, orderIdByName, extra] = await Promise.all([
    readDashboardAlerts(),
    readInventorySheet("Usbekisch - WELLIG"),
    readInventorySheet("Russisch - GLATT"),
    readTopseller(),
    fetchOrderIdByName(),
    loadDeadStockInputs(),
  ]);
  const res = buildDeadStock({ alerts, wellig: wellig.rows, glatt: glatt.rows, topseller, orderIdByName, ...extra });
  return { ...res, lastUpdated: wellig.lastUpdated ?? alerts.lastUpdated, orderIdByName };
}
