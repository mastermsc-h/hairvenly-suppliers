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
// Soll als Schätzung markiert → Merkmal + Label; Modellwert → Merkmal ohne Label-Zusatz
const rsg = roh({ steuern: { ...rs.steuern, sollGeschaetzt: ["ust_va|2026-09"] } });
const psg = L.prognose(rsg, { ...E0, horizontTage: 60 });
const ustSep = psg.ereignisse.find((x) => x.label.startsWith("USt-VA 2026-09"));
check("Soll-Schätzung markiert", [ustSep.schaetzung, ustSep.steuer, ustSep.label.includes("Schätzung")], [true, "ust", true]);
check("Echtes Soll (LSt) nicht als Schätzung", psg.ereignisse.find((x) => x.label.startsWith("Lohnsteuer 2026-10")).schaetzung, false);
check("Modellwert (USt Okt) = Schätzung ohne Zusatz", [psg.ereignisse.find((x) => x.label === "USt-VA 2026-10").schaetzung], [true]);

// Erstattung mit eingetragenem Eingangstermin (Ledger), sonst Termin + 21 Tage
const ustRoh = (extra) => roh({ steuern: { ustHistorie: [{ monat: "2026-09", ust: 18000, eust: 0 }], ustErledigtBis: "2026-09", eustBezahlt: {}, lstLetzte: [], lstErledigtBis: null, estLetzte: null, gewstLetzte: null, quartaleErledigt: [], sollOffen: { "ust_va|2026-10": -22000 }, sollGeschaetzt: ["ust_va|2026-10"], ...extra } });
const ustEv = (x) => x.ereignisse.find((ev) => ev.steuer === "ust" && ev.label.includes("2026-10"));
const EH = { ...E0, horizontTage: 90 };
check("Erstattung ohne Termin: Fälligkeit + 21 T", ustEv(L.prognose(ustRoh({}), EH)).datum, "2026-12-31");
check("Erstattung mit eingetragenem Eingang", [ustEv(L.prognose(ustRoh({ sollFaellig: { "ust_va|2026-10": "2026-12-04" } }), EH)).datum, ustEv(L.prognose(ustRoh({ sollFaellig: { "ust_va|2026-10": "2026-12-04" } }), EH)).betrag, ustEv(L.prognose(ustRoh({ sollFaellig: { "ust_va|2026-10": "2026-12-04" } }), EH)).schaetzung], ["2026-12-04", 22000, true]);
check("Regeltermin im Ledger zählt nicht als eigener Eingang", ustEv(L.prognose(ustRoh({ sollFaellig: { "ust_va|2026-10": "2026-12-10" } }), EH)).datum, "2026-12-31");
check("Zahlung bleibt am Fälligkeitstag", ustEv(L.prognose(ustRoh({ sollOffen: { "ust_va|2026-10": 5000 }, sollFaellig: { "ust_va|2026-10": "2026-12-04" } }), EH)).datum, "2026-12-10");

// PayPal-Guthaben
const rpp = (abgerufen) => roh({ bankSalden: [{ iban: "PAYPAL", saldo: 25000, stand: "2026-10-18", abgerufenAm: abgerufen }] });
check("PayPal frisch → im Startstand", L.prognose(rpp("2026-10-18T10:00:00Z"), E0).startSaldoGesamt, 125000);
check("PayPal frisch → erster Tag", L.prognose(rpp("2026-10-18T10:00:00Z"), E0).tage[0].saldo, 125500);
check("PayPal veraltet → nicht eingerechnet", L.prognose(rpp("2026-10-10T10:00:00Z"), E0).startSaldoGesamt, 100000);
check("PayPal abgeschaltet", L.prognose(rpp("2026-10-18T10:00:00Z"), { ...E0, paypalEinrechnen: false }).paypal.eingerechnet, false);

