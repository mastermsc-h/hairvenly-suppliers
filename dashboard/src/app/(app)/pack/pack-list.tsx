"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search, Package2, ArrowRight, RefreshCw, ExternalLink } from "lucide-react";
import { t, type Locale } from "@/lib/i18n";
import type { PackOrderWithStatus } from "./page";
import { useRouter } from "next/navigation";

const SHOPIFY_STORE_HANDLE = "339520-3";

const statusBadge: Record<PackOrderWithStatus["packStatus"], string> = {
  open: "bg-neutral-100 text-neutral-700 border-neutral-300",
  in_progress: "bg-amber-50 text-amber-800 border-amber-300",
  verified: "bg-emerald-50 text-emerald-800 border-emerald-300",
  shipped: "bg-blue-50 text-blue-800 border-blue-300",
};

export default function PackList({
  orders,
  locale,
}: {
  orders: PackOrderWithStatus[];
  locale: Locale;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    // Sortiere nach createdAt aufsteigend (älteste zuerst, FIFO)
    const sorted = [...orders].sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((o) => {
      const haystack = [
        o.name,
        o.numberClean,
        o.customerName ?? "",
        o.customerEmail ?? "",
        o.shippingAddress?.city ?? "",
      ].join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }, [orders, query]);

  const localeStr = locale === "de" ? "de-DE" : locale === "tr" ? "tr-TR" : "en-US";

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={16} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={`${t(locale, "shipping.col_order")}, ${t(locale, "shipping.col_customer")}…`}
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-neutral-300 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
          />
        </div>
        <button
          onClick={() => router.refresh()}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border border-neutral-300 text-sm hover:bg-neutral-50"
        >
          <RefreshCw size={14} />
          {t(locale, "shipping.refresh")}
        </button>
        <div className="text-sm text-neutral-500 whitespace-nowrap">
          {filtered.length} {t(locale, "shipping.col_order").toLowerCase()}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-neutral-200 p-10 text-center text-neutral-500 shadow-sm">
          <Package2 className="mx-auto mb-3 text-neutral-300" size={40} />
          <div>{t(locale, "shipping.empty")}</div>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-neutral-50 text-neutral-600 text-xs uppercase tracking-wide">
                  <th className="text-left px-4 py-3 font-medium">{t(locale, "shipping.col_order")}</th>
                  <th className="text-left px-4 py-3 font-medium">{t(locale, "shipping.col_date")}</th>
                  <th className="text-left px-4 py-3 font-medium">{t(locale, "shipping.col_customer")}</th>
                  <th className="text-left px-4 py-3 font-medium">{t(locale, "shipping.col_items")}</th>
                  <th className="text-left px-4 py-3 font-medium">{t(locale, "shipping.col_status")}</th>
                  <th className="text-right px-4 py-3 font-medium">{t(locale, "shipping.col_action")}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((o, idx) => (
                  <tr
                    key={o.id}
                    className={`border-t border-neutral-100 transition hover:bg-amber-50 ${
                      idx % 2 === 1 ? "bg-neutral-50/60" : "bg-white"
                    }`}
                  >
                    <td className="px-4 py-3 font-medium text-neutral-900">
                      <div className="flex items-center gap-2">
                        <span>{o.name}</span>
                        <a
                          href={`https://admin.shopify.com/store/${SHOPIFY_STORE_HANDLE}/orders/${o.numericId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-neutral-400 hover:text-neutral-700 transition"
                          title="In Shopify öffnen"
                          onClick={(e) => e.stopPropagation()}
                        >
                          <ExternalLink size={13} />
                        </a>
                      </div>
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
                      <span
                        className={`inline-block px-2 py-1 text-xs font-medium rounded border ${statusBadge[o.packStatus]}`}
                      >
                        {t(locale, `shipping.status_${o.packStatus}`)}
                      </span>
                      {o.packedBy && (
                        <div className="text-xs text-neutral-500 mt-1">{o.packedBy}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/pack/${o.numberClean}`}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-neutral-900 text-white text-xs font-medium hover:bg-neutral-700 transition"
                      >
                        {o.packStatus === "in_progress"
                          ? t(locale, "shipping.continue_pack")
                          : t(locale, "shipping.start_pack")}
                        <ArrowRight size={14} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
