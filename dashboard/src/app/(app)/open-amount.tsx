import { usd } from "@/lib/format";
import { t, type Locale } from "@/lib/i18n";
import { debtBucket } from "@/lib/order-debt";
import type { OrderWithTotals } from "@/lib/types";

const kurz = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;

/**
 * "Offen"-Betrag einer Bestellung: echte Schuld normal (bei Ratenzahlung mit den geplanten
 * Ratenterminen aus der Liquiditätsvorschau), kommende (noch nicht versendet) gedämpft.
 */
export default function OpenAmount({ order: o, locale, raten }: { order: OrderWithTotals; locale: Locale; raten?: string[] }) {
  const amount = `${o.invoice_is_estimated ? "≈ " : ""}${usd(o.remaining_balance)}`;
  const offen = Number(o.remaining_balance ?? 0) > 0.009;
  if (raten?.length && offen) {
    const text = raten.length === 1
      ? `${t(locale, "order.rate_on")} ${kurz(raten[0])}`
      : `${raten.length} ${t(locale, "order.rates")} ${kurz(raten[0])}–${kurz(raten[raten.length - 1])}`;
    return (
      <span title={raten.map(kurz).join(", ")}>
        {amount}
        <span className="block text-[9px] font-normal text-amber-700">{text}</span>
      </span>
    );
  }
  if (debtBucket(o) !== "upcoming" || !offen) return <>{amount}</>;
  return (
    <span className="text-neutral-400 font-normal" title={t(locale, "dashboard.upcoming_hint")}>
      {amount}
      <span className="block text-[9px] uppercase tracking-wide">{t(locale, "dashboard.upcoming_short")}</span>
    </span>
  );
}
