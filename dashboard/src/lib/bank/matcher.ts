/**
 * Zahlungsabgleich: ordnet einen Bank-Eingang offenen Shopify-Bestellungen zu.
 *
 * REINE FUNKTION ohne Abhängigkeiten (kein Supabase, kein Shopify) — damit sie
 * im Smoke-Test (scripts/smoke/bank-matcher.spec.mjs) isoliert geprüft wird.
 *
 * KERN-INVARIANTE ("sicher" = darf automatisch als bezahlt markiert werden):
 *   Mindestens eine Bestellnummer aus dem Verwendungszweck gehört zu einer
 *   OFFENEN Bestellung UND der Betrag ist auf den Cent gleich der Summe der
 *   offenen Beträge dieser Bestellungen. Alles andere → Mensch prüft.
 *
 * Warum beide Bedingungen: Nur-Nummer kann eine PLZ (Bremen 28xxx) oder
 * Rechnungsnummer sein; Nur-Betrag ist bei Standardpreisen mehrdeutig.
 * Zusammen ist ein Fehlgriff praktisch ausgeschlossen.
 */

export interface MatchTx {
  amount: number;                 // + Eingang
  booking_date: string;           // YYYY-MM-DD
  purpose: string | null;
  counterparty_name: string | null;
  end_to_end_ref?: string | null;
}

export interface OpenOrder {
  gid: string;
  name: string;                   // "#27405"
  number: string;                 // "27405"
  createdAt: string;              // ISO
  outstanding: number;            // offener Betrag in EUR
  customerNames: string[];        // Rechnungs-/Liefername
  gateways: string[];             // z.B. ["Bank Deposit"]
}

/** Bestellung, deren Nummer im Verwendungszweck steht, die aber NICHT offen ist. */
export interface ClosedOrderInfo {
  name: string;
  state: "paid" | "cancelled" | "matched" | "other";
  detail: string;                 // z.B. "PAID" / "REFUNDED"
}

export interface Candidate {
  gid: string;
  name: string;
  outstanding: number;
  via: "number" | "amount";
  nameMatch: boolean;
  isBankDeposit: boolean;
}

export type MatchReason =
  | "number_and_amount"   // sicher
  | "payout_source"       // Auszahlung eines Zahlungsdienstleisters o.ä.
  | "amount_mismatch"     // Nummer passt, Betrag nicht (Teil-/Über-/Gebührenzahlung)
  | "order_not_open"      // Nummer gehört zu bezahlter/stornierter Bestellung
  | "amount_only"         // keine Nummer, aber Betrag passt zu offener Bestellung
  | "no_candidate";       // nichts gefunden

export type MatchResult =
  | { kind: "debit" }
  | { kind: "sure"; reason: "number_and_amount"; orders: OpenOrder[] }
  | { kind: "ignored"; reason: "payout_source"; detail: string }
  | {
      kind: "review";
      reason: Exclude<MatchReason, "number_and_amount" | "payout_source">;
      detail: string;
      candidates: Candidate[];
    };

// ── Hilfsfunktionen (exportiert für Tests) ──────────────────────────────────

export function toCents(n: number): number {
  return Math.round(n * 100);
}

/**
 * Alle 4–7-stelligen Zahlen, die nicht Teil einer längeren Ziffernfolge sind.
 * "#27405", "Best.Nr.27405", "HV27405", "27405Mueller" → 27405.
 * Lange Ziffernfolgen (IBAN, Referenzen) werden als Ganzes verworfen.
 */
export function extractOrderNumbers(text: string | null | undefined): string[] {
  if (!text) return [];
  const out = new Set<string>();
  const re = /(?<!\d)(\d{4,7})(?!\d)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) out.add(m[1].replace(/^0+/, "") || "0");
  return [...out];
}

const NAME_STOPWORDS = new Set([
  "herr", "frau", "und", "gmbh", "ug", "kg", "ohg", "mbh", "co", "the", "von", "van", "der", "den", "die",
  "dr", "prof", "familie", "fam",
]);

