/**
 * IMPORT FARB-SHEET → product_colors
 *
 * Liest das kuratierte Farb-Sheet ("Farben Shopify Details") und schreibt
 * Wella-Helligkeit, Unterton, Farbtyp, KI-Beschreibung und KI-Abgrenzung in
 * product_colors. Diese Daten sind die EINZIGE WAHRHEIT für "welche Farbe ist
 * heller/dunkler" — verhindert die Helligkeits-Halluzinationen des Bots
 * (Bug 02.06: RAW vs ESPRESSO geraten).
 *
 * Match: Sheet-Name → product_colors.name_hairvenly (uppercase, mit Alias-Map
 * für Schreibvarianten). Schreibt auf ALLE Längen/Methoden-Einträge derselben
 * Farbe in der russischen Linie.
 *
 * Wiederverwendbar: vom Sync-Button (Server-Action) UND vom Einmal-Skript.
 */
import { google } from "googleapis";
import { createServiceClient } from "@/lib/supabase/server";

const SHEET_ID = "1ow14_Qq6AV7N7vGeJ1EewKvMNfc9nQhHmZf_soDFtpY";
const TAB = "Farben Shopify Details";

// Schreibvarianten Sheet-Name → DB-name_hairvenly (uppercase).
const NAME_ALIAS: Record<string, string> = {
  "BISQUIT BLOND": "BISQUID BLOND",
  "SUN KISSED": "SUN-KISSED",
  "NORWEGIAN": "NORVEGIAN",
  "BUTTER SCOTCH": "BUTTERSCOTCH",
  "VANILLA OMBRE": "VANILA OMBRE",
};

/** Erste numerische Tiefe aus Wella-Code ziehen (z.B. "5/37" → 5, "10.38" → 10,
 *  "6/0 + 8/3" → 6 = die dunkelste/Basis-Stufe). Für schnellen Helligkeits-Vergleich. */
function parseBrightness(wella: string): number | null {
  if (!wella) return null;
  const m = wella.match(/(\d{1,2})\s*[\/.]/);
  if (m) return parseInt(m[1], 10);
  const m2 = wella.match(/^(\d{1,2})\b/);
  return m2 ? parseInt(m2[1], 10) : null;
}

export interface ColorImportResult {
  sheetRows: number;
  matchedColors: number;
  updatedEntries: number;
  unmatched: string[];
}

export async function importColorSheet(): Promise<ColorImportResult> {
  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_PATH || "google-service-account.json",
    scopes: ["https://www.googleapis.com/auth/spreadsheets.readonly"],
  });
  const sheets = google.sheets({ version: "v4", auth });
  const r = await sheets.spreadsheets.values.get({ spreadsheetId: SHEET_ID, range: `${TAB}!A1:L300` });
  const rows = r.data.values || [];
  const hdr = rows[0] || [];
  const data = rows.slice(1).filter(x => x[0]);

  const col = (re: RegExp) => hdr.findIndex(h => re.test(h || ""));
  const iName = 0;
  const iWella = col(/Helligkeit/i);
  const iUnder = col(/Unterton/i);
  const iType = col(/Farbe Typ/i);
  const iBase = col(/Grundton/i);
  const iHigh = col(/Highlights/i);
  const iKi = col(/Beschreibung fuer KI/i);
  const iAbg = col(/Abgrenzung/i);

  const svc = createServiceClient();
  let matchedColors = 0, updatedEntries = 0;
  const unmatched: string[] = [];

  for (const x of data) {
    const rawName = (x[iName] || "").toUpperCase().trim().replace(/\s+/g, " ");
    const dbName = NAME_ALIAS[rawName] || rawName;
    const wella = (x[iWella] || "").trim();
    const fields = {
      wella_level: wella || null,
      brightness_level: parseBrightness(wella),
      undertone: (x[iUnder] || "").trim() || null,
      color_type: (x[iType] || "").trim() || null,
      base_tone: iBase >= 0 ? ((x[iBase] || "").trim() || null) : null,
      highlights: iHigh >= 0 ? ((x[iHigh] || "").trim() || null) : null,
      ki_description: (x[iKi] || "").trim() || null,
      ki_abgrenzung: (x[iAbg] || "").trim() || null,
    };

    // Match auf russische Linie (Sheet ist die russische Farbpalette).
    const { data: matches, error } = await svc
      .from("product_colors")
      .update(fields)
      .or(`name_shopify.ilike.%RUSSISCH%,name_shopify.ilike.%GLATT%`)
      .ilike("name_hairvenly", dbName)
      .select("id");
    if (error) { unmatched.push(`${rawName} (ERR: ${error.message})`); continue; }
    if (matches && matches.length > 0) { matchedColors++; updatedEntries += matches.length; }
    else unmatched.push(rawName);
  }

  return { sheetRows: data.length, matchedColors, updatedEntries, unmatched };
}
