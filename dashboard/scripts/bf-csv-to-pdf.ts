/**
 * Wandelt die beiden BF-2025-Lieferanten-CSVs in PDFs um.
 * Voraussetzung: bf-product-ranking.ts wurde gelaufen (CSVs existieren).
 *
 * Lauf: npx tsx scripts/bf-csv-to-pdf.ts
 */
import { readFileSync, writeFileSync } from "fs";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

const FILES: { csv: string; pdf: string; title: string; accent: [number, number, number] }[] = [
  {
    csv: "scripts/output/bf-2025-ranking-usbekisch-wellig.csv",
    pdf: "scripts/output/bf-2025-ranking-usbekisch-wellig.pdf",
    title: "Black Friday 2025 — Usbekisch Wellig (China/Ebru)",
    accent: [59, 130, 246], // blau
  },
  {
    csv: "scripts/output/bf-2025-ranking-russisch-glatt.csv",
    pdf: "scripts/output/bf-2025-ranking-russisch-glatt.pdf",
    title: "Black Friday 2025 — Russisch Glatt (Amanda)",
    accent: [22, 163, 74], // gruen
  },
];

/** jsPDF-Standardfonts sind Latin-1 — Herzchen & typografische Sonderzeichen
 *  ersetzen, sonst stimmen Breitenberechnung und Darstellung nicht. */
function cleanText(s: string): string {
  return s
    .replace(/[♡♥]/g, "")
    .replace(/[›»]/g, ">")
    .replace(/[–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function parseCsv(path: string): string[][] {
  const lines = readFileSync(path, "utf-8").split("\n").filter(Boolean);
  return lines.slice(1).map((line) => {
    // Format: Rang;"Produkt";Gramm;Stück;Umsatz;A1;A2
    const m = line.match(/^([^;]*);"(.*)";(.*)$/);
    if (!m) return line.split(";");
    return [m[1], m[2], ...m[3].split(";")];
  });
}

for (const f of FILES) {
  const rows = parseCsv(f.csv);
  const totalG = rows.reduce((s, r) => s + (parseInt(r[2]) || 0), 0);
  const totalPieces = rows.reduce((s, r) => s + (parseInt(r[3]) || 0), 0);
  const totalRev = rows.reduce((s, r) => s + (parseFloat(r[4]) || 0), 0);

  const doc = new jsPDF();

  doc.setFontSize(15);
  doc.setFont("helvetica", "bold");
  doc.text(cleanText(f.title), 14, 16);

  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(110, 110, 110);
  doc.text(
    `Aktionen: 14.-20.11. + 27.-30.11.2025 · ${rows.length} Produkte · ${(totalG / 1000).toFixed(1)} kg · ${totalPieces} Stk · ${totalRev.toFixed(0)} EUR`,
    14, 22,
  );
  doc.setTextColor(0, 0, 0);

  autoTable(doc, {
    startY: 27,
    head: [["#", "Produkt", "Gramm", "Stk", "Umsatz", "A1", "A2"]],
    body: rows.map((r) => [r[0], cleanText(r[1]), `${r[2]}g`, r[3], `${r[4]}€`, r[5] ?? "", r[6] ?? ""]),
    foot: [["", "GESAMT", `${totalG}g`, String(totalPieces), `${totalRev.toFixed(0)}€`, "", ""]],
    headStyles: {
      fillColor: f.accent, textColor: [255, 255, 255], fontSize: 7.5, fontStyle: "bold",
      cellPadding: { top: 2, bottom: 2, left: 2, right: 2 },
    },
    footStyles: {
      fillColor: [40, 40, 40], textColor: [255, 255, 255], fontSize: 7.5, fontStyle: "bold",
      cellPadding: { top: 2, bottom: 2, left: 2, right: 2 },
    },
    styles: { fontSize: 7, cellPadding: { top: 1.2, bottom: 1.2, left: 2, right: 2 } },
    columnStyles: {
      0: { cellWidth: 10, halign: "right" },
      1: { cellWidth: 98 },
      2: { cellWidth: 16, halign: "right" },
      3: { cellWidth: 11, halign: "right" },
      4: { cellWidth: 17, halign: "right" },
      5: { cellWidth: 11, halign: "right" },
      6: { cellWidth: 11, halign: "right" },
    },
    showHead: "everyPage",
    margin: { left: 14, right: 14, top: 14, bottom: 16 },
    didDrawPage: () => {
      const pageH = doc.internal.pageSize.height;
      doc.setFontSize(7);
      doc.setTextColor(170, 170, 170);
      doc.text(`Hairvenly · ${cleanText(f.title)} · A1 = Stk 14.-20.11. · A2 = Stk 27.-30.11.`, 14, pageH - 8);
      doc.text(String(doc.getNumberOfPages()), 196, pageH - 8, { align: "right" });
    },
  });

  writeFileSync(f.pdf, Buffer.from(doc.output("arraybuffer")));
  console.log(`✓ ${f.pdf} (${rows.length} Zeilen, ${doc.getNumberOfPages()} Seiten)`);
}
