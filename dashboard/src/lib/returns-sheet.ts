import { google } from "googleapis";
import { readFileSync } from "fs";
import path from "path";

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

export type RetourType = "return" | "exchange" | "complaint";

export interface SheetRow {
  type: RetourType;
  tabName: string;
  year: number;
  month: number;
  rowIndex: number; // 0-based row within tab
  date: string | null; // parsed ISO date "YYYY-MM-DD"
  customerName: string | null;
  orderNumber: string | null; // normalized with leading #
  reason: string | null; // raw text
  reasonCode: string | null; // normalized reason key
  products: string | null; // free-text product description from column Farbe/Produkt/Zurückgesendete Produkte
  productType: string | null; // Tapes / Bondings etc.
  length: string | null; // 45cm..85cm
  origin: string | null; // US / RU
  weight: string | null; // 50g..350g
  quality: string | null; // only for complaint
  handler: string | null; // Mitarbeiter
  status: string | null; // erstattet, neues Paket versendet, in Bearbeitung
  notes: string | null; // column "Sonstiges" or similar
  // Exchange-specific
  exchangeProduct: string | null;
  exchangeWeight: string | null;
  exchangeTracking: string | null;
  // Complaint-specific
  resolution: string | null; // Lösung
  resolutionResult: string | null; // Ergebnis
}

// Mapping from sheet dropdown strings (case-insensitive contains match) to our reason keys
const REASON_MAP: { match: string; key: string }[] = [
  { match: "farbe nicht gepasst", key: "farbe_nicht_gepasst" },
  { match: "falsche farbe", key: "falsche_farbe" },
  { match: "nicht mehr benötigt", key: "nicht_mehr_benoetigt" },
  { match: "nicht mehr benoetigt", key: "nicht_mehr_benoetigt" },
  { match: "nicht mehr gefallen", key: "nicht_mehr_gefallen" },
  { match: "zu viel bestellt", key: "zu_viel_bestellt" },
  { match: "komplett zurück", key: "komplett_zurueck" },
  { match: "komplett zurueck", key: "komplett_zurueck" },
  { match: "kam zurück", key: "komplett_zurueck" },
  { match: "ohne grundangabe", key: "ohne_grundangabe" },
  { match: "falsche lieferung", key: "sonstiges" },
  { match: "länge passt nicht", key: "sonstiges" },
  { match: "sonstiges", key: "sonstiges" },
];

export function normalizeReason(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const lower = String(raw).toLowerCase().trim();
  if (!lower) return null;
  for (const r of REASON_MAP) {
    if (lower.includes(r.match)) return r.key;
  }
  return "sonstiges";
}

// Normalize order number: accept "19207", "#19207", "19023,19181" (take first)
export function normalizeOrderNumber(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  // Take first number if comma-separated
  const first = s.split(/[,;]/)[0].trim();
  const digits = first.replace(/[^\d]/g, "");
  if (!digits) return null;
  return `#${digits}`;
}

// Parse "1.2" (meaning Jan 2026 since tab is "Rücksendung 01.2026") or "15.04" etc.
function parseDate(raw: unknown, defaultYear: number, defaultMonth: number): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;

  // Try DD.MM.YYYY
  let m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})$/);
  if (m) {
    const d = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10);
    const y = parseInt(m[3], 10);
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  // DD.MM (use tab year/month)
  m = s.match(/^(\d{1,2})[./-](\d{1,2})$/);
  if (m) {
    const d = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10);
    return `${defaultYear}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  // Just day
  m = s.match(/^(\d{1,2})$/);
  if (m) {
    const d = parseInt(m[1], 10);
    return `${defaultYear}-${String(defaultMonth).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
  return null;
}

// Parse tab name like "Rücksendung 04.2026" or "Umtausch 02/2026" or "Reklamation 03.2026"
function parseTab(tabName: string): { type: RetourType; year: number; month: number } | null {
  const lower = tabName.toLowerCase().trim();
  let type: RetourType;
  if (lower.startsWith("rücksendung") || lower.startsWith("ruecksendung")) type = "return";
  else if (lower.startsWith("umtausch")) type = "exchange";
  else if (lower.startsWith("reklamation")) type = "complaint";
  else return null;

  // Match MM.YYYY or MM/YYYY (also handles "Rücksendung April 04.2026" — grab last number group)
  const m = tabName.match(/(\d{1,2})[./](\d{4})/);
  if (!m) return null;
  const month = parseInt(m[1], 10);
  const year = parseInt(m[2], 10);
  if (month < 1 || month > 12) return null;
  return { type, year, month };
}

// Map raw "Status" strings to our normalized status
function normalizeStatus(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).toLowerCase().trim();
  if (!s) return null;
  if (s.includes("erstattet") || s.includes("erledigt") || s.includes("paket versendet")) return "resolved";
  if (s.includes("bearbeitung")) return "in_progress";
  if (s.includes("storno") || s.includes("cancel")) return "cancelled";
  return "open";
}

