/**
 * Standard-Bezeichnungen für Bestellungen.
 *
 * Konvention:
 *   - Amanda:         "Amanda {DD.MM.YYYY}"
 *   - Eyfel Ebru CN:  "China {DD.MM.YYYY}"
 *   - Eyfel Ebru TR:  "Türkei {DD.MM.YYYY}"
 *   - Sonstige:       "{SupplierName} {DD.MM.YYYY}"
 *
 * Datumsformat: Punkte (DD.MM.YYYY) — wird überall konsistent verwendet und
 * matcht so auch die Bestellnamen in den Stock-Sheets ("China 03.03.2026" etc.).
 */

export function buildOrderLabel(
  supplierName: string | null | undefined,
  region: string | null | undefined,
  orderDate: string | null | undefined,
): string {
  if (!orderDate) return "";
  const dd = orderDate.slice(8, 10);
  const mm = orderDate.slice(5, 7);
  const yyyy = orderDate.slice(0, 4);
  const datePart = `${dd}.${mm}.${yyyy}`;

  const prefix = labelPrefix(supplierName, region);
  return `${prefix} ${datePart}`;
}

export function labelPrefix(
  supplierName: string | null | undefined,
  region: string | null | undefined,
): string {
  const name = (supplierName ?? "").trim();
  const nameLower = name.toLowerCase();
  const isEyfel = nameLower.includes("eyfel") || nameLower.includes("ebru");

  if (isEyfel) {
    if (region === "CN") return "China";
    if (region === "TR") return "Türkei";
    // No region selected: fall back to name
    return name || "Eyfel Ebru";
  }
  return name || "Bestellung";
}
