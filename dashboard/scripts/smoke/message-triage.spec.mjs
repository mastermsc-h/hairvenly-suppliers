/**
 * SMOKE-TEST: message-triage.ts — "Soll der Bot antworten?"
 *
 * Schreibt ALLE historischen User-Beschwerden als Regressionstests fest.
 * Jeder Fall, bei dem der Bot fälschlich antwortete (oder fälschlich schwieg),
 * gehört hier rein — dann kann er nie wieder zurückkommen.
 *
 * Run:  node scripts/smoke/message-triage.spec.mjs
 * Läuft gegen das ECHTE Modul (zur Laufzeit transpiliert), keine Kopie.
 */
import { readFileSync } from "fs";
import path from "path";
import ts from "typescript";

const tsPath = path.resolve(process.cwd(), "src/lib/chatbot/message-triage.ts");
const src = readFileSync(tsPath, "utf8");
const js = ts.transpileModule(src, {
  compilerOptions: { module: "ESNext", target: "ES2022" },
}).outputText;
const mod = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
const { shouldBotIgnore, isClosingAcknowledgement, hasRealIntent } = mod;

let pass = 0, fail = 0;
const fails = [];
function check(name, actual, expected) {
  if (actual === expected) { pass++; }
  else { fail++; fails.push(`[X] ${name}: erwartet ${expected}, bekam ${actual}`); }
}

// A) BOT SOLL IGNORIEREN (shouldBotIgnore === true)
const IGNORE = [
  ["Story-Mention + [Foto]", "[Foto]", [{ type: "story_mention", url: "" }]],
  ["Story-Mention leer", "", [{ type: "story_mention" }]],
  ["Story-Mention + Label", "[Story-Mention]", [{ type: "story_mention" }]],
  ["Story-Reply Begeisterung", "Wunderschoen!!!", [{ type: "story_reply" }]],
  ["Story-Reply schoen", "schoen", [{ type: "story_reply" }]],
  ["nur Herz-Emoji", "❤️", []],
  ["nur Heart-Eyes", "😍😍", []],
  ["nur Daumen", "👍", []],
  ["reaction-attachment", "", [{ type: "reaction" }]],
  ["ok", "ok", []],
  ["okay", "okay", []],
  ["alles klar", "alles klar", []],
  ["danke", "danke", []],
  ["super", "super", []],
  ["geteilter Post", "[Beitrag]", [{ type: "ig_post" }]],
  ["geteiltes Reel", "", [{ type: "ig_reel" }]],
  ["share leer", "", [{ type: "share" }]],
];
for (const [name, text, atts] of IGNORE) check("IGNORE " + name, shouldBotIgnore(text, atts), true);

// B) BOT SOLL ANTWORTEN (shouldBotIgnore === false) — echte Anliegen NIE unterdrücken
const ANSWER = [
  ["echtes Foto", "[Foto]", [{ type: "image", url: "https://x/y.jpg" }]],
  ["Foto + Frage", "welche Farbe passt?", [{ type: "image", url: "u" }]],
  ["Story-Mention + Frage", "habt ihr die Tapes noch?", [{ type: "story_mention" }]],
  ["Story-Reply + Frage", "wie viel kostet das?", [{ type: "story_reply" }]],
  ["Story-Reply + Anliegen", "ich haette interesse an tapes", [{ type: "story_reply" }]],
  ["Verfuegbarkeit", "habt ihr 5p18a auf lager?", []],
  ["Preis", "was kostet eine verlaengerung", []],
  ["Termin", "kann ich einen termin buchen?", []],
  ["Produkt", "ich suche tapes in 55cm", []],
  ["Farbe", "welche farbe passt zu mir", []],
  ["ok + Folgefrage", "ok und wann kommt es?", []],
  ["danke + Frage", "danke, aber wann ist es wieder da?", []],
];
for (const [name, text, atts] of ANSWER) check("ANSWER " + name, shouldBotIgnore(text, atts), false);

// C) CLOSING-ACKNOWLEDGEMENT
const CLOSING_TRUE = [
  "Okay perfekt vielen Dank",
  "vielen dank",
  "Danke dir",
  "super danke",
  "Perfekt, danke dir",
  "Dankeschoen",
  "top, danke",
];
for (const t of CLOSING_TRUE) check("CLOSING-true " + t.slice(0, 20), isClosingAcknowledgement(t, []), true);

const CLOSING_FALSE = [
  ["Frage trotz danke", "Danke! Und wann kommt das zweite Paket?"],
  ["Content nach danke", "danke, ich nehme die 2 Pakete"],
  ["nur ja", "ja"],
  ["nur ok", "ok"],
];
for (const [name, t] of CLOSING_FALSE) check("CLOSING-false " + name, isClosingAcknowledgement(t, []), false);

// D) hasRealIntent Sanity
check("intent [Foto]-Label = false", hasRealIntent("[Foto]"), false);
check("intent Frage = true", hasRealIntent("habt ihr das?"), true);
check("intent Smalltalk = false", hasRealIntent("schoen"), false);

const report =
  `\n=== MESSAGE-TRIAGE SMOKE-TEST ===\n` +
  `PASS: ${pass} / ${pass + fail}\n` +
  (fail > 0
    ? `\nFEHLER (${fail}):\n` + fails.map(f => "  " + f).join("\n") + "\n"
    : "ALLE BESTANDEN — alle historischen Beschwerde-Faelle abgesichert.\n");
process.stdout.write(report, () => { process.exitCode = fail > 0 ? 1 : 0; });
