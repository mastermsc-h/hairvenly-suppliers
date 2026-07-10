import { google } from "googleapis";
import { readFileSync } from "fs";
import path from "path";

// Sheet IDs mapped by supplier name pattern
const SHEET_MAP: Record<string, string | undefined> = {
  amanda: process.env.GOOGLE_SHEET_AMANDA,
  china: process.env.GOOGLE_SHEET_CHINA,
  eyfel: process.env.GOOGLE_SHEET_CHINA,
};

function getAuth() {
  let key: Record<string, unknown>;

  // Option 1: JSON string in env (for Vercel/production)
  if (process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    key = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
  }
  // Option 2: File path (for local development)
  else if (process.env.GOOGLE_SERVICE_ACCOUNT_PATH) {
    const fullPath = path.resolve(process.cwd(), process.env.GOOGLE_SERVICE_ACCOUNT_PATH);
    key = JSON.parse(readFileSync(fullPath, "utf-8"));
  } else {
    throw new Error("GOOGLE_SERVICE_ACCOUNT_JSON or GOOGLE_SERVICE_ACCOUNT_PATH must be set");
  }

  return new google.auth.GoogleAuth({
    credentials: key,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
}

/** Find the right sheet ID based on supplier name */
export function getSheetId(supplierName: string): string | null {
  const lower = supplierName.toLowerCase();
  for (const [key, id] of Object.entries(SHEET_MAP)) {
    if (lower.includes(key) && id) return id;
  }
  return null;
}

interface OrderItemRow {
  methodName: string;
  lengthValue: string;
  colorName: string;
  quantity: number;
  eta?: string | null; // optional per-position ETA (ISO YYYY-MM-DD)
}

/**
 * Creates a new tab in the Google Sheet with the order data.
 * Tab name format: "Amanda 07.04.2026" (supplier + date)
 */
export async function exportOrderToSheet(
  supplierName: string,
  orderDate: string, // "2026-04-07"
  items: OrderItemRow[],
  meta?: { status?: string; weightKg?: number; eta?: string; notes?: string },
): Promise<{ sheetUrl: string } | { error: string }> {
  const spreadsheetId = getSheetId(supplierName);
  if (!spreadsheetId) {
    return { error: `Kein Google Sheet für Lieferant "${supplierName}" konfiguriert` };
  }

  try {
    const auth = getAuth();
    const sheets = google.sheets({ version: "v4", auth });

    // Format date for tab name: "Amanda 07.04.2026"
    const [yyyy, mm, dd] = orderDate.split("-");
    const tabName = `${supplierName} ${dd}.${mm}.${yyyy}`;

    // Check if tab already exists, add suffix if needed
    const { data: spreadsheet } = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: "sheets.properties.title",
    });

    const existingTitles = new Set(
      spreadsheet.sheets?.map((s) => s.properties?.title) ?? [],
    );

    let finalTabName = tabName;
    let suffix = 1;
    while (existingTitles.has(finalTabName)) {
      suffix++;
      finalTabName = `${tabName} (${suffix})`;
    }

    // Create new tab
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId,
      requestBody: {
        requests: [
          {
            addSheet: {
              properties: {
                title: finalTabName,
                index: 0, // Insert as first tab
              },
            },
          },
        ],
      },
    });

    // Method → color mapping for Google Sheets (RGB 0-1)
    const METHOD_SHEET_COLORS: Record<string, { red: number; green: number; blue: number }> = {
      "Bondings":        { red: 0.93, green: 0.87, blue: 0.98 }, // purple
      "Standard Tapes":  { red: 0.98, green: 0.88, blue: 0.93 }, // pink
      "Minitapes":       { red: 0.99, green: 0.89, blue: 0.88 }, // rose
      "Classic Weft":    { red: 0.87, green: 0.92, blue: 0.99 }, // blue
      "Invisible Weft":  { red: 0.87, green: 0.97, blue: 0.99 }, // cyan
      "Clip-ins":        { red: 1.0,  green: 0.96, blue: 0.87 },  // amber
      "Tapes":           { red: 0.88, green: 0.89, blue: 0.99 }, // indigo
      "Classic Tressen": { red: 0.87, green: 0.98, blue: 0.93 }, // emerald
      "Genius Weft":     { red: 0.87, green: 0.97, blue: 0.96 }, // teal
    };
    const DEFAULT_BG = { red: 0.95, green: 0.95, blue: 0.95 };

    // Status labels (German)
    const STATUS_DE: Record<string, string> = {
      draft: "Entwurf", sent_to_supplier: "An Lieferant gesendet", confirmed: "Bestätigt",
      in_production: "In Produktion", ready_to_ship: "Versandbereit", shipped: "Versendet",
      in_customs: "Im Zoll", delivered: "Angekommen", stocked: "Ins Lager eingepflegt",
      cancelled: "Storniert",
    };

    // Build rows grouped by method + length, tracking row indices for coloring
    const allRows: (string | number)[][] = [
      ["Bestellung", "Status", "Gewicht", "Voraussichtliche Lieferung"],
      [
        `${supplierName} ${dd}.${mm}.${yyyy}`,
        STATUS_DE[meta?.status ?? "draft"] ?? meta?.status ?? "Entwurf",
        meta?.weightKg ? `${meta.weightKg} kg` : "—",
        meta?.eta ? new Date(meta.eta).toLocaleDateString("de-DE") : "—",
      ],
      [], // Empty row before item table
      ["Method", "Length/Variant", "Farbcode", "Quantity (g)", "ETA"],
    ];

    // Format a single ETA value (ISO YYYY-MM-DD) to German DD.MM.YYYY
    const fmtEta = (s: string | null | undefined) => {
      if (!s) return "";
      const d = new Date(s + "T00:00:00");
      if (Number.isNaN(d.getTime())) return "";
      return d.toLocaleDateString("de-DE");
    };
    const fallbackEta = fmtEta(meta?.eta);

    // Track which rows belong to which method (for coloring)
    const groupRanges: { startRow: number; endRow: number; method: string }[] = [];

    // Sort items by method then length
    const sorted = [...items].sort((a, b) => {
      const mCmp = a.methodName.localeCompare(b.methodName);
      if (mCmp !== 0) return mCmp;
      return a.lengthValue.localeCompare(b.lengthValue);
    });

    let currentGroup = "";
    let groupStart = -1;
    let currentMethodName = "";

    for (const item of sorted) {
      const group = `${item.methodName}|${item.lengthValue}`;
      if (group !== currentGroup) {
        // Close previous group
        if (currentGroup && groupStart >= 0) {
          groupRanges.push({ startRow: groupStart, endRow: allRows.length, method: currentMethodName });
        }
        if (currentGroup) allRows.push([]); // Empty row between groups
        currentGroup = group;
        groupStart = allRows.length;
        currentMethodName = item.methodName;
      }
      allRows.push([
        item.methodName,
        item.lengthValue,
        `#${item.colorName}`,
        item.quantity,
        fmtEta(item.eta) || fallbackEta,
      ]);
    }
    // Close last group
    if (groupStart >= 0) {
      groupRanges.push({ startRow: groupStart, endRow: allRows.length, method: currentMethodName });
    }

    // Add subtotal
    const totalQty = items.reduce((s, i) => s + i.quantity, 0);
    allRows.push([]);
    allRows.push(["Subtotal", "", "", totalQty, ""]);

    // Write data
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${finalTabName}'!A1`,
      valueInputOption: "RAW",
      requestBody: { values: allRows },
    });

    // Get sheet ID for formatting
    const { data: updatedSpreadsheet } = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: "sheets.properties",
    });
    const newSheet = updatedSpreadsheet.sheets?.find((s) => s.properties?.title === finalTabName);
    const sheetId = newSheet?.properties?.sheetId;

    if (sheetId !== undefined) {
      const formatRequests: object[] = [
        // Row 0: Meta labels (small, gray)
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 0, endRowIndex: 1 },
            cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 9 }, backgroundColor: { red: 0.95, green: 0.95, blue: 0.95 } } },
            fields: "userEnteredFormat(textFormat,backgroundColor)",
          },
        },
        // Row 1: Meta values (bold, larger)
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 1, endRowIndex: 2 },
            cell: { userEnteredFormat: { textFormat: { bold: true, fontSize: 11 } } },
            fields: "userEnteredFormat(textFormat)",
          },
        },
        // Row 3: Item table header (bold + cyan)
        {
          repeatCell: {
            range: { sheetId, startRowIndex: 3, endRowIndex: 4 },
            cell: {
              userEnteredFormat: {
                textFormat: { bold: true },
                backgroundColor: { red: 0.0, green: 0.9, blue: 0.9 },
              },
            },
            fields: "userEnteredFormat(textFormat,backgroundColor)",
          },
        },
        // Bold subtotal row
        {
          repeatCell: {
            range: { sheetId, startRowIndex: allRows.length - 1, endRowIndex: allRows.length },
            cell: {
              userEnteredFormat: {
                textFormat: { bold: true, fontSize: 11 },
                backgroundColor: { red: 1.0, green: 0.95, blue: 0.8 },
              },
            },
            fields: "userEnteredFormat(textFormat,backgroundColor)",
          },
        },
        // Auto-resize columns
        {
          autoResizeDimensions: {
            dimensions: { sheetId, dimension: "COLUMNS", startIndex: 0, endIndex: 6 },
          },
        },
      ];

      // Color each method group
      for (const range of groupRanges) {
        const bg = METHOD_SHEET_COLORS[range.method] ?? DEFAULT_BG;
        formatRequests.push({
          repeatCell: {
            range: { sheetId, startRowIndex: range.startRow, endRowIndex: range.endRow, startColumnIndex: 0, endColumnIndex: 4 },
            cell: { userEnteredFormat: { backgroundColor: bg } },
            fields: "userEnteredFormat(backgroundColor)",
          },
        });
      }

      await sheets.spreadsheets.batchUpdate({
        spreadsheetId,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        requestBody: { requests: formatRequests as any[] },
      });
    }

    const sheetUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit#gid=${sheetId ?? 0}`;
    return { sheetUrl };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Google Sheets export failed:", message);
    return { error: `Google Sheets Export fehlgeschlagen: ${message}` };
  }
}

