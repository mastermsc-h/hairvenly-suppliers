"use client";

import { FileSpreadsheet } from "lucide-react";
import LieferscheinCheck from "./inbound-deliveries/lieferschein-check";

/**
 * Kompakter Wrapper um LieferscheinCheck: zeigt einen Button "Lieferschein-Check"
 * im Lieferanten-Card-Footer, vorausgewählt mit DIESEM Lieferanten.
 *
 * Im Lieferschein-Check-Modal ist der Lieferanten-Dropdown auf diesen einen
 * Eintrag beschränkt → keine Verwechslung möglich.
 */
export default function SupplierLieferscheinButton({ supplierId, supplierName }: { supplierId: string; supplierName: string }) {
  return (
    <span className="inline-flex">
      <LieferscheinCheck suppliers={[{ id: supplierId, name: supplierName }]} compact />
    </span>
  );
}
