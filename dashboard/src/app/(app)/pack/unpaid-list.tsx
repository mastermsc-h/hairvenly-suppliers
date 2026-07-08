import { type Locale } from "@/lib/i18n";
import type { PackOrder } from "@/lib/shopify";
import { Clock, AlertTriangle } from "lucide-react";

const SHOPIFY_STORE_HANDLE = "339520-3";

// Financial-Status → deutsches Label + Farbe
const finBadge: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "Zahlung ausstehend", cls: "bg-amber-50 text-amber-800 border-amber-300" },
  AUTHORIZED: { label: "Autorisiert", cls: "bg-blue-50 text-blue-800 border-blue-300" },
  PARTIALLY_PAID: { label: "Teilweise bezahlt", cls: "bg-orange-50 text-orange-800 border-orange-300" },
};

// Alter-Stufen: normal (≤7d), überfällig (8–30d), dringend (>30d)
function ageBucket(days: number): "ok" | "overdue" | "urgent" {
  if (days > 30) return "urgent";
  if (days > 7) return "overdue";
  return "ok";
}

const rowCls: Record<string, string> = {
  ok: "",
  overdue: "bg-amber-50",
  urgent: "bg-red-50",
};

export default function UnpaidList({
  orders,
  locale,
}: {
  orders: PackOrder[];
  locale: Locale;
}) {
  const localeStr = locale === "de" ? "de-DE" : locale === "tr" ? "tr-TR" : "en-US";

  if (orders.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm p-8 text-center">
        <Clock size={28} className="mx-auto text-neutral-300 mb-2" />
        <div className="text-sm text-neutral-500">Keine offenen unbezahlten Bestellungen.</div>
      </div>
    );
  }

  const now = Date.now();
  const withAge = orders.map((o) => ({
    o,
    days: Math.floor((now - new Date(o.createdAt).getTime()) / 86_400_000),
  }));
  // Älteste zuerst — die am längsten überfälligen ganz oben.
  withAge.sort((a, b) => b.days - a.days);

  const overdueCount = withAge.filter((x) => x.days > 7).length;

  return (
    <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
      {overdueCount > 0 && (
        <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 border-b border-amber-200 text-sm text-amber-900">
          <AlertTriangle size={15} className="shrink-0" />
          <span>
            <strong>{overdueCount}</strong> Bestellung{overdueCount === 1 ? "" : "en"} seit über 7 Tagen unbezahlt — ggf. stornieren.
          </span>
        </div>
      )}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-neutral-50 text-neutral-600 text-xs uppercase tracking-wide">
              <th className="text-left px-4 py-3 font-medium">Bestellung</th>
              <th className="text-left px-4 py-3 font-medium">Datum</th>
              <th className="text-left px-4 py-3 font-medium">Offen seit</th>
              <th className="text-left px-4 py-3 font-medium">Kunde</th>
              <th className="text-left px-4 py-3 font-medium">Artikel</th>
              <th className="text-left px-4 py-3 font-medium">Zahlung</th>
            </tr>
          </thead>
          <tbody>
            {withAge.map(({ o, days }) => {
              const bucket = ageBucket(days);
              return (
                <tr key={o.id} className={`border-t border-neutral-100 ${rowCls[bucket]}`}>
                  <td className="px-4 py-3 font-medium">
                    <a
                      href={`https://admin.shopify.com/store/${SHOPIFY_STORE_HANDLE}/orders/${o.numericId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-neutral-900 hover:text-blue-700 hover:underline transition"
                      title="In Shopify öffnen"
                    >
                      {o.name}
                    </a>
                  </td>
                  <td className="px-4 py-3 text-neutral-700">
                    <div>
                      {new Date(o.createdAt).toLocaleDateString(localeStr, {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                      })}
                    </div>
                    <div className="text-xs text-neutral-500">
                      {new Date(o.createdAt).toLocaleTimeString(localeStr, {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded border ${
                        bucket === "urgent"
                          ? "bg-red-100 text-red-800 border-red-300"
                          : bucket === "overdue"
                          ? "bg-amber-100 text-amber-800 border-amber-300"
                          : "bg-neutral-100 text-neutral-600 border-neutral-200"
                      }`}
                    >
                      {bucket !== "ok" && <AlertTriangle size={11} />}
                      {days === 0 ? "heute" : `${days} Tag${days === 1 ? "" : "e"}`}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-neutral-700">
                    <div>{o.customerName ?? "—"}</div>
                    {o.shippingAddress?.city && (
                      <div className="text-xs text-neutral-500">{o.shippingAddress.city}</div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-neutral-700">
                    <div>{o.totalQuantity} ×</div>
                    <div className="text-xs text-neutral-500 truncate max-w-xs">
                      {o.lineItems.slice(0, 2).map((li) => li.title).join(", ")}
                      {o.lineItems.length > 2 ? "…" : ""}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {(() => {
                      const b = finBadge[o.displayFinancialStatus] ?? {
                        label: o.displayFinancialStatus,
                        cls: "bg-neutral-100 text-neutral-700 border-neutral-300",
                      };
                      return (
                        <span className={`inline-block px-2 py-1 text-xs font-medium rounded border ${b.cls}`}>
                          {b.label}
                        </span>
                      );
                    })()}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
