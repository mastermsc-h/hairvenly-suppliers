/**
 * SMOKE-TEST: force-tool-intent.ts (Schicht 1 — Tool-Zwang)
 * Run: node scripts/smoke/force-tool-intent.spec.mjs
 */
import { readFileSync } from "fs";
import path from "path";
import ts from "typescript";

const src = readFileSync(path.resolve(process.cwd(), "src/lib/chatbot/force-tool-intent.ts"), "utf8");
const js = ts.transpileModule(src, { compilerOptions: { module: "ESNext", target: "ES2022" } }).outputText;
const mod = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
const { decideForcedTool } = mod;

let pass = 0, fail = 0; const fails = [];
function check(name, text, already, expected) {
  const got = decideForcedTool(text, already || []).tool;
  if (got === expected) pass++;
  else { fail++; fails.push(`[X] ${name}: "${text}" → erwartet ${expected}, bekam ${got}`); }
}

// PREIS-Zwang (die echten Screenshot-Fälle 01.06)
check("wie teuer", "bitter cacao. wie teuer ?", [], "get_price");
check("gleicher preis", "und wellig ? ist ja der gleiche preis, oder", [], "get_price");
check("gleich teuer", "also sind wellig und glatt gleich etuer ?", [], "get_price");
check("was kostet", "was kostet 150g tapes?", [], "get_price");
check("preis nachfrage", "wie ist der preis für bitter cacao", [], "get_price");

// VERFÜGBARKEITS-Zwang
check("habt ihr X", "habt ihr bitter cacao noch?", [], "get_stock_eta");
check("auf lager", "ist raw auf lager?", [], "get_stock_eta");
check("wann wieder", "wann kommt butter cream wieder rein?", [], "get_stock_eta");
check("verfügbar", "ist die farbe verfügbar?", [], "get_stock_eta");

// LÄNGEN-Verfügbarkeit
check("in 55cm", "habt ihr das in 55cm?", [], "get_stock_eta");

// KEIN Zwang (Smalltalk / Begrüßung / Dank)
check("begrüßung", "hi, brauche tapes. was habt ihr da?", [], null);  // "was habt ihr" allg. → kein konkretes Produkt/Preis
check("danke", "danke 🥰", [], null);
check("ok", "ok", [], null);
check("struktur-antwort", "beides irgendwie.", [], null);
check("glatt verlängerung", "glatt. will eine verlängerung", [], null);

// KEIN erneuter Zwang wenn Tool schon lief (Endlos-Schutz)
check("preis schon geholt", "wie teuer?", ["get_price"], null);
check("stock schon geholt", "habt ihr das noch?", ["get_stock_eta"], null);

const report =
  `\n=== FORCE-TOOL-INTENT SMOKE-TEST ===\n` +
  `PASS: ${pass} / ${pass + fail}\n` +
  (fail > 0 ? `\nFEHLER (${fail}):\n` + fails.map(f => "  " + f).join("\n") + "\n"
            : "ALLE BESTANDEN — Faktenfragen erzwingen Tool, Smalltalk nicht.\n");
process.stdout.write(report, () => { process.exitCode = fail > 0 ? 1 : 0; });
