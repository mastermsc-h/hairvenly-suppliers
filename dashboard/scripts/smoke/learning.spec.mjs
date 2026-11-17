/**
 * SMOKE-TEST: learning-core.ts — Lernschleife Entwurf ↔ Team-Antwort.
 *
 * HINTERGRUND (Analyse 17.11.2026): Team antwortet in der IG-App, Entwürfe
 * blieben liegen (333 offen). Jetzt: Entwurf + echte Team-Antwort werden
 * verglichen → Wissenslücken als FAQ-Vorschlag.
 *
 * KERN-INVARIANTEN:
 *  - Nur eine echte TEAM-Antwort (human_agent) gilt als Vergleich; antwortet
 *    zuerst der Bot oder gar niemand, gibt es keinen Vergleich.
 *  - Gesplittete Team-Nachrichten (≤10 Min) zählen als eine Antwort.
 *  - Kaputtes/unvollständiges Modell-JSON erzeugt NIE einen Vorschlag.
 *
 * Run:  node scripts/smoke/learning.spec.mjs
 */
import { readFileSync } from "fs";
import path from "path";
import ts from "typescript";

const src = readFileSync(path.resolve(process.cwd(), "src/lib/chatbot/learning-core.ts"), "utf8");
const js = ts.transpileModule(src, { compilerOptions: { module: "ESNext", target: "ES2022" } }).outputText;
const M = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));

let pass = 0, fail = 0; const fails = [];
function check(name, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) pass++;
  else { fail++; fails.push(`[X] ${name}: erwartet ${JSON.stringify(expected)}, bekam ${JSON.stringify(actual)}`); }
}
const msg = (role, content, min, extra = {}) => ({ role, content, created_at: new Date(Date.UTC(2026, 10, 17, 10, min)).toISOString(), ...extra });

// ── pairTeamReply ────────────────────────────────────────────────────────
check("keine Antwort → none", M.pairTeamReply([msg("user", "hallo?", 1)]).kind, "none");
check("Bot antwortet zuerst → other_reply", M.pairTeamReply([msg("assistant", "Hi", 1, { auto_sent: true }), msg("human_agent", "Hallo", 5)]).kind, "other_reply");
const split = M.pairTeamReply([msg("user", "?", 0), msg("human_agent", "Hi Liebes", 2), msg("human_agent", "kostet 81,99 €", 4), msg("human_agent", "später", 40)]);
check("Team-Split ≤10 Min zusammengefasst, spätere Nachricht nicht", split, { kind: "team", text: "Hi Liebes\n\nkostet 81,99 €", at: msg("x", "", 2).created_at });
check("gelöschte Nachricht zählt nicht", M.pairTeamReply([msg("assistant", "x", 1, { deleted_at: "2026-11-17" }), msg("human_agent", "Team", 3)]).kind, "team");
check("leere Team-Nachricht (nur Bild) → other_reply", M.pairTeamReply([msg("human_agent", "  ", 1)]).kind, "other_reply");

// ── parseComparison ──────────────────────────────────────────────────────
const good = `Hier: {"verdict":"bot_wrong","facts":[{"kind":"bot_wrong","fact":"Bei Überweisung keine Stornierung nach 7 Tagen","bot_said":"7 Tage, dann Storno","faq_question":"Wie lange habe ich Zeit zu überweisen?","faq_answer":"Die Bestellung wird bearbeitet, sobald die Zahlung eingegangen ist."}]}`;
const p = M.parseComparison(good);
check("gültiges JSON mit Text drumherum", p?.verdict, "bot_wrong");
check("Fakt übernommen", p?.facts.length, 1);
check("kaputtes JSON → null", M.parseComparison("{verdict: bot_wrong"), null);
check("unbekanntes Verdict → null", M.parseComparison(`{"verdict":"maybe","facts":[]}`), null);
check("bot_missing ohne verwertbaren Fakt → not_comparable", M.parseComparison(`{"verdict":"bot_missing","facts":[{"fact":"x","faq_question":"","faq_answer":""}]}`)?.verdict, "not_comparable");
check("same ignoriert facts", M.parseComparison(`{"verdict":"same","facts":[{"kind":"bot_wrong","fact":"irgendwas langes","faq_question":"Frage lang genug?","faq_answer":"Antwort lang genug"}]}`)?.facts.length, 0);
check("max. 2 Fakten", M.parseComparison(JSON.stringify({ verdict: "bot_missing", facts: Array(4).fill({ kind: "bot_missing", fact: "Fakt mit Text", faq_question: "Frage mit Text?", faq_answer: "Antwort mit Text" }) }))?.facts.length, 2);

// ── Duplikate ────────────────────────────────────────────────────────────
check("gleiche Frage anders formuliert = Duplikat", M.isDuplicateSuggestion("Darf ich die Haare aus der Tüte nehmen?", ["Darf ich die Haare aus der durchsichtigen Tüte nehmen und anschauen?"]), true);
check("andere Frage ≠ Duplikat", M.isDuplicateSuggestion("Wie lange habe ich Zeit für die Überweisung?", ["Darf ich die Haare aus der Tüte nehmen?"]), false);

// ── Übereinstimmung je Kategorie ─────────────────────────────────────────
const agg = M.agreementByCategory([
  { category: "pricing", verdict: "same" }, { category: "pricing", verdict: "bot_wrong" },
  { category: "pricing", verdict: "style_only" }, { category: "pricing", verdict: "not_comparable" },
  { category: null, verdict: "bot_missing" },
]);
check("pricing: 3 vergleichbar, 2 einig, 1 falsch", agg[0], { category: "pricing", compared: 3, agreeing: 2, wrong: 1, missing: 0 });
check("ohne Kategorie", agg[1].category, "ohne Kategorie");

console.log("=== LERNSCHLEIFE SMOKE-TEST ===");
console.log(`PASS: ${pass} / ${pass + fail}`);
if (fail > 0) { fails.forEach((f) => console.log(f)); process.exit(1); }
console.log("ALLE BESTANDEN — nur echte Team-Antworten werden verglichen, kaputte Modell-Antworten erzeugen keine Vorschläge.");