// Verschobene Zahltermine (nur Planung)
const vs = (bestellungen = {}, raten = {}) => ({ verschiebungen: { bestellungen, raten } });
const zahlEv = (x) => x.ereignisse.find((ev) => ev.art === "lieferant");
const bv = best({ status: "shipped", eta: "2026-11-10" });
const pv0 = L.prognose(roh({ bestellungen: [bv] }), E0);
const pv1 = L.prognose(roh({ bestellungen: [bv], ...vs({ x: { datum: "2026-11-05", notiz: "abgesprochen" } }) }), E0);
check("Amanda ohne Verschiebung sofort", [pv0.bestellungen[0].zahlDatum, pv0.bestellungen[0].sofort], ["2026-10-17", true]);
check("Amanda verschoben: neuer Termin, nicht mehr sofort", [pv1.bestellungen[0].zahlDatum, pv1.bestellungen[0].sofort, pv1.bestellungen[0].termin.verschoben], ["2026-11-05", false, true]);
check("Amanda verschoben: berechneter Termin + Notiz bleiben sichtbar", [pv1.bestellungen[0].termin.regelDatum, pv1.bestellungen[0].termin.notiz], ["2026-10-17", "abgesprochen"]);
check("Amanda verschoben: Betrag unverändert", zahlEv(pv1).betrag, zahlEv(pv0).betrag);
check("Amanda verschoben: Einfuhrabgaben bleiben bei Ankunft", pv1.bestellungen[0].einfuhr.datum, "2026-11-10");
check("Verschieben ändert nur die Zeitachse, nicht den Endstand", pv1.tage.at(-1).saldo, pv0.tage.at(-1).saldo);
const pvA = L.prognose(roh({ bestellungen: [bv], ...vs({ x: { datum: "2026-10-10", notiz: null } }) }), E0);
check("Termin verstrichen, unbezahlt: wieder sofort", [pvA.bestellungen[0].zahlDatum, pvA.bestellungen[0].sofort, pvA.bestellungen[0].termin.verschoben, pvA.bestellungen[0].termin.abgelaufenAm], ["2026-10-17", true, false, "2026-10-10"]);
check("Termin verstrichen: Hinweis", pvA.hinweise.some((h) => h.includes("verstrichen")), true);
const pvZ = L.prognose(roh({ bestellungen: [best({ eta: "2026-12-01" })], ...vs({ x: { datum: "2026-10-05", notiz: null } }) }), E0);
check("Vorgezogener Termin verstrichen: Zahlung bleibt in der Rechnung", [pvZ.bestellungen[0].zahlDatum, pvZ.bestellungen[0].sofort], ["2026-10-17", true]);
check("Termin hinter dem Zeitraum: Warnung", L.prognose(roh({ bestellungen: [bv], ...vs({ x: { datum: "2027-03-01", notiz: null } }) }), E0).hinweise.some((h) => h.includes("Vorschau-Zeitraum")), true);
const pvB = L.prognose(roh({ bestellungen: [best({ restUsd: 0, status: "shipped" })], ...vs({ x: { datum: "2026-10-10", notiz: null } }) }), E0);
check("Bezahlte Bestellung ignoriert Verschiebung", [pvB.bestellungen[0].termin.verschoben, pvB.bestellungen[0].termin.abgelaufenAm, pvB.hinweise.some((h) => h.includes("verstrichen"))], [false, null, false]);

const EB = "Ebru (CN + TR)";
const rv = (raten, letzte = "2026-10-19") => L.prognose(roh({ ratenPositionen: [mp({ restUsd: 120000 })], letzteZahlung: { [EB]: letzte }, ...vs({}, raten) }), E0).ereignisse.filter((x) => x.art === "manuell");
check("Rate verschoben: Folgeraten rutschen mit", rv({ [EB]: { datum: "2026-11-09", notiz: null, basisZahlung: "2026-10-19" } }).map((x) => x.datum), ["2026-11-09", "2026-11-23", "2026-12-07"]);
check("Rate verschoben: alle Raten tragen Termin + Schlüssel", rv({ [EB]: { datum: "2026-11-09", notiz: null, basisZahlung: "2026-10-19" } }).map((x) => [!!x.verschoben, x.rateTermin.schluessel]), [[true, EB], [false, `${EB}#2`], [false, `${EB}#3`]]);
// Beliebige Rate verschieben (User 10.11.2026)
const rvZ = (raten, zahlTage) => L.prognose(roh({ ratenPositionen: [mp({ restUsd: 120000 })], letzteZahlung: { [EB]: "2026-10-19" }, ratenZahlTage: zahlTage, ...vs({}, raten) }), E0).ereignisse.filter((x) => x.art === "manuell");
check("Rate 2 verschieben: Rate 1 bleibt, Folgeraten ab Rate 2", rvZ({ [`${EB}#2`]: { datum: "2026-11-25", notiz: null, basisZahlung: "2026-10-19" } }).map((x) => [x.datum, !!x.verschoben]), [["2026-11-02", false], ["2026-11-25", true], ["2026-12-09", false]]);
check("Rate 2 + Rate 3 einzeln verschoben", rvZ({ [`${EB}#2`]: { datum: "2026-11-25", notiz: null, basisZahlung: "2026-10-19" }, [`${EB}#3`]: { datum: "2026-12-20", notiz: null, basisZahlung: "2026-10-19" } }).map((x) => x.datum), ["2026-11-02", "2026-11-25", "2026-12-20"]);
check("Nach einer Bankzahlung rückt die Verschiebung vor (Rate 2 → Rate 1)", rvZ({ [`${EB}#2`]: { datum: "2026-11-25", notiz: null, basisZahlung: "2026-10-05" } }, { [EB]: ["2026-10-19", "2026-10-05"] }).map((x) => x.datum)[0], "2026-11-25");
check("Verschobene Rate bezahlt: Verschiebung erledigt", rvZ({ [EB]: { datum: "2026-11-25", notiz: null, basisZahlung: "2026-10-05" } }, { [EB]: ["2026-10-19", "2026-10-05"] }).map((x) => x.datum), ["2026-11-02", "2026-11-16", "2026-11-30"]);
check("Zwei Einträge für dieselbe Rate: der zuletzt geplante gilt", rvZ({ [`${EB}#3`]: { datum: "2026-12-30", notiz: null, basisZahlung: "2026-10-05" }, [`${EB}#2`]: { datum: "2026-11-25", notiz: null, basisZahlung: "2026-10-19" } }, { [EB]: ["2026-10-19", "2026-10-05"] }).map((x) => x.datum)[1], "2026-11-25");
check("Ohne Zahltage-Liste: neuere Bankzahlung beendet auch Rate-2-Verschiebung", rvZ({ [`${EB}#2`]: { datum: "2026-11-25", notiz: null, basisZahlung: "2026-10-05" } }).map((x) => x.datum)[1], "2026-11-16");
check("Schlüssel zerlegen", [L.zerlegeRateSchluessel(EB), L.zerlegeRateSchluessel(`${EB}#4`), L.rateSchluessel(EB, 1), L.rateSchluessel(EB, 2)], [{ lieferant: EB, nr: 1 }, { lieferant: EB, nr: 4 }, EB, `${EB}#2`]);
check("Rate vorziehen geht auch", rv({ [EB]: { datum: "2026-10-26", notiz: null, basisZahlung: "2026-10-19" } }).map((x) => x.datum), ["2026-10-26", "2026-11-09", "2026-11-23"]);
check("Neue Bankzahlung beendet die Verschiebung", rv({ [EB]: { datum: "2026-11-09", notiz: null, basisZahlung: "2026-10-05" } }).map((x) => x.datum), ["2026-11-02", "2026-11-16", "2026-11-30"]);
check("Ohne Zahlungsstand: erste Bankzahlung beendet sie", rv({ [EB]: { datum: "2026-11-09", notiz: null, basisZahlung: null } }).map((x) => x.datum)[0], "2026-11-02");
const rvA = rv({ [EB]: { datum: "2026-10-12", notiz: null, basisZahlung: "2026-10-19" } });
check("Rate verstrichen, unbezahlt: sofort, Rest läuft ab heute", [rvA[0].datum, rvA[0].sofort, rvA[0].rateTermin.abgelaufenAm, rvA[1].datum], ["2026-10-17", true, "2026-10-12", "2026-10-31"]);
check("ratenplan: Bestell-Termine folgen der Verschiebung", L.ratenplan([mp({ id: "a", restUsd: 50000 })], { [EB]: "2026-10-19" }, L.mitDefaults({}), "2026-10-20", { [EB]: { datum: "2026-11-20", notiz: null, basisZahlung: "2026-10-19" } }).map((r) => r.datum), ["2026-11-20", "2026-12-04"]);
check("Keine Verschiebungen (alte Rohdaten) ändern nichts", L.prognose(roh({ bestellungen: [bv] }), E0).bestellungen[0].termin, { regelDatum: "2026-10-17", verschoben: false, notiz: null, abgelaufenAm: null });

