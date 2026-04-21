import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { readFileSync } from "node:fs";
import path from "node:path";
import type { ShopifyCustomsOrder } from "@/lib/shopify";

// Fixe Absender- und Zoll-Defaults für Hairvenly (alle CH-Sendungen gleich).
const SENDER = {
  name: "Hairvenly",
  address: "Hans-Böckler-Str. 60, 28217 Bremen",
};
const HS_CODE = "6704.20";
const GOODS_DESCRIPTION = "Extensions";
const ORIGIN_COUNTRY = "Deutschland";
// Pauschale fürs Bruttogewicht (Verpackung/Karton) — wird einmal pro Sendung
// auf das Netto addiert. Im Muster ergibt ~20g eine realistische Größe.
const GROSS_WEIGHT_PADDING_G = 20;

function loadLogo(): string | null {
  try {
    const file = path.join(process.cwd(), "public", "logo.png");
    const buf = readFileSync(file);
    return `data:image/png;base64,${buf.toString("base64")}`;
  } catch {
    return null;
  }
}

function formatAddress(a: ShopifyCustomsOrder["shippingAddress"]): { name: string; line1: string; line2: string } {
  if (!a) return { name: "", line1: "", line2: "" };
  const name = a.name || [a.firstName, a.lastName].filter(Boolean).join(" ") || "";
  const street = [a.address1, a.address2].filter(Boolean).join(", ");
  const cityLine = [a.zip, a.city].filter(Boolean).join(" ");
  const line1 = street;
  const line2 = [cityLine, a.country].filter(Boolean).join(", ");
  return { name, line1, line2 };
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${d.getFullYear()}`;
}

function fmtKg(g: number): string {
  return (g / 1000).toLocaleString("de-DE", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
}

function fmtMoney(n: number): string {
  return n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Generate a CN23 customs declaration PDF for a Shopify order.
 * Returns an ArrayBuffer (compatible with NextResponse body).
 */
export function generateCN23PDF(order: ShopifyCustomsOrder): ArrayBuffer {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.width; // 210mm
  const marginLeft = 20;
  const contentRight = pageWidth - 20;

  const ship = formatAddress(order.shippingAddress);

  const netGrams = order.totalNetGrams;
  const grossGrams = netGrams + GROSS_WEIGHT_PADDING_G;
  const totalValueEur = Number(order.subtotalPriceSet.shopMoney.amount) || 0;

  // Logo top-right
  const logo = loadLogo();
  if (logo) {
    const logoSize = 22;
    doc.addImage(logo, "PNG", contentRight - logoSize, 15, logoSize, logoSize, undefined, "FAST");
  }

  // Title
  doc.setFont("helvetica", "italic");
  doc.setFontSize(14);
  doc.text("CN23 - Zollinhaltserklärung", marginLeft, 22);

  let y = 36;
  const sectionGap = 8;

  // 1. Absender
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.text("1. Absender:", marginLeft, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Name: ${SENDER.name}`, marginLeft, y);
  y += 4.5;
  doc.text(`Adresse: ${SENDER.address}`, marginLeft, y);
  y += sectionGap;

  // 2. Empfänger
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.text("2. Empfänger:", marginLeft, y);
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Name: ${ship.name || "—"}`, marginLeft, y);
  y += 4.5;
  const addr = [ship.line1, ship.line2].filter(Boolean).join(", ") || "—";
  doc.text(`Adresse: ${addr}`, marginLeft, y);
  y += sectionGap;

  // 3. Beschreibung der Ware (Tabelle, Sammelzeile "Extensions")
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.text("3. Beschreibung der Ware:", marginLeft, y);
  y += 3;

  autoTable(doc, {
    startY: y,
    head: [[
      "Position",
      "Beschreibung",
      "HS-Code",
      "Menge",
      "Nettogewicht\n(kg)",
      "Bruttogewicht\n(kg)",
      "Wert\n(EUR)",
      "Ursprungsland",
    ]],
    body: [[
      "1",
      GOODS_DESCRIPTION,
      HS_CODE,
      String(order.totalQuantity),
      fmtKg(netGrams),
      fmtKg(grossGrams),
      fmtMoney(totalValueEur),
      ORIGIN_COUNTRY,
    ]],
    theme: "grid",
    headStyles: {
      fillColor: [255, 255, 255],
      textColor: [0, 0, 0],
      fontStyle: "bold",
      fontSize: 9,
      lineColor: [0, 0, 0],
      lineWidth: 0.2,
      valign: "middle",
      halign: "left",
    },
    styles: {
      fontSize: 9,
      textColor: [0, 0, 0],
      lineColor: [0, 0, 0],
      lineWidth: 0.2,
      cellPadding: 2,
    },
    columnStyles: {
      0: { halign: "center", cellWidth: 18 },
      3: { halign: "right" },
      4: { halign: "right" },
      5: { halign: "right" },
      6: { halign: "right" },
    },
    margin: { left: marginLeft, right: 20 },
  });

  // autoTable sets finalY on doc via lastAutoTable
  const tableEndY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  y = tableEndY + sectionGap;

  // 4. Gesamtsumme
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.text("4. Gesamtsumme:", marginLeft, y);
  y += 6;
  doc.setFontSize(10);
  doc.text("\u2022", marginLeft + 4, y);
  doc.setFont("helvetica", "bold");
  doc.text("Gesamtwert:", marginLeft + 8, y);
  doc.setFont("helvetica", "normal");
  doc.text(`${fmtMoney(totalValueEur)} EUR`, marginLeft + 38, y);
  y += 5.5;
  doc.text("\u2022", marginLeft + 4, y);
  doc.setFont("helvetica", "bold");
  doc.text("Gesamtbruttogewicht:", marginLeft + 8, y);
  doc.setFont("helvetica", "normal");
  doc.text(`${fmtKg(grossGrams)} kg`, marginLeft + 55, y);
  y += sectionGap;

  // 5. Versandart & Inhalt
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.text("5. Versandart & Inhalt:", marginLeft, y);
  y += 6;
  doc.setFontSize(10);
  const items: { label: string; checked: boolean }[] = [
    { label: "Warenversand", checked: true },
    { label: "Geschenk", checked: false },
    { label: "Muster", checked: false },
    { label: "Dokumente", checked: false },
  ];
  for (const it of items) {
    const boxX = marginLeft + 4;
    const boxY = y - 3.2;
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.3);
    doc.rect(boxX, boxY, 3.5, 3.5);
    if (it.checked) {
      doc.setFont("helvetica", "bold");
      doc.text("\u2713", boxX + 0.4, boxY + 3.1);
    }
    doc.setFont("helvetica", "normal");
    doc.text(it.label, boxX + 6, y);
    y += 5.5;
  }
  y += 3;

  // 6. Erklärung & Unterschrift
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);
  doc.text("6. Erklärung & Unterschrift:", marginLeft, y);
  y += 5.5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const declaration =
    "Ich erkläre, dass die Angaben wahrheitsgemäß sind und die Sendung keine verbotenen oder " +
    "gefährlichen Gegenstände enthält.";
  const declLines = doc.splitTextToSize(declaration, contentRight - marginLeft);
  doc.text(declLines, marginLeft, y);
  y += declLines.length * 4.5 + 4;

  doc.text(`Datum: ${formatDate(new Date().toISOString())}`, marginLeft, y);
  y += 18;

  // Signature line (leer — Stempel wird manuell draufgesetzt)
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.3);
  doc.text("Unterschrift:", marginLeft, y);
  doc.line(marginLeft + 25, y, marginLeft + 110, y);

  // Footer: Referenz zur Bestellung (diskret)
  const pageHeight = doc.internal.pageSize.height;
  doc.setFontSize(8);
  doc.setTextColor(150, 150, 150);
  doc.text(`Bestellung ${order.name}`, marginLeft, pageHeight - 10);

  return doc.output("arraybuffer");
}
