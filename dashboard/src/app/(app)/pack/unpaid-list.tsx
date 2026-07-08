"use client";

import { useState } from "react";
import { type Locale } from "@/lib/i18n";
import type { PackOrder } from "@/lib/shopify";
import { Clock, AlertTriangle, ChevronDown, ChevronUp } from "lucide-react";

const SHOPIFY_STORE_HANDLE = "339520-3";

// Financial-Status → deutsches Label + Farbe
const finBadge: Record<string, { label: string; cls: string }> = {
  PENDING: { label: "Zahlung ausstehend", cls: "bg-amber-50 text-amber-800 border-amber-300" },
  AUTHORIZED: { label: "Autorisiert", cls: "bg-blue-50 text-blue-800 border-blue-300" },
  PARTIALLY_PAID: { label: "Teilweise bezahlt", cls: "bg-orange-50 text-orange-800 border-orange-300" },
};

// Alter-Stufen für die Farbe: normal (≤7d), überfällig (8–30d), dringend (>30d)
function ageBucket(days: number): "ok" | "overdue" | "urgent" {
  if (days > 30) return "urgent";
  if (days > 7) return "overdue";
  return "ok";
}
const rowCls: Record<string, string> = { ok: "", overdue: "bg-amber-50", urgent: "bg-red-50" };

// Bestellungen die älter als hier sind, werden standardmäßig eingeklappt.
const HIDE_AFTER_DAYS = 14;

interface Aged {
  o: PackOrder;
  days: number;
}

export default function UnpaidList({
  orders,
  locale,
}: {
  orders: PackOrder[];
  locale: Locale;
}) {
  const localeStr = locale === "de" ? "de-DE" : locale === "tr" ? "tr-TR" : "en-US";
  const [showOld, setShowOld] = useState(false);

  if (orders.length === 0) {
    return (
      <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm p-8 text-center">
        <Clock size={28} className="mx-auto text-neutral-300 mb-2" />
        <div className="text-sm text-neutral-500">Keine offenen unbezahlten Bestellungen.</div>
      </div>
    );
  }

  const now = Date.now();
  const withAge: Aged[] = orders.map((o) => ({
    o,
    days: Math.floor((now - new Date(o.createdAt).getTime()) / 86_400_000),
  }));

  // Aktuell (≤14d): neueste zuerst. Ältere (>14d): am längsten überfällige zuerst.
  const recent = withAge.filter((x) => x.days <= HIDE_AFTER_DAYS).sort((a, b) => a.days - b.days);
  const old = withAge.filter((x) => x.days > HIDE_AFTER_DAYS).sort((a, b) => b.days - a.days);

  const renderRow = ({ o, days }: Aged) => {
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
  };

  return (
    <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
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
            {recent.length > 0 ? (
              recent.map(renderRow)
            ) : (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-sm text-neutral-500">
                  Keine aktuellen unbezahlten Bestellungen (≤ {HIDE_AFTER_DAYS} Tage).
                </td>
              </tr>
            )}

            {/* Aufklappbare ältere (> 14 Tage) */}
            {old.length > 0 && (
              <>
                <tr>
                  <td colSpan={6} className="px-0 py-0">
                    <button
                      type="button"
                      onClick={() => setShowOld((v) => !v)}
                      className="w-full flex items-center justify-center gap-2 px-4 py-3 bg-neutral-50 hover:bg-neutral-100 text-sm font-medium text-neutral-700 border-t border-neutral-200 transition"
                    >
                      {showOld ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                      {showOld
                        ? `Ältere ausblenden`
                        : `${old.length} ältere unbezahlte (> ${HIDE_AFTER_DAYS} Tage) anzeigen`}
                    </button>
                  </td>
                </tr>
                {showOld && old.map(renderRow)}
              </>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
