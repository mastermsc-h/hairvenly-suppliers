"use client";

import { useState } from "react";
import { Truck, ChevronDown } from "lucide-react";

interface TransitOrder {
  label: string;
  eta: string | null;
  status: string;
  quantity: number;
}

export default function TransitBadge({ orders }: { orders: TransitOrder[] }) {
  const [open, setOpen] = useState(false);

  if (orders.length === 0) return <span className="text-neutral-300">–</span>;

  const totalG = orders.reduce((s, o) => s + o.quantity, 0);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-cyan-50 text-cyan-700 hover:bg-cyan-100 transition"
      >
        <Truck size={12} />
        {totalG}g
        <ChevronDown size={10} className={`transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute z-20 top-full mt-1 left-0 bg-white border border-neutral-200 rounded-lg shadow-lg p-3 min-w-[240px]">
          <div className="text-xs font-medium text-neutral-500 mb-2">Unterwegs Bestellungen</div>
          <div className="space-y-2">
            {orders.map((o, i) => (
              <div key={i} className="flex items-center justify-between gap-3 text-xs">
                <div>
                  <div className="font-medium text-neutral-900">{o.label}</div>
                  <div className="text-neutral-500">
                    {o.eta ? `ETA: ${new Date(o.eta).toLocaleDateString("de-DE")}` : "Kein ETA"} · {o.status}
                  </div>
                </div>
                <div className="font-semibold text-neutral-900 whitespace-nowrap">{o.quantity}g</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
