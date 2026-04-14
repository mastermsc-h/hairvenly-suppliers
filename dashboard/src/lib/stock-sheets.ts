import { google } from "googleapis";
import { readFileSync } from "fs";
import path from "path";

// ── Auth (shared with google-sheets.ts) ────────────────────────

function getAuth() {
  let key: Record<string, unknown>;
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    key = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  } else if (process.env.GOOGLE_SERVICE_ACCOUNT_PATH) {
    const fullPath = path.resolve(process.cwd(), process.env.GOOGLE_SERVICE_ACCOUNT_PATH);
    key = JSON.parse(readFileSync(fullPath, "utf-8"));
  } else {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_PATH must be set");
  }
  return new google.auth.GoogleAuth({
    credentials: key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
}

function getStockSheetId(): string {
  const id = process.env.GOOGLE_SHEET_STOCK;
  if (!id) throw new Error("GOOGLE_SHEET_STOCK nicht konfiguriert");
  return id;
}

// ── Types ──────────────────────────────────────────────────────

export interface InventoryRow {
  collection: string;
  product: string;
  unitWeight: number;
  quantity: number;
  totalWeight: number;
}

export interface TopsSellerSection {
  quality: "Usbekisch Wellig" | "Russisch Glatt";
  sections: TopsSellerGroup[];
  totalGrams: number;
  totalGrams30: number;
  orderHeaders: string[]; // Names of active orders (e.g. "China 07.04.2026\nca. Ankunft: ...")
}

export interface TopsSellerGroup {
  label: string; // e.g. "Standard Tapes (Russisch Glatt)"
  items: TopsSellerItem[];
}

export interface TopsSellerItem {
  rang: number;
  farbe: string;
  laenge: string;
  verkauftG: number;
  verkauft30d: number;
  verkauftStk: number;
  prognose: number;
  tier: string;
  ziel: number;
  lagerG: number;
  rangKlasse: string;
  unterwegsG: number;
  perOrder: number[]; // grams per order (aligned with section.orderHeaders)
}

export interface AlertProduct {
  collection: string;
  product: string;
  variant: string | null;
  lagerG: number;
  stufe?: "kritisch" | "niedrig";
  sheetKey: "wellig" | "glatt";
  unterwegsG: number;
  perOrder: { name: string; ankunft: string; menge: number }[];
}

export interface VerkaufsanalyseRow {
  collection: string;
  quality: string;
  gPerUnit: string;
  avg12mKg: number;
  avg12mEur: number;
  avg3mKg: number;
  avg3mEur: number;
  d30Kg: number;
  d30Eur: number;
  curMonthKg: number;
  curMonthEur: number;
  trend: string;
  isSummary: boolean;
}

// ── Timestamp Extraction ───────────────────────────────────────

/** Extract a German timestamp like "DD.MM.YYYY HH:MM" from a string */
function extractTimestamp(text: string): string | null {
  // Match patterns like "13.04.2026 16:07" or "13.04.2026, 16:07"
  const m = text.match(/(\d{2}\.\d{2}\.\d{4})[,\s]+(\d{2}:\d{2})/);
  if (m) return `${m[1]} ${m[2]}`;
  // Match just date
  const d = text.match(/(\d{2}\.\d{2}\.\d{4})/);
  if (d) return d[1];
  return null;
}

// ── Read Inventory (Russisch-GLATT / Usbekisch-WELLIG) ─────────

export async function readInventorySheet(
  tabName: "Russisch - GLATT" | "Usbekisch - WELLIG",
): Promise<{ rows: InventoryRow[]; lastUpdated: string | null }> {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });

  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: getStockSheetId(),
    range: `'${tabName}'!A1:E2000`,
    valueRenderOption: "UNFORMATTED_VALUE",
  });

  const rawRows = data.values ?? [];
  const rows: InventoryRow[] = [];
  let currentCollection = "";
  let lastUpdated: string | null = null;

  for (const row of rawRows) {
    const col0 = String(row[0] ?? "").trim();
    const col1 = String(row[1] ?? "").trim();
    const col2 = parseFloat(row[2]) || 0;
    const col3 = parseFloat(row[3]) || 0;
    const col4 = parseFloat(row[4]) || 0;

    // Extract timestamp from "Zuletzt aktualisiert: DD.MM.YYYY HH:MM Uhr"
    if (col0.startsWith("Zuletzt") && !lastUpdated) {
      lastUpdated = extractTimestamp(col0);
      continue;
    }
    if (col0 === "Collection Name") continue;
    if (col0.startsWith("Total") || col0.startsWith("GRAND")) continue;
    if (col0) currentCollection = col0;
    if (!col1) continue;

    rows.push({
      collection: currentCollection,
      product: col1,
      unitWeight: col2,
      quantity: col3,
      totalWeight: col4,
    });
  }

  return { rows, lastUpdated };
}

