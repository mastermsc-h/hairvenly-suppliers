/**
 * SMOKE-TEST: Zahlungsabgleich (src/lib/bank/matcher.ts + rows.ts)
 *
 * KERN-INVARIANTE: "sicher" (= darf automatisch als bezahlt markiert werden)
 * NUR wenn Bestellnummer im Verwendungszweck zu einer OFFENEN Bestellung
 * gehört UND der Betrag auf den Cent stimmt. Jeder andere Fall → Mensch.
 * Ein falsches "sicher" würde eine unbezahlte Bestellung versenden lassen.
 *
 * Run:  node scripts/smoke/bank-matcher.spec.mjs
 */
import { readFileSync } from "fs";
import path from "path";
import ts from "typescript";

async function load(rel) {
  const js = ts.transpileModule(readFileSync(path.resolve(process.cwd(), rel), "utf8"), {
    compilerOptions: { module: "ESNext", target: "ES2022" },
  }).outputText;
  return import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
}
const M = await load("src/lib/bank/matcher.ts");
const R = await load("src/lib/bank/rows.ts");

let pass = 0, fail = 0; const fails = [];
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++;
  else { fail++; fails.push(`[X] ${name}: erwartet ${e}, bekam ${a}`); }
}

const order = (number, outstanding, name = "Anna Müller", created = "2026-10-01T10:00:00Z", gateways = ["Bank Deposit"]) => ({
  gid: `gid://shopify/Order/${number}00`, name: `#${number}`, number: String(number),
  createdAt: created, outstanding, customerNames: [name], gateways,
});
const tx = (amount, purpose, name = "MUELLER, ANNA", date = "2026-10-12") =>
  ({ amount, purpose, counterparty_name: name, booking_date: date, end_to_end_ref: null });

const open = [
  order(27405, 158.97, "Anna Müller"),
  order(27406, 69.89, "Jörg Schäfer"),
  order(27407, 69.89, "Lisa Kaya"),
  order(27408, 447.92, "Sven Öztürk"),
  order(27409, 29.69, "Maria Rossi"),
];
const kind = (r) => r.kind;
const reason = (r) => r.reason ?? null;

// ── SICHER ─────────────────────────────────────────────────────────────────
check("Nr + Betrag exakt → sure", kind(M.matchTransaction(tx(158.97, "Bestellung 27405"), open)), "sure");
check("#-Präfix", kind(M.matchTransaction(tx(158.97, "#27405"), open)), "sure");
check("Nr direkt an Text geklebt (SEPA-Zeilen)", kind(M.matchTransaction(tx(158.97, "Best.Nr.27405Anna Mueller"), open)), "sure");
check("Sammelzahlung 2 Bestellungen, Summe exakt", kind(M.matchTransaction(tx(228.86, "27405 und 27406"), open)), "sure");
check("Sammelzahlung → beide Orders", M.matchTransaction(tx(228.86, "27405 27406"), open).orders?.map((o) => o.name), ["#27405", "#27406"]);
check("Nr doppelt im Zweck zählt einmal", kind(M.matchTransaction(tx(158.97, "27405 / 27405"), open)), "sure");
check("Nr in End-to-End-Referenz", kind(M.matchTransaction({ ...tx(158.97, "Danke"), end_to_end_ref: "HV-27405" }, open)), "sure");
check("Sicher schlägt Payout-Filter (Nr+Betrag)", kind(M.matchTransaction(tx(29.69, "27409", "Klarna Bank AB"), open)), "sure");

// ── NIEMALS SICHER ─────────────────────────────────────────────────────────
check("Nr passt, 1 Cent zu wenig → review", reason(M.matchTransaction(tx(158.96, "27405"), open)), "amount_mismatch");
check("Nr passt, Überzahlung → review", reason(M.matchTransaction(tx(160, "27405"), open)), "amount_mismatch");
check("Nr passt, Auslands-Gebühr abgezogen → review", kind(M.matchTransaction(tx(153.97, "Order 27405"), open)), "review");
check("Nur Betrag, keine Nr → review amount_only", reason(M.matchTransaction(tx(447.92, "Haarverlängerung"), open)), "amount_only");
check("Betrag mehrdeutig (2×69,89) → review", M.matchTransaction(tx(69.89, "Danke"), open).candidates?.length, 2);
check("Mehrdeutig: Name sortiert nach vorn", M.matchTransaction(tx(69.89, "Danke", "Kaya, Lisa"), open).candidates?.[0]?.name, "#27407");
check("PLZ 28195 ist keine offene Bestellung → nicht sicher", kind(M.matchTransaction(tx(158.97, "Musterstr 1 28195 Bremen"), open)), "review");
check("Nr einer anderen Bestellung + Betrag einer dritten → nicht sicher", kind(M.matchTransaction(tx(447.92, "27405"), open)), "review");
check("Lange Ziffernfolge (IBAN) liefert keine Nr", M.extractOrderNumbers("DE89370400440532013000"), []);
check("Datum 12.10.2026 → nur 2026 (keine offene Bestellung)", kind(M.matchTransaction(tx(158.97, "12.10.2026"), open)), "review");

