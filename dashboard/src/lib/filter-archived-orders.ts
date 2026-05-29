import type { AlertProduct, TopsSellerSection } from "@/lib/stock-sheets";
import type { OrderMeta } from "@/lib/order-name-map";
import { isArchived } from "@/lib/order-name-map";

/** Format ISO YYYY-MM-DD to German DD.MM.YYYY for display in stock sheets. */
function formatDeDate(iso: string): string {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
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
      if (!meta?.eta) return o;
      const newAnkunft = `ca. Ankunft: ${formatDeDate(meta.eta)}`;
      if (newAnkunft === o.ankunft) return o;
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
    const kept = item.perOrder.filter((o) => !isArchived(orderIdByName[o.name]));
    // 2) Override ankunft with DB ETA where we have a match
    const withEta = kept.map((o) => {
      const meta = orderIdByName[o.name];
      if (!meta?.eta) return o;
      return { ...o, ankunft: `ca. Ankunft: ${formatDeDate(meta.eta)}` };
    });
    const archivedRemoved = kept.length !== item.perOrder.length;
    const etaChanged = withEta.some((o, i) => o.ankunft !== kept[i].ankunft);
    if (!archivedRemoved && !etaChanged) return item;
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
