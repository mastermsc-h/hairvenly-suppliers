"use client";

import { useState } from "react";
import { ChevronDown, ChevronRight, Split } from "lucide-react";

/**
 * Toggle-Button für Teillieferungs-Sub-Rows. Klick blendet die zugehörigen
 * <tr data-ship-of={orderId}> Zeilen ein/aus. Default: aus.
 *
 * Sub-Rows haben initial style="display:none" gesetzt (server-rendered),
 * Toggle schaltet via direkte DOM-Manipulation — kein Re-Render der ganzen
 * Tabelle nötig.
 */
export default function ToggleShipmentsButton({
  orderId,
  count,
}: {
  orderId: string;
  count: number;
}) {
  const [open, setOpen] = useState(false);

  function toggle() {
    const newOpen = !open;
    setOpen(newOpen);
    document.querySelectorAll(`tr[data-ship-of="${orderId}"]`).forEach((tr) => {
      (tr as HTMLElement).style.display = newOpen ? "" : "none";
    });
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className="inline-flex items-center gap-0.5 text-[9px] font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-1.5 py-0.5 hover:bg-amber-100 transition"
      title={open ? `${count} Teillieferungen ausblenden` : `${count} Teillieferungen anzeigen`}
    >
      {open ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
      <Split size={9} /> {count} {count === 1 ? "Teillieferung" : "Teillieferungen"}
    </button>
  );
}
