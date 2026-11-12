/**
 * Kandidaten für "Kritischer Bestand": ALLE Produkte mit Lager > 0 aus den
 * Inventar-Tabs, nicht nur die Sheet-Liste (1–599 g). Sonst fehlen
 * Schnelldreher mit ≥ 600 g, die vor der nächsten Lieferung leer sind.
 * Bewertet wird nach Reichweite (stock-criticality.ts).
 */
import {
  enrichAlertsWithTier,
  readDashboardAlerts,
  readInventorySheet,
  readTopseller,
  type AlertProduct,
  type InventoryRow,
  type TopsSellerSection,
} from "./stock-sheets";
import { fetchOrderIdByName, type OrderMeta } from "./order-name-map";
import { filterArchivedFromStock } from "./filter-archived-orders";
import { berlinTodayIso } from "./chatbot/eta-pick";
import { assessStock, needsAction, LOW_STOCK_G } from "./stock-criticality";

type Alerts = Awaited<ReturnType<typeof readDashboardAlerts>>;

const isClipCollection = (c: string) => /CLIP[\s-]?IN/i.test(c);
const norm = (s: string) => s.replace(/\s+/g, " ").trim().toUpperCase();

/** Sheet-Listen hängen bei Clip-ins " [150g]" an den Namen, die Inventar-Tabs führen die Variante separat. */
function keyOf(collection: string, product: string, variant: string | number | null): string {
  const base = product.replace(/\s*\[\d+g\]\s*$/, "");
  return `${norm(collection)}|${norm(base)}|${variant ?? ""}`;
}

export interface CriticalStockResult {
  /** Handlungsbedarf + alles < 600 g (für die Filter "Ladenhüter" / "Alle < 600 g"). */
  items: AlertProduct[];
  actionCount: number;
  todayIso: string;
}

export interface StockCandidatesInput {
  alerts: Pick<Alerts, "kritisch" | "unterwegs">;
  wellig: InventoryRow[];
  glatt: InventoryRow[];
  topseller: TopsSellerSection[];
  orderIdByName: Record<string, OrderMeta>;
}

/**
 * Alle Produkte mit Lager > 0, angereichert um Verkaufsrang/-zahlen und
 * bereinigte Bestellungen. Gemeinsame Basis für Kritisch und Ladenhüter.
 * `url` = Shop-URL aus dem Inventar-Tab (für Handle-Lookups).
 */
export type StockCandidate = AlertProduct & { url?: string | null; unitWeight?: number };

export function buildStockCandidates(input: StockCandidatesInput): StockCandidate[] {

  // Sheet-Zeilen tragen Bestellungen (perOrder) und die alte Stufe → bevorzugt.
  const fromSheet = new Map<string, AlertProduct>();
  for (const a of input.alerts.unterwegs) fromSheet.set(keyOf(a.collection, a.product, a.variant), a);
  for (const a of input.alerts.kritisch) fromSheet.set(keyOf(a.collection, a.product, a.variant), a);

  const candidates = new Map<string, StockCandidate>();
  const tabs: [InventoryRow[], "wellig" | "glatt"][] = [[input.wellig, "wellig"], [input.glatt, "glatt"]];
  for (const [rows, tabKey] of tabs) {
    for (const r of rows) {
      if (!r.product || r.product === "Produkt" || r.totalWeight <= 0) continue;
      const clip = isClipCollection(r.collection);
      const variant = clip ? String(r.unitWeight) : null;
      const key = keyOf(r.collection, r.product, variant);
      if (candidates.has(key)) continue;
      const sheetRow = fromSheet.get(key);
      candidates.set(
        key,
        sheetRow ? { ...sheetRow, url: r.url, unitWeight: r.unitWeight } : {
          collection: r.collection,
          product: clip ? `${r.product}  [${r.unitWeight}g]` : r.product,
          variant,
          lagerG: r.totalWeight,
          sheetKey: clip ? "glatt" : tabKey,
          unterwegsG: 0,
          perOrder: [],
          url: r.url,
          unitWeight: r.unitWeight,
        },
      );
    }
  }
  // Sheet-Kritisch-Zeilen ohne Inventar-Treffer nie verlieren.
  for (const [key, a] of fromSheet) {
    if (!candidates.has(key) && a.lagerG > 0 && input.alerts.kritisch.includes(a)) candidates.set(key, a);
  }

  const enriched = enrichAlertsWithTier([...candidates.values()], input.topseller);
  return filterArchivedFromStock(enriched, input.orderIdByName).filter((d) => d.lagerG > 0);
}

export function buildCriticalStock(input: StockCandidatesInput & { todayIso?: string }): CriticalStockResult {
  const todayIso = input.todayIso ?? berlinTodayIso();
  const filtered = buildStockCandidates(input);

  const items: AlertProduct[] = [];
  let actionCount = 0;
  for (const d of filtered) {
    const { url: _url, unitWeight: _uw, ...rest } = d;
    void _url;
    void _uw;
    const crit = assessStock(d, todayIso);
    const action = needsAction(d, crit);
    if (action) actionCount++;
    if (action || d.lagerG < LOW_STOCK_G) items.push({ ...rest, crit });
  }
  return { items, actionCount, todayIso };
}

export async function loadCriticalStock(): Promise<
  CriticalStockResult & { lastUpdated: string | null; orderIdByName: Record<string, OrderMeta> }
> {
  const [alerts, wellig, glatt, { sections: topseller }, orderIdByName] = await Promise.all([
    readDashboardAlerts(),
    readInventorySheet("Usbekisch - WELLIG"),
    readInventorySheet("Russisch - GLATT"),
    readTopseller(),
    fetchOrderIdByName(),
  ]);
  const res = buildCriticalStock({ alerts, wellig: wellig.rows, glatt: glatt.rows, topseller, orderIdByName });
  return { ...res, lastUpdated: alerts.lastUpdated ?? wellig.lastUpdated, orderIdByName };
}
