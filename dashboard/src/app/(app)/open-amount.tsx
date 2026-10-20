import { usd } from "@/lib/format";
import { t, type Locale } from "@/lib/i18n";
import { debtBucket } from "@/lib/order-debt";
import type { OrderWithTotals } from "@/lib/types";

/** "Offen"-Betrag einer Bestellung: echte Schuld normal, kommende (noch nicht versendet) gedämpft. */
export default function OpenAmount({ order: o, locale }: { order: OrderWithTotals; locale: Locale }) {
  const amount = `${o.invoice_is_estimated ? "≈ " : ""}${usd(o.remaining_balance)}`;
  if (debtBucket(o) !== "upcoming" || Number(o.remaining_balance ?? 0) <= 0) return <>{amount}</>;
  return (
    <span className="text-neutral-400 font-normal" title={t(locale, "dashboard.upcoming_hint")}>
      {amount}
      <span className="block text-[9px] uppercase tracking-wide">{t(locale, "dashboard.upcoming_short")}</span>
    </span>
  );
}
