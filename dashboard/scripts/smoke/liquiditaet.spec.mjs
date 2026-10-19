/**
 * SMOKE-TEST: Liquiditätsvorschau (src/lib/liquiditaet/rechnung.ts)
 *
 * KERN-INVARIANTEN:
 *  - Kontostand nur aus "Information zur Abrechnung Kontostand am …" (nicht aus dem
 *    "Rechnungsabschluss", der die Entgelte des Folgetags schon enthält).
 *  - Zahlungen laufen in Datumsreihenfolge; die Ampel einer Bestellung berücksichtigt
 *    alle vorher fälligen Zahlungen.
 *  - EUSt einer Ankunft verringert die USt-VA desselben Monats (Vorsteuer).
 *
 * Run:  node scripts/smoke/liquiditaet.spec.mjs
 */
import { readFileSync } from "fs";
import path from "path";
import ts from "typescript";

function transpile(rel) {
  return ts.transpileModule(readFileSync(path.resolve(process.cwd(), rel), "utf8"), {
    compilerOptions: { module: "ESNext", target: "ES2022" },
  }).outputText;
}
const toUrl = (js) => "data:text/javascript;base64," + Buffer.from(js).toString("base64");
const kategorienUrl = toUrl(transpile("src/lib/bank/kategorien.ts"));
const L = await import(toUrl(transpile("src/lib/liquiditaet/rechnung.ts").replace('"@/lib/bank/kategorien"', JSON.stringify(kategorienUrl))));

let pass = 0, fail = 0; const fails = [];
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++;
  else { fail++; fails.push(`[X] ${name}: erwartet ${e}, bekam ${a}`); }
}

// ── Kontoauszug-Texte (echte Sparkassen-Zwecke) ─────────────────────────────
check("Kontostand Abschluss (zusammengeklebt)",
  L.parseKontostand("Abrechnung 30.09.2026Information zur AbrechnungKontostand am 30.09.202698.449,21 + --------------Abrechnungszeitraum"),
  { am: "2026-09-30", betrag: 98449.21 });
check("Kontostand kleines Konto",
  L.parseKontostand("Abrechnung 30.09.2026Information zur AbrechnungKontostand am 30.09.20262.797,12 +--------------"),
  { am: "2026-09-30", betrag: 2797.12 });
check("Kontostand negativ",
  L.parseKontostand("Information zur AbrechnungKontostand am 31.10.20261.234,56 -"),
  { am: "2026-10-31", betrag: -1234.56 });
check("Rechnungsabschluss wird NICHT genommen",
  L.parseKontostand("Kontostand/Rechnungsabschluss am 30.09.2026 98.400,46+Rechnungsnummer"), null);
check("FX-Kurs", L.parseFxKurs("FXP/260909735471BIC DHBKHKHHXXXUSD30000,00 1,15950INVOICE NO AMANDAGRM"), 1.1595);
check("FX-Kurs kleiner Betrag", L.parseFxKurs("FXP/261008746325BIC DHBKHKHHXXXUSD1290,00 1,11290INVOICE"), 1.1129);
check("FX-Kurs fehlt", L.parseFxKurs("Rechnungsnr. 2026/1758"), null);

// ── Prognose ────────────────────────────────────────────────────────────────
const roh = (o = {}) => ({
  heute: "2026-10-18",
  startSaldo: 100000,
  saldoStand: "2026-10-16",
  konten: [],
  basis: { monate: ["2026-09"], tage: 30, einnahmen: 30000, laufend: [{ kategorie: "aus_x", summe: -15000 }], andereLieferanten: -6000, monatsWerte: [] },
  fxAuto: { kurs: 1.25, datum: "2026-10-09" },
  bestellungen: [],
  steuern: { ustHistorie: [], ustErledigtBis: null, eustBezahlt: {}, lstLetzte: [], lstErledigtBis: null, estLetzte: null, gewstLetzte: null, quartaleErledigt: [] },
  nachbestellung: { kgProMonatAuto: 0, usdProKgAuto: 0, leadWochen: 6 },
  ...o,
});
const best = (o) => ({ id: "x", label: "B", status: "in_production", eta: "2026-11-10", invoiceUsd: 50000, restUsd: 50000, importVatEur: null, kg: 40, ...o });
const E0 = { zollSatz: 0, eustSatz: 19, horizontTage: 60, puffer: 20000 };

let p = L.prognose(roh(), E0);
check("Start = Tag nach letzter Buchung", p.start, "2026-10-17");
check("Netto pro Tag", [p.einnahmenProTag, p.laufendProTag], [1000, -500]);
check("Ohne Ereignisse: Saldo wächst um 500/Tag", p.tage[1].saldo, 101000);

p = L.prognose(roh({ bestellungen: [best({})] }), E0);
const b = p.bestellungen[0];
check("Zahltag = Ankunft − 7", b.zahlDatum, "2026-11-03");
check("USD → EUR mit Kurs aus Bank", b.betragEur, 40000);
// 17.10.–03.11. = 18 Tage × 500 = 9000 → 109000 − 40000 = 69000
check("Saldo nach Zahlung", b.saldoNachZahlung, 69000);
check("Ampel ok", b.ampel, "ok");
check("EUSt 19 % am Ankunftstag", [b.einfuhr.datum, b.einfuhr.eust, b.einfuhr.zoll], ["2026-11-10", 7600, 0]);