// ── Doppelzahlung / nicht offen ────────────────────────────────────────────
const closed = { "27390": { name: "#27390", state: "paid", detail: "PAID" } };
check("Nr gehört zu bezahlter Bestellung → order_not_open",
  reason(M.matchTransaction(tx(99, "Bestellung 27390"), open, closed)), "order_not_open");
check("Bereits anderem Eingang zugeordnet → order_not_open",
  reason(M.matchTransaction(tx(158.97, "27405"), open.filter((o) => o.number !== "27405"),
    { "27405": { name: "#27405", state: "matched", detail: "" } })), "order_not_open");

// ── Bezahl-Zeitpunkt: von Hand erledigt vs. Doppelzahlung (echte Daten 15.10.) ──
const paidAfter = { "26206": { name: "#26206", state: "paid", detail: "PAID", paidAt: "2026-08-26T10:00:00Z" } };
check("Bezahlt markiert am Tag NACH Eingang → von Hand erledigt (ignored)",
  M.matchTransaction(tx(122.97, "26206", "Gaye Norman", "2026-08-25"), open, paidAfter).reason, "already_paid");
check("Bezahlt markiert am Eingangstag → erledigt",
  M.matchTransaction(tx(122.97, "26206", "X", "2026-08-26"), open, paidAfter).reason, "already_paid");
check("Bezahlt markiert 1 Tag VOR Buchung (Toleranz) → erledigt",
  M.matchTransaction(tx(122.97, "26206", "X", "2026-08-27"), open, paidAfter).reason, "already_paid");
check("Bezahlt 2+ Tage VOR Eingang → mögliche Doppelzahlung (review)",
  M.matchTransaction(tx(122.97, "26206", "X", "2026-09-10"), open, paidAfter).reason, "order_not_open");
check("Doppelzahlung-Text nennt Datum",
  /26\.08\.2026/.test(M.matchTransaction(tx(122.97, "26206", "X", "2026-09-10"), open, paidAfter).detail), true);
check("Storniert → review",
  M.matchTransaction(tx(50, "26100", "X"), open, { "26100": { name: "#26100", state: "cancelled", detail: "", paidAt: null } }).reason, "order_not_open");
// Bug 15.10.: Zweck nennt bezahlte #26976, Betrag zufällig gleich offener #27409 → NIE fremde Bestellung vorschlagen
const paid26976 = { "26976": { name: "#26976", state: "paid", detail: "PAID", paidAt: "2026-09-16T08:00:00Z" } };
check("Nummer einer bezahlten Bestellung → kein Betrags-Vorschlag einer fremden",
  M.matchTransaction(tx(29.69, "26976", "Felicitas K", "2026-09-15"), open, paid26976).kind, "ignored");
check("…und nicht als amount_only",
  M.matchTransaction(tx(29.69, "26976", "Felicitas K", "2026-09-15"), open, paid26976).reason !== "amount_only", true);
check("Zahl ohne Bestellung + Betrag passt → amount_only mit korrektem Text",
  /gehören zu keiner Bestellung/.test(M.matchTransaction(tx(447.92, "Rechnung 1234", "X"), open).detail ?? ""), true);

check("Führende Null ist keine Bestellnummer", M.extractOrderNumbers("Z0367DJ87 02740"), []);
check("Erstattete Bestellung, bezahlt nach Eingang → erledigt + Hinweis",
  /später erstattet/.test(M.matchTransaction(tx(152.99, "26620", "Anja S", "2026-09-02"), open,
    { "26620": { name: "#26620", state: "paid", detail: "REFUNDED", paidAt: "2026-09-03T09:00:00Z" } }).detail ?? ""), true);
check("DHL-Gutschrift mit Zahl → ignored", M.matchTransaction(tx(275.6, "/OBO/Deutsche Post AG/INV/2609 24831", "DHL AG"), open).kind, "ignored");