// Anzahlung + Rest (Amanda)
const anz = (o = {}, rest = 50000) => L.prognose(roh({ bestellungen: [best({ restUsd: rest })], ...vs({ x: { datum: "2026-10-25", notiz: null, anzahlungUsd: 10000, restDatum: "2026-11-22", restBasisUsd: 50000, ...o } }) }), E0);
const lief = (x) => x.ereignisse.filter((ev) => ev.art === "lieferant").map((ev) => [ev.datum, ev.teil, Math.round(-ev.betrag * x.fx)]);
const pA = anz();
check("Anzahlung: zwei Zahlungen", lief(pA), [["2026-10-25", "anzahlung", 10000], ["2026-11-22", "rest", 40000]]);
check("Anzahlung: Summe unverändert", pA.tage.at(-1).saldo, L.prognose(roh({ bestellungen: [best({})] }), E0).tage.at(-1).saldo);
check("Anzahlung: Teilung in der Bestellung", [pA.bestellungen[0].teilung.anzahlungBezahlt, pA.bestellungen[0].teilung.restUsd, pA.bestellungen[0].zahlDatum], [false, 40000, "2026-10-25"]);
const nachAnz = (x) => x.ereignisse.filter((ev) => ev.art === "lieferant").map((ev) => x.tage.find((t) => t.datum === ev.datum).saldo);
check("Anzahlung: Ampel nach der knapperen Zahlung", pA.bestellungen[0].saldoNachZahlung, Math.min(...nachAnz(pA)));
const pB = anz({}, 41000);
check("Anzahlung bezahlt (Rest kleiner als beim Planen): nur noch der Rest", lief(pB), [["2026-11-22", "rest", 41000]]);
check("Anzahlung bezahlt: Zahltag = Rest-Termin", [pB.bestellungen[0].zahlDatum, pB.bestellungen[0].teilung.anzahlungBezahlt], ["2026-11-22", true]);
check("Anzahlung ≥ Rest: nur eine Zahlung", lief(anz({ anzahlungUsd: 60000 })), [["2026-10-25", "anzahlung", 50000]]);
check("Rest-Termin vor der Anzahlung: rückt auf die Anzahlung", lief(anz({ restDatum: "2026-10-20" })).map((x) => x[0]), ["2026-10-25", "2026-10-25"]);
const pC = anz({ datum: "2026-10-10" });
check("Anzahlung verstrichen, unbezahlt: sofort", [lief(pC)[0][0], pC.bestellungen[0].sofort, pC.hinweise.some((h) => h.includes("(Anzahlung)"))], ["2026-10-17", true, true]);
const pD = anz({ restDatum: "2026-10-12" }, 41000);
check("Rest verstrichen: sofort + Hinweis", [lief(pD)[0][0], pD.bestellungen[0].sofort, pD.bestellungen[0].teilung.restAbgelaufenAm], ["2026-10-17", true, "2026-10-12"]);
check("Ohne Teilung: kein teilung-Feld", L.prognose(roh({ bestellungen: [bv] }), E0).bestellungen[0].teilung, null);
check("Einfuhrabgaben bleiben bei Ankunft", pA.bestellungen[0].einfuhr.datum, "2026-11-10");

