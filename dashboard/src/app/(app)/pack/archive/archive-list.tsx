"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search, Archive, ExternalLink, Camera, FileText, ArrowRight } from "lucide-react";
import { t, type Locale } from "@/lib/i18n";
import type { ArchivedSession } from "./page";

const SHOPIFY_STORE_HANDLE = "339520-3";

const statusBadge: Record<string, string> = {
  verified: "bg-emerald-50 text-emerald-800 border-emerald-300",
  shipped: "bg-blue-50 text-blue-800 border-blue-300",
};

export default function ArchiveList({
  sessions,
  locale,
}: {
  sessions: ArchivedSession[];
  locale: Locale;
}) {
  const [query, setQuery] = useState("");
  const localeStr = locale === "de" ? "de-DE" : locale === "tr" ? "tr-TR" : "en-US";

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) =>
      [s.orderName, s.packedByName ?? "", s.notes ?? ""].join(" ").toLowerCase().includes(q),
    );
  }, [sessions, query]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={16} />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Bestellung, Bearbeiter, Notiz…"
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-neutral-300 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
          />
        </div>
        <div className="text-sm text-neutral-500 whitespace-nowrap">
          {filtered.length} {t(locale, "shipping.col_order").toLowerCase()}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-neutral-200 p-10 text-center text-neutral-500 shadow-sm">
          <Archive className="mx-auto mb-3 text-neutral-300" size={40} />
          <div>{t(locale, "shipping.archive_empty")}</div>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-neutral-50 text-neutral-600 text-xs uppercase tracking-wide">
                  <th className="text-left px-4 py-3 font-medium">{t(locale, "shipping.col_order")}</th>
                  <th className="text-left px-4 py-3 font-medium">{t(locale, "shipping.archive_finished_at")}</th>
                  <th className="text-left px-4 py-3 font-medium">{t(locale, "shipping.packed_by")}</th>
                  <th className="text-left px-4 py-3 font-medium">{t(locale, "shipping.col_items")}</th>
                  <th className="text-left px-4 py-3 font-medium">{t(locale, "shipping.archive_notes")}</th>
                  <th className="text-left px-4 py-3 font-medium">{t(locale, "shipping.col_status")}</th>
                  <th className="text-right px-4 py-3 font-medium">{t(locale, "shipping.col_action")}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((s, idx) => (
                  <tr
                    key={s.id}
                    className={`border-t border-neutral-100 transition hover:bg-amber-50 ${
                      idx % 2 === 1 ? "bg-neutral-50/60" : "bg-white"
                    }`}
                  >
                    <td className="px-4 py-3 font-medium text-neutral-900">
                      <div className="flex items-center gap-2">
                        <span>{s.orderName}</span>
                        {s.shopifyOrderId && (
                          <a
                            href={`https://admin.shopify.com/store/${SHOPIFY_STORE_HANDLE}/orders/${s.shopifyOrderId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-neutral-400 hover:text-neutral-700"
                            title="In Shopify öffnen"
                          >
                            <ExternalLink size={13} />
                          </a>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-neutral-700">
                      {s.finishedAt ? (
                        <>
                          <div>
                            {new Date(s.finishedAt).toLocaleDateString(localeStr, {
                              day: "2-digit",
                              month: "2-digit",
                              year: "numeric",
                            })}
                          </div>
                          <div className="text-xs text-neutral-500">
                            {new Date(s.finishedAt).toLocaleTimeString(localeStr, {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </div>
                        </>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3 text-neutral-700">{s.packedByName ?? "—"}</td>
                    <td className="px-4 py-3 text-neutral-700">{s.itemCount}</td>
                    <td className="px-4 py-3 text-neutral-700 max-w-xs">
                      {s.notes ? (
                        <div className="text-xs italic line-clamp-2">{s.notes}</div>
                      ) : (
                        <span className="text-neutral-400 text-xs">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block px-2 py-1 text-xs font-medium rounded border ${statusBadge[s.status] ?? statusBadge.verified}`}
                      >
                        {t(locale, `shipping.status_${s.status}`)}
                      </span>
                      <div className="flex items-center gap-2 mt-1 text-xs text-neutral-500">
                        <span className="flex items-center gap-1">
                          <Camera size={11} />
                          {s.photoCount}/3
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        href={`/pack/archive/${s.orderNumberClean}`}
                        className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-neutral-300 text-neutral-700 text-xs font-medium hover:bg-neutral-50 transition"
                      >
                        <FileText size={13} />
                        {t(locale, "shipping.archive_view_details")}
                        <ArrowRight size={13} />
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