// ── Import Shopify Names ────────────────────────────────────────

interface ShopifyProduct {
  collection: string;     // Shopify collection = Method mapping
  shopifyName: string;    // Full Shopify product name
  colorName: string;      // Extracted color (e.g. "EBONY" from "#EBONY - INVISIBLE CLIP...")
  variant: string;        // Weight variant (e.g. "100", "150")
}

// Map Shopify collections → Catalog method names
export const COLLECTION_TO_METHOD: Record<string, string> = {
  // Amanda (Russisch GLATT)
  "clip in extensions echthaar": "Clip-ins",
  "standard tapes russisch": "Standard Tapes",
  "mini tapes glatt": "Minitapes",
  "russische bondings (glatt)": "Bondings",
  "russische classic tressen (glatt)": "Classic Weft",
  "russische genius tressen (glatt)": "Genius Weft",
  "russische invisible tressen (glatt)": "Invisible Weft",
  // Eyfel Ebru (Usbekisch WELLIG)
  "tapes wellig 45cm": "Tapes",
  "tapes wellig 55cm": "Tapes",
  "tapes wellig 65cm": "Tapes",
  "tapes wellig 85cm": "Tapes",
  "bondings wellig 65cm": "Bondings",
  "bondings wellig 85cm": "Bondings",
  "usbekische classic tressen (wellig)": "Classic Tressen",
  "usbekische genius tressen (wellig)": "Genius Weft",
  "ponytail extensions kaufen": "Ponytail",
};

