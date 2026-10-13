/**
 * Bank-Umsatz-Zeilen: gemeinsames Format für FinTS-Worker und CSV-Import,
 * Dedupe-Schlüssel und toleranter CSV-Parser.
 *
 * REINE FUNKTIONEN ohne Abhängigkeiten — getestet in
 * scripts/smoke/bank-matcher.spec.mjs.
 */

export interface BankRow {
  booking_date: string;            // YYYY-MM-DD
  value_date: string | null;
  amount: number;                  // + Eingang, − Ausgang
  currency: string;
  counterparty_name: string | null;
  counterparty_iban: string | null;
  purpose: string | null;
  posting_text: string | null;
  end_to_end_ref: string | null;
  account_iban: string | null;
}

// ── Dedupe ──────────────────────────────────────────────────────────────────

function norm(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Basis des Dedupe-Schlüssels. Bewusst OHNE eigene IBAN und OHNE Gegen-IBAN:
 * Lexware-CSV und FinTS liefern diese Felder unterschiedlich vollständig —
 * mit ihnen würde derselbe Umsatz aus zwei Quellen doppelt landen.
 * Identische Umsätze am selben Tag (Kunde überweist zweimal gleich) werden
 * über den Laufindex in dedupeKeys() unterschieden.
 */
export function dedupeBase(r: Pick<BankRow, "booking_date" | "amount" | "purpose" | "counterparty_name">): string {
  const text = norm(r.purpose) || norm(r.counterparty_name);
  return `${r.booking_date}|${Math.round(r.amount * 100)}|${text.slice(0, 60)}`;
}

/** Schlüssel pro Zeile inkl. Laufindex für exakte Duplikate innerhalb eines Abrufs. */
export function dedupeKeys(rows: BankRow[]): string[] {
  const seen = new Map<string, number>();
  return rows.map((r) => {
    const base = dedupeBase(r);
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return `${base}#${n}`;
  });
}

// ── Validierung (für Ingest vom Worker) ────────────────────────────────────

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function optStr(v: unknown, max = 1000): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s ? s.slice(0, max) : null;
}

/** Prüft/normalisiert eine Zeile aus fremder Quelle. null = unbrauchbar. */
export function sanitizeRow(input: Record<string, unknown>): BankRow | null {
  const booking = optStr(input.booking_date, 10);
  if (!booking || !DATE_RE.test(booking)) return null;
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || Math.abs(amount) > 10_000_000) return null;
  const value = optStr(input.value_date, 10);
  return {
    booking_date: booking,
    value_date: value && DATE_RE.test(value) ? value : null,
    amount: Math.round(amount * 100) / 100,
    currency: (optStr(input.currency, 3) ?? "EUR").toUpperCase(),
    counterparty_name: optStr(input.counterparty_name, 200),
    counterparty_iban: optStr(input.counterparty_iban, 40)?.replace(/\s+/g, "").toUpperCase() ?? null,
    purpose: optStr(input.purpose, 1000),
    posting_text: optStr(input.posting_text, 200),
    end_to_end_ref: optStr(input.end_to_end_ref, 200),
    account_iban: optStr(input.account_iban, 40)?.replace(/\s+/g, "").toUpperCase() ?? null,
  };
}

// ── CSV ─────────────────────────────────────────────────────────────────────

/** RFC-4180-artiges Parsen mit Quotes, "" als Escape und Zeilenumbrüchen in Quotes. */
export function parseCsvText(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === delimiter) { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some((f) => f.trim() !== "")) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== "")) rows.push(row);
  return rows;
}

function headerKey(h: string): string {
  return h
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .replace(/[^a-z0-9]/g, "");
}

type Field =
  | "booking_date" | "value_date" | "amount" | "credit" | "debit" | "currency"
  | "counterparty_name" | "counterparty_iban" | "purpose" | "posting_text"
  | "end_to_end_ref" | "account_iban";

/** Reihenfolge = Priorität: erster Treffer pro Feld gewinnt. */
const HEADER_MAP: [Field, (k: string) => boolean][] = [
  ["account_iban", (k) => k === "auftragskonto" || k === "eigeneiban" || k === "kontoiban"],
  ["booking_date", (k) => ["buchungstag", "buchungsdatum", "datum", "buchung", "bookingdate", "date", "belegdatum"].includes(k)],
  ["value_date", (k) => ["valutadatum", "valuta", "wertstellung", "wertstellungsdatum", "valuedate"].includes(k)],
  ["amount", (k) => ["betrag", "betrageur", "betragineur", "umsatz", "umsatzeur", "amount"].includes(k)],
  ["credit", (k) => ["haben", "eingang", "gutschrift", "credit"].includes(k)],
  ["debit", (k) => ["soll", "ausgang", "lastschrift", "belastung", "debit"].includes(k)],
  ["currency", (k) => ["waehrung", "currency", "whrg"].includes(k)],
  ["counterparty_name", (k) =>
    ["beguenstigterzahlungspflichtiger", "zahlungspflichtiger", "auftraggeberempfaenger", "empfaengerauftraggeber",
     "auftraggeber", "empfaenger", "name", "gegenpartei", "zahlungsbeteiligter", "beteiligter", "counterparty",
     "kontoinhaber", "namezahlungsbeteiligter", "kunde"].includes(k)],
  ["counterparty_iban", (k) =>
    ["kontonummeriban", "iban", "ibangegenkonto", "gegenkonto", "gegenkontoiban", "ibanzahlungsbeteiligter",
     "kontonummer"].includes(k)],
  ["purpose", (k) => ["verwendungszweck", "zweck", "vwz", "purpose", "beschreibung", "buchungsdetails", "description", "notiz"].includes(k)],
  ["posting_text", (k) => ["buchungstext", "umsatzart", "art", "buchungsart", "vorgang", "typ"].includes(k)],
  ["end_to_end_ref", (k) => ["kundenreferenzendtoend", "endtoendreferenz", "eref", "endtoendid", "kundenreferenz"].includes(k)],
];