export function normalizeNameTokens(name: string | null | undefined): string[] {
  if (!name) return [];
  const s = name
    .toLowerCase()
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFD").replace(/[̀-ͯ]/g, "");
  return s
    .split(/[^a-z]+/)
    .filter((t) => t.length >= 3 && !NAME_STOPWORDS.has(t));
}

/** Teilen Kontoinhaber und Bestell-Kunde mindestens einen Namensbestandteil? */
export function namesMatch(counterparty: string | null | undefined, customerNames: string[]): boolean {
  const a = new Set(normalizeNameTokens(counterparty));
  if (a.size === 0) return false;
  return customerNames.some((n) => normalizeNameTokens(n).some((t) => a.has(t)));
}

/**
 * Eingänge, die sicher KEINE Vorkasse-Kundenzahlung sind: Auszahlungen von
 * Zahlungsdienstleistern/Plattformen, Behörden, Bank selbst. Geprüft wird nur
 * der Kontoinhaber (nicht der Verwendungszweck — ein Kunde darf "paypal"
 * schreiben, ohne dass seine Zahlung verschwindet).
 */
const PAYOUT_SOURCES = [
  "shopify", "paypal", "klarna", "stripe", "adyen", "mollie", "treatwell", "sumup",
  "amazon payments", "amazon eu", "unzer", "computop", "payone", "concardis", "nexi",
  "finanzamt", "bundeskasse", "landeshauptkasse", "bundesagentur",
];

export function payoutSource(counterparty: string | null | undefined): string | null {
  if (!counterparty) return null;
  const c = counterparty.toLowerCase();
  return PAYOUT_SOURCES.find((k) => c.includes(k)) ?? null;
}

function isBankDeposit(o: OpenOrder): boolean {
  return o.gateways.some((g) => /bank|deposit|vorkasse|ueberweisung|überweisung|manual/i.test(g));
}

function eur(n: number): string {
  return n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}

// ── Hauptfunktion ───────────────────────────────────────────────────────────