// Extract length from collection name (e.g. "Tapes Wellig 45cm" → "45cm")
function extractLength(collection: string): string | null {
  const m = collection.match(/(\d+)\s*cm/i);
  if (m) return m[1] + "cm";
  // Clip-ins have variant weights
  return null;
}

/**
 * Import Shopify product names from Stock Calculation sheet.
 * Returns products grouped by method with their Shopify names.
 */
export async function importShopifyNames(tabName: string): Promise<{ products: ShopifyProduct[] } | { error: string }> {
  const spreadsheetId = process.env.GOOGLE_SHEET_STOCK;
  if (!spreadsheetId) return { error: "GOOGLE_SHEET_STOCK nicht konfiguriert" };

  try {
    const auth = getAuth();
    const sheets = google.sheets({ version: "v4", auth });

    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${tabName}'!A1:C1000`,
      valueRenderOption: "UNFORMATTED_VALUE",
    });

    const rawRows = data.values ?? [];
    if (rawRows.length < 2) return { products: [] };

    const products: ShopifyProduct[] = [];

    for (let i = 1; i < rawRows.length; i++) {
      const row = rawRows[i];
      if (!row || row.length < 2) continue;

      const collection = String(row[0] ?? "").trim();
      const shopifyName = String(row[1] ?? "").trim();
      const variant = String(row[2] ?? "").trim();

      // Skip total/summary rows
      if (!collection || collection.startsWith("Total") || collection === "GRAND TOTAL") continue;
      if (!shopifyName || !shopifyName.includes("#")) continue;

      // Normalize: extract from the # onwards (handles "TRESSEN #FROSTY..." and "INVISIBLE TRESSEN #PEARL...")
      const hashIdx = shopifyName.indexOf("#");
      const afterHash = shopifyName.substring(hashIdx + 1).trim();

      // Extract the color name (first meaningful part before descriptive words)
      let colorName = afterHash;
      // Smart extraction: if it starts with a short code (number/letter combo), take just that
      // e.g. "2E DUNKELBRAUNE..." → "2E", "24A SANDBLONDE..." → "24A"
      const codeMatch = colorName.match(/^([A-Z0-9][A-Z0-9/]*(?:\s*[A-Z0-9/]+)?)\s+[A-ZÄÖÜ]/);
      if (codeMatch) {
        const code = codeMatch[1].trim();
        // Only use if it's short (typical color codes are 1-8 chars)
        if (code.length <= 8 && !code.includes(" ")) {
          colorName = code;
        }
      }

      // For longer names: take the part before common descriptive/method words
      if (colorName.length > 10) {
        const stopWords = [
          " RUSSISCHE", " RU GLATT", " GLATT", " US WELLIGE", " WELLIGE", " US ",
          " STANDARD ", " MINI TAPE", " BONDINGS", " INVISIBLE", " CLASSIC",
          " GENIUS", " TAPE EXT", " CLIP EXT", " TRESSEN", " WEFT",
          " EXTENSIONS", " - ", " TIEFSCHWARZ", " SCHWARZBRAUN", " DUNKELBRAUN",
          " MITTELBRAUN", " HELLBRAUN", " DUNKELBLOND", " HELLBLOND", " LICHTBLOND",
          " LIGHTBLOND", " PLATINBLOND", " OMBRES ", " BALAYAGE ", " GESTRÄHN",
          " HONIGBLOND", " GOLDBLOND", " SAMTBRAUN", " MOKKA", " ASCHBRAUN",
          " REHBRAUN", " KUPFER", " KIRSCHE", " SANDBLOND", " SCHOKOLAD",
          " KÜHLES ", " HELLES ", " DUNKLE",
        ];
        for (const sw of stopWords) {
          const idx = colorName.toUpperCase().indexOf(sw.toUpperCase());
          if (idx > 0) {
            const candidate = colorName.substring(0, idx).trim();
            if (candidate.length >= 1) {
              colorName = candidate;
              break;
            }
          }
        }
      }

      // Clean up: remove trailing special chars and "TRESSEN" prefix artifacts
      colorName = colorName.replace(/\s+TRESSEN$/i, "").replace(/[♡\-–,\s]+$/, "").trim();

      products.push({ collection, shopifyName, colorName, variant });
    }

    return { products };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `Import fehlgeschlagen: ${message}` };
  }
}

