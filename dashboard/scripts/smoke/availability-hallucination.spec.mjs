/**
 * SMOKE-TEST: detect-availability-hallucination.ts
 * Run: node scripts/smoke/availability-hallucination.spec.mjs
 */
import { readFileSync } from "fs";
import path from "path";
import ts from "typescript";
const src = readFileSync(path.resolve(process.cwd(), "src/lib/chatbot/detect-availability-hallucination.ts"), "utf8");
const js = ts.transpileModule(src, { compilerOptions: { module: "ESNext", target: "ES2022" } }).outputText;
const mod = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
const { detectAvailabilityHallucination } = mod;

let pass = 0, fail = 0; const fails = [];
function check(name, got, exp) { if (got === exp) pass++; else { fail++; fails.push(`[X] ${name}: erwartet ${exp}, bekam ${got}`); } }

// Tool-Results
const OOS = [{ name: "get_stock_eta", content: '{"status":"out_of_stock_no_eta","message":"ausverkauft"}' }];
const NOT_CATALOG = [{ name: "get_stock_eta", content: '{"status":"not_in_catalog"}' }];
const AVAIL_COLORS = [{ name: "get_available_colors", content: '{"status":"ok","message":"2 Farben gefunden"}' }];
const IN_STOCK = [{ name: "get_stock_eta", content: '{"status":"in_stock","availability_level":"comfortable"}' }];
const IN_STOCK_LOW = [{ name: "get_stock_eta", content: '{"status":"in_stock_low","available_grams":25}' }];
const MULTI_WITH = [{ name: "get_stock_eta", content: '{"status":"multi_length_results","per_length":{"55cm":{"in_stock":[{"product":"x"}]}}}' }];
const MULTI_WITHOUT = [{ name: "get_stock_eta", content: '{"status":"multi_length_results","per_length":{"55cm":{"in_stock":[],"oos":[{"product":"x"}]}}}' }];

// VERDÄCHTIG: Verfügbarkeit behauptet, KEIN in-stock-Beleg → true
check("Mocha-Melt-Bug (oos + avail_colors)", detectAvailabilityHallucination(
  "ABER: Wir hätten die Mocha Melt in 55cm wellig sofort verfügbar! Die ist nur 10cm kürzer.",
  [...OOS, ...AVAIL_COLORS]).suspicious, true);
check("nur get_available_colors", detectAvailabilityHallucination(
  "Die Farbe ist verfügbar in 55cm 💕", AVAIL_COLORS).suspicious, true);
check("not_in_catalog + claim", detectAvailabilityHallucination(
  "Haben wir sofort da!", NOT_CATALOG).suspicious, true);
check("gar keine tools + claim", detectAvailabilityHallucination(
  "Die 55cm sind aktuell verfügbar.", []).suspicious, true);
check("multi ohne in_stock", detectAvailabilityHallucination(
  "In 55cm sofort verfügbar.", MULTI_WITHOUT).suspicious, true);

// OK: in-stock-Beleg vorhanden → false
check("in_stock vorhanden", detectAvailabilityHallucination(
  "Die Farbe haben wir sofort da 💕", IN_STOCK).suspicious, false);
check("in_stock_low vorhanden", detectAvailabilityHallucination(
  "Haben wir noch da — schau schnell.", IN_STOCK_LOW).suspicious, false);
check("multi MIT in_stock", detectAvailabilityHallucination(
  "In 55cm sofort verfügbar 💕", MULTI_WITH).suspicious, false);

// OK: keine Verfügbarkeits-Behauptung → false (auch ohne Beleg)
check("ehrliche oos-Antwort", detectAvailabilityHallucination(
  "Die 65cm sind leider ausverkauft, kein Liefertermin.", OOS).suspicious, false);
check("nur Beratung/Frage", detectAvailabilityHallucination(
  "Magst du eine andere Länge? Welche Farbe schwebt dir vor?", []).suspicious, false);
check("ETA-Antwort", detectAvailabilityHallucination(
  "Kommt ca. Anfang Juni wieder rein.", OOS).suspicious, false);

const report =
  `\n=== AVAILABILITY-HALLUCINATION SMOKE-TEST ===\n` +
  `PASS: ${pass} / ${pass + fail}\n` +
  (fail > 0 ? `\nFEHLER (${fail}):\n` + fails.map(f => "  " + f).join("\n") + "\n"
            : "ALLE BESTANDEN — Verfügbarkeit ohne Lagerbeleg wird geflaggt, echte Belege durchgelassen.\n");
process.stdout.write(report, () => { process.exitCode = fail > 0 ? 1 : 0; });
