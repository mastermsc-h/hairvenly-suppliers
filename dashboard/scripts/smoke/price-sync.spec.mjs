/**
 * SMOKE-TEST: price-sync.ts — Preise Shopify → chatbot_prices.
 *
 * HINTERGRUND (Analyse 17.11.2026): chatbot_prices stand seit 03.05. still,
 * der Bot nannte in 33 Auto-Antworten zu niedrige Preise (US-Tapes 65cm
 * 49,75 € statt 58,99 €, RU-Tapes 72,50 € statt 81,99 €).
 *
 * KERN-INVARIANTEN:
 *  - Jede Bot-Preiszeile wird aus genau der passenden Shopify-Produktgruppe
 *    abgeleitet (Mini Tape ≠ Tape, Invisible Tape ≠ Tape, Farbmuster raus).
 *  - Unsicheres wird NIE geschrieben (zu wenig Produkte, uneinheitliche
 *    Preise, Sprung > +40 % / < −30 %, kein eindeutiges Produkt) → „check".
 *
 * Run:  node scripts/smoke/price-sync.spec.mjs
 */
import { readFileSync } from "fs";
import path from "path";
import ts from "typescript";

const src = readFileSync(path.resolve(process.cwd(), "src/lib/chatbot/price-sync.ts"), "utf8");
const js = ts.transpileModule(src, { compilerOptions: { module: "ESNext", target: "ES2022" } }).outputText;
const M = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));

let pass = 0, fail = 0; const fails = [];
function check(name, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass++;
  else { fail++; fails.push(`[X] ${name}: erwartet ${JSON.stringify(expected)}, bekam ${JSON.stringify(actual)}`); }
}
const P = (title, price, vt = "Default Title") => ({ title, variants: [{ title: vt, price: String(price) }] });
const many = (n, fn) => Array.from({ length: n }, (_, i) => fn(i));
const get = (d, method, line, cm, g = null) => d.find((x) => x.method === method && x.supplier_line === line && x.length_cm === cm && x.gram_label === g);

// ── Ableitung aus echten Titelformen ──────────────────────────────────────
const products = [
  ...many(5, (i) => P(`#C${i} I Natürliches Schwarzbraun I Echthaar I Standard Tape Extensions I RU Glatt ♡`, 81.99)),
  P("#C9 | Dunkelbraun | Echthaar I Standard Tape Extensions I RU Glatt ♡", 77.89), // Einzel-Sale
  ...many(4, (i) => P(`#A${i} | Warmes Herbstbraun | Echthaar Mini Tape Extensions | RU Glatt ♡`, 152.99)),
  ...many(4, (i) => P(`#B${i} Honigblond | Echthaar Tape Extensions 65 cm | US Wellig ♡`, 58.99, "25 (10 Strähnen)")),
  P("ASCHBRAUNE US WELLIGE TAPE EXTENSIONS 65CM", 58.99, "25 (10 Strähnen)"),
  ...many(4, (i) => P(`#D${i} | Echthaar Invisible Tapes 65 cm | US Wellig ♡`, 72.5)),
  P("Farbmuster Teststrähne Echthaar, usbekisch (2 g)", 3.99, "#2 Schokobraune"),
  ...many(4, (i) => ({ title: `#E${i} | Echthaar Invisible Clip Extensions ♡`, variants: [{ title: "100g", price: "159.00" }, { title: "150g", price: "225.00" }, { title: "225g", price: "330.00" }] })),
  ...many(4, (i) => P(`#F${i} | Echthaar Butterfly Tressen 65 cm | US Wellig ♡`, 134.99)),
  ...many(4, (i) => P(`#G${i} | Echthaar Butterfly Tressen | RU Glatt ♡`, 204.99)),
  ...many(3, (i) => P(`#H${i} | Echthaar Keratin Bondings 85 cm | US Wellig ♡`, 78.99, "25 (25 Strähnen)")),
  ...many(3, (i) => P(`#I${i} | Echthaar Bondings | RU Glatt 1g ♡`, 81.99)),
];
const d = M.derivePrices(products);
check("RU Tape: häufigster Preis, Sale ignoriert", get(d, "tape", "amanda", 60).price, 81.99);
check("RU Tape: Mini Tapes NICHT mitgezählt", get(d, "tape", "amanda", 60).support, 6);
check("Mini Tape eigene Zeile", get(d, "mini_tape", "amanda", 60).price, 152.99);
check("US Tape 65: inkl. GROSSBUCHSTABEN-Titel, ohne Invisible Tapes", get(d, "tape", "ebru", 65).support, 5);
check("US Tape 65 Preis", get(d, "tape", "ebru", 65).price, 58.99);
check("US Tape 45: keine Produkte → support 0", get(d, "tape", "ebru", 45).support, 0);
check("Clip-in 150g: nur 150g-Variante", get(d, "clip_in", "amanda", 60, "150g").price, 225);
check("Clip-in 225g", get(d, "clip_in", "amanda", 60, "225g").price, 330);
check("invisible_tape Amanda = Butterfly RU (nicht US)", get(d, "invisible_tape", "amanda", 60).price, 204.99);
check("invisible_tape Ebru: bewusst keine Regel", get(d, "invisible_tape", "ebru", 65), undefined);
check("Bondings 85 US", get(d, "bondings", "ebru", 85).price, 78.99);
check("Bondings RU", get(d, "bondings", "amanda", 60).price, 81.99);
check("Bondings 65 US: keine 85er mitgezählt", get(d, "bondings", "ebru", 65).support, 0);

