/**
 * SMOKE-TEST: cache-stability.ts — Lernen↔Cache-Entkopplung (Schritt B).
 *
 * KERN-INVARIANTE: consolidated + fresh = ALLE Rows. Es darf NIE Wissen
 * verloren gehen oder doppelt landen — sonst würde der Bot bei kritischen
 * Fragen (Preise, Pflege, Methoden) plötzlich ohne eine FAQ antworten.
 *
 * Run:  node scripts/smoke/cache-stability.spec.mjs
 * Läuft gegen das ECHTE Modul (zur Laufzeit transpiliert), keine Kopie.
 */
import { readFileSync } from "fs";
import path from "path";
import ts from "typescript";

const tsPath = path.resolve(process.cwd(), "src/lib/chatbot/cache-stability.ts");
const src = readFileSync(tsPath, "utf8");
const js = ts.transpileModule(src, {
  compilerOptions: { module: "ESNext", target: "ES2022" },
}).outputText;
const mod = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
const { stableCutoffIso, splitByCacheCutoff } = mod;

let pass = 0, fail = 0;
const fails = [];
function check(name, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { pass++; }
  else { fail++; fails.push(`[X] ${name}: erwartet ${JSON.stringify(expected)}, bekam ${JSON.stringify(actual)}`); }
}

// ── Cutoff-Determinismus ────────────────────────────────────────────────
// Morgens und abends desselben Tages → IDENTISCHER Cutoff (sonst bräche der
// Cache mitten am Tag).
check("Cutoff 09:00 == 23:59 (gleicher Tag)",
  stableCutoffIso(new Date("2026-06-09T09:00:00Z")),
  stableCutoffIso(new Date("2026-06-09T23:59:59Z")));
check("Cutoff ist UTC-Mitternacht",
  stableCutoffIso(new Date("2026-06-09T15:30:00Z")), "2026-06-09T00:00:00.000Z");
check("Tageswechsel ändert Cutoff genau 1×",
  stableCutoffIso(new Date("2026-06-10T00:00:01Z")), "2026-06-10T00:00:00.000Z");

// ── Split-Logik ─────────────────────────────────────────────────────────
const CUT = "2026-06-09T00:00:00.000Z";
const rows = [
  { slug: "alt",          created_at: "2026-05-01T10:00:00Z", updated_at: "2026-05-01T10:00:00Z" }, // alt → stable
  { slug: "gestern",      created_at: "2026-06-08T23:59:59Z", updated_at: null },                    // vor Cutoff → stable
  { slug: "heute-neu",    created_at: "2026-06-09T08:00:00Z", updated_at: null },                    // heute → fresh
  { slug: "mitternacht",  created_at: "2026-06-09T00:00:00.000Z", updated_at: null },                // exakt Cutoff → fresh (>=)
  { slug: "alt-editiert", created_at: "2026-04-01T10:00:00Z", updated_at: "2026-06-09T12:00:00Z" }, // heute editiert → fresh
  { slug: "ohne-ts" },                                                                               // kein Timestamp → stable (deterministisch)
];
const { consolidated, fresh } = splitByCacheCutoff(rows, CUT);

check("alt → stable", consolidated.some(r => r.slug === "alt"), true);
check("gestern → stable", consolidated.some(r => r.slug === "gestern"), true);
check("heute-neu → fresh", fresh.some(r => r.slug === "heute-neu"), true);
check("exakt Mitternacht → fresh", fresh.some(r => r.slug === "mitternacht"), true);
check("altes Element heute editiert → fresh (Edit bricht stable nicht erneut)", fresh.some(r => r.slug === "alt-editiert"), true);
check("ohne Timestamp → stable (deterministisch)", consolidated.some(r => r.slug === "ohne-ts"), true);

// ── KERN-INVARIANTE: nichts verloren, nichts doppelt ────────────────────
check("VOLLSTÄNDIGKEIT: consolidated + fresh = alle", consolidated.length + fresh.length, rows.length);
const allSlugs = new Set([...consolidated, ...fresh].map(r => r.slug));
check("KEINE DUPLIKATE/VERLUSTE: jede Row genau 1×", allSlugs.size, rows.length);

// Leere Liste / Stabilität
const empty = splitByCacheCutoff([], CUT);
check("leere Liste → leer/leer", [empty.consolidated.length, empty.fresh.length], [0, 0]);
// Zweiter Lauf identisch (Determinismus — stable Block bleibt byte-gleich)
const again = splitByCacheCutoff(rows, CUT);
check("Determinismus: zweiter Lauf identisch", again.consolidated.map(r => r.slug), consolidated.map(r => r.slug));

console.log("=== CACHE-STABILITY SMOKE-TEST ===");
console.log(`PASS: ${pass} / ${pass + fail}`);
if (fail > 0) { fails.forEach(f => console.log(f)); process.exit(1); }
console.log("ALLE BESTANDEN — Lernen kostet keinen Cache mehr, Wissen geht nie verloren.");
