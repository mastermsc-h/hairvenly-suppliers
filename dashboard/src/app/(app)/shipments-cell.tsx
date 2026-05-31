"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Truck, Calendar, Check, ExternalLink, Package } from "lucide-react";
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
            return (
              <div
                key={s.id}
                className="bg-purple-50/40 border border-purple-200 rounded px-1.5 py-1 leading-tight"
              >
                <div className="font-semibold text-purple-900 inline-flex items-center gap-0.5">
                  <Package size={8} /> {label}
                  {s.arrived_at && (
                    <span className="ml-1 text-emerald-700 inline-flex items-center gap-0.5">
                      <Check size={8} /> da
                    </span>
                  )}
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
