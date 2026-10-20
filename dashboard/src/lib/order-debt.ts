import type { OrderWithTotals } from "@/lib/types";

/**
 * Schulden-Einordnung einer Bestellung:
 *   due      → Ware ist abgeschickt (Status ab "Versandt" oder Tracking vorhanden) = echte Schuld
 *   upcoming → bestellt/in Produktion, Betrag kommt erst noch auf uns zu
 *   none     → Entwurf, storniert, ausgeblendet (zählt nirgends)
 */
export type DebtBucket = "due" | "upcoming" | "none";

const SHIPPED_STATUSES = new Set(["shipped", "in_customs", "delivered", "stocked"]);
const NOT_COUNTED_STATUSES = new Set(["draft", "cancelled", "hidden"]);

export function debtBucket(o: Pick<OrderWithTotals, "status" | "tracking_number">): DebtBucket {
  if (NOT_COUNTED_STATUSES.has(o.status)) return "none";
  if (SHIPPED_STATUSES.has(o.status) || !!o.tracking_number) return "due";
  return "upcoming";
}

export function sumOpen(orders: OrderWithTotals[], bucket: Exclude<DebtBucket, "none">): number {
  return orders
    .filter((o) => debtBucket(o) === bucket)
    .reduce((sum, o) => sum + Number(o.remaining_balance ?? 0), 0);
}
