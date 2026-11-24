/**
 * SMOKE-TEST: detect-weekday-mismatch.ts
 *
 * BUG 24.11.2026: „Unsere Black Friday Aktion startet am 27. November und
 * läuft bis zum 30. November — also ab Mittwoch geht's los!" (27.11.2026 =
 * Freitag). Wochentag neben Datum muss stimmen, sonst Entwurf.
 *
 * Run:  node scripts/smoke/weekday-mismatch.spec.mjs
 */
import { readFileSync } from "fs";
import path from "path";
import ts from "typescript";

const src = readFileSync(path.resolve(process.cwd(), "src/lib/chatbot/detect-weekday-mismatch.ts"), "utf8");
const js = ts.transpileModule(src, { compilerOptions: { module: "ESNext", target: "ES2022" } }).outputText;
const { detectWeekdayMismatch: W } = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));

let pass = 0, fail = 0; const fails = [];
function check(name, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass++;
  else { fail++; fails.push(`[X] ${name}: erwartet ${JSON.stringify(expected)}, bekam ${JSON.stringify(actual)}`); }
}
const T = "2026-11-24";
check("echter Fall: „ab Mittwoch“ für 27.11. → verdächtig", W("Unsere Black Friday Aktion startet am 27. November und läuft bis zum 30. November — also ab Mittwoch geht's los!", T).suspicious, true);
check("richtig: Freitag, 27.11.", W("Black Friday startet am Freitag, 27.11. 💕", T).suspicious, false);
check("richtig: Montag 30.11.2026", W("läuft bis Montag, 30.11.2026", T).suspicious, false);
check("falsch: Dienstag, 06.11.2026 (= Freitag)", W("kommt ca. Dienstag, 06.11.2026 wieder rein", T).suspicious, true);
check("Öffnungszeiten Montag bis Freitag neben Datum → ok", W("Ab 06.11. wieder da — wir haben Montag bis Freitag 10–18 Uhr geöffnet", T).suspicious, false);
check("„montags“ (Gewohnheit) → ok", W("Versand ab 02.12., montags packen wir besonders viel", T).suspicious, false);
check("Wochentag ohne Datum → ok", W("Am Freitag geht's los 💕", T).suspicious, false);
check("Datum weit weg vom Wochentag → ok", W("Kommt am 06.12. " + "x".repeat(200) + " Am Montag sind wir wieder da", T).suspicious, false);
check("Jahreswechsel: Freitag, 08.01. (2027) → ok", W("kommt Freitag, 08.01. wieder", T).suspicious, false);
check("Plural-Bindestrich Mo–Fr unberührt", W("am 27.11. — Mo–Fr erreichbar", T).suspicious, false);

console.log("=== WOCHENTAG-GUARD SMOKE-TEST ===");
console.log(`PASS: ${pass} / ${pass + fail}`);
if (fail > 0) { fails.forEach((f) => console.log(f)); process.exit(1); }
console.log("ALLE BESTANDEN — Wochentage neben Datumsangaben müssen stimmen.");
