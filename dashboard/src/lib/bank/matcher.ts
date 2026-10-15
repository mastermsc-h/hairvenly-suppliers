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
  counterparty_iban?: string | null;
  posting_text?: string | null;
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
  /** Wann wurde sie bezahlt (letzte erfolgreiche Zahlung, ISO)? null = unbekannt. */
  paidAt?: string | null;
}

export interface Candidate {
  gid: string;
  name: string;
  outstanding: number;
  via: "number" | "amount";
  nameMatch: boolean;
  isBankDeposit: boolean;
}

export type IgnoreReason =
  | "payout_source"       // Auszahlung eines Zahlungsdienstleisters / Behörde
  | "own_transfer"        // Übertrag zwischen eigenen Konten
  | "cash_deposit"        // Bareinzahlung (SB-Einzahlung)
  | "already_paid";       // Bestellung war schon (von Hand) bezahlt markiert

export type ReviewReason =
  | "amount_mismatch"     // Nummer passt, Betrag nicht (Teil-/Über-/Gebührenzahlung)
  | "order_not_open"      // Nummer gehört zu stornierter / vorher bezahlter Bestellung
  | "amount_only"         // keine passende Nummer, aber Betrag passt zu offener Bestellung
  | "no_candidate";       // nichts gefunden

export type MatchReason = "number_and_amount" | IgnoreReason | ReviewReason;

export type MatchResult =
  | { kind: "debit" }
  | { kind: "sure"; reason: "number_and_amount"; orders: OpenOrder[] }
  | { kind: "ignored"; reason: IgnoreReason; detail: string }
  | { kind: "review"; reason: ReviewReason; detail: string; candidates: Candidate[] };

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
  // Bestellnummern beginnen nie mit 0 — "Z0367DJ87" ist eine Referenz, keine #367.
  while ((m = re.exec(text)) !== null) if (!m[1].startsWith("0")) out.add(m[1]);
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
  "deutsche post", "dhl ag", "dhl paket", // Versand-Gutschriften (Zweck enthält Rechnungsnummern)
];

export function payoutSource(counterparty: string | null | undefined): string | null {
  if (!counterparty) return null;
  const c = counterparty.toLowerCase();
  return PAYOUT_SOURCES.find((k) => c.includes(k)) ?? null;
}

/** Bareinzahlung am Automaten/Schalter — Geld aus dem Salon, keine Bestellzahlung. */
const CASH_DEPOSIT = /\b(SB-?EINZAHLUNG|BAREINZAHLUNG|BARGELDEINZAHLUNG|EINZAHLUNG\s+(AM\s+)?AUTOMAT|CASH\s+DEPOSIT)\b/i;

export function ownMovement(
  tx: Pick<MatchTx, "counterparty_iban" | "posting_text" | "purpose">,
  ownIbans: string[] = [],
): "own_transfer" | "cash_deposit" | null {
  const iban = (tx.counterparty_iban ?? "").replace(/\s+/g, "").toUpperCase();
  if (iban && ownIbans.some((o) => o.replace(/\s+/g, "").toUpperCase() === iban)) return "own_transfer";
  if (CASH_DEPOSIT.test(`${tx.posting_text ?? ""} ${tx.purpose ?? ""}`)) return "cash_deposit";
  return null;
}

function deDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
}

