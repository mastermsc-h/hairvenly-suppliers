"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Truck, Calendar, ExternalLink, Package } from "lucide-react";
import { date as fmtDate } from "@/lib/format";

export interface ShipmentLite {
  id: string;
  order_id: string;
  label: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
  eta: string | null;
  shipped_at: string | null;
  arrived_at: string | null;
}

/**
 * Derive a status from the date fields:
 *   - arrived_at set → "angekommen" (emerald)
 *   - shipped_at set → "versandt" (cyan)
 *   - tracking_number set → "versandbereit" (orange)
 *   - eta set → "in produktion" (amber)
 *   - else → "offen" (neutral)
 */
function deriveStatus(s: ShipmentLite): { label: string; bg: string; text: string; dot: string } {
  if (s.arrived_at) return { label: "angekommen", bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500" };
  if (s.shipped_at) return { label: "versandt", bg: "bg-cyan-50", text: "text-cyan-700", dot: "bg-cyan-500" };
  if (s.tracking_number) return { label: "versandbereit", bg: "bg-orange-50", text: "text-orange-700", dot: "bg-orange-500" };
  if (s.eta) return { label: "in produktion", bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-500" };
  return { label: "offen", bg: "bg-neutral-100", text: "text-neutral-700", dot: "bg-neutral-400" };
}

/**
 * Aggregated progress badge for the main status column.
 * Shows "N/M versandt" / "N/M angekommen" etc. depending on the highest
 * milestone any Teil has reached. Returns null if no shipments or nothing
 * has progressed past "offen/in produktion" (main status is enough).
 */
export function ShipmentProgress({
  shipments,
  hasUnassignedItems = false,
}: {
  shipments: ShipmentLite[];
  hasUnassignedItems?: boolean;
}) {
  if (!shipments || shipments.length === 0) return null;
  // Unassigned items count as an implicit "offen" pseudo-shipment so we never
  // claim "alle versandt" while positions are still in production.
  const total = shipments.length + (hasUnassignedItems ? 1 : 0);
  const arrived = shipments.filter((s) => s.arrived_at).length;
  const shipped = shipments.filter((s) => s.shipped_at).length;
  const ready = shipments.filter((s) => s.tracking_number && !s.shipped_at && !s.arrived_at).length;

  let label = "";
  let cls = "";
  if (arrived > 0) {
    label = arrived === total ? "alle angekommen" : `${arrived}/${total} angekommen`;
    cls = "bg-emerald-50 text-emerald-700 border-emerald-200";
  } else if (shipped > 0) {
    label = shipped === total ? "alle versandt" : `${shipped}/${total} versandt`;
    cls = "bg-cyan-50 text-cyan-700 border-cyan-200";
  } else if (ready > 0) {
    label = ready === total ? "alle versandbereit" : `${ready}/${total} versandbereit`;
    cls = "bg-orange-50 text-orange-700 border-orange-200";
  } else {
    return null;
  }

  return (
    <span
      className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-medium border ${cls} mt-0.5`}
      title={`${total} Teillieferungen`}
    >
      <Package size={9} />
      {label}
    </span>
  );
}

/**
 * Compact, expandable per-Teillieferung display for the order overview tables.
 *
 * Collapsed: "▸ 2 Teillieferungen" pill button
 * Expanded: list of Teil 1/2/... with their own ETA + tracking link + status
 */
export default function ShipmentsCell({ shipments }: { shipments: ShipmentLite[] }) {
  const [open, setOpen] = useState(false);

  if (shipments.length === 0) return null;

  return (
    <div className="text-[10px]">
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded font-medium text-purple-700 bg-purple-50 border border-purple-200 hover:bg-purple-100 transition"
      >
        {open ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
        <Package size={9} /> {shipments.length} {shipments.length === 1 ? "Teil" : "Teile"}
      </button>

      {open && (
        <div className="mt-1 space-y-1">
          {shipments.map((s, idx) => {
            const label = s.label || `Teil ${idx + 1}`;
            const st = deriveStatus(s);
            return (
              <div
                key={s.id}
                className="bg-purple-50/40 border border-purple-200 rounded px-1.5 py-1 leading-tight"
              >
                <div className="flex items-center gap-1 flex-wrap">
                  <span className="font-semibold text-purple-900 inline-flex items-center gap-0.5">
                    <Package size={8} /> {label}
                  </span>
                  <span className={`inline-flex items-center gap-0.5 px-1 py-px rounded ${st.bg} ${st.text}`}>
                    <span className={`w-1 h-1 rounded-full ${st.dot}`} />
                    {st.label}
                  </span>
                </div>
                {s.eta && (
                  <div className="text-purple-700/80 inline-flex items-center gap-0.5">
                    <Calendar size={8} /> {fmtDate(s.eta)}
                  </div>
                )}
                {s.shipped_at && !s.arrived_at && (
                  <div className="text-purple-700/80 inline-flex items-center gap-0.5">
                    <Truck size={8} /> ab {fmtDate(s.shipped_at)}
                  </div>
                )}
                {s.tracking_number && (
                  <div>
                    {s.tracking_url ? (
                      <a
                        href={s.tracking_url}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-blue-600 hover:underline inline-flex items-center gap-0.5"
                        title={s.tracking_number}
                      >
                        {s.tracking_number.length > 22 ? s.tracking_number.slice(0, 20) + "…" : s.tracking_number}
                        <ExternalLink size={8} />
                      </a>
                    ) : (
                      <span className="text-neutral-500" title={s.tracking_number}>
                        {s.tracking_number.length > 22 ? s.tracking_number.slice(0, 20) + "…" : s.tracking_number}
                      </span>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
