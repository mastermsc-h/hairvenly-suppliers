/**
 * SMOKE-TEST: Kontoumsatz-Kategorien + Finanzamt-Erkennung (src/lib/bank/kategorien.ts)
 *
 * KERN-INVARIANTEN:
 *  - Finanzamt-Zwecke werden exakt in Steuerart + Zeitraum übersetzt; bei
 *    mehreren Anteilen ohne aufgehende Summe wird NICHT geraten.
 *  - Von Hand eingetragenes Ist im Steuer-Ledger wird von der Bank NIE überschrieben.
 *
 * Run:  node scripts/smoke/bank-kategorien.spec.mjs
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
const K = await load("src/lib/bank/kategorien.ts");

let pass = 0, fail = 0; const fails = [];
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++;
  else { fail++; fails.push(`[X] ${name}: erwartet ${e}, bekam ${a}`); }
}

// ── parseSteuerZweck: echte Verwendungszwecke der Sparkasse Bremen ──────────
check("LOHNST Monat",
  K.parseSteuerZweck("STEUERNR 060/212/27747 LOHNST JUL.26 4.049,86EUR", -4049.86),
  [{ art: "lst_anmeldung", zeitraum: "2026-07", jahr: 2026, betrag: 4049.86 }]);
check("UMS.ST Monat",
  K.parseSteuerZweck("STEUERNR 060/212/27747 UMS.ST JUL.26 14.091,52EUR", -14091.52),
  [{ art: "ust_va", zeitraum: "2026-07", jahr: 2026, betrag: 14091.52 }]);
check("EINK.ST Quartal",
  K.parseSteuerZweck("STEUERNR 060/212/27747 EINK.ST 3VJ.26 1.735,00EUR", -1735),
  [{ art: "est_vz", zeitraum: "Q3 2026", jahr: 2026, betrag: 1735 }]);
check("GEW.ST Quartal",
  K.parseSteuerZweck("STEUERNR 060/212/27747 GEW.ST 3VJ.26 1.025,00EUR", -1025),
  [{ art: "gewst_vz", zeitraum: "Q3 2026", jahr: 2026, betrag: 1025 }]);
check("Erstattung USt = negativ",
  K.parseSteuerZweck("ERSTATT.6021227747 UMS.ST JUN.26 18.114,12 EUR", 18114.12),
  [{ art: "ust_va", zeitraum: "2026-06", jahr: 2026, betrag: -18114.12 }]);
check("Erstattung mit Zuschlags-Kürzel",
  K.parseSteuerZweck("ERSTATT.6021227747 UMS.ST APR.26 VERSP.Z 310,00 EUR", 310),
  [{ art: "ust_va", zeitraum: "2026-04", jahr: 2026, betrag: -310 }]);
check("Jahressteuer → Nachzahlung",
  K.parseSteuerZweck("STEUERNR 060/212/27747 EINK.ST 2024 2.000,00EUR", -2000),
  [{ art: "est_nachzahlung", zeitraum: "2024", jahr: 2024, betrag: 2000 }]);
check("Dezember Vorjahr",
  K.parseSteuerZweck("STEUERNR 1 UMS.ST DEZ.25 99,00EUR", -99),
  [{ art: "ust_va", zeitraum: "2025-12", jahr: 2025, betrag: 99 }]);
check("Mehrere Anteile, Summe geht auf",
  K.parseSteuerZweck("STEUERNR 1 EINK.ST 3VJ.26 1.000,00EUR SOLZ 3VJ.26 55,00EUR UMS.ST AUG.26 500,00EUR", -1555),
  [{ art: "est_vz", zeitraum: "Q3 2026", jahr: 2026, betrag: 1055 },
   { art: "ust_va", zeitraum: "2026-08", jahr: 2026, betrag: 500 }]);
check("Mehrere Anteile, Summe geht NICHT auf → nicht raten",
  K.parseSteuerZweck("STEUERNR 1 EINK.ST 3VJ.26 1.000,00EUR UMS.ST AUG.26 500,00EUR", -1400), []);
check("Kein Steuer-Token", K.parseSteuerZweck("Rechnungsnr. 2026/1758", -475.41), []);
check("Leerer Zweck", K.parseSteuerZweck(null, -1), []);

// ── kategorisiere ───────────────────────────────────────────────────────────
const regeln = K.sortRegeln([
  { id: "r1", prioritaet: 10, feld: "purpose", muster: "DHL EXPRESS", richtung: "aus", kategorie: "st_eust" },
  { id: "r2", prioritaet: 50, feld: "counterparty_name", muster: "dhl", richtung: "alle", kategorie: "aus_versand" },
  { id: "r3", prioritaet: 30, feld: "counterparty_name", muster: "NEXI GERMANY", richtung: "ein", kategorie: "ein_karte" },
  { id: "r4", prioritaet: 30, feld: "counterparty_name", muster: "NEXI GERMANY", richtung: "aus", kategorie: "aus_bank" },
  { id: "r5", prioritaet: 5, feld: "counterparty_iban", muster: "0084626001", richtung: "alle", kategorie: "umbuchung" },
]);
const tx = (o) => ({ amount: -1, booking_date: "2026-09-15", counterparty_name: null, counterparty_iban: null, purpose: null, posting_text: null, match_status: "debit", ...o });

const fa = K.kategorisiere(tx({ amount: -4215.25, counterparty_name: "Finanzkasse in LHK Bremen", counterparty_iban: "DE59250000000025001532", purpose: "STEUERNR 060/212/27747 LOHNST AUG.26 4.215,25EUR" }), regeln);
check("Finanzamt Lohnsteuer → Kategorie", [fa.kategorie, fa.quelle, fa.steuer_split.length], ["st_lohnsteuer", "auto", 1]);
const faUnlesbar = K.kategorisiere(tx({ amount: -50, counterparty_name: "Finanzkasse in LHK Bremen", purpose: "SAEUMNISZUSCHLAG" }), regeln);
check("Finanzamt unlesbar → sonstige Steuern", faUnlesbar.kategorie, "st_sonstige");
const express = K.kategorisiere(tx({ amount: -1015.05, counterparty_name: "DHL GROUP - DEUTSCHE POST AG", purpose: "/OBO/DHL EXPRESS GERMANY GMBH/INV/ZIT7817554" }), regeln);
check("DHL Express → EUSt (vor DHL-Versand-Regel)", [express.kategorie, express.steuer_split], ["st_eust", [{ art: "eust", zeitraum: "2026-09", jahr: 2026, betrag: 1015.05 }]]);
check("DHL Paket → Versand", K.kategorisiere(tx({ amount: -1239.29, counterparty_name: "DHL GROUP - DHL AG", purpose: "/OBO/DHL PAKET GMBH/KD 6386863875" }), regeln).kategorie, "aus_versand");
check("Nexi Eingang → Kartenzahlungen", K.kategorisiere(tx({ amount: 3000, counterparty_name: "NEXI GERMANY GMBH" }), regeln).kategorie, "ein_karte");
check("Nexi Ausgang → Gebühren", K.kategorisiere(tx({ amount: -30, counterparty_name: "Nexi Germany GmbH" }), regeln).kategorie, "aus_bank");
check("Eigenes Konto per IBAN-Teilstring", K.kategorisiere(tx({ amount: -500, counterparty_iban: "DE56 2905 0101 0084 6260 01" }), regeln).kategorie, "umbuchung");
check("Vorkasse-Fallback", K.kategorisiere(tx({ amount: 449.9, counterparty_name: "Erika Muster", match_status: "shadow" }), regeln).kategorie, "ein_vorkasse");
check("Ausgang unbekannt → unklar", K.kategorisiere(tx({ amount: -99, counterparty_name: "Unbekannt GmbH" }), regeln).kategorie, "unklar");
check("Altlast-Kundenzahlung (ignored) → Vorkasse", K.kategorisiere(tx({ amount: 17.98, counterparty_name: "Kim Fischer", purpose: "Bestellung 25283", match_status: "ignored" }), regeln).kategorie, "ein_vorkasse");
check("Eingang Rückzahlung Gehalt → unklar", K.kategorisiere(tx({ amount: 219.01, counterparty_name: "Johanna Müller", purpose: "Zurückzahlung Gehalt,Extensions", match_status: "ignored" }), regeln).kategorie, "unklar");
check("Eingang Rueckueberweisung → unklar", K.kategorisiere(tx({ amount: 1421.82, purpose: "Rueckueberweisung falsche Rueckerstattung" }), regeln).kategorie, "unklar");

// ── summiereSteuern ─────────────────────────────────────────────────────────
const sum = K.summiereSteuern([
  { booking_date: "2026-07-27", steuer_split: [{ art: "ust_va", zeitraum: "2026-04", jahr: 2026, betrag: 310 }] },
  { booking_date: "2026-08-04", steuer_split: [{ art: "ust_va", zeitraum: "2026-04", jahr: 2026, betrag: -310 }] },
  { booking_date: "2026-08-13", steuer_split: [{ art: "lst_anmeldung", zeitraum: "2026-07", jahr: 2026, betrag: 4049.86 }] },
  { booking_date: "2026-08-01", steuer_split: null },
]);
check("Zahlung + Erstattung heben sich auf", sum.find((s) => s.zeitraum === "2026-04"), { art: "ust_va", zeitraum: "2026-04", jahr: 2026, netto: 0, anzahl: 2, letzte_buchung: "2026-08-04" });
check("Anzahl Summen", sum.length, 2);

// ── ledgerUpdate: Invariante "manuell wird nie überschrieben" ──────────────
const s = (netto) => ({ art: "ust_va", zeitraum: "2026-07", jahr: 2026, netto, anzahl: 1, letzte_buchung: "2026-09-16" });
check("Manuelles Ist bleibt", K.ledgerUpdate({ ist_betrag: 14000, soll_betrag: 0, richtung: "zahlung", ist_quelle: "manuell" }, s(14091.52)), {});
check("Leerer Posten wird befüllt", K.ledgerUpdate({ ist_betrag: 0, soll_betrag: 0, richtung: "zahlung", ist_quelle: "manuell" }, s(14091.52)),
  { ist_betrag: 14091.52, bezahlt_am: "2026-09-16", ist_quelle: "bank" });
check("Bank-Ist wird aktualisiert", K.ledgerUpdate({ ist_betrag: 100, soll_betrag: 0, richtung: "zahlung", ist_quelle: "bank" }, s(200)),
  { ist_betrag: 200, bezahlt_am: "2026-09-16", ist_quelle: "bank" });
check("Erstattung dreht Richtung bei Soll 0", K.ledgerUpdate({ ist_betrag: 0, soll_betrag: 0, richtung: "zahlung", ist_quelle: "manuell" }, s(-18114.12)),
  { ist_betrag: 18114.12, bezahlt_am: "2026-09-16", ist_quelle: "bank", richtung: "erstattung" });
check("Widerspruch zu Soll → nichts", K.ledgerUpdate({ ist_betrag: 0, soll_betrag: 500, richtung: "zahlung", ist_quelle: "manuell" }, s(-100)), {});
check("Netto 0, manuell leer → nichts", K.ledgerUpdate({ ist_betrag: 0, soll_betrag: 0, richtung: "zahlung", ist_quelle: "manuell" }, s(0)), {});
check("Netto 0, Bank-Ist → zurücksetzen", K.ledgerUpdate({ ist_betrag: 310, soll_betrag: 0, richtung: "zahlung", ist_quelle: "bank" }, s(0)),
  { ist_betrag: 0, bezahlt_am: null, ist_quelle: "bank" });

// ── Kategorien-Liste konsistent ─────────────────────────────────────────────
check("Kategorie-Keys eindeutig", new Set(K.KATEGORIEN.map((k) => k.key)).size, K.KATEGORIEN.length);
check("unklar existiert", !!K.KATEGORIE_BY_KEY.unklar, true);

console.log(`bank-kategorien: ${pass} ok, ${fail} Fehler`);
if (fail) { console.log(fails.join("\n")); process.exit(1); }
