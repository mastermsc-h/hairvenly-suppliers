/**
 * SMOKE-TEST: Rechnungen der Seite /finances/steuertipps (src/lib/finanzen/steuertipps.ts)
 *
 * KERN-INVARIANTEN:
 *  - Ersparnis = taxChain(Gewinn) − taxChain(Gewinn − Abzug): 0 bei 0 €, monoton steigend.
 *  - Grenzsteuersatz bei ~445 T€ Gewinn (Bremen, Hebesatz 460): 45 % ESt + Soli − § 35 + GewSt ≈ 49 %.
 *  - SV auf Einmalzahlungen nur bis zur anteiligen Jahres-BBG.
 *  - Rechtsformvergleich: Einzelunternehmen = taxChain; GmbH-Firmensteuer ≈ 31,9 % bei Hebesatz 460.
 *
 * Run:  node scripts/smoke/steuertipps.spec.mjs
 */
import { readFileSync } from "fs";
import path from "path";
import ts from "typescript";

const tr = (f) =>
  ts.transpileModule(readFileSync(path.resolve(process.cwd(), f), "utf8"), { compilerOptions: { module: "ESNext", target: "ES2022" } }).outputText;
const dataUrl = (js) => "data:text/javascript;base64," + Buffer.from(js).toString("base64");
const steuerUrl = dataUrl(tr("src/lib/finanzen/steuerrechnung.ts"));
const S = await import(steuerUrl);
const T = await import(dataUrl(tr("src/lib/finanzen/steuertipps.ts").replace(/from\s+["']\.\/steuerrechnung["']/g, `from "${steuerUrl}"`)));

let pass = 0, fail = 0; const fails = [];
function check(name, ok, info = "") {
  if (ok) pass++;
  else { fail++; fails.push(`[X] ${name} ${info}`); }
}
const HS = 460, FB = 24_500, J = 2026;

// Ersparnis
check("Abzug 0 → 0 gespart", T.ersparnis(445_000, 0, HS, FB, J).gespart === 0);
const e10 = T.ersparnis(445_000, 10_000, HS, FB, J).gespart;
const e20 = T.ersparnis(445_000, 20_000, HS, FB, J).gespart;
check("monoton", e20 > e10 && e10 > 0, `${e10} ${e20}`);
const gs = T.grenzsatz(445_000, HS, FB, J);
check("Grenzsatz 445k ≈ 47–50 %", gs > 0.47 && gs < 0.5, `${gs}`);
check("Ersparnis = Differenz taxChain", Math.abs(e10 - (S.taxChain(445_000, HS, FB, J).steuerGesamt - S.taxChain(435_000, HS, FB, J).steuerGesamt)) < 0.01);
check("kein Gewinn → keine Ersparnis", T.ersparnis(0, 5_000, HS, FB, J).gespart === 0);

// SV Einmalzahlung
const svKlein = T.svEinmalzahlung(1_000, 3_000, 11);
check("kleiner Bonus voll SV-pflichtig", svKlein.pflichtRv === 1_000 && svKlein.pflichtKv === 1_000);
const svHoch = T.svEinmalzahlung(10_000, 6_000, 11);
check("Gehalt über KV-BBG → keine KV auf Bonus", svHoch.pflichtKv === 0, JSON.stringify(svHoch));
check("Gehalt unter RV-BBG → RV bis Raum", svHoch.pflichtRv === Math.min(10_000, 8_450 * 11 - 6_000 * 11));
const svMittel = T.svEinmalzahlung(10_000, 5_000, 11);
check("KV nur bis anteilige BBG", Math.abs(svMittel.pflichtKv - (5_812.5 * 11 - 55_000)) < 0.01, JSON.stringify(svMittel));

// Bonus
const b = T.bonusRechnung({ personen: 2, betrag: 10_000, monate: [11, 12], monatsgehalt: 4_500, gewinn: 445_000, hebesatz: HS, freibetrag: FB, jahr: J });
check("Bonus gesamt 40k", b.bonusGesamt === 40_000);
check("Aufwand = Bonus + AG-SV", Math.abs(b.aufwand - (40_000 + b.agSv)) < 0.01);
check("Firma spart ~ Grenzsatz", b.steuerGespart > b.aufwand * 0.45 && b.steuerGespart < b.aufwand * 0.5, `${b.steuerGespart} / ${b.aufwand}`);
check("Netto Manager < Brutto", b.nettoJePerson > 8_000 && b.nettoJePerson < 15_000, `${b.nettoJePerson}`);

// Rechtsformen
check("KSt 2026/2027 15 %", T.kstSatz(2026) === 0.15 && T.kstSatz(2027) === 0.15);
check("KSt 2028 14 %, 2032 10 %", Math.abs(T.kstSatz(2028) - 0.14) < 1e-9 && Math.abs(T.kstSatz(2032) - 0.1) < 1e-9 && T.kstSatz(2040) === 0.1);
const rv = T.rechtsformVergleich({ gewinn: 445_000, gfGehalt: 0, ausschuettungsQuote: 0, hebesatz: HS, freibetrag: FB, jahr: J });
check("EU = taxChain", Math.abs(rv[0].sofort - S.taxChain(445_000, HS, FB, J).steuerGesamt) < 0.01);
const firmaQuote = rv[1].sofort / 445_000;
check("GmbH thesauriert ≈ 31,9 %", firmaQuote > 0.315 && firmaQuote < 0.322, `${firmaQuote}`);
check("Holding ohne Ausschüttung > GmbH (5 %-Anteil)", rv[2].sofort > rv[1].sofort);
const rv2 = T.rechtsformVergleich({ gewinn: 445_000, gfGehalt: 120_000, ausschuettungsQuote: 1, hebesatz: HS, freibetrag: FB, jahr: J });
check("Vollausschüttung: sofort = gesamtBeiVoll", Math.abs(rv2[1].sofort - rv2[1].gesamtBeiVollausschuettung) < 0.01);
check("netto + Steuer = Gewinn", Math.abs(rv2[1].netto + rv2[1].sofort - 445_000) < 0.01);

if (fails.length) console.log(fails.join("\n"));
console.log(`steuertipps: ${fail ? "FAIL" : "PASS"}: ${pass} ok, ${fail} Fehler`);
if (fail) process.exit(1);