// ── Update Order Status in Sheet ─────────────────────────────────

const STATUS_DE: Record<string, string> = {
  draft: "Entwurf", sent_to_supplier: "An Lieferant gesendet", confirmed: "Bestätigt",
  in_production: "In Produktion", ready_to_ship: "Versandbereit", shipped: "Versendet",
  in_customs: "Im Zoll", delivered: "Angekommen", stocked: "Ins Lager eingepflegt",
  cancelled: "Storniert",
};

/**
 * Update the status cell in an existing order sheet tab.
 * The status is in cell B2 (row 2, column 2).
 */
export async function updateSheetStatus(
  sheetUrl: string,
  newStatus: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    // Extract spreadsheet ID and gid from URL
    const idMatch = sheetUrl.match(/\/d\/([^/]+)/);
    const gidMatch = sheetUrl.match(/gid=(\d+)/);
    if (!idMatch) return { ok: false, error: "Ungültige Sheet-URL" };

    const spreadsheetId = idMatch[1];
    const auth = getAuth();
    const sheets = google.sheets({ version: "v4", auth });

    // Find the tab name from gid
    const { data: meta } = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: "sheets.properties",
    });

    const gid = gidMatch ? parseInt(gidMatch[1]) : null;
    let tabName: string | null = null;

    if (gid !== null) {
      const sheet = meta.sheets?.find((s) => s.properties?.sheetId === gid);
      tabName = sheet?.properties?.title ?? null;
    }

    if (!tabName) {
      // Fallback: use first sheet
      tabName = meta.sheets?.[0]?.properties?.title ?? null;
    }

    if (!tabName) return { ok: false, error: "Tab nicht gefunden" };

    // Update status in B2
    const statusLabel = STATUS_DE[newStatus] ?? newStatus;
    await sheets.spreadsheets.values.update({
      spreadsheetId,
      range: `'${tabName}'!B2`,
      valueInputOption: "RAW",
      requestBody: { values: [[statusLabel]] },
    });

    return { ok: true };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

// ── Budget & Suggestion Generation ──────────────────────────────

export interface SuggestionMeta {
  title: string;       // Full title row content
  budgetKg: number;    // Budget in kg
  usedKg: number;      // Used/consumed budget in kg
  timestamp: string;   // When the suggestion was last updated
}

/**
 * Read the header info from a suggestion tab (date, budget, consumed)
 */
export async function readSuggestionMeta(tabName: string): Promise<SuggestionMeta | null> {
  const spreadsheetId = process.env.GOOGLE_SHEET_STOCK;
  if (!spreadsheetId) return null;

  try {
    const auth = getAuth();
    const sheets = google.sheets({ version: "v4", auth });

    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${tabName}'!A1:J3`,
      valueRenderOption: "UNFORMATTED_VALUE",
    });

    const rows = data.values ?? [];
    const title = String(rows[0]?.[0] ?? "");

    // Extract budget and consumed from title
    // Format: "AMANDA (Russisch Glatt) – BUDGET-BESTELLUNG 10.04.2026 | Budget: 20.0 kg | Verbraucht: 20.0 kg"
    const budgetMatch = title.match(/Budget:\s*([\d.,]+)\s*kg/i);
    const usedMatch = title.match(/Verbraucht:\s*([\d.,]+)\s*kg/i);

    return {
      title,
      budgetKg: budgetMatch ? parseFloat(budgetMatch[1].replace(",", ".")) : 0,
      usedKg: usedMatch ? parseFloat(usedMatch[1].replace(",", ".")) : 0,
      timestamp: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

/**
 * Trigger the Apps Script via Web App to regenerate order suggestions.
 * The script runs createBestellungAmanda/China with the given budget.
 * This can take 2-5 minutes to complete.
 */
export async function triggerAppsScript(supplier: "amanda" | "china", budgetGrams: number): Promise<{ ok: boolean; title?: string; error?: string }> {
  const url = process.env.GOOGLE_APPS_SCRIPT_URL;
  if (!url) return { ok: false, error: "GOOGLE_APPS_SCRIPT_URL nicht konfiguriert" };

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ supplier, budgetG: budgetGrams }),
      // Apps Script can take several minutes
      signal: AbortSignal.timeout(360000), // 6 min timeout
    });

    const text = await response.text();
    try {
      const data = JSON.parse(text) as { ok?: boolean; error?: string; title?: string; budgetG?: number };
      if (data.error) {
        console.error("[triggerAppsScript] Apps Script Fehler:", data.error);
        // Google-Spreadsheet-Timeout in verständliche Handlungsanweisung übersetzen
        const friendly = /timed out|Zeit überschritten/i.test(data.error)
          ? "Google Sheets ist gerade ausgelastet (vermutlich läuft der Auto-Refresh im Hintergrund). Bitte in 2–3 Minuten erneut versuchen."
          : data.error;
        return { ok: false, error: friendly };
      }
      // Sanity-Check: wenn Apps Script zwar 'ok' aber weder title noch budgetG
      // zurückgibt, ist wahrscheinlich etwas schiefgelaufen — sag es dem User.
      if (!data.title && !data.budgetG) {
        console.warn("[triggerAppsScript] Response ohne Title/Budget — evtl. leerer Sheet-Output:", text.slice(0, 500));
      }
      return { ok: true, title: data.title };
    } catch {
      if (text.includes("authorization") || text.includes("Sign in")) {
        return { ok: false, error: "Apps Script Autorisierung fehlgeschlagen. Bitte Web App Deployment prüfen." };
      }
      // Nicht-JSON und keine Auth-Seite → wahrscheinlich HTML-Fehlerseite oder Timeout.
      // Antwort zurückgeben statt still ok:true — damit der User weiß dass was schief lief.
      console.warn("[triggerAppsScript] Nicht-JSON Response, ersten 200 Zeichen:", text.slice(0, 200));
      return { ok: false, error: `Apps Script antwortete unerwartet (kein JSON). Erste 200 Zeichen: ${text.slice(0, 200)}` };
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: `Apps Script Aufruf fehlgeschlagen: ${message}` };
  }
}