// Parse columns depending on type
function parseRow(
  type: RetourType,
  tabName: string,
  year: number,
  month: number,
  row: unknown[],
  rowIndex: number,
): SheetRow | null {
  const get = (i: number) => {
    const v = row[i];
    if (v == null) return null;
    const s = String(v).trim();
    return s || null;
  };

  if (type === "return") {
    // Columns: A=Datum B=Name C=Bestellnummer D=Grund E=Farbe F=Produkte G=Länge H=Qualität I=Menge J=Status K=Sonstiges L=Mitarbeiter
    const dateStr = parseDate(get(0), year, month);
    const name = get(1);
    const order = normalizeOrderNumber(get(2));
    const reason = get(3);
    const color = get(4); // "Farbe" — actually the color code
    const product = get(5); // "Produkte" — Tapes, Bondings etc.
    const length = get(6);
    const quality = get(7); // US / RU / Gemischt
    const weight = get(8);
    const status = get(9);
    const notes = get(10);
    const handler = get(11);

    if (!order && !name) return null; // skip empty rows

    return {
      type,
      tabName,
      year,
      month,
      rowIndex,
      date: dateStr,
      customerName: name,
      orderNumber: order,
      reason,
      reasonCode: normalizeReason(reason),
      products: color,
      productType: product,
      length,
      origin: quality,
      weight,
      quality: null,
      handler,
      status: normalizeStatus(status),
      notes,
      exchangeProduct: null,
      exchangeWeight: null,
      exchangeTracking: null,
      resolution: null,
      resolutionResult: null,
    };
  }

  if (type === "exchange") {
    // Columns: A=Bearbeitungsdatum B=Name C=Bestellnummer D=Grund E=Zurückgesendete Produkte F=Menge G=Gewünschte Produkte H=Menge I=Status J=Sendungsnummer des neuen Pakets
    const dateStr = parseDate(get(0), year, month);
    const name = get(1);
    const order = normalizeOrderNumber(get(2));
    const reason = get(3);
    const returnedProduct = get(4);
    const returnedQty = get(5);
    const wantedProduct = get(6);
    const wantedQty = get(7);
    const status = get(8);
    const tracking = get(9);

    if (!order && !name) return null;

    return {
      type,
      tabName,
      year,
      month,
      rowIndex,
      date: dateStr,
      customerName: name,
      orderNumber: order,
      reason,
      reasonCode: normalizeReason(reason),
      products: returnedProduct,
      productType: null,
      length: null,
      origin: null,
      weight: returnedQty,
      quality: null,
      handler: null,
      status: normalizeStatus(status),
      notes: null,
      exchangeProduct: wantedProduct,
      exchangeWeight: wantedQty,
      exchangeTracking: tracking,
      resolution: null,
      resolutionResult: null,
    };
  }

  if (type === "complaint") {
    // Columns: A=Bearbeitungsdatum B=Name C=Bestellnummer D=Grund E=Produkt F=Länge G=Qualität H=Farbe I=Menge J=Status K=Ergebnis L=Lösung
    const dateStr = parseDate(get(0), year, month);
    const name = get(1);
    const order = normalizeOrderNumber(get(2));
    const reason = get(3);
    const product = get(4);
    const length = get(5);
    const quality = get(6);
    const color = get(7);
    const weight = get(8);
    const status = get(9);
    const ergebnis = get(10);
    const loesung = get(11);

    if (!order && !name) return null;

    return {
      type,
      tabName,
      year,
      month,
      rowIndex,
      date: dateStr,
      customerName: name,
      orderNumber: order,
      reason,
      reasonCode: normalizeReason(reason),
      products: color,
      productType: product,
      length,
      origin: null,
      weight,
      quality,
      handler: null,
      status: normalizeStatus(status),
      notes: null,
      exchangeProduct: null,
      exchangeWeight: null,
      exchangeTracking: null,
      resolution: loesung,
      resolutionResult: ergebnis,
    };
  }

  return null;
}

/**
 * Read all return-related tabs from the Retouren Google Sheet and return
 * normalized rows. Handles Rücksendung / Umtausch / Reklamation tabs.
 */
export async function readRetourenSheet(): Promise<{ rows: SheetRow[] } | { error: string }> {
  const spreadsheetId = process.env.GOOGLE_SHEET_RETOUREN;
  if (!spreadsheetId) return { error: "GOOGLE_SHEET_RETOUREN nicht konfiguriert" };

  try {
    const auth = getAuth();
    const sheets = google.sheets({ version: "v4", auth });

    // 1. List all tabs
    const { data: meta } = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: "sheets.properties.title",
    });
    const tabs = (meta.sheets ?? [])
      .map((s) => s.properties?.title ?? "")
      .filter(Boolean);

    // 2. Filter to relevant tabs
    const tabInfos = tabs
      .map((t) => ({ name: t, info: parseTab(t) }))
      .filter((x): x is { name: string; info: { type: RetourType; year: number; month: number } } => x.info !== null);

    const allRows: SheetRow[] = [];

    // 3. Batch read in groups of 5 to respect rate limits
    for (let i = 0; i < tabInfos.length; i += 5) {
      const batch = tabInfos.slice(i, i + 5);
      const ranges = batch.map((t) => `'${t.name}'!A2:L1000`);
      const { data } = await sheets.spreadsheets.values.batchGet({
        spreadsheetId,
        ranges,
        valueRenderOption: "UNFORMATTED_VALUE",
      });

      for (let j = 0; j < batch.length; j++) {
        const tab = batch[j];
        const values = data.valueRanges?.[j]?.values ?? [];
        for (let k = 0; k < values.length; k++) {
          const row = parseRow(tab.info.type, tab.name, tab.info.year, tab.info.month, values[k] as unknown[], k);
          if (row) allRows.push(row);
        }
      }
    }

    return { rows: allRows };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `Sheet-Import fehlgeschlagen: ${message}` };
  }
}