/** YYYY-MM-DD minus n Tage. */
function minusDays(iso: string, n: number): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
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
  ownIbans: string[] = [],
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

  // 2) Eigene Bewegungen: Übertrag zwischen eigenen Konten, Bareinzahlung
  const own = ownMovement(tx, ownIbans);
  if (own === "own_transfer") return { kind: "ignored", reason: own, detail: "Übertrag zwischen eigenen Konten" };
  if (own === "cash_deposit") return { kind: "ignored", reason: own, detail: "Bareinzahlung" };

  // 3) Auszahlungen von Plattformen/Behörden
  const payout = payoutSource(tx.counterparty_name);
  if (payout) {
    return { kind: "ignored", reason: "payout_source", detail: `Auszahlung/Absender: ${payout}` };
  }

  // 4) Nummer passt, Betrag nicht
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

  // 5) Nummer gehört zu einer NICHT offenen Bestellung. Der Verwendungszweck
  //    nennt dann eine konkrete Bestellung → nie eine fremde per Betrag vorschlagen.
  const closed = [...new Map(
    numbers.map((n) => closedByNumber[n]).filter((c): c is ClosedOrderInfo => !!c).map((c) => [c.name, c]),
  ).values()];
  if (closed.length > 0) {
    const cancelled = closed.filter((c) => c.state === "cancelled");
    const matched = closed.filter((c) => c.state === "matched");
    const paid = closed.filter((c) => c.state === "paid");
    // Bezahlt-Markierung am/nach dem Tag vor der Buchung → das war genau diese
    // Zahlung (von Hand erledigt). Davor → Geld kam ein zweites Mal.
    const handledFrom = minusDays(tx.booking_date, 1);
    const handled = paid.filter((c) => c.paidAt && c.paidAt.slice(0, 10) >= handledFrom);
    const paidBefore = paid.filter((c) => c.paidAt && c.paidAt.slice(0, 10) < handledFrom);
    const paidUnknown = paid.filter((c) => !c.paidAt);
    const other = closed.filter((c) => c.state === "other");

    if (handled.length === closed.length) {
      return {
        kind: "ignored",
        reason: "already_paid",
        detail:
          `${handled.map((c) => c.name).join(", ")} war bereits als bezahlt markiert` +
          ` (${handled.map((c) => deDate(c.paidAt!)).join(", ")}) – vermutlich schon von Hand erledigt` +
          (handled.some((c) => /REFUNDED/.test(c.detail)) ? ", später erstattet." : "."),
      };
    }
    const parts = [
      ...cancelled.map((c) => `${c.name} ist storniert – ggf. erstatten`),
      ...matched.map((c) => `${c.name} wurde bereits einem anderen Eingang zugeordnet – mögliche Doppelzahlung`),
      ...paidBefore.map((c) => `${c.name} war schon am ${deDate(c.paidAt!)} bezahlt – mögliche Doppelzahlung, ggf. erstatten`),
      ...paidUnknown.map((c) => `${c.name} ist bereits bezahlt – bitte prüfen`),
      ...other.map((c) => `${c.name} ist nicht offen (${c.detail})`),
    ];
    return { kind: "review", reason: "order_not_open", detail: parts.join(". ") + ".", candidates: [] };
  }

  // Betrags-Kandidaten: gleicher Betrag, Bestellung nicht nach dem Buchungstag angelegt
  const bookingLimit = new Date(`${tx.booking_date}T23:59:59Z`).getTime() + 86400000;
  const amountCands = openOrders
    .filter((o) => toCents(o.outstanding) === amountCents && new Date(o.createdAt).getTime() <= bookingLimit)
    .map((o) => toCandidate(o, "amount"))
    .sort((a, b) => Number(b.nameMatch) - Number(a.nameMatch) || Number(b.isBankDeposit) - Number(a.isBankDeposit));

  const numberNote = numbers.length
    ? `Zahl(en) im Verwendungszweck (${numbers.slice(0, 3).join(", ")}) gehören zu keiner Bestellung`
    : "Keine Bestellnummer im Verwendungszweck";

  // 6) Nur Betrag passt
  if (amountCands.length > 0) {
    const named = amountCands.filter((c) => c.nameMatch).length;
    return {
      kind: "review",
      reason: "amount_only",
      detail:
        amountCands.length === 1
          ? `${numberNote}, Betrag passt zu ${amountCands[0].name}` + (amountCands[0].nameMatch ? " (Name passt auch)." : ".")
          : `${numberNote}, Betrag passt zu ${amountCands.length} Bestellungen` + (named ? `, Name passt bei ${named}.` : "."),
      candidates: amountCands,
    };
  }

  return {
    kind: "review",
    reason: "no_candidate",
    detail: `${numberNote}, keine offene Bestellung mit diesem Betrag.`,
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
  maxLookups = 5,
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