export function matchTransaction(
  tx: MatchTx,
  openOrders: OpenOrder[],
  closedByNumber: Record<string, ClosedOrderInfo> = {},
): MatchResult {
  const amountCents = toCents(tx.amount);
  if (amountCents <= 0) return { kind: "debit" };

  const byNumber = new Map<string, OpenOrder>();
  for (const o of openOrders) if (toCents(o.outstanding) > 0) byNumber.set(o.number, o);

  const numbers = extractOrderNumbers(`${tx.purpose ?? ""} ${tx.end_to_end_ref ?? ""}`);
  const hits = numbers.map((n) => byNumber.get(n)).filter((o): o is OpenOrder => !!o);
  const uniqueHits = [...new Map(hits.map((o) => [o.gid, o])).values()];

  const toCandidate = (o: OpenOrder, via: Candidate["via"]): Candidate => ({
    gid: o.gid,
    name: o.name,
    outstanding: o.outstanding,
    via,
    nameMatch: namesMatch(tx.counterparty_name, o.customerNames),
    isBankDeposit: isBankDeposit(o),
  });

  // 1) Sicher: Nummer(n) + exakter Betrag
  if (uniqueHits.length > 0) {
    const sum = uniqueHits.reduce((s, o) => s + toCents(o.outstanding), 0);
    if (sum === amountCents) {
      return { kind: "sure", reason: "number_and_amount", orders: uniqueHits };
    }
  }

  // 2) Auszahlungen von Plattformen/Behörden → ignorieren
  const payout = payoutSource(tx.counterparty_name);
  if (payout) {
    return { kind: "ignored", reason: "payout_source", detail: `Auszahlung/Absender: ${payout}` };
  }

  // 3) Nummer passt, Betrag nicht
  if (uniqueHits.length > 0) {
    const sum = uniqueHits.reduce((s, o) => s + o.outstanding, 0);
    const diff = tx.amount - sum;
    return {
      kind: "review",
      reason: "amount_mismatch",
      detail:
        `${uniqueHits.map((o) => o.name).join(" + ")}: offen ${eur(sum)}, eingegangen ${eur(tx.amount)} ` +
        `(${diff > 0 ? "+" : ""}${eur(diff)})`,
      candidates: uniqueHits.map((o) => toCandidate(o, "number")),
    };
  }

  // Betrags-Kandidaten: gleicher Betrag, Bestellung nicht nach dem Buchungstag angelegt
  const bookingLimit = new Date(`${tx.booking_date}T23:59:59Z`).getTime() + 86400000;
  const amountCands = openOrders
    .filter((o) => toCents(o.outstanding) === amountCents && new Date(o.createdAt).getTime() <= bookingLimit)
    .map((o) => toCandidate(o, "amount"))
    .sort((a, b) => Number(b.nameMatch) - Number(a.nameMatch) || Number(b.isBankDeposit) - Number(a.isBankDeposit));

  // 4) Nummer gehört zu bezahlter/stornierter Bestellung (Doppelzahlung?)
  const closed = numbers.map((n) => closedByNumber[n]).filter((c): c is ClosedOrderInfo => !!c);
  if (closed.length > 0) {
    const what = closed
      .map((c) =>
        c.state === "matched"
          ? `${c.name} wurde bereits einem anderen Eingang zugeordnet`
          : `${c.name} ist ${c.state === "paid" ? "bereits bezahlt" : c.state === "cancelled" ? "storniert" : `nicht offen (${c.detail})`}`,
      )
      .join(", ");
    return {
      kind: "review",
      reason: "order_not_open",
      detail: `${what} – mögliche Doppelzahlung, ggf. erstatten.`,
      candidates: amountCands,
    };
  }

  // 5) Nur Betrag passt
  if (amountCands.length > 0) {
    const named = amountCands.filter((c) => c.nameMatch).length;
    return {
      kind: "review",
      reason: "amount_only",
      detail:
        amountCands.length === 1
          ? `Keine Bestellnummer im Verwendungszweck, Betrag passt zu ${amountCands[0].name}` +
            (amountCands[0].nameMatch ? " (Name passt auch)." : ".")
          : `Keine Bestellnummer, Betrag passt zu ${amountCands.length} Bestellungen` +
            (named ? `, Name passt bei ${named}.` : "."),
      candidates: amountCands,
    };
  }

  return {
    kind: "review",
    reason: "no_candidate",
    detail: numbers.length
      ? `Zahlen im Verwendungszweck (${numbers.slice(0, 3).join(", ")}) passen zu keiner offenen Bestellung.`
      : "Keine Bestellnummer und keine offene Bestellung mit diesem Betrag.",
    candidates: [],
  };
}

/**
 * Welche Zahlen aus dem Verwendungszweck lohnen einen Shopify-Lookup als
 * mögliche (bezahlte/stornierte) Bestellnummer? Nur der plausible Bereich um
 * die aktuellen Bestellnummern — eine PLZ 28195 bei Bestellungen um 27.000
 * würde sonst jedes Mal eine Abfrage auslösen.
 */
export function plausibleClosedNumbers(
  tx: MatchTx,
  openOrders: OpenOrder[],
  maxLookups = 3,
): string[] {
  const nums = openOrders.map((o) => Number(o.number)).filter(Number.isFinite);
  if (nums.length === 0) return [];
  const max = Math.max(...nums);
  const open = new Set(openOrders.map((o) => o.number));
  return extractOrderNumbers(`${tx.purpose ?? ""} ${tx.end_to_end_ref ?? ""}`)
    .filter((n) => !open.has(n))
    .filter((n) => {
      const v = Number(n);
      return v >= max - 5000 && v <= max + 50;
    })
    .slice(0, maxLookups);
}
