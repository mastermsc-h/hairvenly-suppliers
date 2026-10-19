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

// Echte Formate aus der Historie (Backfill 19.10.2026)
check("MAI ohne Punkt",
  K.parseSteuerZweck("STEUERNR 060/212/27747     LOHNST  MAI 26  3.470,37EUR", -3470.37),
  [{ art: "lst_anmeldung", zeitraum: "2026-05", jahr: 2026, betrag: 3470.37 }]);
check("UMS.ST MAI ohne Punkt",
  K.parseSteuerZweck("STEUERNR 060/212/27747     UMS.ST  MAI 26  31.590,61EUR", -31590.61),
  [{ art: "ust_va", zeitraum: "2026-05", jahr: 2026, betrag: 31590.61 }]);
check("Quartal 2025",
  K.parseSteuerZweck("STEUERNR 060/212/27747     UMS.ST  3VJ.25  6.483,36EUR", -6483.36),
  [{ art: "ust_va", zeitraum: "Q3 2025", jahr: 2025, betrag: 6483.36 }]);
check("Sammelabbuchung drei Steuern",
  K.parseSteuerZweck("STEUERNR 060/212/27747 LOHNST APR.26 3.156,86EUR GEW.ST 2VJ.26 1.025,00EUR UMS.ST MRZ.26 32.121,85EUR", -36303.71).map((x) => [x.art, x.zeitraum, x.betrag]),
  [["lst_anmeldung", "2026-04", 3156.86], ["gewst_vz", "Q2 2026", 1025], ["ust_va", "2026-03", 32121.85]]);

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
const rLohn = K.sortRegeln([{ id: "l", prioritaet: 40, feld: "purpose", muster: "lohn", richtung: "aus", kategorie: "aus_personal" }]);
check("Finanzamt nie über allgemeine Regeln", K.kategorisiere(tx({ amount: -99, counterparty_name: "Finanzkasse in LHK Bremen", purpose: "STEUERNR 1 LOHNST XYZ" }), rLohn).kategorie, "st_sonstige");
check("Sammelabbuchung → Kategorie des größten Anteils",
  K.kategorisiere(tx({ amount: -36303.71, counterparty_name: "Finanzkasse in LHK Bremen", purpose: "STEUERNR 060/212/27747 LOHNST APR.26 3.156,86EUR GEW.ST 2VJ.26 1.025,00EUR UMS.ST MRZ.26 32.121,85EUR" }), regeln).kategorie, "st_ust");
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

// ── gleicheSplits: jsonb sortiert Schlüssel um (art,jahr,betrag,zeitraum) ──
check("Gleich trotz anderer Schlüsselreihenfolge",
  K.gleicheSplits([{ art: "ust_va", jahr: 2026, betrag: 14091.52, zeitraum: "2026-07" }], [{ art: "ust_va", zeitraum: "2026-07", jahr: 2026, betrag: 14091.52 }]), true);
check("Ungleich bei anderem Betrag",
  K.gleicheSplits([{ art: "ust_va", zeitraum: "2026-07", jahr: 2026, betrag: 1 }], [{ art: "ust_va", zeitraum: "2026-07", jahr: 2026, betrag: 2 }]), false);
check("null = leer", K.gleicheSplits(null, []), true);

// ── faelligkeit (Dauerfristverlängerung für USt) ───────────────────────────
check("USt Juli mit DFV → 10.09.", K.faelligkeit("ust_va", "2026-07"), "2026-09-10");
check("USt August mit DFV → 10.10. ist Samstag → 12.10.", K.faelligkeit("ust_va", "2026-08"), "2026-10-12");
check("USt November mit DFV → Januar Folgejahr", K.faelligkeit("ust_va", "2026-11"), "2027-01-11");
check("LSt ohne DFV → 10. Folgemonat", K.faelligkeit("lst_anmeldung", "2026-07"), "2026-08-10");
check("LSt Dezember → Januar", K.faelligkeit("lst_anmeldung", "2026-12"), "2027-01-11");
check("ESt Q3 → 10.09.", K.faelligkeit("est_vz", "Q3 2026"), "2026-09-10");
check("GewSt Q3 → 15.08. ist Samstag → 17.08.", K.faelligkeit("gewst_vz", "Q3 2026"), "2026-08-17");
check("Nachzahlung → unbekannt", K.faelligkeit("est_nachzahlung", "2024"), null);

// ── Targobank: Name + IBAN nur im Verwendungszweck ─────────────────────────
const tz = "ECHTZEITÜBERWEISUNG INLAND  TBOL MEHMET CAKMAK AUGUST GEHALT   IBAN DE93290501010015124738 BIC SBREDE22XXX AM 02.09.2026";
check("IBAN aus Zweck", K.ibanAusZweck(tz), "DE93290501010015124738");
check("IBAN mit Doppelpunkt", K.ibanAusZweck("DAUERAUFTRAG IBAN:DE38290501010000123456 BIC"), "DE38290501010000123456");
check("Feld-IBAN hat Vorrang", K.effektiveIban({ counterparty_iban: "DE11", purpose: tz }), "DE11");
check("Übertrag von Sparkasse auf Targobank = Umbuchung (IBAN im Zweck)",
  K.kategorisiere(tx({ amount: 7500, purpose: "LOHN / GEHALT / RENTE IBRAHIM CAN IBAN DE56290501010084626001 BIC SBREDE22XXX" }), regeln).kategorie, "umbuchung");
const rAok = K.sortRegeln([{ id: "a", prioritaet: 20, feld: "counterparty_name", muster: "AOK", richtung: "aus", kategorie: "aus_sozialversicherung" }]);
check("Name-Regel greift im Zweck, wenn Name fehlt",
  K.kategorisiere(tx({ amount: -2464.46, purpose: "ECHTZEITÜBERWEISUNG INLAND TBOL AOK BREMEN/BREMERHAVEN D028779660 IBAN DE12" }), rAok).kategorie, "aus_sozialversicherung");
check("Name vorhanden → Zweck wird NICHT für Name-Regeln genutzt",
  K.kategorisiere(tx({ amount: -10, counterparty_name: "Max Muster", purpose: "Erstattung AOK-Beitrag" }), rAok).kategorie, "unklar");

// ── Kategorien-Liste konsistent ─────────────────────────────────────────────
check("Kategorie-Keys eindeutig", new Set(K.KATEGORIEN.map((k) => k.key)).size, K.KATEGORIEN.length);
check("unklar existiert", !!K.KATEGORIE_BY_KEY.unklar, true);

console.log(`bank-kategorien: ${pass} ok, ${fail} Fehler`);
if (fail) { console.log(fails.join("\n")); process.exit(1); }