// ── Read Topseller ─────────────────────────────────────────────

export async function readTopseller(): Promise<{ sections: TopsSellerSection[]; lastUpdated: string | null }> {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });

  // Read wider range to capture detail order columns (start at col 15 = O)
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: getStockSheetId(),
    range: "'Topseller'!A1:Z500",
    valueRenderOption: "UNFORMATTED_VALUE",
  });

  const rawRows = data.values ?? [];
  const sections: TopsSellerSection[] = [];
  const DETAIL_START = 14; // 0-indexed col O (15th col)
  let lastUpdated: string | null = null;

  let currentSection: TopsSellerSection | null = null;
  let currentGroup: TopsSellerGroup | null = null;
  let inHeader = false;
  let detailColCount = 0;

  for (const row of rawRows) {
    const col0 = String(row[0] ?? "").trim();
    const col1 = String(row[1] ?? "").trim();
    const merged = row.slice(0, 13).map((c: unknown) => String(c ?? "")).join(" ");

    // Detect main section headers: "USBEKISCH WELLIG" or "RUSSISCH GLATT"
    if (merged.toUpperCase().includes("USBEKISCH WELLIG") && merged.includes("Topseller")) {
      currentSection = { quality: "Usbekisch Wellig", sections: [], totalGrams: 0, totalGrams30: 0, orderHeaders: [] };
      sections.push(currentSection);
      if (!lastUpdated) lastUpdated = extractTimestamp(merged);
      inHeader = false;
      continue;
    }
    if (merged.toUpperCase().includes("RUSSISCH GLATT") && merged.includes("Topseller")) {
      currentSection = { quality: "Russisch Glatt", sections: [], totalGrams: 0, totalGrams30: 0, orderHeaders: [] };
      sections.push(currentSection);
      inHeader = false;
      continue;
    }

    if (!currentSection) continue;

    // Detect group headers: "── Standard Tapes (Russisch Glatt) ──"
    // Also read order headers from detail columns in this row
    if (merged.includes("──") && merged.includes("(")) {
      const label = merged.replace(/──/g, "").trim();
      currentGroup = { label, items: [] };
      currentSection.sections.push(currentGroup);
      // Parse order headers from detail columns (col O onwards)
      if (currentSection.orderHeaders.length === 0) {
        const headers: string[] = [];
        for (let i = DETAIL_START; i < (row.length ?? 0); i++) {
          const h = String(row[i] ?? "").trim();
          if (h) headers.push(h);
          else break;
        }
        if (headers.length > 0) {
          currentSection.orderHeaders = headers;
          detailColCount = headers.length;
        }
      }
      inHeader = true;
      continue;
    }

    // Skip column header row
    if (inHeader && (col0 === "Rang" || col1 === "Farbcode")) {
      inHeader = false;
      continue;
    }

    if (!currentGroup) continue;

    // Parse data rows: Rang(0), Farbcode(1), Länge(2), Verkauft(3), 30T(4), Stk(5), Prognose(6), Tier(7), Ziel(8), Lager(9), Rang-Klasse(10), sep(11), Unterwegs(12)
    const rang = parseInt(col0);
    if (isNaN(rang) || rang <= 0) continue;

    // Parse per-order detail columns
    const perOrder: number[] = [];
    for (let i = 0; i < detailColCount; i++) {
      perOrder.push(parseFloat(row[DETAIL_START + i]) || 0);
    }

    const item: TopsSellerItem = {
      rang,
      farbe: col1,
      laenge: String(row[2] ?? "").trim(),
      verkauftG: parseFloat(row[3]) || 0,
      verkauft30d: parseFloat(row[4]) || 0,
      verkauftStk: parseFloat(row[5]) || 0,
      prognose: parseFloat(row[6]) || 0,
      tier: String(row[7] ?? "").trim(),
      ziel: parseFloat(row[8]) || 0,
      lagerG: parseFloat(row[9]) || 0,
      rangKlasse: String(row[10] ?? "").trim(),
      unterwegsG: parseFloat(row[12]) || 0,
      perOrder,
    };

    currentGroup.items.push(item);
    currentSection.totalGrams += item.verkauftG;
    currentSection.totalGrams30 += item.verkauft30d;
  }

  return { sections, lastUpdated };
}

