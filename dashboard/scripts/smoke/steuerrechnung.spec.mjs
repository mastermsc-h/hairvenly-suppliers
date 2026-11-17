/**
 * SMOKE-TEST: ESt/GewSt-Kette (src/lib/finanzen/steuerrechnung.ts)
 *
 * KERN-INVARIANTEN (Einzelunternehmen):
 *  - Die Gewerbesteuer ist KEINE Betriebsausgabe (§ 4 Abs. 5b EStG): zvE = Gewinn.
 *  - GewSt-Anrechnung auf die ESt = 4,0 × Messbetrag (§ 35 EStG), max. die GewSt selbst.
 *    (Bug bis 17.11.2026: 3,8 % vom Gewinn + GewSt vom zvE abgezogen → ESt ~11 T€ zu hoch.)
 *  - Tarif je Jahr (§ 32a), stetig an den Zonengrenzen; Soli mit Freigrenze.
 *
 * Run:  node scripts/smoke/steuerrechnung.spec.mjs
 */
import { readFileSync } from "fs";
import path from "path";
import ts from "typescript";

const js = ts.transpileModule(readFileSync(path.resolve(process.cwd(), "src/lib/finanzen/steuerrechnung.ts"), "utf8"), {
  compilerOptions: { module: "ESNext", target: "ES2022" },
}).outputText;
const S = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));

let pass = 0, fail = 0; const fails = [];
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++;
  else { fail++; fails.push(`[X] ${name}: erwartet ${e}, bekam ${a}`); }
}
const near = (name, a, e, tol = 1) => check(name, Math.abs(a - e) <= tol, true) || (Math.abs(a - e) > tol && fails.push(`    ${name}: ${a} vs ${e}`));

// Tarif 2026
check("ESt 2026 Grundfreibetrag", S.calcESt(12_348, 2026), 0);
check("ESt 2026 Spitzensatz", S.calcESt(393_264, 2026), 157_498);
check("ESt 2026 42%-Zone", S.calcESt(100_000, 2026), Math.floor(0.42 * 100_000 - 11_135.63));
// Stetigkeit an den Zonengrenzen (Tarif-Konstanten zueinander passend)
for (const j of [2024, 2025, 2026]) {
  for (const g of [17_443, 17_005, 17_799, 66_760, 68_480, 69_878, 277_825]) {
    near(`Tarif ${j} stetig bei ${g}`, S.calcESt(g + 1, j) - S.calcESt(g, j), 0.45, 1.5);
  }
}
check("Jahr nach dem neuesten Tarif = neuester Tarif", S.calcESt(200_000, 2030), S.calcESt(200_000, 2026));

// Soli
check("Soli unter Freigrenze 0", S.calcSoli(20_000, 2026), 0);
near("Soli voll", S.calcSoli(100_000, 2026), 5_500, 0.01);

// Kette
const t = S.taxChain(393_264, 460, 24_500, 2026);
check("GewSt-Ertrag auf 100 abgerundet", t.gewstBasis, 393_200 - 24_500);
near("GewSt", t.gewstJahr, 368_700 * 0.035 * 4.6, 0.01);
check("zvE = Gewinn (GewSt nicht abziehbar)", t.zvE, 393_264);
near("Anrechnung = 4,0 × Messbetrag", t.gewstAnrechnung, 368_700 * 0.035 * 4, 0.01);
near("ESt gesamt", Math.round(t.estGesamt), Math.round((157_498 - 51_618) * 1.055), 1);
// Anrechnung nie höher als GewSt (niedriger Hebesatz)
const t2 = S.taxChain(200_000, 300, 24_500, 2026);
near("Anrechnung max. GewSt", t2.gewstAnrechnung, t2.gewstJahr, 0.01);
// Kleiner Gewinn: keine negative Steuer
const t3 = S.taxChain(10_000, 460, 24_500, 2026);
check("kleiner Gewinn: Steuer 0", t3.steuerGesamt, 0);
const t4 = S.taxChain(-5_000, 460, 24_500, 2026);
check("Verlust: Steuer 0", t4.steuerGesamt, 0);

console.log(`steuerrechnung: PASS: ${pass} ok, ${fail} Fehler`);
if (fail) { console.log(fails.join("\n")); process.exit(1); }
