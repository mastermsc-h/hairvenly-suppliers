/**
 * Ladenhüter / Sale-Kandidaten: Produkte mit Lager, die in 90 Tagen (fast)
 * nichts verkauft haben. Basis = dieselben Kandidaten wie "Kritischer Bestand".
 *
 *   tot      – 0 g in 90 Tagen
 *   fasttot  – verkauft, aber Lager reicht beim 90-Tage-Tempo > N Monate
 *              (N wählt die Seite; geliefert wird alles ab MIN_MONTHS)
 *
 * Neue Produkte (Shopify-Anlage < 90 Tage) haben noch keine 90-Tage-Historie
 * und werden ausgenommen — so muss keine Linie von Hand ausgeschlossen werden.
 */
import { readDashboardAlerts, readInventorySheet, readTopseller, type AlertProduct } from "./stock-sheets";
import { fetchOrderIdByName, type OrderMeta } from "./order-name-map";
import { shopifyGraphQL } from "./shopify";
import { buildStockCandidates, type StockCandidatesInput } from "./stock-critical";

export const DEAD_WINDOW_DAYS = 90;
export const DEAD_MIN_MONTHS = 12;

export interface DeadStockItem extends AlertProduct {
  deadKind: "tot" | "fasttot";
  /** Monate, die das Lager beim 90-Tage-Tempo reicht; null = kein Verkauf (unendlich). */
  monthsCover: number | null;
  /** Tage seit Anlage in Shopify; null = unbekannt. */
  ageDays: number | null;
}

export interface DeadStockResult {
  items: DeadStockItem[];
  /** Produkte mit Lager, die wegen Alter < 90 Tage nicht bewertet wurden. */
  tooNew: { count: number; kg: number };
  /** Produkte mit Lager ohne Verkaufszahlen im Topseller-Tab. */
  noData: { count: number; kg: number };
  /** Gesamtlager aller bewerteten Produkte (für den Anteil). */
  totalLagerKg: number;
}

const PRODUCT_AGES_QUERY = `
  query($after: String) {
    products(first: 250, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes { handle createdAt }
    }
  }`;

type AgesPage = {
  products: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: { handle: string; createdAt: string }[] };
};

/** handle → createdAt. Fehler → leere Map (Alter dann unbekannt, Produkt wird normal bewertet). */
export async function fetchProductCreatedAt(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  try {
    let after: string | null = null;
    for (let page = 0; page < 40; page++) {
      const res: { data?: AgesPage } = await shopifyGraphQL<AgesPage>(PRODUCT_AGES_QUERY, { after }, { allowPartialErrors: true });
      const d = res.data?.products;
      if (!d) break;
      for (const n of d.nodes) out.set(n.handle, n.createdAt);
      if (!d.pageInfo.hasNextPage) break;
      after = d.pageInfo.endCursor;
    }
  } catch {
    // Seite bleibt nutzbar; nur der Neu-Ausschluss fehlt dann
  }
  return out;
}

const handleFromUrl = (u: string | null | undefined) => (u ?? "").match(/\/products\/([^/?#]+)/)?.[1] ?? null;

export function buildDeadStock(
  input: StockCandidatesInput & { createdAt: Map<string, string>; now?: number },
): DeadStockResult {
  const now = input.now ?? Date.now();
  const items: DeadStockItem[] = [];
  const tooNew = { count: 0, kg: 0 };
  const noData = { count: 0, kg: 0 };
  let totalLagerG = 0;

  for (const c of buildStockCandidates(input)) {
    const { url, ...d } = c;
    const created = handleFromUrl(url) ? input.createdAt.get(handleFromUrl(url)!) : undefined;
    const ageDays = created ? Math.floor((now - Date.parse(created)) / 864e5) : null;
    if (ageDays !== null && ageDays < DEAD_WINDOW_DAYS) {
      tooNew.count++;
      tooNew.kg += d.lagerG / 1000;
      continue;
    }
    if (d.verkauft90d === undefined) {
      noData.count++;
      noData.kg += d.lagerG / 1000;
      continue;
    }
    totalLagerG += d.lagerG;
    const v90 = d.verkauft90d;
    if (v90 <= 0) {
      items.push({ ...d, deadKind: "tot", monthsCover: null, ageDays });
      continue;
    }
    const monthsCover = d.lagerG / (v90 / 3);
    if (monthsCover > DEAD_MIN_MONTHS) {
      items.push({ ...d, deadKind: "fasttot", monthsCover: Math.round(monthsCover * 10) / 10, ageDays });
    }
  }
  items.sort((a, b) => b.lagerG - a.lagerG);
  return { items, tooNew, noData, totalLagerKg: totalLagerG / 1000 };
}

export async function loadDeadStock(): Promise<
  DeadStockResult & { lastUpdated: string | null; orderIdByName: Record<string, OrderMeta> }
> {
  const [alerts, wellig, glatt, { sections: topseller }, orderIdByName, createdAt] = await Promise.all([
    readDashboardAlerts(),
    readInventorySheet("Usbekisch - WELLIG"),
    readInventorySheet("Russisch - GLATT"),
    readTopseller(),
    fetchOrderIdByName(),
    fetchProductCreatedAt(),
  ]);
  const res = buildDeadStock({ alerts, wellig: wellig.rows, glatt: glatt.rows, topseller, orderIdByName, createdAt });
  return { ...res, lastUpdated: wellig.lastUpdated ?? alerts.lastUpdated, orderIdByName };
}
