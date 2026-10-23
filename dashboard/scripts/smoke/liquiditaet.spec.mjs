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
  bankSalden: [],
  basis: { monate: ["2026-09"], tage: 30, einnahmen: 30000, laufend: [{ kategorie: "aus_x", summe: -15000 }], andereLieferanten: -6000, monatsWerte: [] },
  fxAuto: { kurs: 1.25, datum: "2026-10-09" },
  bestellungen: [],
  steuern: { ustHistorie: [], ustErledigtBis: null, eustBezahlt: {}, lstLetzte: [], lstErledigtBis: null, estLetzte: null, gewstLetzte: null, quartaleErledigt: [] },
  nachbestellung: { kgProMonatAuto: 0, kgVerbrauchMonat: null, usdProKgAuto: 0, leadWochen: 6 },
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
check("Ø EUSt andere = Historie ohne Amanda", p.eustAndereMonat, 2000);
check("Ø tatsächliche Zahllast", p.ustIstSchnitt, 20000);
check("USt Sep = 22000 − 17000, fällig 10.11.", st.find((s) => s[1] === "USt-VA 2026-09"), ["2026-11-10", "USt-VA 2026-09", -5000]);
check("USt Nov: EUSt 38000 > Basis → Erstattung 21 Tage nach 11.01.", st.find((s) => s[1].startsWith("USt") && s[1].includes("2026-11")), ["2027-02-01", "USt-Erstattung 2026-11 (EUSt-Verrechnung)", 18000]);
check("Lohnsteuer Okt Ø 4100 am 10.11.", st.find((s) => s[1] === "Lohnsteuer 2026-10"), ["2026-11-10", "Lohnsteuer 2026-10", -4100]);
check("GewSt Q4 am 16.11.", st.find((s) => s[1].startsWith("GewSt")), ["2026-11-16", "GewSt-Vorauszahlung Q4 2026", -1025]);
check("ESt Q4 am 10.12.", st.find((s) => s[1].startsWith("ESt")), ["2026-12-10", "ESt-Vorauszahlung Q4 2026", -1735]);
check("Q3 schon bezahlt → nicht nochmal", st.some((s) => s[1].includes("Q3")), false);

// Andere Lieferanten: Standard aus, aber Warn-Tiefpunkt wird gerechnet
p = L.prognose(roh(), E0);
check("Andere Lieferanten nur im Warn-Tiefpunkt", p.tage.at(-1).saldo > p.tiefpunktMitAnderen.saldo || p.tiefpunktMitAnderen.saldo <= p.tiefpunkt.saldo, true);
const pMit = L.prognose(roh(), { ...E0, andereLieferantenEinrechnen: true });
check("Eingerechnet: 300/Tag weniger", pMit.tage[0].saldo, 100300);
// Amanda-Anteil der historischen EUSt wird herausgerechnet: 12.500 USD / 1,25 = 10.000 € → EUSt 1.900
const pAm = L.prognose(roh({ steuern: { ustHistorie: [{ monat: "2026-08", ust: 15000, eust: 5000 }], ustErledigtBis: "2026-08", eustBezahlt: {}, lstLetzte: [], lstErledigtBis: null, estLetzte: null, gewstLetzte: null, quartaleErledigt: [], amandaImportUsd: { "2026-08": 12500 } } }), { ...E0, horizontTage: 60 });
check("EUSt andere = 5000 − Amanda 1900", pAm.eustAndereMonat, 3100);
check("Laufender Monat Okt: Basis 20000 − andere 3100", pAm.ereignisse.find((x) => x.label === "USt-VA 2026-10").betrag, -16900);
check("Vergangener Monat Sep: nur tatsächliche EUSt (0)", pAm.ereignisse.find((x) => x.label === "USt-VA 2026-09").betrag, -20000);