// ── Import Hairvenly Color Codes from Order Sheets ──────────────

export interface OrderSheetColor {
  method: string;
  length: string;
  colorName: string;  // The Hairvenly color code (e.g. "2E", "Pearl White")
}

/**
 * Read ALL order tabs from a sheet and extract unique method → length → color combinations.
 * This gives us the real Hairvenly color codes.
 */
export async function importColorsFromOrderSheets(spreadsheetId: string, isAmanda: boolean): Promise<{ colors: OrderSheetColor[] } | { error: string }> {
  try {
    const auth = getAuth();
    const sheets = google.sheets({ version: "v4", auth });

    // Get all tab names
    const { data: meta } = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: "sheets.properties.title",
    });
    const tabs = (meta.sheets ?? []).map((s) => s.properties?.title ?? "").filter(Boolean);

    const allColors = new Map<string, Set<string>>(); // "method|length" → Set of colors

    for (const tab of tabs) {
      // Skip non-order tabs
      if (tab.includes("Kopie") || tab.includes("Summary") || tab.includes("Eyfel Ebru")) continue;

      try {
        const range = isAmanda ? `'${tab}'!A1:F100` : `'${tab}'!A1:D100`;
        const { data } = await sheets.spreadsheets.values.get({
          spreadsheetId,
          range,
          valueRenderOption: "UNFORMATTED_VALUE",
        });

        const rows = data.values ?? [];
        let curMethod = "", curLength = "";

        for (const row of rows.slice(isAmanda ? 2 : 1)) {
          let method: string, length: string, color: string;

          if (isAmanda) {
            // Amanda: B=Method, C=Length, D=Farbcode
            method = String(row[1] ?? "").trim() || curMethod;
            length = String(row[2] ?? "").trim() || curLength;
            color = String(row[3] ?? "").trim();
            if (row[1]) curMethod = method;
            if (row[2]) curLength = length;
          } else {
            // China: A=Method, B=Length, C=Farbcode
            method = String(row[0] ?? "").trim() || curMethod;
            length = String(row[1] ?? "").trim() || curLength;
            color = String(row[2] ?? "").trim();
            if (row[0]) curMethod = method;
            if (row[1]) curLength = length;
          }

          if (!color.startsWith("#")) continue;
          if (method.toLowerCase().includes("subtotal") || method.toLowerCase().includes("summary")) continue;
          color = color.replace(/^#/, "").trim();
          if (!color || !method || !length) continue;

          const key = `${method}|${length}`;
          if (!allColors.has(key)) allColors.set(key, new Set());
          allColors.get(key)!.add(color);
        }
      } catch {
        // Skip tabs that can't be read
      }
    }

    // Flatten to array
    const colors: OrderSheetColor[] = [];
    for (const [key, colorSet] of allColors) {
      const [method, length] = key.split("|");
      for (const colorName of colorSet) {
        colors.push({ method, length, colorName });
      }
    }

    return { colors };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: `Import fehlgeschlagen: ${message}` };
  }
}

// ── Import Order Suggestions ────────────────────────────────────

export interface SuggestionRow {
  method: string;
  length: string;
  colorCode: string;   // Raw color code from sheet (e.g. "#PEARL WHITE STANDARD RU...")
  stock: number;
  inTransit: number;
  target: number;
  orderQty: number;    // Suggested quantity
}

/**
 * Read order suggestions from the Stock Calculation sheet.
 * @param tabName - The tab name to read (e.g. "Vorschlag - Amanda", "Vorschlag - China")
 */