// ── Plan: was darf geschrieben werden? ────────────────────────────────────
const row = (method, line, cm, price, g = null, active = true) => ({ method, supplier_line: line, length_cm: cm, gram_label: g, price_eur: price, active });
const der = (method, line, cm, price, support = 10, agree = 0.95, g = null) => ({ method, supplier_line: line, length_cm: cm, gram_label: g, price, support, agree, samples: [] });
const plan = M.planPriceUpdates(
  [
    row("tape", "ebru", 65, 49.75),            // echter Bug-Fall → update
    row("tape", "amanda", 60, 81.99),          // gleich → unchanged
    row("tape", "ebru", 45, 44.75),            // zu wenig Produkte → check
    row("tape", "ebru", 55, 47.25),            // uneinheitlich → check
    row("mini_tape", "amanda", 60, 100),       // +53 % → check
    row("tressen", "ebru", 65, 200),           // −41 % → check
    row("invisible_tape", "ebru", 65, 195),    // keine Regel → check
    row("ponytail", "ebru", 65, 179.99, "130g", false), // inaktiv → ignoriert
  ],
  [
    der("tape", "ebru", 65, 58.99), der("tape", "amanda", 60, 81.99), der("tape", "ebru", 45, 52.99, 2),
    der("tape", "ebru", 55, 55.99, 10, 0.5), der("mini_tape", "amanda", 60, 152.99), der("tressen", "ebru", 65, 117.99),
  ],
);
const st = (m, l, cm) => plan.find((p) => p.method === m && p.supplier_line === l && p.length_cm === cm)?.status;
check("Bug-Fall 49,75 → 58,99 wird übernommen", plan.find((p) => p.method === "tape" && p.length_cm === 65), { method: "tape", supplier_line: "ebru", length_cm: 65, gram_label: null, old_price: 49.75, status: "update", new_price: 58.99 });
check("gleicher Preis → unchanged", st("tape", "amanda", 60), "unchanged");
check("support < 3 → check", st("tape", "ebru", 45), "check");
check("uneinheitlich → check", st("tape", "ebru", 55), "check");
check("+53 % → check", st("mini_tape", "amanda", 60), "check");
check("−41 % → check", st("tressen", "ebru", 65), "check");
check("keine Regel → check", st("invisible_tape", "ebru", 65), "check");
check("inaktive Zeile ignoriert", plan.length, 7);

// ── FAQ mit alten Preisen ─────────────────────────────────────────────────
const faqs = [
  { id: "1", question: "150g Tape RU?", answer: "6 Packungen à 25g = €435.00 (6 × €72.50)." },
  { id: "2", question: "komma", answer: "kostet 72,50 € pro Packung" },
  { id: "3", question: "größere Zahl", answer: "kostet 172,50 € bzw. 72,55 €" },
  { id: "4", question: "kurz", answer: "nur 72,5 € heute" },
  { id: "5", question: "Summe (echter Fall 17.11.)", answer: "Russisch glatt (60cm) = 435€, Usbekisch wellig (65cm) = 298,50€ (6 Packungen à 25g)" },
  { id: "6", question: "unbeteiligt", answer: "Versand gratis ab 150€" },
];
const hits = M.findStaleFaqPrices(faqs, [72.5]).map((h) => h.id);
check("FAQ: €72.50 / 72,50 / 72,5 / Summe 435 gefunden, 172,50 und 72,55 nicht", hits, ["1", "2", "4", "5"]);
check("FAQ: Summe 6 × 49,75 = 298,50 gefunden", M.findStaleFaqPrices(faqs, [49.75]).map((h) => h.id), ["5"]);
check("FAQ: neutrale Beträge kein Treffer", M.findStaleFaqPrices([faqs[5]], [72.5, 49.75]).length, 0);

console.log("=== PREIS-SYNC SMOKE-TEST ===");
console.log(`PASS: ${pass} / ${pass + fail}`);
if (fail > 0) { fails.forEach((f) => console.log(f)); process.exit(1); }
console.log("ALLE BESTANDEN — Bot-Preise folgen Shopify, Unsicheres wird nie automatisch geschrieben.");