// Eingelagert, aber unbezahlt: bleibt Schuld, sofort fällig, keine Einfuhrabgaben mehr
const eingelagert = L.prognose(roh({ bestellungen: [{ ...bv, status: "stocked", eta: "2026-12-20" }] }), E0);
check("Eingelagert unbezahlt ist sofort fällig", eingelagert.bestellungen[0].sofort, true);
check("Eingelagert: Zahlung am ersten Tag", eingelagert.ereignisse.filter((x) => x.art === "lieferant").map((x) => x.datum), [eingelagert.start]);
check("Eingelagert: keine Einfuhrabgaben", eingelagert.ereignisse.filter((x) => x.art === "einfuhr").length, 0);
check("Angekommen verhält sich gleich", L.prognose(roh({ bestellungen: [{ ...bv, status: "delivered", eta: "2026-12-20" }] }), E0).bestellungen[0].sofort, true);

// Einfuhrabgaben per DHL-Rechnungsnummer (ZIT) mit dem Konto abgleichen
check("Rechnungsnummern: Komma/Leerzeichen/Groß-klein", L.rechnungsNummern(" zit8150777, ZIT 8150778; 26 33474 ;x1"), ["ZIT8150777", "ZIT8150778", "2633474"]);
check("Rechnungsnummern leer", L.rechnungsNummern(null), []);
const dhl = (datum, betrag, zweck) => ({ datum, betrag, zweck });
const ezB = [
  dhl("2026-11-04", -7790.76, "/OBO/DHL EXPRESS GERMANY GMBH/INV/ZIT8150777 INV/ZIT8150777 INV/ZIT8150777 INV/ZIT8150777"),
  dhl("2026-10-30", -23887.6, "/OBO/DHL EXPRESS GERMANY GMBH/INV/ZIT8044246 INV/ZIT8044246 INV/ZIT8048169 INV/ZIT8048169 INV/ZIT8"),
  dhl("2026-10-28", -24749.74, "RG.-Nr.. 26 33474 / Kundennr.. 180590"),
  dhl("2026-10-01", 50, "Gutschrift ZIT9999999"),
];
const ezM = L.einfuhrZahlungen([
  { id: "a", rechnung: "ZIT8150777" },
  { id: "b", rechnung: "ZIT8044246" },
  { id: "c", rechnung: "ZIT8150777, ZIT8150999" },
  { id: "d", rechnung: "26 33474" },
  { id: "e", rechnung: "ZIT9999999" },
  { id: "f", rechnung: null },
], ezB);
check("ZIT gefunden: Betrag + Datum", [ezM.get("a").gefunden, ezM.get("a").betragEur, ezM.get("a").datum], [["ZIT8150777"], 7790.76, "2026-11-04"]);
check("Gleiche ZIT an zwei Bestellungen = Sammelzahlung", [ezM.get("a").sammel, ezM.get("c").sammel], [true, true]);
check("Fremde ZIT in der Abbuchung = Sammelzahlung", ezM.get("b").sammel, true);
check("Teilweise gefunden", [ezM.get("c").gefunden, ezM.get("c").rechnungen.length], [["ZIT8150777"], 2]);
check("Nummer mit Leerzeichen (Ungewitter)", [ezM.get("d").gefunden, ezM.get("d").sammel], [["2633474"], false]);
check("Gutschrift zählt nicht", ezM.get("e").gefunden, []);
check("Ohne Nummer kein Eintrag", ezM.has("f"), false);

const ezVoll = { rechnungen: ["ZIT1"], gefunden: ["ZIT1"], betragEur: 8000, datum: "2026-10-17", sammel: false };
const ezNichts = { rechnungen: ["ZIT1"], gefunden: [], betragEur: 0, datum: null, sammel: false };
const pz1 = L.prognose(roh({ bestellungen: [best({ restUsd: 0, status: "shipped", einfuhrRechnung: "ZIT1", einfuhrZahlung: ezVoll })] }), E0);
check("ZIT abgebucht: keine Einfuhrabgaben mehr, obwohl noch unterwegs", [pz1.ereignisse.filter((x) => x.art === "einfuhr").length, pz1.bestellungen[0].einfuhr], [0, null]);
check("ZIT abgebucht: Abgleich an der Bestellung", [pz1.bestellungen[0].einfuhrRechnung, pz1.bestellungen[0].einfuhrZahlung.betragEur], ["ZIT1", 8000]);
const pz2 = L.prognose(roh({ bestellungen: [best({ restUsd: 0, status: "stocked", eta: "2026-10-10", einfuhrZahlung: ezNichts })] }), E0);
check("ZIT eingetragen, nicht abgebucht: bleibt trotz Eingelagert (am ersten Tag)", pz2.ereignisse.filter((x) => x.art === "einfuhr").map((x) => [x.datum, x.betrag]), [[pz2.start, -7600]]);
const pz3 = L.prognose(roh({ bestellungen: [best({ restUsd: 0, status: "shipped", einfuhrZahlung: { rechnungen: ["ZIT1", "ZIT2"], gefunden: ["ZIT1"], betragEur: 3000, datum: "2026-10-17", sammel: false } })] }), E0);
check("Teil abgebucht: nur der Rest bleibt", pz3.ereignisse.filter((x) => x.art === "einfuhr").map((x) => x.betrag), [-4600]);
const pz4 = L.prognose(roh({ bestellungen: [best({ restUsd: 0, status: "shipped", einfuhrZahlung: { rechnungen: ["ZIT1", "ZIT2"], gefunden: ["ZIT1"], betragEur: 30000, datum: "2026-10-17", sammel: true } })] }), E0);
check("Teil in Sammelzahlung: Anteil unbekannt → Schätzung bleibt", pz4.ereignisse.filter((x) => x.art === "einfuhr").map((x) => x.betrag), [-7600]);
check("Ohne ZIT unverändert", L.prognose(roh({ bestellungen: [best({ restUsd: 0, status: "shipped" })] }), E0).ereignisse.filter((x) => x.art === "einfuhr").map((x) => x.betrag), [-7600]);