export async function importSuggestions(tabName: string): Promise<{ rows: SuggestionRow[] } | { error: string }> {
  const spreadsheetId = process.env.GOOGLE_SHEET_STOCK;
  if (!spreadsheetId) return { error: "GOOGLE_SHEET_STOCK nicht konfiguriert" };

  try {
    const auth = getAuth();
    const sheets = google.sheets({ version: "v4", auth });

    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${tabName}'!A1:H500`,
      valueRenderOption: "UNFORMATTED_VALUE",
    });

    const rawRows = data.values ?? [];
    if (rawRows.length < 3) return { rows: [] };

    // Detect which format based on the tab name
    const isAmanda = tabName.toLowerCase().includes("amanda");

    const rows: SuggestionRow[] = [];

    for (let i = 2; i < rawRows.length; i++) { // Skip header rows (row 1 = title, row 2 = headers)
      const row = rawRows[i];
      if (!row || row.length < 4) continue;

      let method: string, length: string, colorCode: string, stock: number, inTransit: number, target: number, orderQty: number;

      if (isAmanda) {
        // Amanda: A=Quality, B=Method, C=Length, D=Farbcode, E=Lager, F=Unterwegs, G=Ziel, H=Bestellung
        method = String(row[1] ?? "").trim();
        length = String(row[2] ?? "").trim();
        colorCode = String(row[3] ?? "").trim();
        stock = Number(row[4]) || 0;
        inTransit = Number(row[5]) || 0;
        target = Number(row[6]) || 0;
        orderQty = Number(row[7]) || 0;
      } else {
        // China: A=Typ, B=Länge, C=Farbcode, D=Lager, E=Unterwegs, F=Ziel, G=Bestellung
        method = String(row[0] ?? "").trim();
        length = String(row[1] ?? "").trim();
        colorCode = String(row[2] ?? "").trim();
        stock = Number(row[3]) || 0;
        inTransit = Number(row[4]) || 0;
        target = Number(row[5]) || 0;
        orderQty = Number(row[6]) || 0;
      }

      // Stop at "VOLLSTÄNDIGE LISTE" or "Subtotal" separator
      const rawA = String(row[0] ?? "").trim();
      const rawAll = row.map((c: unknown) => String(c ?? "")).join(" ");
      if (rawAll.includes("VOLLSTÄNDIGE LISTE") || rawAll.includes("vollständig")) break;
      if (rawA.toLowerCase() === "subtotal" || method.toLowerCase() === "subtotal") break;

      // Skip empty rows, header-like rows
      if (!colorCode || !colorCode.includes("#")) continue;
      if (orderQty <= 0) continue;

      // Normalize: extract the part starting from # (e.g. "TRESSEN #FROSTY..." → "#FROSTY...")
      const hashIndex = colorCode.indexOf("#");
      if (hashIndex > 0) {
        // Has a prefix like "TRESSEN " or "INVISIBLE TRESSEN " — extract just the #part
        colorCode = colorCode.substring(hashIndex);
      }

      // Fill down method/length from previous rows if empty
      if (!method && rows.length > 0) method = rows[rows.length - 1].method;
      if (!length && rows.length > 0) length = rows[rows.length - 1].length;

      rows.push({ method, length, colorCode, stock, inTransit, target, orderQty });
    }

    return { rows };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Import suggestions failed:", message);
    return { error: `Import fehlgeschlagen: ${message}` };
  }
}

/**
 * Read per-position ETAs from an exported order tab.
 *
 * The order tab layout (written by exportOrderToSheet):
 *   Row 1: ["Bestellung", "Status", "Gewicht", "Voraussichtliche Lieferung"]
 *   Row 2: [<order name>, <status>, <weight>, <eta>]
 *   Row 3: []
 *   Row 4: ["Method", "Length/Variant", "Farbcode", "Quantity (g)", "ETA"]
 *   Row 5+: items (or empty rows between groups)
 *   Last:  ["Subtotal", ...]
 *
 * Returns a map: `${method}|${length}|${color}` (lowercased) → ETA-ISO-string
 * Empty cells / "Subtotal" / group separators are skipped.
 */
export async function readOrderSheetEtas(
  sheetUrl: string,
): Promise<{ etas?: Map<string, string>; error?: string }> {
  const m = sheetUrl.match(/\/spreadsheets\/d\/([^/]+).*[?&]gid=(\d+)/);
  if (!m) return { error: "Sheet-URL konnte nicht geparst werden" };
  const spreadsheetId = m[1];
  const sheetGid = Number(m[2]);

  try {
    const auth = getAuth();
    const sheets = google.sheets({ version: "v4", auth });

    // Find the tab name for the given gid
    const { data: meta } = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: "sheets.properties",
    });
    const tab = meta.sheets?.find((s) => s.properties?.sheetId === sheetGid);
    if (!tab?.properties?.title) return { error: "Tab nicht gefunden" };
    const tabName = tab.properties.title;

    // Read range — wider to support custom column layouts (A..K)
    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${tabName}'!A1:K1000`,
    });
    const rows = data.values ?? [];
    if (rows.length < 4) return { etas: new Map() };

    // Find columns INDEPENDENTLY by scanning all top-rows:
    //   1) Item header row → has "Farbcode" → gives Method/Length/Color columns
    //   2) "ETA" label can be in any row (often in the meta block at row 1)
    let itemHeaderRow = -1;
    let colMethod = -1, colLength = -1, colColor = -1, colEta = -1;
    for (let i = 0; i < Math.min(rows.length, 20); i++) {
      const r = rows[i] ?? [];
      const cells = r.map((c) => String(c ?? "").trim().toLowerCase());
      // Find the items header row
      const fcIdx = cells.findIndex((c) => c === "farbcode" || c === "color" || c === "farbe");
      if (fcIdx >= 0 && itemHeaderRow < 0) {
        itemHeaderRow = i;
        colColor = fcIdx;
        colMethod = cells.findIndex((c) => c === "method" || c === "methode");
        colLength = cells.findIndex(
          (c) => c === "length/variant" || c === "length" || c === "länge" || c === "laenge" || c === "variant" || c === "länge/variante",
        );
      }
      // Find ETA column anywhere (meta-row or item-header-row)
      if (colEta < 0) {
        const eIdx = cells.findIndex(
          (c) => c === "eta" || c === "ankunft" || c === "ankunftsdatum",
        );
        if (eIdx >= 0) colEta = eIdx;
      }
    }

    // No item header found OR no ETA column → nothing to override
    if (itemHeaderRow < 0 || colEta < 0 || colColor < 0) return { etas: new Map() };
    const headerRowIdx = itemHeaderRow;

    const result = new Map<string, string>();
    // Fill-down for method + length (common in merged-cell sheets)
    let lastMethod = "";
    let lastLength = "";
    for (let i = headerRowIdx + 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r.length === 0) continue;
      const method = (colMethod >= 0 ? String(r[colMethod] ?? "").trim() : "") || lastMethod;
      const length = (colLength >= 0 ? String(r[colLength] ?? "").trim() : "") || lastLength;
      const colorRaw = colColor >= 0 ? String(r[colColor] ?? "").trim() : "";
      const etaCell = String(r[colEta] ?? "").trim();
      if (method && method.toLowerCase() !== "subtotal") lastMethod = method;
      if (length) lastLength = length;
      if (!colorRaw) continue;
      if (method.toLowerCase() === "subtotal") continue;
      const iso = parseGermanDate(etaCell);
      if (!iso) continue;
      const key = `${(method || "").toLowerCase()}|${(length || "").toLowerCase()}|${colorRaw.replace(/^#/, "").toLowerCase()}`;
      result.set(key, iso);
    }
    return { etas: result };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { error: message };
  }
}

