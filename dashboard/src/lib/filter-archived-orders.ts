import type { AlertProduct } from "@/lib/stock-sheets";
import type { OrderMeta } from "@/lib/order-name-map";
import { isArchived } from "@/lib/order-name-map";

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
    const filtered = item.perOrder.filter((o) => !isArchived(orderIdByName[o.name]));
    if (filtered.length === item.perOrder.length) return item;
    const unterwegsG = filtered.reduce((s, o) => s + (o.menge || 0), 0);
    return { ...item, perOrder: filtered, unterwegsG };
  });
}
