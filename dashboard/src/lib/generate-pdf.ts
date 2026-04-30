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

const fmt = (n: number) => new Intl.NumberFormat("de-DE").format(n);

/**
 * Generate a styled PDF for an order.
 *
 * Layout-Strategie:
 * - Pro Methoden+Längen-Gruppe wird eine eigene `autoTable` gerendert.
 * - Der Gruppen-Header (z.B. "Bondings · 85cm | 13.500 g") sitzt im
 *   `head` der Tabelle, sodass `showHead: 'everyPage'` ihn automatisch
 *   auf jeder Seite wiederholt, falls die Gruppe seitenübergreifend ist.
 *   → Verhindert, dass abgerutschte Zeilen wie zur nächsten Kategorie
 *     wirken (Witwen/Waisen-Problem).
 * - `pageBreak: 'avoid'` versucht zusätzlich, kleine Gruppen komplett
 *   zusammenzuhalten und Header nicht am Seitenende zu lassen.
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
  doc.text(`${items.length} Positionen · ${fmt(totalQty)} g`, 14, 28);
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

  // Cursor-Y: jede Gruppen-Tabelle startet wo die vorherige aufhört
  let cursorY = 34;

  for (const group of groups) {
    const bg = METHOD_COLORS[group.method] ?? DEFAULT_COLOR;
    const groupQty = group.items.reduce((s, i) => s + i.quantity, 0);

    autoTable(doc, {
      startY: cursorY,
      // Gruppen-Header im "head" → wird auf jeder Folgeseite wiederholt
      head: [[
        {
          content: `${group.method} · ${group.length}`,
          styles: { halign: "left" },
        },
        {
          content: `${fmt(groupQty)} g`,
          styles: { halign: "right" },
        },
      ]],
      body: group.items.map((item) => [
        {
          content: `#${item.colorName}`,
          styles: { fontSize: 8, cellPadding: { top: 1.5, bottom: 1.5, left: 8, right: 4 } },
        },
        {
          content: fmt(item.quantity),
          styles: { halign: "right", fontSize: 8, cellPadding: { top: 1.5, bottom: 1.5, left: 4, right: 4 } },
        },
      ]),
      headStyles: {
        fillColor: bg,
        textColor: [50, 50, 50],
        fontStyle: "bold",
        fontSize: 8,
        cellPadding: { top: 3, bottom: 3, left: 4, right: 4 },
      },
      // Gruppen-Header auf JEDER Seite wiederholen (verhindert Witwen/Waisen)
      showHead: "everyPage",
      // Versuche kleine Gruppen ganz auf eine Seite zu legen — wenn sie
      // mehr als eine Seite brauchen, splittet autoTable normal.
      pageBreak: "avoid",
      styles: { fontSize: 8, cellPadding: { top: 1.5, bottom: 1.5, left: 4, right: 4 } },
      columnStyles: { 0: { cellWidth: 120 }, 1: { halign: "right", cellWidth: 50 } },
      tableWidth: 170,
      margin: { left: 14, right: 14, top: 14, bottom: 14 },
    });

    // Update cursor for next group
    cursorY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? cursorY;
  }

  // Subtotal als eigene kleine Tabelle direkt unter den Gruppen
  autoTable(doc, {
    startY: cursorY + 2,
    body: [[
      {
        content: "Subtotal",
        styles: { fontStyle: "bold", fontSize: 9, cellPadding: { top: 3, bottom: 3, left: 4, right: 4 } },
      },
      {
        content: `${fmt(totalQty)} g`,
        styles: {
          fontStyle: "bold", fontSize: 9, halign: "right",
          fillColor: [255, 243, 205],
          cellPadding: { top: 3, bottom: 3, left: 4, right: 4 },
        },
      },
    ]],
    showHead: "never",
    pageBreak: "avoid",
    styles: { fontSize: 9 },
    columnStyles: { 0: { cellWidth: 120 }, 1: { halign: "right", cellWidth: 50 } },
    tableWidth: 170,
    margin: { left: 14, right: 14 },
  });

  // Footer auf jeder Seite
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    const pageHeight = doc.internal.pageSize.height;
    doc.setFontSize(8);
    doc.setTextColor(180, 180, 180);
    doc.text(`Hairvenly · ${supplierName} · ${dateStr}`, 14, pageHeight - 10);
    if (pageCount > 1) {
      doc.text(`${i} / ${pageCount}`, 200 - 14, pageHeight - 10, { align: "right" });
    }
  }

  return Buffer.from(doc.output("arraybuffer"));
}