// Echter Verlauf: rückwärts aus dem heutigen Stand
const vb = (iban, datum, betrag, name = "X", intern = false) => ({ iban, datum, betrag, name, intern });
const vBuchungen = [
  vb("A", "2026-10-01", 100), vb("B", "2026-10-02", 50),
  vb("A", "2026-10-03", -500, "Finanzamt"), vb("A", "2026-10-03", 20, "Shop"),
  vb("A", "2026-10-05", -300, "Übertrag", true), vb("B", "2026-10-05", 300, "Übertrag", true),
];
const vKonten = [{ iban: "A", saldo: 1000 }, { iban: "B", saldo: 2000 }];
const v = L.kontoVerlauf(vBuchungen, vKonten, "2026-10-06");
check("Verlauf startet, sobald alle Konten Daten haben", v[0].datum, "2026-10-02");
check("Verlauf Tagesende-Stände", v.map((t) => t.saldo), [3480, 3000, 3000, 3000, 3000]);
check("Letzter Tag = heutiger Stand", v.at(-1).saldo, 3000);
check("Tage ohne Buchung sind dabei", v[2].datum, "2026-10-04");
check("Größte Buchung zuerst", v[1].buchungen, [{ name: "Finanzamt", betrag: -500 }, { name: "Shop", betrag: 20 }]);
check("Übertrag zwischen eigenen Konten nicht in der Tagesliste", v[3].buchungen, []);
check("Mehr Buchungen als angezeigt werden gezählt", L.kontoVerlauf(vBuchungen, vKonten, "2026-10-06", 1)[1].weitere, 1);
const vg = L.kontoVerlauf([...vBuchungen, vb("A", "2026-10-04", -700, "Amanda · AMANDAGRM1"), vb("B", "2026-10-04", -90, "Finanzamt")].map((x) => ({ ...x, gruppe: x.name.startsWith("Amanda") ? "amanda" : x.name === "Finanzamt" ? "steuern" : null })), vKonten, "2026-10-06");
check("Verlauf: Zahlungsgruppen je Tag (alle, nicht nur die größten)", vg.find((t) => t.datum === "2026-10-04").zahlungen, [{ gruppe: "amanda", name: "Amanda · AMANDAGRM1", betrag: -700 }, { gruppe: "steuern", name: "Finanzamt", betrag: -90 }]);
check("Verlauf: Tage ohne Gruppenzahlung ohne Feld", "zahlungen" in vg.find((t) => t.datum === "2026-10-05"), false);
check("Termin-Gruppen", ["lieferant", "nachbestellung", "manuell", "einfuhr", "steuer", "aktion"].map((art) => L.zahlGruppe({ art })), ["amanda", "amanda", "ebru", "einfuhr", "steuern", null]);
check("Konto ohne Buchungen → kein Verlauf statt falscher Summe", L.kontoVerlauf(vBuchungen, [...vKonten, { iban: "C", saldo: 5 }], "2026-10-06"), []);

// Ebru: Ware in Produktion als geschätzte Rechnung hinten in den Raten
const pg = L.prognose(roh({
  ratenPositionen: [mp({ id: "a", label: "A", restUsd: 40000 }), mp({ id: "g", label: "G", datum: "2026-11-03", restUsd: 20000, geschaetzt: true })],
  letzteZahlung: { "Ebru (CN + TR)": "2026-10-19" },
}), E0).ereignisse.filter((x) => x.art === "manuell");
check("Geschätzte Position reiht sich hinten ein", pg.map((x) => [x.datum, !!x.schaetzung]), [["2026-11-02", false], ["2026-11-17", true]]);
check("Geschätzte Position im Label mit ≈", pg[1].label.includes("(≈ G)"), true);