// ── Read Dashboard Alerts (Nullbestand, Kritisch, Unterwegs) ───

export async function readDashboardAlerts(): Promise<{
  nullbestand: AlertProduct[];
  kritisch: AlertProduct[];
  unterwegs: AlertProduct[];
  lagerKpis: { welligKg: number; glattKg: number };
  lastUpdated: string | null;
}> {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });

  // Read the entire dashboard tab
  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: getStockSheetId(),
    range: "'📊 Dashboard'!A1:Z500",
    valueRenderOption: "UNFORMATTED_VALUE",
  });

  const rawRows = data.values ?? [];

  const nullbestand: AlertProduct[] = [];
  const kritisch: AlertProduct[] = [];
  const unterwegs: AlertProduct[] = [];

  let welligKg = 0;
  let glattKg = 0;
  let lastUpdated: string | null = null;

  type ParseMode = "none" | "nullbestand" | "kritisch" | "unterwegs";
  let mode: ParseMode = "none";
  let currentSheetKey: "wellig" | "glatt" = "wellig";
  let orderHeaders: string[] = [];
  let skipNextRow = false;

  for (const row of rawRows) {
    const merged = row.map((c: unknown) => String(c ?? "")).join(" ");
    const col0 = String(row[0] ?? "").trim();

    // Extract timestamp from "Stand: DD.MM.YYYY, HH:MM"
    if (merged.includes("Stand:") && !lastUpdated) {
      lastUpdated = extractTimestamp(merged);
    }

    // Extract KPIs
    if (merged.includes("Usbekisch") && merged.includes("kg") && merged.match(/\d+\.\d+\s*kg/)) {
      const m = merged.match(/([\d.]+)\s*kg/);
      if (m && welligKg === 0) welligKg = parseFloat(m[1]);
    }
    if (merged.includes("Russisch") && merged.includes("kg") && merged.match(/\d+\.\d+\s*kg/)) {
      const m = merged.match(/([\d.]+)\s*kg/);
      if (m && glattKg === 0) glattKg = parseFloat(m[1]);
    }

    // Detect section transitions
    if (merged.includes("NULLBESTAND")) {
      mode = "nullbestand";
      currentSheetKey = merged.toUpperCase().includes("WELLIG") ? "wellig" : "glatt";
      skipNextRow = true; // header row
      orderHeaders = [];
      continue;
    }
    if (merged.includes("KRITISCHER BESTAND")) {
      mode = "kritisch";
      currentSheetKey = merged.toUpperCase().includes("WELLIG") ? "wellig" : "glatt";
      skipNextRow = true;
      orderHeaders = [];
      continue;
    }
    if (merged.includes("UNTERWEGS") && merged.includes("Produkte unterwegs")) {
      mode = "unterwegs";
      currentSheetKey = merged.toUpperCase().includes("WELLIG") ? "wellig" : "glatt";
      skipNextRow = true;
      orderHeaders = [];
      continue;
    }
    if (merged.includes("LAGERBESTAND") && merged.includes("KG PRO KOLLEKTION")) {
      mode = "none";
      continue;
    }

    // Parse header to get order names
    if (skipNextRow && (col0 === "Kollektion" || col0 === "Collection")) {
      for (let i = 4; i < row.length; i++) {
        const h = String(row[i] ?? "").trim();
        if (h) orderHeaders.push(h);
      }
      skipNextRow = false;
      continue;
    }
    if (skipNextRow) {
      skipNextRow = false;
      continue;
    }

    // Skip summary/empty rows
    if (mode === "none") continue;
    if (col0 === "GESAMT" || col0 === "" || !row[1]) continue;

    const product = String(row[1] ?? "").trim();
    if (!product) continue;

    // Extract variant from product name "[225g]"
    let variant: string | null = null;
    const variantMatch = product.match(/\[(\d+)g\]/);
    if (variantMatch) variant = variantMatch[1];

    const lagerG = parseFloat(row[2]) || 0;
    const unterwegsGesamt = parseFloat(row[3]) || 0;

    const perOrder: { name: string; ankunft: string; menge: number }[] = [];
    for (let i = 0; i < orderHeaders.length; i++) {
      const menge = parseFloat(row[4 + i]) || 0;
      if (menge > 0) {
        const parts = orderHeaders[i].split("\n");
        perOrder.push({
          name: parts[0] ?? orderHeaders[i],
          ankunft: parts[1] ?? "",
          menge,
        });
      }
    }

    const item: AlertProduct = {
      collection: col0,
      product: product.replace(/\s*\[\d+g\]/, ""),
      variant,
      lagerG,
      sheetKey: currentSheetKey,
      unterwegsG: unterwegsGesamt,
      perOrder,
    };

    if (mode === "nullbestand") {
      nullbestand.push(item);
    } else if (mode === "kritisch") {
      item.stufe = lagerG < 300 ? "kritisch" : "niedrig";
      kritisch.push(item);
    } else if (mode === "unterwegs") {
      unterwegs.push(item);
    }
  }

  return { nullbestand, kritisch, unterwegs, lagerKpis: { welligKg, glattKg }, lastUpdated };
}

