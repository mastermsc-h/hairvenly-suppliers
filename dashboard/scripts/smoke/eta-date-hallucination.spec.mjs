/**
 * SMOKE-TEST: detect-eta-date-hallucination.ts + Telefon-Schutz (intent-contact.ts)
 *
 * Echte Antworten aus dem Sarah-Chat (16.10.2026) als Regressionsfälle.
 * Run:  node scripts/smoke/eta-date-hallucination.spec.mjs
 */
import { readFileSync } from "fs";
import path from "path";
import ts from "typescript";

const tr = (rel) => ts.transpileModule(readFileSync(path.resolve(process.cwd(), rel), "utf8"), {
  compilerOptions: { module: "ESNext", target: "ES2022" },
}).outputText;
const toUrl = (js) => "data:text/javascript;base64," + Buffer.from(js).toString("base64");

const { detectEtaDateHallucination } = await import(toUrl(tr("src/lib/chatbot/detect-eta-date-hallucination.ts")));
const bizUrl = toUrl(tr("src/lib/chatbot/business-config.ts"));
const contactJs = tr("src/lib/chatbot/intent-contact.ts").replace(/from\s+["']\.\/business-config["']/, `from "${bizUrl}"`);
const { enforceBusinessFacts, looksLikeDateOrTime } = await import(toUrl(contactJs));

let pass = 0, fail = 0; const fails = [];
const check = (n, a, e) => { if (JSON.stringify(a) === JSON.stringify(e)) pass++; else { fail++; fails.push(`[X] ${n}: erwartet ${JSON.stringify(e)}, bekam ${JSON.stringify(a)}`); } };

const TODAY = "2026-10-16";
// Tool-Ergebnisse wie sie NACH dem Fix aussehen
const toolLatte = JSON.stringify({ status: "unterwegs", sheet_last_updated: "13.10.2026 14:58",
  message: "z.B. 'ca. Ende Mai, also etwa 30.05.'",
  products: [{ product: "#Latte Balayage Clip [225g]", earliest_eta: "21.10.2026", earliest_eta_iso: "2026-10-21", eta_confirmed: true, eta_overdue: false }] });
const toolButter = JSON.stringify({ status: "unterwegs", products: [{ product: "#Butter Cream Clip [225g]", earliest_eta: "06.11.2026", earliest_eta_iso: "2026-11-06", eta_confirmed: true, eta_overdue: false }] });
// Tool-Ergebnis wie es VOR dem Fix aussah (überfälliges Datum)
const toolOld = JSON.stringify({ status: "unterwegs", products: [{ earliest_eta: "20.08.26", earliest_eta_iso: "2026-08-20", eta_confirmed: false }] });

const det = (text, ev) => detectEtaDateHallucination(text, ev, TODAY).suspicious;

// ── Echte Sarah-Antworten → MÜSSEN als verdächtig erkannt werden ──────────
check("Sarah #1: 'um den 20.08. herum' (Vergangenheit)",
  det("Die LATTE BALAYAGE Clip-Ins 225g kommen voraussichtlich ca. Mitte bis Ende August wieder rein (um den 20.08. herum).", [toolOld]), true);
check("Sarah #2: 'ich meinte tatsächlich nächstes Jahr' + wieder rein",
  det("Genau, ich meinte tatsächlich nächstes Jahr! Die Clip-Ins kommen voraussichtlich wieder rein.", [toolOld]), true);
check("Sarah #3: 'erst nächstes Jahr wieder da'",
  det("Ja genau, leider sind beide erst nächstes Jahr wieder da 🥺", [toolOld]), true);
check("erfundenes Jahr 20.08.2027 (Tool sagt 2026)",
  det("Die Clip-Ins kommen voraussichtlich um den 20.08.2027 herum.", [toolOld]), true);
check("Datum ohne jeden Tool-Beleg",
  det("Die kommen ca. am 28.10. wieder rein 💕", []), true);
check("Beispiel-Datum aus Tool-'message' zählt NICHT als Beleg",
  det("Die kommen ca. am 30.05. wieder rein", [toolLatte]), true);

// ── Korrekte Antworten → NICHT verdächtig ───────────────────────────────
check("korrekt: Latte 21.10. + Butter 06.11.",
  det("Die LATTE BALAYAGE Clip-Ins 225g kommen voraussichtlich um den 21.10. rein, die BUTTER CREAM um den 06.11.2026 💕", [toolLatte, toolButter]), false);
check("korrekt: Datum aus Pre-LLM-Stock-Hinweis",
  det("Die kommen ca. am 21.10.2026 wieder rein", ["  - Russisch Clip 225g: AUSVERKAUFT, Nachschub kommt ca. 21.10.2026"]), false);
check("überfällig ehrlich ohne Datum",
  det("Die sind nachbestellt, die Lieferung hat sich leider etwas verzögert — ein genaues neues Datum haben wir gerade noch nicht 🥺", [toolOld]), false);
check("Datum ohne Liefer-Kontext (Bestelldatum)",
  det("Du hattest am 03.05. bei uns bestellt 💕", []), false);
check("'nächstes Jahr' mit Beleg im nächsten Jahr ok",
  det("Die kommen leider erst nächstes Jahr wieder rein, ca. am 15.01.2027.", [JSON.stringify({ products: [{ earliest_eta: "15.01.2027" }] })]), false);

// ── Telefon-Schutz darf Daten NICHT fressen ─────────────────────────────
const ef = (t) => enforceBusinessFacts(t).text;
check("Datum 20.08.2027 bleibt", ef("kommt ca. um den 20.08.2027 herum"), "kommt ca. um den 20.08.2027 herum");
check("Datums-Bereich 20.08.-25.08. bleibt", ef("ca. 20.08.-25.08. 💕"), "ca. 20.08.-25.08. 💕");
check("Uhrzeit 10.00-18.00 bleibt", ef("geöffnet 10.00-18.00 Uhr"), "geöffnet 10.00-18.00 Uhr");
check("ISO-Datum bleibt", ef("ETA 2026-10-21"), "ETA 2026-10-21");
check("fremde Handynummer wird weiterhin ersetzt", ef("ruf an: 0176 12345678").includes("0173 8000865"), true);
check("unsere Nummer bleibt", ef("WhatsApp 0173 8000865"), "WhatsApp 0173 8000865");
check("looksLikeDateOrTime(0421.123456) = false (Telefon mit Punkt)", looksLikeDateOrTime("0421.123456"), false);

console.log("=== ETA-DATE-HALLUCINATION SMOKE-TEST ===");
console.log(`PASS: ${pass} / ${pass + fail}`);
if (fail > 0) { fails.forEach(f => console.log(f)); process.exit(1); }
console.log("ALLE BESTANDEN — erfundene/vergangene Liefertermine werden abgefangen, Daten überleben den Telefon-Schutz.");