// Ebru-Lieferungen: Einfuhrabgaben bei Ankunft
const ea = (o) => ({ id: "e1", label: "China X", lieferant: "Ebru (CN + TR)", status: "in_production", eta: "2026-11-20", warenUsd: 50000, importVatEur: null, geschaetzt: true, ...o });
const einf = (pp) => pp.ereignisse.filter((x) => x.art === "einfuhr").map((x) => [x.datum, x.betrag]);
const pe1 = L.prognose(roh({ einfuhrAndere: [ea({})] }), E0);
check("Ebru-Einfuhr 3 Tage nach Versand (Versand = Ankunft − 7)", einf(pe1), [["2026-11-16", -7600]]);
check("Ebru-Einfuhr im Ergebnis", [pe1.einfuhrAndere[0].einfuhr.eust, pe1.einfuhrAndere[0].geschaetzt], [7600, true]);
const pe2 = L.prognose(roh({ einfuhrAndere: [ea({ eta: "2026-10-01" })] }), E0);
check("Ankunft vorbei, noch nicht versendet: Versand frühestens +7, Zoll +3, mit Hinweis", [einf(pe2), pe2.hinweise.some((h) => h.includes("China X") && h.includes("noch nicht versendet"))], [[["2026-10-27", -7600]], true]);
check("Ankunft vorbei, versendet: Ungewitter-Rechnung sofort", einf(L.prognose(roh({ einfuhrAndere: [ea({ eta: "2026-10-01", status: "shipped" })] }), E0)), [["2026-10-17", -7600]]);
check("Ankunft bald, noch in Produktion: nicht vor Versand +7 +3", einf(L.prognose(roh({ einfuhrAndere: [ea({ eta: "2026-10-20" })] }), E0)), [["2026-10-27", -7600]]);
check("Amanda: Ankunft vorbei, noch versandbereit → Einfuhr frühestens in 7 Tagen", L.prognose(roh({ bestellungen: [best({ restUsd: 0, status: "ready_to_ship", eta: "2026-10-01" })] }), E0).bestellungen[0].einfuhr.datum, "2026-10-24");
check("Amanda: Ankunft vorbei, versendet → Einfuhr sofort", L.prognose(roh({ bestellungen: [best({ restUsd: 0, status: "shipped", eta: "2026-10-01" })] }), E0).bestellungen[0].einfuhr.datum, "2026-10-17");
check("Eingelagert ohne Rechnungsnr.: keine Abgaben", einf(L.prognose(roh({ einfuhrAndere: [ea({ status: "stocked" })] }), E0)), []);
check("Eingelagert, Zoll-Rechnung noch offen: Abgaben bleiben", einf(L.prognose(roh({ einfuhrAndere: [ea({ status: "stocked", eta: "2026-10-10", einfuhrZahlung: ezNichts })] }), E0)), [["2026-10-17", -7600]]);
check("Zoll-Rechnung abgebucht: keine Abgaben", einf(L.prognose(roh({ einfuhrAndere: [ea({ einfuhrZahlung: ezVoll })] }), E0)), []);
check("Mit Lieferanten-Ø: Ebru-Einfuhr nicht einzeln (sonst doppelt)", einf(L.prognose(roh({ einfuhrAndere: [ea({})] }), { ...E0, andereLieferantenEinrechnen: true })), []);
// USt: Ebru einzeln geplant → kein Ø-EUSt der anderen Lieferanten mehr obendrauf
const ustEbru = (extra) => L.prognose(roh({ ...extra, steuern: { ustHistorie: [{ monat: "2026-08", ust: 20000, eust: 2000 }], ustErledigtBis: "2026-08", eustBezahlt: {}, lstLetzte: [], lstErledigtBis: null, estLetzte: null, gewstLetzte: null, quartaleErledigt: [] } }), { ...E0, horizontTage: 120 })
  .ereignisse.find((x) => x.label === "USt-VA 2026-10").betrag;
check("USt Okt alt: Basis − Ø EUSt andere", ustEbru({}), -20000);
check("USt Okt mit Ebru einzeln: ohne Ø", ustEbru({ einfuhrAndere: [] }), -22000);
check("USt Nov mit Ebru-Ankunft: deren EUSt verrechnet", L.prognose(roh({ einfuhrAndere: [ea({})], steuern: { ustHistorie: [{ monat: "2026-08", ust: 20000, eust: 2000 }], ustErledigtBis: "2026-08", eustBezahlt: {}, lstLetzte: [], lstErledigtBis: null, estLetzte: null, gewstLetzte: null, quartaleErledigt: [] } }), { ...E0, horizontTage: 120 }).ereignisse.find((x) => x.label === "USt-VA 2026-11").betrag, -14400);

// Ebru-Nachbestellungen (Schätzung)
const nb = { lieferant: "Ebru (CN + TR)", kgProMonatAuto: 130 / 3, usdProKgAuto: 1000, leadWochen: 8 };
const pnb = L.prognose(roh({ einfuhrAndere: [], ebruNachbestellung: nb }), { ...E0, ebruNachbestellungenEinrechnen: true });
check("Ebru-Nachbestellung: Einfuhr 3 Tage nach Versand (bestellt Mo 19.10. + 8 Wochen − 7 + 3)", pnb.ereignisse.filter((x) => x.label.includes("Ebru-Nachbestellung")).map((x) => [x.datum, x.betrag, x.schaetzung]), [["2026-12-10", -1520, true]]);
check("Ebru-Nachbestellung: kg/Monat im Ergebnis", Math.round(pnb.ebruNachbestellKgMonat * 10) / 10, 43.3);
check("Ebru-Nachbestellung: Verbrauch geht vor Ø Bestellungen", L.prognose(roh({ einfuhrAndere: [], ebruNachbestellung: { ...nb, kgVerbrauchMonat: 30 } }), { ...E0, ebruNachbestellungenEinrechnen: true }).ebruNachbestellKgMonat, 30);
check("Ebru-Nachbestellung: manuell geht vor Verbrauch", L.prognose(roh({ einfuhrAndere: [], ebruNachbestellung: { ...nb, kgVerbrauchMonat: 30 } }), { ...E0, ebruNachbestellungenEinrechnen: true, ebruNachbestellKgMonat: 20 }).ebruNachbestellKgMonat, 20);
check("Ebru-Nachbestellung aus: nichts", L.prognose(roh({ einfuhrAndere: [], ebruNachbestellung: nb }), E0).ereignisse.length, 0);
const pnb2 = L.prognose(roh({ einfuhrAndere: [], ebruNachbestellung: nb }), { ...E0, ebruNachbestellungenEinrechnen: true, horizontTage: 120 });
check("Ebru-Nachbestellung: Rechnung reiht sich als geschätzte Rate ein", pnb2.ereignisse.filter((x) => x.art === "manuell").every((x) => x.schaetzung && x.label.includes("≈ Nachbestellung")), true);
check("Ebru-Nachbestellung: es gibt Raten", pnb2.ereignisse.some((x) => x.art === "manuell"), true);