// ── Read Verkaufsanalyse ───────────────────────────────────────

export async function readVerkaufsanalyse(): Promise<{ rows: VerkaufsanalyseRow[]; lastUpdated: string | null }> {
  const auth = getAuth();
  const sheets = google.sheets({ version: "v4", auth });

  const { data } = await sheets.spreadsheets.values.get({
    spreadsheetId: getStockSheetId(),
    range: "'Verkaufsanalyse'!A1:L200",
    valueRenderOption: "UNFORMATTED_VALUE",
  });

  const rawRows = data.values ?? [];
  const rows: VerkaufsanalyseRow[] = [];
  let lastUpdated: string | null = null;

  // Sheet format (from Code.js):
  // Row 1: Title (merged A1:L1) - "VERKAUFSANALYSE – Letzte 12 Monate | ..."
  // Row 2: Weights note (merged)
  // Row 3: empty
  // Row 4: "USBEKISCH WELLIG" (merged A:L, section header)
  // Row 5: Column headers: A="", B="Collection", C="g/Stk", D="Ø 12M (kg)", ...
  // Row 6+: Data: A="", B=collection name, C=g/Stk, D-K=values, L=trend
  // SUMME row, empty row, then "RUSSISCH GLATT" section, then GESAMT

  let currentQuality = "";

  for (const row of rawRows) {
    // Build the full text of the row to detect section headers (merged cells put text in col A)
    const colA = String(row[0] ?? "").trim();
    const colB = String(row[1] ?? "").trim();
    const fullText = row.map((c: unknown) => String(c ?? "")).join(" ").toUpperCase();

    // Skip title, notes, empty rows — but extract timestamp first
    if (fullText.includes("VERKAUFSANALYSE") && fullText.includes("LETZTE")) {
      if (!lastUpdated) lastUpdated = extractTimestamp(colA || row.map((c: unknown) => String(c ?? "")).join(" "));
      continue;
    }
    if (fullText.includes("GEWICHTE:")) continue;

    // Detect section headers (merged into col A): "USBEKISCH WELLIG" / "RUSSISCH GLATT"
    // These are single-cell merged rows with just the quality name
    if (colA.toUpperCase() === "USBEKISCH WELLIG" || fullText === "USBEKISCH WELLIG") {
      currentQuality = "Usbekisch Wellig";
      continue;
    }
    if (colA.toUpperCase() === "RUSSISCH GLATT" || fullText === "RUSSISCH GLATT") {
      currentQuality = "Russisch Glatt";
      continue;
    }

    // Skip column header rows
    if (colB === "Collection") continue;

    // Skip empty rows
    if (!colB) continue;

    if (!currentQuality) continue;

    // Detect summary rows
    const isSummary = colB.toUpperCase().includes("SUMME") || colB.toUpperCase().includes("GESAMT");

    // Parse values: C=g/Stk, D=Ø12M(kg), E=Ø12M(€), F=Ø3M(kg), G=Ø3M(€), H=30T(kg), I=30T(€), J=AktM(kg), K=AktM(€), L=Trend
    rows.push({
      collection: colB,
      quality: currentQuality,
      gPerUnit: String(row[2] ?? "").trim(),
      avg12mKg: parseFloat(row[3]) || 0,
      avg12mEur: parseFloat(row[4]) || 0,
      avg3mKg: parseFloat(row[5]) || 0,
      avg3mEur: parseFloat(row[6]) || 0,
      d30Kg: parseFloat(row[7]) || 0,
      d30Eur: parseFloat(row[8]) || 0,
      curMonthKg: parseFloat(row[9]) || 0,
      curMonthEur: parseFloat(row[10]) || 0,
      trend: String(row[11] ?? "").trim(),
      isSummary,
    });
  }

  return { rows, lastUpdated };
}