// Nachbestellungen
const pn = L.prognose(roh({ nachbestellung: { kgProMonatAuto: 52, kgVerbrauchMonat: null, usdProKgAuto: 1250, leadWochen: 6 } }), { ...E0, nachbestellungenEinrechnen: true, horizontTage: 60 });
check("Ohne Verbrauch: Bestellrhythmus", pn.nachbestellKgMonat, 52);
const pv = L.prognose(roh({ nachbestellung: { kgProMonatAuto: 52, kgVerbrauchMonat: 24.3, usdProKgAuto: 1250, leadWochen: 6 } }), { ...E0, nachbestellungenEinrechnen: true });
check("Verbrauch hat Vorrang vor Bestellrhythmus", pv.nachbestellKgMonat, 24.3);
check("Manuell hat Vorrang vor Verbrauch", L.prognose(roh({ nachbestellung: { kgProMonatAuto: 52, kgVerbrauchMonat: 24.3, usdProKgAuto: 1250, leadWochen: 6 } }), { ...E0, nachbestellKgMonat: 30 }).nachbestellKgMonat, 30);
// Ausgeblendete Kategorie (Kredit abbezahlt)
const rk = roh({ basis: { monate: ["2026-09"], tage: 30, einnahmen: 30000, laufend: [{ kategorie: "aus_kredit", summe: -9000 }, { kategorie: "aus_x", summe: -6000 }], andereLieferanten: 0, monatsWerte: [] } });
check("Mit Kredit", L.prognose(rk, E0).laufendProTag, -500);
check("Kredit fällt weg", L.prognose(rk, { ...E0, ausgeblendeteKategorien: ["aus_kredit"] }).laufendProTag, -200);
check("Nachbestellungen erzeugen Zahlungen", pn.ereignisse.some((x) => x.art === "nachbestellung"), true);
check("Erste Nachbestellung: Mo 19.10. + 35 Tage", pn.ereignisse.find((x) => x.art === "nachbestellung").datum, "2026-11-23");

// Verkaufsaktion (Black Friday)
const akt = { aktiv: true, label: "BF", von: "2026-11-15", bis: "2026-11-16", mehrumsatzBrutto: 11900, profil: [1, 3], verzugTage: 3, auszahlungProzent: 100, quelle: "test" };
const pa2 = L.prognose(roh({ steuern: { ustHistorie: [{ monat: "2026-08", ust: 10000, eust: 0 }], ustErledigtBis: "2026-10", eustBezahlt: {}, lstLetzte: [], lstErledigtBis: null, estLetzte: null, gewstLetzte: null, quartaleErledigt: [] } }), { ...E0, horizontTage: 100, aktion: akt });
check("Aktion: Eingänge nach Profil + Verzug", pa2.ereignisse.filter((x) => x.art === "aktion").map((x) => [x.datum, x.betrag]), [["2026-11-18", 2975], ["2026-11-19", 8925]]);
check("Aktion: USt Nov = Basis + 19/119 vom Mehrumsatz", pa2.ereignisse.find((x) => x.label === "USt-VA 2026-11").betrag, -11900);
check("Aktion aus = nichts", L.prognose(roh(), { ...E0, aktion: { ...akt, aktiv: false } }).ereignisse.length, 0);
check("Falsches Profil → gleichmäßig", L.prognose(roh(), { ...E0, aktion: { ...akt, profil: [1, 2, 3] } }).ereignisse.filter((x) => x.art === "aktion").map((x) => x.betrag), [5950, 5950]);

// Ratenzahlung: Ebru 40k $, erste Rate Rechnung + 14 T, dann alle 14 T ab der LETZTEN ZAHLUNG (Bank)
const mp = (o) => ({ id: "m", label: "M", lieferant: "Ebru (CN + TR)", datum: "2026-10-10", restUsd: 0, ...o });
const pm = L.prognose(roh({
  ratenPositionen: [mp({ id: "a", label: "A", restUsd: 68625 }), mp({ id: "b", label: "B", datum: "2026-10-20", restUsd: 30000 })],
  letzteZahlung: { "Ebru (CN + TR)": "2026-10-19" },
}), E0);
const raten = pm.ereignisse.filter((x) => x.art === "manuell");
check("Ebru: Rhythmus läuft ab letzter Zahlung weiter", raten.map((x) => x.datum), ["2026-11-02", "2026-11-16", "2026-11-30"]);
check("Ebru: Raten in EUR (40k/40k/Rest, Kurs 1,25)", raten.map((x) => x.betrag), [-32000, -32000, -14900]);
check("Ebru: Rate 2 bedient A-Rest + B", raten[1].label.includes("(A, B)"), true);
const pf = L.prognose(roh({ ratenPositionen: [mp({ restUsd: 50000 })] }), E0).ereignisse.filter((x) => x.art === "manuell");
check("Ebru ohne Zahlungshistorie: Rechnung + 14 T, dann 14 T", pf.map((x) => x.datum), ["2026-10-24", "2026-11-07"]);
const pn2 = L.prognose(roh({ ratenPositionen: [mp({ datum: "2026-11-01", restUsd: 40000 })], letzteZahlung: { "Ebru (CN + TR)": "2026-09-01" } }), E0).ereignisse.filter((x) => x.art === "manuell");
check("Ebru: neue Rechnung nach langer Pause → Frist ab Rechnungseingang", pn2.map((x) => x.datum), ["2026-11-15"]);
const pu = L.prognose(roh({ ratenPositionen: [mp({ datum: "2026-08-01", restUsd: 50000 })] }), E0).ereignisse.filter((x) => x.art === "manuell");
check("Überfällig: erste Rate sofort, dann Abstand", pu.map((x) => [x.datum, !!x.sofort]), [["2026-10-17", true], ["2026-10-31", false]]);
check("Bezahlt = keine Rate", L.prognose(roh({ ratenPositionen: [mp({ restUsd: 0 })] }), E0).ereignisse.length, 0);
const pz = L.prognose(roh({ ratenPositionen: [mp({ datum: "2026-10-01", restUsd: 40000 }), mp({ id: "z", lieferant: "Amanda", datum: "2026-10-01", restUsd: 40000 })] }), { ...E0, manuellFristTage: 28 }).ereignisse.filter((x) => x.art === "manuell");
check("Andere Lieferanten: allgemeine Regel (Frist 28), Ebru eigene (14)", pz.map((x) => x.datum).sort(), ["2026-10-17", "2026-10-29"]);
check("Alte Rohdaten (manuellePositionen) gehen weiter", L.prognose(roh({ manuellePositionen: [mp({ restUsd: 1000 })] }), E0).ereignisse.filter((x) => x.art === "manuell").length, 1);