// Nicht zugeordnete Verzoller-Abbuchungen (06.11.2026: ZIT8150777 abgebucht, an keiner Bestellung → doppelt gezählt)
const zb = (o) => ({ datum: "2026-10-16", betrag: -8000, zweck: "/OBO/DHL EXPRESS GERMANY GMBH/INV/ZIT8150777 INV/ZIT8150777", gegenpartei: "DHL AG", kategorie: "st_eust", ...o });
const offen = L.offeneZollBuchungen([
  zb({}),
  zb({ zweck: "/OBO/DHL EXPRESS GERMANY GMBH/INV/ZIT8000001", betrag: -500 }),
  zb({ zweck: "RG.-Nr.. 26 33474 / Kundennr.. 180590 / Hairvenly", gegenpartei: "Carl Ungewitter Trinidad Lake", betrag: -2000 }),
  zb({ kategorie: "aus_versand", zweck: "/OBO/DHL PAKET GMBH/ZIT8999999" }),
  zb({ betrag: 100 }),
], ["zit 8000001"]);
check("Offene Zoll-Buchungen: ZIT + Ungewitter, eingetragene/fremde/Gutschrift raus", offen.map((b) => [b.art, b.nummern, b.betragEur]), [["dhl", ["ZIT8150777"], 8000], ["ungewitter", ["26 33474"], 2000]]);
const zv = L.zollVermutungen(
  [{ id: "a", art: "dhl", versandAm: "2026-10-10", eur: 5000 }, { id: "b", art: "dhl", versandAm: "2026-10-12", eur: 4000 }, { id: "c", art: "dhl", versandAm: "2026-10-20", eur: 1000 }, { id: "d", art: "ungewitter", versandAm: "2026-10-01", eur: 1000 }],
  [{ datum: "2026-10-16", betragEur: 8000, nummern: ["ZIT1"], art: "dhl" }],
);
check("Vermutung: älteste Sendung zuerst, Abbuchung deckt mehrere", [zv.get("a"), zv.get("b")].map((v) => [v.anteilEur, v.vollstaendig, v.betragEur]), [[5000, true, 8000], [3000, false, 8000]]);
check("Vermutung: Abbuchung vor dem Versand / anderer Verzoller zählt nicht", [zv.has("c"), zv.has("d")], [false, false]);
check("Vermutung: Abbuchung am Versandtag zählt nicht", L.zollVermutungen([{ id: "a", art: "dhl", versandAm: "2026-10-16", eur: 5000 }], [{ datum: "2026-10-16", betragEur: 8000, nummern: ["ZIT1"], art: "dhl" }]).size, 0);
const zbRoh = (o, b = {}) => roh({ bestellungen: [best({ restUsd: 0, status: "shipped", versandAm: "2026-10-15", ...b })], zollBuchungen: [{ datum: "2026-10-16", betragEur: 8000, nummern: ["ZIT8150777"], art: "dhl" }], ...o });
const pzv = L.prognose(zbRoh({}), E0);
check("Abgebucht nach Versand, nicht zugeordnet: keine Einfuhr mehr in der Vorschau", [pzv.ereignisse.filter((x) => x.art === "einfuhr").length, pzv.bestellungen[0].einfuhr, pzv.bestellungen[0].einfuhrVermutung.nummern], [0, null, ["ZIT8150777"]]);
check("Kleinere Abbuchung: nur der Rest bleibt", L.prognose(zbRoh({ zollBuchungen: [{ datum: "2026-10-16", betragEur: 3000, nummern: ["ZIT1"], art: "dhl" }] }), E0).ereignisse.filter((x) => x.art === "einfuhr").map((x) => x.betrag), [-4600]);
check("Schalter aus: Schätzung bleibt", L.prognose(zbRoh({}), { ...E0, zollAbbuchungenVerrechnen: false }).ereignisse.filter((x) => x.art === "einfuhr").map((x) => x.betrag), [-7600]);
check("Ohne Versandtag: keine Vermutung", L.prognose(zbRoh({}, { versandAm: null }), E0).ereignisse.filter((x) => x.art === "einfuhr").map((x) => x.betrag), [-7600]);
check("Noch nicht versendet: keine Vermutung", L.prognose(zbRoh({}, { status: "ready_to_ship" }), E0).bestellungen[0].einfuhrVermutung, null);
check("Eigene Nummer eingetragen: keine Vermutung", L.prognose(zbRoh({}, { einfuhrRechnung: "ZIT7777777", einfuhrZahlung: ezNichts }), E0).bestellungen[0].einfuhrVermutung, null);
const pvE = L.prognose(roh({ einfuhrAndere: [ea({ status: "shipped", versandAm: "2026-10-15" })], zollBuchungen: [{ datum: "2026-10-17", betragEur: 9000, nummern: ["26 33474"], art: "ungewitter" }] }), E0);
check("Ebru: Ungewitter-Abbuchung nach Versand verrechnet", [einf(pvE), pvE.einfuhrAndere[0].einfuhrVermutung.nummern], [[], ["26 33474"]]);