// ── Eigene Bewegungen ──────────────────────────────────────────────────────
const own = ["DE56290501010084626001", "DE55290501010084626019"];
check("Übertrag von eigenem Konto → own_transfer",
  M.matchTransaction({ ...tx(500, "Umbuchung"), counterparty_iban: "DE55 2905 0101 0084 6260 19" }, open, {}, own).reason, "own_transfer");
check("SB-Einzahlung → cash_deposit",
  M.matchTransaction({ ...tx(300, "SB-EINZAHLUNG SPKHB-F054GA 2120 / 19.09.26", null) }, open, {}, own).reason, "cash_deposit");
check("Kunde schreibt 'Anzahlung' → NICHT Bareinzahlung",
  M.matchTransaction(tx(447.92, "Anzahlung Haare"), open, {}, own).reason, "amount_only");
check("Sicherer Treffer schlägt eigenes Konto (Nr+Betrag)",
  M.matchTransaction({ ...tx(158.97, "27405"), counterparty_iban: own[0] }, open, {}, own).kind, "sure");

// ── Ignorieren / Ausgänge ──────────────────────────────────────────────────
check("Ausgang → debit", kind(M.matchTransaction(tx(-50, "Miete"), open)), "debit");
check("0 € → debit", kind(M.matchTransaction(tx(0, ""), open)), "debit");
check("Shopify-Auszahlung → ignored", kind(M.matchTransaction(tx(1234.5, "Payout", "Shopify International Ltd"), open)), "ignored");
check("PayPal-Auszahlung → ignored", kind(M.matchTransaction(tx(80, "PP.1234", "PayPal Europe S.a.r.l."), open)), "ignored");
check("Kunde schreibt 'paypal' im Zweck → NICHT ignoriert",
  kind(M.matchTransaction(tx(158.97, "statt paypal 27405"), open)), "sure");
check("Nichts passt → no_candidate", reason(M.matchTransaction(tx(12.34, "Gutschrift"), open)), "no_candidate");

// ── Bestellung nach Buchungstag angelegt → kein Betrags-Kandidat ───────────
const later = [order(27500, 50, "X Y", "2026-10-20T10:00:00Z")];
check("Betrags-Kandidat nur wenn Bestellung vorher existierte", reason(M.matchTransaction(tx(50, "", "X Y", "2026-10-12"), later)), "no_candidate");

// ── Namensabgleich ─────────────────────────────────────────────────────────
check("Umlaut-Normalisierung", M.namesMatch("SCHAEFER JOERG", ["Jörg Schäfer"]), true);
check("Nachname, Vorname", M.namesMatch("Müller, Anna", ["Anna Mueller"]), true);
check("Stoppwörter zählen nicht", M.namesMatch("Herr Frau", ["Frau Herr"]), false);

// ── Plausible Nummern für Shopify-Lookup ───────────────────────────────────
check("PLZ außerhalb Bereich → kein Lookup", M.plausibleClosedNumbers(tx(1, "28195 Bremen"), open), []);
check("Alte Nr im Bereich → Lookup", M.plausibleClosedNumbers(tx(1, "27390"), open), ["27390"]);
check("Offene Nr → kein Lookup", M.plausibleClosedNumbers(tx(1, "27405"), open), []);

// ── Dedupe ─────────────────────────────────────────────────────────────────
const row = (amount, purpose, date = "2026-10-12") => ({
  booking_date: date, value_date: null, amount, currency: "EUR", counterparty_name: "A", counterparty_iban: null,
  purpose, posting_text: null, end_to_end_ref: null, account_iban: null,
});
const k1 = R.dedupeKeys([row(10, "Best 27405")]);
const k2 = R.dedupeKeys([row(10, "BEST-27405")]);
check("Dedupe ignoriert Schreibweise/Sonderzeichen", k1[0] === k2[0], true);
const kk = R.dedupeKeys([row(10, "X"), row(10, "X")]);
check("Zwei identische Umsätze am selben Tag bleiben zwei", kk[0] !== kk[1], true);
check("Dedupe unabhängig von IBAN-Feldern",
  R.dedupeKeys([{ ...row(10, "X"), account_iban: "DE1", counterparty_iban: "DE2" }])[0] === R.dedupeKeys([row(10, "X")])[0], true);

