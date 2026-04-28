import type { AlertProduct, TopsSellerSection } from "@/lib/stock-sheets";
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