/** Format ISO date "YYYY-MM-DD" → "DD.MM.YYYY" für Sheet-Zellen. */
function formatGermanDate(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  return `${m[3]}.${m[2]}.${m[1]}`;
}

/**
 * Schreibt für alle übergebenen (method|length|color) Keys einen ETA-Wert in
 * die ETA-Spalte des Order-Sheets. Nutzt dieselbe Header-Erkennung wie
 * readOrderSheetEtas. Wenn die ETA-Spalte nicht existiert (z.B. weil das Sheet
 * sie noch nicht hat), wird der ersten freien Spalte rechts vom Item-Header
 * eine neue ETA-Header-Zelle hinzugefügt.
 */
export async function writeOrderSheetEtas(
  sheetUrl: string,
  etas: Map<string, string>, // key: "method|length|color (lowercase, no #)" → ISO date
): Promise<{ updated?: number; created_eta_column?: boolean; error?: string }> {
  if (etas.size === 0) return { updated: 0 };

  const m = sheetUrl.match(/\/spreadsheets\/d\/([^/]+).*[?&]gid=(\d+)/);
  if (!m) return { error: "Sheet-URL konnte nicht geparst werden" };
  const spreadsheetId = m[1];
  const sheetGid = Number(m[2]);

  try {
    const auth = getAuth();
    const sheets = google.sheets({ version: "v4", auth });

    const { data: meta } = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: "sheets.properties",
    });
    const tab = meta.sheets?.find((s) => s.properties?.sheetId === sheetGid);
    if (!tab?.properties?.title) return { error: "Tab nicht gefunden" };
    const tabName = tab.properties.title;

    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${tabName}'!A1:K1000`,
    });
    const rows = data.values ?? [];
    if (rows.length < 4) return { updated: 0 };

    // Find columns same way as readOrderSheetEtas
    let itemHeaderRow = -1;
    let colMethod = -1, colLength = -1, colColor = -1, colEta = -1;
    for (let i = 0; i < Math.min(rows.length, 20); i++) {
      const r = rows[i] ?? [];
      const cells = r.map((c) => String(c ?? "").trim().toLowerCase());
      const fcIdx = cells.findIndex((c) => c === "farbcode" || c === "color" || c === "farbe");
      if (fcIdx >= 0 && itemHeaderRow < 0) {
        itemHeaderRow = i;
        colColor = fcIdx;
        colMethod = cells.findIndex((c) => c === "method" || c === "methode");
        colLength = cells.findIndex(
          (c) => c === "length/variant" || c === "length" || c === "länge" || c === "laenge" || c === "variant" || c === "länge/variante",
        );
      }
      if (colEta < 0) {
        const eIdx = cells.findIndex(
          (c) => c === "eta" || c === "ankunft" || c === "ankunftsdatum",
        );
        if (eIdx >= 0) colEta = eIdx;
      }
    }
    if (itemHeaderRow < 0 || colColor < 0) return { error: "Item-Header (Farbcode) nicht gefunden" };

    let createdEtaCol = false;
    // If no ETA column anywhere → add as new header column right after the last known column
    if (colEta < 0) {
      const headerRow = rows[itemHeaderRow] ?? [];
      colEta = Math.max(colMethod + 1, colLength + 1, colColor + 1, headerRow.length);
      const colLetter = String.fromCharCode(65 + colEta); // A=65; works up to Z which is enough for K-range
      await sheets.spreadsheets.values.update({
        spreadsheetId,
        range: `'${tabName}'!${colLetter}${itemHeaderRow + 1}`,
        valueInputOption: "RAW",
        requestBody: { values: [["ETA"]] },
      });
      createdEtaCol = true;
    }

    // Build per-row updates
    const updates: { range: string; values: string[][] }[] = [];
    let lastMethod = "";
    let lastLength = "";
    let updated = 0;
    for (let i = itemHeaderRow + 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r.length === 0) continue;
      const method = (colMethod >= 0 ? String(r[colMethod] ?? "").trim() : "") || lastMethod;
      const length = (colLength >= 0 ? String(r[colLength] ?? "").trim() : "") || lastLength;
      const colorRaw = colColor >= 0 ? String(r[colColor] ?? "").trim() : "";
      if (method && method.toLowerCase() !== "subtotal") lastMethod = method;
      if (length) lastLength = length;
      if (!colorRaw) continue;
      if (method.toLowerCase() === "subtotal") continue;
      const key = `${(method || "").toLowerCase()}|${(length || "").toLowerCase()}|${colorRaw.replace(/^#/, "").toLowerCase()}`;
      const newEta = etas.get(key);
      if (!newEta) continue;
      const colLetter = String.fromCharCode(65 + colEta);
      updates.push({
        range: `'${tabName}'!${colLetter}${i + 1}`,
        values: [[formatGermanDate(newEta)]],
      });
      updated++;
    }
    if (updates.length > 0) {
      await sheets.spreadsheets.values.batchUpdate({
        spreadsheetId,
        requestBody: {
          valueInputOption: "USER_ENTERED",
          data: updates,
        },
      });
    }
    return { updated, created_eta_column: createdEtaCol };
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}

