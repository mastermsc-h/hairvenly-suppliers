/**
 * SMOKE-TEST: eta-pick.ts — welcher Liefertermin wird dem Bot gegeben?
 *
 * KERN-INVARIANTE (Bug 16.10.2026, Sarah): Der Bot bekommt NIE ein Datum in
 * der Vergangenheit als Ankunftstermin. Es gewinnt der früheste ZUKÜNFTIGE
 * Termin; sind alle überfällig → overdue=true und KEIN Datum.
 *
 * Run:  node scripts/smoke/eta-pick.spec.mjs
 */
import { readFileSync } from "fs";
import path from "path";
import ts from "typescript";

const js = ts.transpileModule(readFileSync(path.resolve(process.cwd(), "src/lib/chatbot/eta-pick.ts"), "utf8"), {
  compilerOptions: { module: "ESNext", target: "ES2022" },
}).outputText;
const { pickEta, parseEtaDate, berlinTodayIso } = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));

let pass = 0, fail = 0; const fails = [];
const check = (n, a, e) => { if (JSON.stringify(a) === JSON.stringify(e)) pass++; else { fail++; fails.push(`[X] ${n}: erwartet ${JSON.stringify(e)}, bekam ${JSON.stringify(a)}`); } };

const TODAY = "2026-10-16";

// ── Echter Fall Sarah: Latte Balayage Clip 225g (Sheet + DB-Override) ────
const latte = [
  { ankunft: "ETA überfällig: 20.08.2026", etaConfirmed: false },
  { ankunft: "ca. Ankunft: 21.10.2026", etaConfirmed: true },   // Amanda 24.07. (DB)
  { ankunft: "ca. Ankunft: 14.10.2026", etaConfirmed: true },   // Amanda 03.08. überfällig
  { ankunft: "ca. Ankunft: 10.11.2026", etaConfirmed: true },   // Amanda 29.09.
];
check("Sarah/Latte → 21.10.2026 (frühester ZUKÜNFTIGER)", pickEta(latte, TODAY).text, "21.10.2026");
check("Sarah/Latte → confirmed", pickEta(latte, TODAY).confirmed, true);
check("Sarah/Latte → nicht overdue", pickEta(latte, TODAY).overdue, false);

// ── Alle Termine überfällig → overdue, KEIN Datum ────────────────────────
const allPast = [{ ankunft: "ETA überfällig: 20.08.2026" }, { ankunft: "ETA überfällig: 06.10.2026" }];
check("alle überfällig → overdue", pickEta(allPast, TODAY).overdue, true);
check("alle überfällig → text null (kein Datum!)", pickEta(allPast, TODAY).text, null);

// ── Heute zählt als zukünftig (kommt heute) ──────────────────────────────
check("ETA = heute → gilt", pickEta([{ ankunft: "ca. Ankunft: 16.10.2026" }], TODAY).text, "16.10.2026");
check("ETA = gestern → overdue", pickEta([{ ankunft: "ca. Ankunft: 15.10.2026" }], TODAY).overdue, true);

// ── Jahreswechsel: Januar nächsten Jahres ist Zukunft ────────────────────
check("05.01.27 → Zukunft", pickEta([{ ankunft: "ca. Ankunft: 05.01.27" }], TODAY).text, "05.01.2027");

// ── Kein Datum / leer ───────────────────────────────────────────────────
check("undatiert → Rohtext", pickEta([{ ankunft: "bald" }], TODAY).text, "bald");
check("leer → null, nicht overdue", pickEta([], TODAY), { text: null, iso: null, confirmed: false, overdue: false });

// ── parseEtaDate ────────────────────────────────────────────────────────
check("parse 6.10.26", parseEtaDate("ETA überfällig: 6.10.26"), { iso: "2026-10-06", text: "06.10.2026" });
check("parse ungültiger Monat → null", parseEtaDate("31.13.2026"), null);
check("berlinTodayIso Format", /^\d{4}-\d{2}-\d{2}$/.test(berlinTodayIso()), true);

console.log("=== ETA-PICK SMOKE-TEST ===");
console.log(`PASS: ${pass} / ${pass + fail}`);
if (fail > 0) { fails.forEach(f => console.log(f)); process.exit(1); }
console.log("ALLE BESTANDEN — kein vergangenes Datum geht als Liefertermin an den Bot.");