// Eingetragene Zahlungen, die das Konto noch nicht zeigt (06.11.2026: 3 Amanda-Anzahlungen, Bank erst nach 1–3 Tagen)
check("USD aus Verwendungszweck", [L.usdImZweck("FXP/261029BIC DHBKHKHHXXXUSD12190,03 1,10810INVOICE"), L.usdImZweck("EMPF. CN BETRAG. USD       -6.142,00KURS."), L.usdImZweck("SEPA")], [[12190.03], [6142], []]);
const zt = (o) => ({ datum: "2026-10-16", betrag: -10000, zweck: "FXP/x BIC DHBKHKHHXXXUSD13000,00 1,11", kategorie: "aus_wareneinkauf", ...o });
const zu = (o) => ({ id: "z", datum: "2026-10-16", usd: 13000, ...o });
check("Zahlung mit passender Abbuchung: nicht unterwegs", L.zahlungenOhneAbbuchung([zu({})], [zt({})], "2026-10-18").length, 0);
check("Zahlung ohne Abbuchung: unterwegs", L.zahlungenOhneAbbuchung([zu({})], [zt({ zweck: "USD12999,00" })], "2026-10-18").map((z) => z.id), ["z"]);
check("Gebühren-Zeile mit gleichem USD-Betrag zählt nicht", L.zahlungenOhneAbbuchung([zu({})], [zt({ betrag: -22.5, kategorie: "aus_bank", zweck: "GEBUEHRENUSD 13000,00" })], "2026-10-18").length, 1);
check("Zwei gleiche Zahlungen, eine Abbuchung: eine bleibt unterwegs", L.zahlungenOhneAbbuchung([zu({ id: "a" }), zu({ id: "b" })], [zt({})], "2026-10-18").length, 1);
check("Ältere Zahlung (>10 Tage): nicht mehr unterwegs", L.zahlungenOhneAbbuchung([zu({ datum: "2026-10-01" })], [], "2026-10-18").length, 0);
const pun = L.prognose(roh({ zahlungenUnterwegs: [{ id: "z", orderId: "x", label: "Amanda 03.08.2026", lieferant: "Amanda", datum: "2026-10-16", usd: 12500, art: "amanda" }] }), E0);
check("Unterwegs: heute abgezogen", pun.ereignisse.filter((x) => x.unterwegs).map((x) => [x.datum, x.betrag, x.art]), [["2026-10-17", -10000, "lieferant"]]);
check("Unterwegs: senkt den Tiefpunkt", pun.tiefpunkt.saldo < L.prognose(roh(), E0).tiefpunkt.saldo, true);
const pun2 = L.prognose(roh({ bestellungen: [best({ id: "x" })], zahlungenUnterwegs: [{ id: "z", orderId: "x", label: "B", lieferant: "Amanda", datum: "2026-10-16", usd: 5000, art: "amanda" }] }), E0);
check("Unterwegs: Ampel/Termin der Bestellung unverändert", pun2.bestellungen[0].zahlDatum, L.prognose(roh({ bestellungen: [best({ id: "x" })] }), E0).bestellungen[0].zahlDatum);
check("Unterwegs Ebru: als Raten-Abgang", L.prognose(roh({ zahlungenUnterwegs: [{ id: "z", orderId: "y", label: "EHL1", lieferant: "Ebru (CN + TR)", datum: "2026-10-16", usd: 12500, art: "raten" }] }), E0).ereignisse.filter((x) => x.unterwegs).map((x) => [x.art, x.ratenLieferant]), [["manuell", "Ebru (CN + TR)"]]);

// Rhythmuswechsel (User 12.11.2026: ab 07.12. jede Woche eine Ebru-Rate)
const rw = (regel, raten = {}) => L.prognose(roh({ ratenPositionen: [mp({ restUsd: 400000 })], letzteZahlung: { [EB]: "2026-10-19" }, ...vs({}, raten) }), { ...E0, horizontTage: 90, ratenLieferanten: [{ name: "Ebru", rateUsd: 40000, fristTage: 14, abstandTage: 14, bankMuster: "X", ...regel }] }).ereignisse.filter((x) => x.art === "manuell").map((x) => x.datum);
check("Ab 07.12. wöchentlich: Rate nach altem Rhythmus über den Wechsel hinaus → am Wechseltag", rw({ wechselAb: "2026-12-07", abstandTageAb: 7 }).slice(0, 7), ["2026-11-02", "2026-11-16", "2026-11-30", "2026-12-07", "2026-12-14", "2026-12-21", "2026-12-28"]);
check("Ab 07.12. wöchentlich mit verschobener Rate 1 (01.12.)", rw({ wechselAb: "2026-12-07", abstandTageAb: 7 }, { [EB]: { datum: "2026-12-01", notiz: null, basisZahlung: "2026-10-19" } }).slice(0, 4), ["2026-12-01", "2026-12-07", "2026-12-14", "2026-12-21"]);
check("Ohne Wechsel unverändert", rw({}).slice(0, 3), ["2026-11-02", "2026-11-16", "2026-11-30"]);

// Defaults
check("Defaults vollständig", Object.keys(L.mitDefaults({})).length, Object.keys(L.LIQ_DEFAULTS).length);

console.log(`liquiditaet: ${pass} ok, ${fail} Fehler`);
if (fail) { console.log(fails.join("\n")); process.exit(1); }
