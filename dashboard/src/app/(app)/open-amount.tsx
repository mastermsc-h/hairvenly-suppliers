import { usd, date } from "@/lib/format";
import { t, type Locale } from "@/lib/i18n";
import { debtBucket } from "@/lib/order-debt";
import { plusTage } from "@/lib/liquiditaet/rechnung";
import type { OrderWithTotals } from "@/lib/types";

/**
 * "Offen"-Betrag einer Bestellung: echte Schuld normal, kommende (noch nicht versendet) gedämpft,
 * manuelle Position mit Zahlungsfrist (gleiche Frist wie der Ratenplan der Liquiditätsvorschau).
 */
export default function OpenAmount({ order: o, locale, manualFristTage }: { order: OrderWithTotals; locale: Locale; manualFristTage: number }) {
  const amount = `${o.invoice_is_estimated ? "≈ " : ""}${usd(o.remaining_balance)}`;
  const offen = Number(o.remaining_balance ?? 0) > 0.009;
  if (o.status === "manual" && offen) {
    const basis = o.order_date ?? o.created_at.slice(0, 10);
    return (
      <span>
        {amount}
        <span className="block text-[9px] font-normal text-amber-700">
          {t(locale, "order.manual_due_by")} {date(plusTage(basis, manualFristTage))}
        </span>
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
