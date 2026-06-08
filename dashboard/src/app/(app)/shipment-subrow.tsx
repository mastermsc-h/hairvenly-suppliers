"use client";

import { useState, useTransition } from "react";
import { Package, Calendar, Truck, Check, Loader2, ExternalLink, FileText } from "lucide-react";
import { date as fmtDate } from "@/lib/format";
import { markShipmentArrived } from "@/lib/actions/shipments";

export interface ShipmentRowData {
  id: string;
  order_id: string;
  label: string | null;
  tracking_number: string | null;
  tracking_url: string | null;
  eta: string | null;
  shipped_at: string | null;
  arrived_at: string | null;
  inbound_delivery_id?: string | null;
}

export interface ShipmentRowDoc {
  id: string;
  kind: string;
  file_name: string;
  file_path: string;
}

function deriveStatus(s: ShipmentRowData): { label: string; bg: string; text: string; dot: string } {
  if (s.arrived_at) return { label: "angekommen", bg: "bg-emerald-50", text: "text-emerald-700", dot: "bg-emerald-500" };
  if (s.shipped_at) return { label: "versandt", bg: "bg-cyan-50", text: "text-cyan-700", dot: "bg-cyan-500" };
  if (s.tracking_number) return { label: "versandbereit", bg: "bg-orange-50", text: "text-orange-700", dot: "bg-orange-500" };
  if (s.eta) return { label: "in produktion", bg: "bg-amber-50", text: "text-amber-700", dot: "bg-amber-500" };
  return { label: "offen", bg: "bg-neutral-100", text: "text-neutral-700", dot: "bg-neutral-400" };
}

/**
 * Sub-Row in der Bestellübersichts-Tabelle: zeigt eine Teillieferung mit
 * eigenen Spalten (Bezeichnung / Status + angekommen-Button / Liefertermin /
 * Lieferschein). Wird DIREKT unter der Order-Hauptzeile gerendert, damit die
 * Information aus dem aufklappbaren Popup in die Tabellen-Struktur wandert.
 */
export default function ShipmentSubRow({
  shipment,
  index,
  docs,
  canEdit,
  colspan_invoice,
}: {
  shipment: ShipmentRowData;
  index: number;
  docs: ShipmentRowDoc[];
  canEdit: boolean;
  /** Spalten-Anzahl für die rechten Invoice/Notes-Zellen (für korrektes Layout) */
  colspan_invoice: number;
}) {
  const [pending, startTransition] = useTransition();
  const st = deriveStatus(shipment);
  const label = shipment.label || `Teil ${index + 1}`;

  function markArrived(e: React.MouseEvent) {
    e.stopPropagation();
    if (!confirm(`${label} als angekommen markieren (heute)?`)) return;
    startTransition(async () => {
      await markShipmentArrived(shipment.id);
    });
  }

  // Bevorzugt Lieferschein, sonst irgendein Dokument
  const lieferschein = docs.find((d) => d.kind === "packing_details");

  return (
    <tr
      data-ship-of={shipment.order_id}
      style={{ display: "none" }}
      className="bg-purple-50/30 border-l-4 border-purple-300 hover:bg-purple-50/60 transition"
    >
      {/* BEZEICHNUNG */}
      <td className="px-5 py-1.5 pl-10">
        <div className="inline-flex items-center gap-1.5 text-xs">
          <Package size={11} className="text-purple-500 shrink-0" />
          <span className="font-medium text-purple-900">{label}</span>
          {shipment.inbound_delivery_id && (
            <a
              href={`/inbound-deliveries/${shipment.inbound_delivery_id}`}
              className="text-blue-600 hover:underline inline-flex items-center gap-0.5 text-[10px]"
              title="Zum Wareneingang"
              onClick={(e) => e.stopPropagation()}
            >
              ↗ WE
            </a>
          )}
        </div>
      </td>
      {/* STATUS + angekommen-Button */}
      <td className="px-5 py-1.5">
        <div className="flex items-center gap-1.5 flex-wrap">
          <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium border ${st.bg} ${st.text}`}>
            <span className={`w-1 h-1 rounded-full ${st.dot}`} />
            {st.label}
          </span>
          {canEdit && !shipment.arrived_at && (
            <button
              type="button"
              onClick={markArrived}
              disabled={pending}
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium bg-white text-neutral-600 border border-neutral-300 hover:bg-neutral-50 hover:text-neutral-900 hover:border-neutral-400 disabled:opacity-50"
              title="Klicken: arrived_at = heute. Teillieferung verschwindet danach aus 'Unterwegs' und Chatbot."
            >
              {pending && <Loader2 size={10} className="animate-spin" />}
              als angekommen markieren
            </button>
          )}
        </div>
      </td>
      {/* LIEFERTERMIN: eta + shipped/arrived + tracking */}
      <td className="px-5 py-1.5 text-xs text-neutral-700">
        {shipment.eta && (
          <div className="inline-flex items-center gap-0.5 text-purple-700">
            <Calendar size={10} className="text-neutral-400" /> {fmtDate(shipment.eta)}
          </div>
        )}
        {shipment.shipped_at && !shipment.arrived_at && (
          <div className="text-[10px] text-neutral-500 inline-flex items-center gap-0.5">
            <Truck size={9} /> ab {fmtDate(shipment.shipped_at)}
          </div>
        )}
        {shipment.arrived_at && (
          <div className="text-[10px] text-emerald-700 inline-flex items-center gap-0.5">
            <Check size={9} /> angekommen {fmtDate(shipment.arrived_at)}
          </div>
        )}
        {shipment.tracking_number && (
          <div className="text-[10px] mt-0.5">
            {shipment.tracking_url ? (
              <a
                href={shipment.tracking_url}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="text-blue-600 hover:underline inline-flex items-center gap-0.5"
                title={shipment.tracking_number}
              >
                {shipment.tracking_number.length > 18 ? shipment.tracking_number.slice(0, 16) + "…" : shipment.tracking_number}
                <ExternalLink size={9} />
              </a>
            ) : (
              <span className="text-neutral-500">{shipment.tracking_number}</span>
            )}
          </div>
        )}
      </td>
      {/* DOKUMENTE: Lieferschein dieser Teillieferung */}
      <td className="px-5 py-1.5">
        {lieferschein ? (
          <a
            href={`/api/documents/${lieferschein.id}`}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-orange-50 text-orange-700 border border-orange-200 hover:bg-orange-100"
            title={lieferschein.file_name}
          >
            <FileText size={10} /> Lieferschein
          </a>
        ) : (
          <span className="text-[10px] text-neutral-400">—</span>
        )}
      </td>
      {/* Rest: leer (Rechnung, Notes etc. gehören zur Bestellung, nicht Teil) */}
      <td className="px-5 py-1.5" colSpan={colspan_invoice}></td>
    </tr>
  );
}
