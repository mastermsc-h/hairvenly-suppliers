import { CheckCircle2 } from "lucide-react";
import { usd } from "@/lib/format";
import { t, type Locale } from "@/lib/i18n";
import { debtBucket } from "@/lib/order-debt";
import type { OrderWithTotals } from "@/lib/types";

const kurz = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;

/** Vollständig bezahlt: Rechnungsbetrag (echt oder geschätzt) vorhanden und nichts mehr offen. */
export function isFullyPaid(o: Pick<OrderWithTotals, "invoice_effective" | "remaining_balance">): boolean {
  return Number(o.invoice_effective ?? 0) > 0 && Number(o.remaining_balance ?? 0) <= 0.009;
}

/** Grüner "Bezahlt"-Stempel mit Haken. */
export function PaidStamp({ locale }: { locale: Locale }) {
  return (
    <span className="inline-flex -rotate-3 items-center gap-1 rounded-md border-2 border-emerald-500 bg-emerald-50 px-1.5 py-0.5 text-[11px] font-bold uppercase tracking-wide text-emerald-700">
      <CheckCircle2 size={13} strokeWidth={2.5} />
      {t(locale, "order.paid")}
    </span>
  );
}

/**
 * "Offen"-Betrag einer Bestellung: echte Schuld normal (bei Ratenzahlung mit den geplanten
 * Ratenterminen aus der Liquiditätsvorschau), kommende (noch nicht versendet) gedämpft.
 */
export default function OpenAmount({ order: o, locale, raten }: { order: OrderWithTotals; locale: Locale; raten?: string[] }) {
  const amount = `${o.invoice_is_estimated ? "≈ " : ""}${usd(o.remaining_balance)}`;
  const offen = Number(o.remaining_balance ?? 0) > 0.009;
  if (isFullyPaid(o)) return <PaidStamp locale={locale} />;
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
