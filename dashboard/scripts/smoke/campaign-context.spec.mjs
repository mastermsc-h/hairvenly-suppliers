/**
 * SMOKE-TEST: campaign-context.ts + IG-Handle in enforceBusinessFacts.
 *
 * BUG 24.11.2026: „Hallo ihr Lieben, wann gibt es den Black Week Rabatt bei
 * euch" → Bot: „haben wir bereits auf Instagram angekündigt … @hairvenly".
 * Aktion war nirgends gepflegt, Profil heißt @hairvenly.de.
 *
 * KERN-INVARIANTEN:
 *  - Der Bot sieht gepflegte Aktionen datumsrichtig (kommt / läuft / beendet).
 *  - Prozente/Codes/„bereits angekündigt" ohne Beleg → Entwurf statt Senden.
 *  - Jedes „@hairvenly…" wird zu @hairvenly.de (E-Mails bleiben unberührt).
 *
 * Run:  node scripts/smoke/campaign-context.spec.mjs
 */
import { readFileSync } from "fs";
import path from "path";
import ts from "typescript";

const load = async (rel, patch = (s) => s) => {
  const src = patch(readFileSync(path.resolve(process.cwd(), rel), "utf8"));
  const js = ts.transpileModule(src, { compilerOptions: { module: "ESNext", target: "ES2022" } }).outputText;
  return import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
};
const C = await load("src/lib/chatbot/campaign-context.ts");
// intent-contact importiert business-config — als data:-Modul einhängen
const cfgJs = ts.transpileModule(readFileSync(path.resolve(process.cwd(), "src/lib/chatbot/business-config.ts"), "utf8"), { compilerOptions: { module: "ESNext", target: "ES2022" } }).outputText;
const cfgUrl = "data:text/javascript;base64," + Buffer.from(cfgJs).toString("base64");
const IC = await load("src/lib/chatbot/intent-contact.ts", (s) => s.replace(/from\s+["']\.\/business-config["']/g, `from ${JSON.stringify(cfgUrl)}`));

let pass = 0, fail = 0; const fails = [];
function check(name, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass++;
  else { fail++; fails.push(`[X] ${name}: erwartet ${JSON.stringify(expected)}, bekam ${JSON.stringify(actual)}`); }
}

const BF = { name: "Black Friday", starts_on: "2026-11-27", ends_on: "2026-11-30", public_info: "Bis zu 30 % Rabatt auf Extensions und Tools (Zubehör)." };
check("23.11.: kommt", C.campaignState(BF, "2026-11-23"), "upcoming");
check("27.11.: läuft", C.campaignState(BF, "2026-11-27"), "running");
check("30.11.: läuft noch", C.campaignState(BF, "2026-11-30"), "running");
check("01.12.: beendet", C.campaignState(BF, "2026-12-01"), "ended");
check("20.12.: nicht mehr erwähnt", C.campaignState(BF, "2026-12-20"), "hidden");
check("ohne public_info nie sichtbar", C.campaignState({ ...BF, public_info: null }, "2026-11-28"), "hidden");
check("mehr als 30 Tage vorher: noch nicht", C.campaignState(BF, "2026-10-20"), "hidden");

const blockBefore = C.buildCampaignBlock([BF], "2026-11-24", "@hairvenly.de");
check("Block vorher: Startdatum + Zeitraum", /startet am 27\.11\.2026 \(27\.11\.2026 bis 30\.11\.2026\)/.test(blockBefore), true);
check("Block vorher: noch nicht gültig", /vorher gilt der Rabatt noch NICHT/.test(blockBefore), true);
check("Block nennt richtigen Handle", blockBefore.includes("@hairvenly.de"), true);
check("leerer Block: keine Aktion eingetragen", /KEINE zeitlich begrenzte Aktion/.test(C.buildCampaignBlock([], "2026-11-24", "@hairvenly.de")), true);

// ── Guard: echte Bot-Antwort vom 23.11. ────────────────────────────────
const realBad = "Hi meine Liebe 💕\n\nUnsere Black Week Aktionen haben wir bereits auf Instagram und über unsere Kanäle angekündigt. Die genauen Rabatte und Konditionen findest du auf unserem Instagram-Profil @hairvenly – da posten wir immer alle aktuellen Aktionen.";
check("echter Fall: „bereits angekündigt“ → verdächtig", C.detectPromoHallucination(realBad, [blockBefore]).suspicious, true);
const good = "Hi Liebes 💕 Unser Black Friday läuft vom 27.11. bis 30.11.2026 — dann gibt's bis zu 30 % auf Extensions und Tools ✨";
check("belegte 30 % → ok", C.detectPromoHallucination(good, [blockBefore]).suspicious, false);
check("erfundene 40 % → verdächtig", C.detectPromoHallucination("Black Friday: 40 % auf alles!", [blockBefore]).suspicious, true);
check("erfundener Code → verdächtig", C.detectPromoHallucination("Mit dem Code BLACK30 sparst du", [blockBefore]).suspicious, true);
check("belegter Code (FAQ) → ok", C.detectPromoHallucination("Mit dem Code HERO20 sparst du", ["Code HERO20 gilt"]).suspicious, false);
check("Prozent ohne Aktions-Kontext (Haaranteil) → ok", C.detectPromoHallucination("Die Haare sind zu 100 % Echthaar", [blockBefore]).suspicious, false);
check("Gewerberabatt 10 % aus FAQ → ok", C.detectPromoHallucination("Als Gewerbekunde bekommst du 10% Rabatt", ["**10% Rabatt** auf Extensions"]).suspicious, false);

// ── IG-Handle ───────────────────────────────────────────────────────────
const fix = (t) => IC.enforceBusinessFacts(t).text;
check("@hairvenly → @hairvenly.de", fix("Profil @hairvenly – da posten wir"), "Profil @hairvenly.de – da posten wir");
check("Satzende-Punkt bleibt", fix("folg uns auf @hairvenly."), "folg uns auf @hairvenly.de.");
check("richtiger Handle unverändert", fix("auf @hairvenly.de!"), "auf @hairvenly.de!");
check("E-Mail unverändert", fix("Mail an kontakt@hairvenly.de"), "Mail an kontakt@hairvenly.de");
check("Fantasie-Handle korrigiert", fix("(@hairvenly_official)"), "(@hairvenly.de)");
check("Profil-URL korrigiert", fix("https://instagram.com/hairvenly hier"), "https://www.instagram.com/hairvenly.de/ hier");

console.log("=== AKTIONEN + IG-HANDLE SMOKE-TEST ===");
console.log(`PASS: ${pass} / ${pass + fail}`);
if (fail > 0) { fails.forEach((f) => console.log(f)); process.exit(1); }
console.log("ALLE BESTANDEN — Bot kennt gepflegte Aktionen datumsrichtig, erfundene Rabatte gehen in den Entwurf.");