// Zwei Bestellungen: die zweite sieht die erste
p = L.prognose(roh({ bestellungen: [best({ id: "a", eta: "2026-11-01", restUsd: 75000, invoiceUsd: 75000 }), best({ id: "b", eta: "2026-11-02", restUsd: 75000, invoiceUsd: 75000 })] }), E0);
const [pa, pb] = p.bestellungen;
// 17.–25.10. = 9 Tage × 500 → 104500 − 60000
check("Erste ok", [pa.ampel, pa.saldoNachZahlung], ["ok", 44500]);
check("Zweite sieht die erste: Lücke, Fehlbetrag", [pb.ampel, pb.saldoNachZahlung, pb.fehlbetrag], ["luecke", -15000, 15000]);
check("Tiefpunkt erkannt", p.tiefpunkt.saldo < 0, true);

// Status versandbereit → sofort fällig
p = L.prognose(roh({ bestellungen: [best({ status: "ready_to_ship", eta: "2026-12-01" })] }), E0);
check("Versandbereit = sofort", [p.bestellungen[0].zahlDatum, p.bestellungen[0].sofort], ["2026-10-17", true]);

// Knapp: unter Puffer, aber positiv
p = L.prognose(roh({ startSaldo: 50000, bestellungen: [best({ eta: "2026-10-25", restUsd: 50000 })] }), E0);
check("Knapp + Fehlbetrag bis Puffer", [p.bestellungen[0].ampel, p.bestellungen[0].fehlbetrag], ["knapp", 9000]);

// Bereits bezahlt (Rest 0): keine Zahlung, aber Einfuhrabgaben
p = L.prognose(roh({ bestellungen: [best({ restUsd: 0, status: "shipped" })] }), E0);
check("Bezahlt: nur Einfuhr", p.ereignisse.map((x) => x.art), ["einfuhr"]);
check("Bezahlt: nicht \"sofort\", sondern bezahlt", [p.bestellungen[0].bezahlt, p.bestellungen[0].sofort], [true, false]);

// USt: Basis − EUSt des Monats, fällig 10. übernächster Monat; Erstattung +21 Tage
p = L.prognose(roh({
  bestellungen: [best({ eta: "2026-11-10", invoiceUsd: 250000, restUsd: 0, status: "shipped" })],
  steuern: { ustHistorie: [{ monat: "2026-08", ust: 20000, eust: 2000 }], ustErledigtBis: "2026-08", eustBezahlt: { "2026-09": 17000 },
    lstLetzte: [4000, 4200], lstErledigtBis: "2026-09", estLetzte: 1735, gewstLetzte: 1025, quartaleErledigt: ["est_vz|Q3 2026", "gewst_vz|Q3 2026"] },
}), { ...E0, horizontTage: 120 });
const st = p.ereignisse.filter((x) => x.art === "steuer").map((x) => [x.datum, x.label, x.betrag]);
check("USt-Basis = Ø(ust+eust)", p.ustBasis, 22000);
check("USt Sep = 22000 − 17000, fällig 10.11.", st.find((s) => s[1] === "USt-VA 2026-09"), ["2026-11-10", "USt-VA 2026-09", -5000]);
check("USt Nov: EUSt 38000 > Basis → Erstattung 21 Tage nach 11.01.", st.find((s) => s[1].startsWith("USt") && s[1].includes("2026-11")), ["2027-02-01", "USt-Erstattung 2026-11 (EUSt-Verrechnung)", 16000]);
check("Lohnsteuer Okt Ø 4100 am 10.11.", st.find((s) => s[1] === "Lohnsteuer 2026-10"), ["2026-11-10", "Lohnsteuer 2026-10", -4100]);
check("GewSt Q4 am 16.11.", st.find((s) => s[1].startsWith("GewSt")), ["2026-11-16", "GewSt-Vorauszahlung Q4 2026", -1025]);
check("ESt Q4 am 10.12.", st.find((s) => s[1].startsWith("ESt")), ["2026-12-10", "ESt-Vorauszahlung Q4 2026", -1735]);
check("Q3 schon bezahlt → nicht nochmal", st.some((s) => s[1].includes("Q3")), false);

// Andere Lieferanten: Standard aus, aber Warn-Tiefpunkt wird gerechnet
p = L.prognose(roh(), E0);
check("Andere Lieferanten nur im Warn-Tiefpunkt", p.tage.at(-1).saldo > p.tiefpunktMitAnderen.saldo || p.tiefpunktMitAnderen.saldo <= p.tiefpunkt.saldo, true);
const pMit = L.prognose(roh(), { ...E0, andereLieferantenEinrechnen: true });
check("Eingerechnet: 300/Tag weniger", pMit.tage[0].saldo, 100300);

// Nachbestellungen
const pn = L.prognose(roh({ nachbestellung: { kgProMonatAuto: 52, usdProKgAuto: 1250, leadWochen: 6 } }), { ...E0, nachbestellungenEinrechnen: true, horizontTage: 60 });
check("Nachbestellungen erzeugen Zahlungen", pn.ereignisse.some((x) => x.art === "nachbestellung"), true);
check("Erste Nachbestellung: Mo 19.10. + 35 Tage", pn.ereignisse.find((x) => x.art === "nachbestellung").datum, "2026-11-23");

// Defaults
check("Defaults vollständig", Object.keys(L.mitDefaults({})).length, Object.keys(L.LIQ_DEFAULTS).length);

console.log(`liquiditaet: ${pass} ok, ${fail} Fehler`);
if (fail) { console.log(fails.join("\n")); process.exit(1); }