export function parseGermanDate(s: string): string | null {
  const t = s.trim();
  let m = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/.exec(t);
  if (m) {
    const y = m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]);
    return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(t);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

/** "1.234,56" / "-1234,56" / "1,234.56" / "1234.56" / "12,50 €" → Zahl. */
export function parseAmount(s: string): number | null {
  let t = s.trim().replace(/\s|€|eur/gi, "");
  if (!t) return null;
  let sign = 1;
  if (/^[-−]/.test(t)) { sign = -1; t = t.slice(1); }
  else if (t.startsWith("+")) t = t.slice(1);
  if (/[-−]$/.test(t)) { sign = -1; t = t.slice(0, -1); }
  const lastComma = t.lastIndexOf(",");
  const lastDot = t.lastIndexOf(".");
  if (lastComma > lastDot) t = t.replace(/\./g, "").replace(",", ".");
  else t = t.replace(/,/g, "");
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return sign * Number(t);
}

export interface CsvParseResult {
  rows: BankRow[];
  skipped: number;
  mapping: Partial<Record<Field, string>>;
  error?: string;
}

export function parseBankCsv(text: string): CsvParseResult {
  const clean = text.replace(/^﻿/, "");
  const firstLines = clean.split(/\r?\n/).slice(0, 20).join("\n");
  const counts = [";", ",", "\t"].map((d) => [d, firstLines.split(d).length] as const);
  const delimiter = counts.sort((a, b) => b[1] - a[1])[0][0];
  const table = parseCsvText(clean, delimiter);

  // Kopfzeile suchen (manche Exporte haben Vorspann-Zeilen)
  let headerIdx = -1;
  let mapping: Partial<Record<Field, number>> = {};
  for (let i = 0; i < Math.min(table.length, 20); i++) {
    const keys = table[i].map(headerKey);
    const m: Partial<Record<Field, number>> = {};
    for (const [field, test] of HEADER_MAP) {
      const idx = keys.findIndex((k, j) => test(k) && !Object.values(m).includes(j));
      if (idx >= 0 && m[field] === undefined) m[field] = idx;
    }
    if (m.booking_date !== undefined && (m.amount !== undefined || m.credit !== undefined)) {
      headerIdx = i;
      mapping = m;
      break;
    }
  }
  if (headerIdx < 0) {
    return {
      rows: [], skipped: 0, mapping: {},
      error: "Keine Kopfzeile mit Datum- und Betrag-Spalte gefunden (erwartet z.B. 'Buchungstag' und 'Betrag').",
    };
  }

  const header = table[headerIdx];
  const cell = (r: string[], f: Field) => (mapping[f] !== undefined ? (r[mapping[f]!] ?? "").trim() : "");
  const rows: BankRow[] = [];
  let skipped = 0;
  for (const r of table.slice(headerIdx + 1)) {
    const date = parseGermanDate(cell(r, "booking_date"));
    let amount: number | null = null;
    if (mapping.amount !== undefined) amount = parseAmount(cell(r, "amount"));
    else {
      const cr = parseAmount(cell(r, "credit")) ?? 0;
      const db = parseAmount(cell(r, "debit")) ?? 0;
      amount = cr !== 0 || db !== 0 ? Math.abs(cr) - Math.abs(db) : null;
    }
    if (!date || amount === null) { skipped++; continue; }
    const row = sanitizeRow({
      booking_date: date,
      value_date: parseGermanDate(cell(r, "value_date")),
      amount,
      currency: cell(r, "currency") || "EUR",
      counterparty_name: cell(r, "counterparty_name"),
      counterparty_iban: cell(r, "counterparty_iban"),
      purpose: cell(r, "purpose"),
      posting_text: cell(r, "posting_text"),
      end_to_end_ref: cell(r, "end_to_end_ref"),
      account_iban: cell(r, "account_iban"),
    });
    if (row) rows.push(row); else skipped++;
  }
  const named: Partial<Record<Field, string>> = {};
  for (const [f, idx] of Object.entries(mapping)) named[f as Field] = header[idx as number];
  return { rows, skipped, mapping: named };
}