// ── Werte-Parser ───────────────────────────────────────────────────────────
check("Betrag 1.234,56", R.parseAmount("1.234,56"), 1234.56);
check("Betrag -49,90", R.parseAmount("-49,90"), -49.9);
check("Betrag 1,234.56", R.parseAmount("1,234.56"), 1234.56);
check("Betrag 12,50 €", R.parseAmount("12,50 €"), 12.5);
check("Betrag Müll → null", R.parseAmount("abc"), null);
check("Datum 13.10.26", R.parseGermanDate("13.10.26"), "2026-10-13");
check("Datum 2026-10-13", R.parseGermanDate("2026-10-13"), "2026-10-13");
check("sanitize verwirft kaputtes Datum", R.sanitizeRow({ booking_date: "13.10.2026", amount: 1 }), null);
check("sanitize verwirft NaN-Betrag", R.sanitizeRow({ booking_date: "2026-10-13", amount: "x" }), null);

// ── CSV: Sparkasse CSV-CAMT ────────────────────────────────────────────────
const spk = [
  '"Auftragskonto";"Buchungstag";"Valutadatum";"Buchungstext";"Verwendungszweck";"Glaeubiger ID";"Mandatsreferenz";"Kundenreferenz (End-to-End)";"Sammlerreferenz";"Lastschrift Ursprungsbetrag";"Auslagenersatz Ruecklastschrift";"Beguenstigter/Zahlungspflichtiger";"Kontonummer/IBAN";"BIC (SWIFT-Code)";"Betrag";"Waehrung";"Info"',
  '"DE11290501010000000000";"12.10.26";"12.10.26";"GUTSCHR. UEBERWEISUNG";"Bestellung 27405";"";"";"NOTPROVIDED";"";"";"";"Anna Mueller";"DE02100100100006820101";"PBNKDEFFXXX";"158,97";"EUR";"Umsatz gebucht"',
  '"DE11290501010000000000";"11.10.26";"11.10.26";"FOLGELASTSCHRIFT";"Miete; Oktober";"";"";"";"";"";"";"Vermieter GmbH";"DE02100100100006820102";"";"-1.200,00";"EUR";"Umsatz gebucht"',
].join("\r\n");
const ps = R.parseBankCsv(spk);
check("Sparkasse: 2 Zeilen", ps.rows.length, 2);
check("Sparkasse: Datum", ps.rows[0]?.booking_date, "2026-10-12");
check("Sparkasse: Betrag", ps.rows[0]?.amount, 158.97);
check("Sparkasse: Name", ps.rows[0]?.counterparty_name, "Anna Mueller");
check("Sparkasse: Ausgang negativ", ps.rows[1]?.amount, -1200);
check("Sparkasse: Semikolon in Quotes", ps.rows[1]?.purpose, "Miete; Oktober");
check("Sparkasse: Ursprungsbetrag nicht als Betrag", ps.mapping.amount, "Betrag");
check("Sparkasse: E2E", ps.rows[0]?.end_to_end_ref, "NOTPROVIDED");

// ── CSV: Lexware-artig mit Vorspann + Komma ────────────────────────────────
const lex = [
  "Kontoumsätze Sparkasse Bremen",
  "",
  "Buchungsdatum,Wertstellung,Auftraggeber/Empfänger,Verwendungszweck,Betrag (EUR)",
  '13.10.2026,13.10.2026,"Schäfer, Jörg","27406 Danke","69,89"',
].join("\n");
const pl = R.parseBankCsv(lex);
check("Lexware: Vorspann übersprungen", pl.rows.length, 1);
check("Lexware: Name mit Komma", pl.rows[0]?.counterparty_name, "Schäfer, Jörg");
check("Lexware: Betrag", pl.rows[0]?.amount, 69.89);

// ── CSV: Soll/Haben getrennt ───────────────────────────────────────────────
const sh = "Datum;Name;Verwendungszweck;Soll;Haben\n01.10.2026;A;x;;100,00\n02.10.2026;B;y;20,00;\n";
const psh = R.parseBankCsv(sh);
check("Soll/Haben: Haben positiv", psh.rows[0]?.amount, 100);
check("Soll/Haben: Soll negativ", psh.rows[1]?.amount, -20);
check("CSV ohne Kopf → Fehler", !!R.parseBankCsv("a;b\n1;2").error, true);

if (fail) {
  console.error(fails.join("\n"));
  console.error(`FAIL: ${fail} von ${pass + fail}`);
  process.exit(1);
}
console.log(`PASS: ${pass}/${pass + fail} Zahlungsabgleich-Checks grün`);
