"use client";

import { useState } from "react";
import { Download, FileText } from "lucide-react";
import { t, type Locale } from "@/lib/i18n";
import type { ShopifyCustomsOrder } from "@/lib/shopify";

interface Props {
  orders: ShopifyCustomsOrder[];
  allOrders: ShopifyCustomsOrder[];
  locale: Locale;
}

export default function CustomsList({ orders, allOrders, locale }: Props) {
  const [showFulfilled, setShowFulfilled] = useState(false);
  const visible = showFulfilled ? allOrders : orders;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-neutral-600">
          {visible.length} {t(locale, "customs_ch.orders_count")}
        </div>
        <label className="flex items-center gap-2 text-sm text-neutral-600 cursor-pointer">
          <input
            type="checkbox"
            checked={showFulfilled}
            onChange={(e) => setShowFulfilled(e.target.checked)}
            className="rounded border-neutral-300"
          />
          {t(locale, "customs_ch.show_fulfilled")}
        </label>
      </div>

      {visible.length === 0 ? (
        <div className="bg-white rounded-2xl border border-neutral-200 p-8 shadow-sm text-center text-sm text-neutral-500">
          {t(locale, "customs_ch.empty")}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-neutral-50 text-xs font-medium text-neutral-600 uppercase tracking-wide">
              <tr>
                <th className="text-left px-4 py-3">{t(locale, "customs_ch.col_order")}</th>
                <th className="text-left px-4 py-3">{t(locale, "customs_ch.col_date")}</th>
                <th className="text-left px-4 py-3">{t(locale, "customs_ch.col_customer")}</th>
                <th className="text-left px-4 py-3">{t(locale, "customs_ch.col_city")}</th>
                <th className="text-right px-4 py-3">{t(locale, "customs_ch.col_items")}</th>
                <th className="text-right px-4 py-3">{t(locale, "customs_ch.col_value")}</th>
                <th className="text-left px-4 py-3">{t(locale, "customs_ch.col_status")}</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-100">
              {visible.map((o) => {
                const addr = o.shippingAddress;
                const customer = addr?.name || [addr?.firstName, addr?.lastName].filter(Boolean).join(" ") || "—";
                const date = new Date(o.createdAt);
                const dateStr = date.toLocaleDateString(locale === "de" ? "de-DE" : locale === "tr" ? "tr-TR" : "en-GB");
                const value = Number(o.subtotalPriceSet.shopMoney.amount) || 0;
                const fulfilled = o.displayFulfillmentStatus === "FULFILLED";
                return (
                  <tr key={o.id} className="hover:bg-neutral-50">
                    <td className="px-4 py-3 font-medium text-neutral-900">{o.name}</td>
                    <td className="px-4 py-3 text-neutral-600">{dateStr}</td>
                    <td className="px-4 py-3 text-neutral-900">{customer}</td>
                    <td className="px-4 py-3 text-neutral-600">
                      {[addr?.zip, addr?.city].filter(Boolean).join(" ") || "—"}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums">{o.totalQuantity}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {value.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
                    </td>
                    <td className="px-4 py-3">
                      <StatusBadge
                        fulfilled={fulfilled}
                        locale={locale}
                      />
                    </td>
                    <td className="px-4 py-3 text-right">
                      <a
                        href={`/customs-ch/pdf/${o.numericId}`}
                        className="inline-flex items-center gap-1.5 bg-neutral-900 text-white font-medium rounded-lg px-3 py-1.5 text-xs hover:bg-neutral-800 transition"
                      >
                        <Download size={14} />
                        {t(locale, "customs_ch.download")}
                      </a>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="bg-neutral-50 border border-neutral-200 rounded-2xl p-4 text-xs text-neutral-600 flex gap-2">
        <FileText size={14} className="shrink-0 mt-0.5" />
        <span>{t(locale, "customs_ch.hint")}</span>
      </div>
    </div>
  );
}

function StatusBadge({ fulfilled, locale }: { fulfilled: boolean; locale: Locale }) {
  if (fulfilled) {
    return (
      <span className="inline-flex items-center rounded-full bg-neutral-100 text-neutral-700 text-xs px-2 py-0.5">
        {t(locale, "customs_ch.status_fulfilled")}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full bg-amber-100 text-amber-800 text-xs px-2 py-0.5">
      {t(locale, "customs_ch.status_open")}
    </span>
  );
}
