/**
 * SMOKE-TEST: Freestyle-Einnahmen (src/lib/salon/einnahmen.ts)
 *
 * KERN-INVARIANTEN:
 *  - Datum/Uhrzeit vom Gerät ist Bremer Ortszeit (Sommer-/Winterzeit) → UTC korrekt.
 *  - Tagessummen nach Bremer Kalendertag, nicht nach UTC (23:30 Uhr gehört zum selben Tag).
 *  - Stornierte Einträge zählen in keiner Summe.
 *  - Ausgaben zählen nie als Einnahme; Saldo = Einnahmen − Ausgaben.
 *  - Mitarbeiter stornieren nur eigene Einträge vom selben Tag.
 *
 * Run:  node scripts/smoke/salon-einnahmen.spec.mjs
 */
import { readFileSync } from "fs";
import path from "path";
import ts from "typescript";

const js = ts.transpileModule(readFileSync(path.resolve(process.cwd(), "src/lib/salon/einnahmen.ts"), "utf8"), {
  compilerOptions: { module: "ESNext", target: "ES2022" },
}).outputText;
const E = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));

let pass = 0, fail = 0; const fails = [];
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++;
  else { fail++; fails.push(`[X] ${name}: erwartet ${e}, bekam ${a}`); }
}

// Zeitzone
check("Winterzeit: 14:30 Bremen = 13:30 UTC", E.berlinLokalZuIso("2026-11-05T14:30"), "2026-11-05T13:30:00.000Z");
check("Sommerzeit: 14:30 Bremen = 12:30 UTC", E.berlinLokalZuIso("2026-07-05T14:30"), "2026-07-05T12:30:00.000Z");
check("Kurz nach Umstellung (29.03. 03:30)", E.berlinLokalZuIso("2026-03-29T03:30"), "2026-03-29T01:30:00.000Z");
check("Ungültig", E.berlinLokalZuIso("05.11.2026 14:30"), null);
check("Hin und zurück", E.berlinLokal(E.berlinLokalZuIso("2026-11-05T09:05")), "2026-11-05T09:05");
check("23:30 Bremen bleibt derselbe Tag", E.berlinDatum("2026-11-05T22:30:00Z"), "2026-11-05");
check("00:30 Bremen ist der nächste Tag", E.berlinDatum("2026-11-05T23:30:00Z"), "2026-11-06");

// Beträge
check("Komma", E.parseBetrag("12,50"), 12.5);
check("Tausenderpunkt", E.parseBetrag("1.234,5"), 1234.5);
check("Punkt als Dezimal", E.parseBetrag("89.90"), 89.9);
check("Euro-Zeichen", E.parseBetrag("450 €"), 450);
check("Drei Nachkommastellen ungültig", E.parseBetrag("1,234"), null);
check("Text ungültig", E.parseBetrag("abc"), null);
check("Leer", E.parseBetrag(""), null);

// Prüfung
const jetzt = new Date("2026-11-05T13:00:00Z");
check("Gültig", E.pruefeEinnahme({ betrag: 100, zeitpunktIso: "2026-11-05T12:00:00Z", notiz: "100g Bondings 1B" }, jetzt), null);
check("Betrag fehlt", E.pruefeEinnahme({ betrag: null, zeitpunktIso: "2026-11-05T12:00:00Z", notiz: null }, jetzt) !== null, true);
check("Zukunft", E.pruefeEinnahme({ betrag: 10, zeitpunktIso: "2026-11-05T14:00:00Z", notiz: null }, jetzt) !== null, true);
check("Zu alt", E.pruefeEinnahme({ betrag: 10, zeitpunktIso: "2026-09-01T12:00:00Z", notiz: null }, jetzt) !== null, true);
check("Admin darf älter", E.pruefeEinnahme({ betrag: 10, zeitpunktIso: "2026-09-01T12:00:00Z", notiz: null }, jetzt, E.ADMIN_MAX_TAGE_ZURUECK), null);
check("Admin: Zukunft trotzdem nicht", E.pruefeEinnahme({ betrag: 10, zeitpunktIso: "2026-11-05T14:00:00Z", notiz: null }, jetzt, E.ADMIN_MAX_TAGE_ZURUECK) !== null, true);

// Storno
check("Eigener Eintrag von heute", E.darfMitarbeiterStornieren({ employeeId: "a", storniertAm: null, erfasstAm: "2026-11-05T08:00:00Z" }, "a", jetzt), true);
check("Fremder Eintrag", E.darfMitarbeiterStornieren({ employeeId: "b", storniertAm: null, erfasstAm: "2026-11-05T08:00:00Z" }, "a", jetzt), false);
check("Von gestern", E.darfMitarbeiterStornieren({ employeeId: "a", storniertAm: null, erfasstAm: "2026-11-04T08:00:00Z" }, "a", jetzt), false);
check("Schon storniert", E.darfMitarbeiterStornieren({ employeeId: "a", storniertAm: "2026-11-05T09:00:00Z", erfasstAm: "2026-11-05T08:00:00Z" }, "a", jetzt), false);

// Summen
const z = (o) => ({ id: "x", employeeId: "a", employeeName: "Dana", artName: "Hochsetzen", bereich: "salon", betrag: 100, zeitpunkt: "2026-11-05T10:00:00Z", notiz: null, storniertAm: null, storniertVon: null, ...o });
const s = E.summiere([
  z({}),
  z({ bereich: "verkauf", betrag: 49.9 }),
  z({ employeeId: "b", employeeName: "Tanja", betrag: 300 }),
  z({ betrag: 999, storniertAm: "2026-11-05T11:00:00Z" }),
  z({ betrag: 50, zeitpunkt: "2026-11-05T22:30:00Z" }),
  z({ employeeId: "b", employeeName: "Tanja", bereich: "verkauf", betrag: 20, zeitpunkt: "2026-11-04T10:00:00Z" }),
  z({ bereich: "ausgabe", betrag: 12.5, artName: "Getränke & Snacks" }),
  z({ bereich: "ausgabe", betrag: 80, storniertAm: "2026-11-05T11:00:00Z" }),
]);
check("Summe (ohne Storno, Ausgaben getrennt)", s.summe, { gesamt: 519.9, verkauf: 69.9, salon: 450, ausgaben: 12.5, saldo: 507.4, anzahl: 6 });
check("Je Mitarbeiter absteigend", s.proMitarbeiter.map((m) => [m.name, m.gesamt, m.verkauf, m.salon, m.ausgaben]), [["Tanja", 320, 20, 300, 0], ["Dana", 199.9, 49.9, 150, 12.5]]);
check("Je Tag (Bremer Datum, neueste zuerst)", s.proTag.map((t) => [t.datum, t.gesamt, t.ausgaben, t.saldo]), [["2026-11-05", 499.9, 12.5, 487.4], ["2026-11-04", 20, 0, 20]]);
check("Tag × Mitarbeiter nur Einnahmen", s.proTag[0].proMitarbeiter, { a: 199.9, b: 300 });
const nurAusgabe = E.summiere([z({ bereich: "ausgabe", betrag: 30 })]);
check("Nur Ausgabe → Saldo negativ", nurAusgabe.summe, { gesamt: 0, verkauf: 0, salon: 0, ausgaben: 30, saldo: -30, anzahl: 1 });

console.log(`salon-einnahmen: PASS: ${pass} ok, ${fail} Fehler`);
if (fail) { console.log(fails.join("\n")); process.exit(1); }
