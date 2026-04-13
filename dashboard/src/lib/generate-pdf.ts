import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

interface OrderItemRow {
  methodName: string;
  lengthValue: string;
  colorName: string;
  quantity: number;
}

const METHOD_COLORS: Record<string, [number, number, number]> = {
  "Bondings":        [237, 221, 252],  // purple
  "Standard Tapes":  [252, 225, 237],  // pink
  "Minitapes":       [254, 226, 224],  // rose
  "Classic Weft":    [221, 235, 254],  // blue
  "Invisible Weft":  [221, 248, 254],  // cyan
  "Clip-ins":        [255, 245, 221],  // amber
  "Tapes":           [224, 226, 254],  // indigo
  "Classic Tressen": [221, 252, 237],  // emerald
  "Genius Weft":     [221, 248, 245],  // teal
};

const DEFAULT_COLOR: [number, number, number] = [243, 243, 243];

/**
 * Generate a styled PDF for an order.
 * Returns a Buffer of the PDF file.
 */
export function generateOrderPDF(
  supplierName: string,
  orderDate: string,
  items: OrderItemRow[],
): Buffer {
  const doc = new jsPDF();
  const [yyyy, mm, dd] = orderDate.split("-");
  const dateStr = `${dd}.${mm}.${yyyy}`;

  // Title
  doc.setFontSize(18);
  doc.setFont("helvetica", "bold");
  doc.text(`${supplierName} — Bestellung ${dateStr}`, 14, 20);

  // Subtitle
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(120, 120, 120);
  const totalQty = items.reduce((s, i) => s + i.quantity, 0);
  doc.text(`${items.length} Positionen · ${new Intl.NumberFormat("de-DE").format(totalQty)} g`, 14, 28);
  doc.setTextColor(0, 0, 0);

  // Group items by method + length
  const sorted = [...items].sort((a, b) => {
    const mCmp = a.methodName.localeCompare(b.methodName);
    if (mCmp !== 0) return mCmp;
    return a.lengthValue.localeCompare(b.lengthValue);
  });

  const groups: { method: string; length: string; items: OrderItemRow[] }[] = [];
  let currentKey = "";
  for (const item of sorted) {
    const key = `${item.methodName}|${item.lengthValue}`;
    if (key !== currentKey) {
      groups.push({ method: item.methodName, length: item.lengthValue, items: [] });
      currentKey = key;
    }
    groups[groups.length - 1].items.push(item);
  }

  // Build compact 2-column table: Farbcode | Menge
  const tableBody: { content: string; colSpan?: number; styles?: object }[][] = [];

  for (const group of groups) {
    const bg = METHOD_COLORS[group.method] ?? DEFAULT_COLOR;
    const groupQty = group.items.reduce((s, i) => s + i.quantity, 0);

    // Group header row (full width)
    tableBody.push([
      {
        content: `${group.method} · ${group.length}`,
        styles: {
          fillColor: bg, fontStyle: "bold", fontSize: 8,
          textColor: [50, 50, 50], cellPadding: { top: 3, bottom: 3, left: 4, right: 4 },
        },
      },
      {
        content: `${new Intl.NumberFormat("de-DE").format(groupQty)} g`,
        styles: {
          fillColor: bg, fontStyle: "bold", fontSize: 8,
          textColor: [50, 50, 50], halign: "right",
          cellPadding: { top: 3, bottom: 3, left: 4, right: 4 },
        },
      },
    ]);

    // Item rows — compact
    for (const item of group.items) {
      tableBody.push([
        { content: `#${item.colorName}`, styles: { fontSize: 8, cellPadding: { top: 1.5, bottom: 1.5, left: 8, right: 4 } } },
        {
          content: `${new Intl.NumberFormat("de-DE").format(item.quantity)}`,
          styles: { halign: "right", fontSize: 8, cellPadding: { top: 1.5, bottom: 1.5, left: 4, right: 4 } },
        },
      ]);
    }
  }

  // Subtotal row
  tableBody.push([
    { content: "Subtotal", styles: { fontStyle: "bold", fontSize: 9, cellPadding: { top: 3, bottom: 3, left: 4, right: 4 } } },
    {
      content: `${new Intl.NumberFormat("de-DE").format(totalQty)} g`,
      styles: { fontStyle: "bold", fontSize: 9, halign: "right", fillColor: [255, 243, 205], cellPadding: { top: 3, bottom: 3, left: 4, right: 4 } },
    },
  ]);

  autoTable(doc, {
    startY: 34,
    head: [["Farbcode", "Menge (g)"]],
    body: tableBody,
    headStyles: {
      fillColor: [30, 30, 30], textColor: [255, 255, 255], fontSize: 8, fontStyle: "bold",
      cellPadding: { top: 2, bottom: 2, left: 4, right: 4 },
    },
    styles: { fontSize: 8, cellPadding: { top: 1.5, bottom: 1.5, left: 4, right: 4 } },
    columnStyles: { 0: { cellWidth: 120 }, 1: { halign: "right", cellWidth: 50 } },
    tableWidth: 170,
    margin: { left: 14, right: 14 },
  });

  // Footer
  const pageHeight = doc.internal.pageSize.height;
  doc.setFontSize(8);
  doc.setTextColor(180, 180, 180);
  doc.text(`Hairvenly · ${supplierName} · ${dateStr}`, 14, pageHeight - 10);

  return Buffer.from(doc.output("arraybuffer"));
}
