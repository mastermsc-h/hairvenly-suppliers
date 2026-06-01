/**
 * SMOKE-TEST: detect-price-hallucination.ts
 * Sichert ab, dass geratene Preise (ohne get_price-Tool) als Draft markiert
 * werden, echte Tool-Antworten + Nicht-Preis-Texte aber durchgehen.
 *
 * Run: node scripts/smoke/price-hallucination.spec.mjs
 */
import { readFileSync } from "fs";
import path from "path";
import ts from "typescript";

const src = readFileSync(path.resolve(process.cwd(), "src/lib/chatbot/detect-price-hallucination.ts"), "utf8");
const js = ts.transpileModule(src, { compilerOptions: { module: "ESNext", target: "ES2022" } }).outputText;
const mod = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
const { detectPriceHallucination } = mod;

let pass = 0, fail = 0; const fails = [];
function check(name, got, exp) { if (got === exp) pass++; else { fail++; fails.push(`[X] ${name}: erwartet ${exp}, bekam ${got}`); } }

// A) VERDÄCHTIG (Preis genannt, KEIN get_price) → suspicious=true → Force-Draft
const SUSPICIOUS = [
  // DER echte Screenshot-Bug: "beide gleich teuer" mit Zahlen, ohne Tool
  ["Screenshot-Bug Russisch", "Russisch Glatt 60cm: 175g = 507,50€, 200g = 580€", []],
  ["Screenshot-Bug Usbekisch", "Usbekisch Wellig 55cm: 175g = 330,75€", []],
  ["Preis pro Pack geraten", "Tapes kosten 72,50€ pro Packung", []],
  ["Verlängerung Gesamtpreis", "Die Tape-Verlängerung liegt bei 540€ inklusive Styling", []],
  ["Bonding-Preis", "Für 150g Bondings zahlst du insgesamt 435€", []],
  ["nur falsches Tool genutzt", "Standard Tapes 60cm kosten 119€ pro Packung", ["get_stock_eta"]],
  // QUALITATIVE Preisaussagen OHNE Zahl — der echte Screenshot-Bug 01.06
  ["Screenshot 'Preis ist gleich'", "Genau, der Preis ist gleich 💕 Beide Linien (Russisch glatt und Usbekisch wellig) kosten das Gleiche", []],
  ["beide gleich teuer", "Wellig und glatt sind gleich teuer bei den Tapes", []],
  ["Usbekisch günstiger geraten", "Usbekisch wellig ist etwas günstiger als Russisch glatt", []],
  ["Russisch teurer geraten", "Russisch glatt ist teurer als die wellige Linie", []],
  ["kein Preisunterschied", "Bei den Tapes gibt's preislich keinen Unterschied zwischen den Linien", []],
];
for (const [name, text, tools] of SUSPICIOUS) check("SUSPICIOUS " + name, detectPriceHallucination(text, tools).suspicious, true);

// B) OK (kein Force-Draft nötig)
const OK = [
  // get_price wurde genutzt → vertrauen
  ["mit get_price", "Russisch Glatt 175g = 507,50€", ["get_price"]],
  ["mit salon-tool", "Das Einsetzen kostet 180€", ["get_salon_service_price"]],
  // Versandkosten-Schwelle ist kein Produktpreis
  ["Versand-Schwelle", "Ab 150€ Bestellwert ist der Versand kostenlos 💕", []],
  ["Gratis-Versand", "Versandkostenfrei ab 150€", []],
  // Keine Euro-Beträge
  ["nur Gramm/Länge", "Du brauchst ca. 150g in 55cm, also 6 Packungen", []],
  ["reine Klärungsfrage", "Magst du Russisch glatt oder Usbekisch wellig? Welche Länge?", []],
  ["Methoden-Info ohne Preis", "Tapes gibt es in beiden Linien, Bondings auch", []],
  ["nur Begrüßung", "Hi Liebes 💕 wie kann ich dir helfen?", []],
  // Qualitative Aussagen MIT get_price → ok (Bot hat verifiziert)
  ["günstiger MIT tool", "Usbekisch wellig ist günstiger — 47,25€ vs 72,50€ pro Pack", ["get_price"]],
  // Qualitativer Preisvergleich OHNE Linien-/Produktbezug → kein Force-Draft
  // (z.B. allgemeine Aussage, nicht über unsere Verkaufspreise)
  ["Haltbarkeit gleich (kein Preis)", "Die Pflege ist bei beiden gleich aufwendig", []],
  ["Struktur-Vergleich", "Usbekisch ist leichter als Russisch", []],
];
for (const [name, text, tools] of OK) check("OK " + name, detectPriceHallucination(text, tools).suspicious, false);

const report =
  `\n=== PREIS-HALLUZINATION SMOKE-TEST ===\n` +
  `PASS: ${pass} / ${pass + fail}\n` +
  (fail > 0 ? `\nFEHLER (${fail}):\n` + fails.map(f => "  " + f).join("\n") + "\n"
            : "ALLE BESTANDEN — geratene Preise werden geflaggt, echte Tool-Antworten durchgelassen.\n");
process.stdout.write(report, () => { process.exitCode = fail > 0 ? 1 : 0; });