/** Parse "DD.MM.YYYY" → ISO "YYYY-MM-DD". Returns null if invalid. */
function parseGermanDate(s: string): string | null {
  const m = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{2,4})$/);
  if (!m) return null;
  const [, d, mo, y] = m;
  const yyyy = y.length === 2 ? `20${y}` : y;
  const mm = mo.padStart(2, "0");
  const dd = d.padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Read FULL item rows from an order's Google Sheet (method/length/color/qty/eta).
 * Used to import items into DB when an order has none.
 */
export async function readOrderSheetItems(
  sheetUrl: string,
): Promise<{
  items?: {
    method: string;
    length: string;
    color: string; // without leading "#"
    quantity: number;
    eta: string | null; // ISO
  }[];
  error?: string;
}> {
  const m = sheetUrl.match(/\/spreadsheets\/d\/([^/]+).*[?&]gid=(\d+)/);
  if (!m) return { error: "Sheet-URL konnte nicht geparst werden" };
  const spreadsheetId = m[1];
  const sheetGid = Number(m[2]);

  try {
    const auth = getAuth();
    const sheets = google.sheets({ version: "v4", auth });
    const { data: meta } = await sheets.spreadsheets.get({
      spreadsheetId,
      fields: "sheets.properties",
    });
    const tab = meta.sheets?.find((s) => s.properties?.sheetId === sheetGid);
    if (!tab?.properties?.title) return { error: "Tab nicht gefunden" };
    const tabName = tab.properties.title;

    const { data } = await sheets.spreadsheets.values.get({
      spreadsheetId,
      range: `'${tabName}'!A1:K1000`,
    });
    const rows = data.values ?? [];
    if (rows.length < 4) return { items: [] };

    // Locate header columns (same logic as readOrderSheetEtas)
    let itemHeaderRow = -1;
    let colMethod = -1, colLength = -1, colColor = -1, colQty = -1, colEta = -1;
    for (let i = 0; i < Math.min(rows.length, 20); i++) {
      const r = rows[i] ?? [];
      const cells = r.map((c) => String(c ?? "").trim().toLowerCase());
      const fcIdx = cells.findIndex((c) => c === "farbcode" || c === "color" || c === "farbe");
      if (fcIdx >= 0 && itemHeaderRow < 0) {
        itemHeaderRow = i;
        colColor = fcIdx;
        colMethod = cells.findIndex((c) => c === "method" || c === "methode");
        colLength = cells.findIndex(
          (c) => c === "length/variant" || c === "length" || c === "länge" || c === "laenge" || c === "variant" || c === "länge/variante",
        );
        colQty = cells.findIndex((c) => c === "quantity" || c === "quantity (g)" || c === "menge" || c === "menge (g)" || c === "gramm");
      }
      if (colEta < 0) {
        const eIdx = cells.findIndex(
          (c) => c === "eta" || c === "ankunft" || c === "ankunftsdatum",
        );
        if (eIdx >= 0) colEta = eIdx;
      }
    }
    if (itemHeaderRow < 0 || colColor < 0) return { items: [] };

    const items: { method: string; length: string; color: string; quantity: number; eta: string | null }[] = [];
    let lastMethod = "";
    let lastLength = "";
    for (let i = itemHeaderRow + 1; i < rows.length; i++) {
      const r = rows[i];
      if (!r || r.length === 0) continue;
      const method = (colMethod >= 0 ? String(r[colMethod] ?? "").trim() : "") || lastMethod;
      const length = (colLength >= 0 ? String(r[colLength] ?? "").trim() : "") || lastLength;
      const colorRaw = String(r[colColor] ?? "").trim();
      const qtyCell = colQty >= 0 ? String(r[colQty] ?? "").trim() : "";
      const etaCell = colEta >= 0 ? String(r[colEta] ?? "").trim() : "";
      if (method && method.toLowerCase() !== "subtotal") lastMethod = method;
      if (length) lastLength = length;
      if (!colorRaw || method.toLowerCase() === "subtotal") continue;
      const qty = Number(qtyCell.replace(/[^\d.,-]/g, "").replace(",", "."));
      if (!Number.isFinite(qty) || qty <= 0) continue;
      items.push({
        method,
        length,
        color: colorRaw.replace(/^#/, ""),
        quantity: qty,
        eta: parseGermanDate(etaCell),
      });
    }
    return { items };
  } catch (err: unknown) {
    return { error: err instanceof Error ? err.message : String(err) };
  }
}
