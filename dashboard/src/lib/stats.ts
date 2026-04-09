// Aggregations- und Statistik-Helper für das Dashboard.

export interface MonthlyVolumePoint {
  month: string; // "2026-01"
  label: string; // "Jan 26"
  bestellvolumen: number;
  offene_schulden: number;
}

interface OrderRow {
  created_at: string;
  invoice_total: number | null;
}
interface PaymentRow {
  paid_at: string;
  amount: number | null;
}

const MONTH_NAMES = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

function ymKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return `${MONTH_NAMES[m - 1]} ${String(y).slice(2)}`;
}

/**
 * Liefert die letzten N Monate (inkl. aktuell) mit:
 * - Bestellvolumen   = Σ invoice_total der in dem Monat erstellten Bestellungen
 * - Offene Schulden  = kumulierte Bestellsumme bis Monatsende minus kumulierte Zahlungen bis Monatsende
 */
export function buildMonthlyStats(
  orders: OrderRow[],
  payments: PaymentRow[],
  months = 12,
): MonthlyVolumePoint[] {
  const now = new Date();
  const buckets: { key: string; volume: number }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({ key: ymKey(d), volume: 0 });
  }
  const bucketIndex = new Map(buckets.map((b, i) => [b.key, i]));

  // Bestellvolumen pro Monat
  for (const o of orders) {
    if (!o.invoice_total) continue;
    const key = ymKey(new Date(o.created_at));
    const idx = bucketIndex.get(key);
    if (idx !== undefined) buckets[idx].volume += Number(o.invoice_total);
  }

  // Kumuliert über alles bis Monatsende → offene Schulden Verlauf
  const cumulativeInvoiced: Record<string, number> = {};
  const cumulativePaid: Record<string, number> = {};
  let invSum = 0;
  let paySum = 0;
  // Sortiert nach Monatsende — wir laufen alle Buckets durch und summieren alles, was ≤ Monatsende ist.
  for (const b of buckets) {
    const [y, m] = b.key.split("-").map(Number);
    const monthEnd = new Date(y, m, 0, 23, 59, 59);
    invSum = orders.reduce(
      (s, o) =>
        new Date(o.created_at) <= monthEnd ? s + Number(o.invoice_total ?? 0) : s,
      0,
    );
    paySum = payments.reduce(
      (s, p) => (new Date(p.paid_at) <= monthEnd ? s + Number(p.amount ?? 0) : s),
      0,
    );
    cumulativeInvoiced[b.key] = invSum;
    cumulativePaid[b.key] = paySum;
  }

  return buckets.map((b) => ({
    month: b.key,
    label: monthLabel(b.key),
    bestellvolumen: Math.round(b.volume * 100) / 100,
    offene_schulden:
      Math.round((cumulativeInvoiced[b.key] - cumulativePaid[b.key]) * 100) / 100,
  }));
}
