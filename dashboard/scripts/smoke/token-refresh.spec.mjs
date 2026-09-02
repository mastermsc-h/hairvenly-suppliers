/**
 * SMOKE-TEST: token-refresh.ts — wann wird der IG-Token erneuert?
 *
 * KERN-INVARIANTE: Ein <24h alter Token wird NIE erneuert (IG lehnt ab),
 * und ein Token nahe Ablauf wird IMMER erneuert (darf nie ablaufen wie am
 * 15.07.2026 passiert).
 *
 * Run:  node scripts/smoke/token-refresh.spec.mjs
 */
import { readFileSync } from "fs";
import path from "path";
import ts from "typescript";

const tsPath = path.resolve(process.cwd(), "src/lib/messaging/token-refresh.ts");
const js = ts.transpileModule(readFileSync(tsPath, "utf8"), {
  compilerOptions: { module: "ESNext", target: "ES2022" },
}).outputText;
const { shouldRefresh } = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));

let pass = 0, fail = 0; const fails = [];
function check(name, actual, expected) {
  if (actual === expected) pass++;
  else { fail++; fails.push(`[X] ${name}: erwartet ${expected}, bekam ${actual}`); }
}

const now = new Date("2026-09-02T12:00:00Z");
const daysAgo = (n) => new Date(now.getTime() - n * 86400000);
const daysAhead = (n) => new Date(now.getTime() + n * 86400000);

// ── <24h alt → NIEMALS erneuern (IG-Regel) ──────────────────────────────
check("frisch geseedet (0h) → nein", shouldRefresh(now, now, daysAhead(60)), false);
check("12h alt → nein", shouldRefresh(now, daysAgo(0.5), daysAhead(60)), false);

// ── Normaler Alltag ─────────────────────────────────────────────────────
check("2 Tage alt, 58 Tage Rest → noch nicht", shouldRefresh(now, daysAgo(2), daysAhead(58)), false);
check("25 Tage seit Refresh → ja (monatlich)", shouldRefresh(now, daysAgo(25), daysAhead(35)), true);
check("26 Tage seit Refresh → ja", shouldRefresh(now, daysAgo(26), daysAhead(34)), true);

// ── Notfall-Schwelle: Restlaufzeit knapp → erneuern ─────────────────────
check("nur 20 Tage Rest → ja", shouldRefresh(now, daysAgo(5), daysAhead(20)), true);
check("nur 10 Tage Rest → ja", shouldRefresh(now, daysAgo(3), daysAhead(10)), true);
check("21 Tage Rest, 5 Tage alt → noch nicht", shouldRefresh(now, daysAgo(5), daysAhead(21)), false);

// ── Randfälle ───────────────────────────────────────────────────────────
check("kein refreshedAt → ja (sicherheitshalber)", shouldRefresh(now, null, daysAhead(60)), true);
check("kein expiresAt bekannt, 25 Tage alt → ja", shouldRefresh(now, daysAgo(25), null), true);
check("kein expiresAt, 3 Tage alt → nein", shouldRefresh(now, daysAgo(3), null), false);

console.log("=== TOKEN-REFRESH SMOKE-TEST ===");
console.log(`PASS: ${pass} / ${pass + fail}`);
if (fail > 0) { fails.forEach(f => console.log(f)); process.exit(1); }
console.log("ALLE BESTANDEN — Token wird rechtzeitig erneuert, nie <24h, läuft nie ab.");