const rp = L.ratenplan([mp({ id: "a", label: "A", restUsd: 50000 }), mp({ id: "b", label: "B", datum: "2026-10-11", restUsd: 30000 })], { "Ebru (CN + TR)": "2026-10-19" }, L.mitDefaults({}), "2026-10-20");
check("ratenplan: Anteile je Rechnung", rp.map((r) => [r.datum, r.positionen.map((x) => `${x.id}:${x.usd}`)]), [["2026-11-02", ["a:40000"]], ["2026-11-16", ["a:10000", "b:30000"]]]);

// Soll aus dem Steuer-Ledger hat Vorrang vor der Schätzung
const rs = roh({ steuern: { ustHistorie: [{ monat: "2026-08", ust: 20000, eust: 0 }], ustErledigtBis: "2026-08", eustBezahlt: {}, lstLetzte: [4000], lstErledigtBis: "2026-09",
  estLetzte: 1735, gewstLetzte: 1025, quartaleErledigt: [], sollOffen: { "ust_va|2026-09": 18200, "lst_anmeldung|2026-10": 4500, "gewst_vz|Q4 2026": 1500 } } });
const ps = L.prognose(rs, { ...E0, horizontTage: 60 });
const lbl = (pre) => ps.ereignisse.find((x) => x.label.startsWith(pre));
check("USt Sep = Soll", [lbl("USt-VA 2026-09").betrag, lbl("USt-VA 2026-09").label.includes("Soll")], [-18200, true]);
check("USt Okt ohne Soll = Schätzung", lbl("USt-VA 2026-10").betrag, -20000);
check("LSt Okt = Soll", lbl("Lohnsteuer 2026-10").betrag, -4500);
check("GewSt Q4 = Soll", lbl("GewSt-Vorauszahlung Q4 2026").betrag, -1500);

// PayPal-Guthaben
const rpp = (abgerufen) => roh({ bankSalden: [{ iban: "PAYPAL", saldo: 25000, stand: "2026-10-18", abgerufenAm: abgerufen }] });
check("PayPal frisch → im Startstand", L.prognose(rpp("2026-10-18T10:00:00Z"), E0).startSaldoGesamt, 125000);
check("PayPal frisch → erster Tag", L.prognose(rpp("2026-10-18T10:00:00Z"), E0).tage[0].saldo, 125500);
check("PayPal veraltet → nicht eingerechnet", L.prognose(rpp("2026-10-10T10:00:00Z"), E0).startSaldoGesamt, 100000);
check("PayPal abgeschaltet", L.prognose(rpp("2026-10-18T10:00:00Z"), { ...E0, paypalEinrechnen: false }).paypal.eingerechnet, false);

// Defaults
check("Defaults vollständig", Object.keys(L.mitDefaults({})).length, Object.keys(L.LIQ_DEFAULTS).length);

console.log(`liquiditaet: ${pass} ok, ${fail} Fehler`);
if (fail) { console.log(fails.join("\n")); process.exit(1); }
