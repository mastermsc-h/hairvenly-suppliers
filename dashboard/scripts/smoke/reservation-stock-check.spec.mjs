/**
 * SMOKE-TEST: Lager-Check der Chatbot-Warteliste (src/lib/reservations/stock-match.ts)
 *
 * KERN-INVARIANTEN:
 *  - „wieder auf Lager" nur, wenn GENAU diese Farbe × Methode × Linie × Länge ×
 *    Gewicht im Lager-Sheet Bestand > 0 hat (Badge + grüne Zeile hängen daran).
 *  - Gewicht gilt auch für „unterwegs"-Zeilen (Bug 12.11.2026: „RAW Clip-Ins
 *    225g" bekam die ETA der [150g]-Variante).
 *  - Gewicht in der Farbe ("#EBONY 150g") killt den strukturierten Match nicht
 *    (Bug 12.11.2026: vorrätige Ware blieb "unknown").
 *  - ETA nie in der Vergangenheit (gleiche Regel wie der Bot, eta-pick.ts).
 *  - in_stock_since bleibt bei erneutem Check stehen, wird beim Verlassen geleert.
 *
 * Fixtures = echte Sheet-Zeilen (Stand 12.11.2026).
 * Run:  node scripts/smoke/reservation-stock-check.spec.mjs
 */
import { readFileSync } from "fs";
import path from "path";
import ts from "typescript";

function transpile(rel) {
  return ts.transpileModule(readFileSync(path.resolve(process.cwd(), rel), "utf8"), {
    compilerOptions: { module: "ESNext", target: "ES2022" },
  }).outputText;
}
const toUrl = (js) => "data:text/javascript;base64," + Buffer.from(js).toString("base64");
const etaPickUrl = toUrl(transpile("src/lib/chatbot/eta-pick.ts"));
const M = await import(toUrl(transpile("src/lib/reservations/stock-match.ts").replace('"@/lib/chatbot/eta-pick"', JSON.stringify(etaPickUrl))));

let pass = 0, fail = 0; const fails = [];
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++;
  else { fail++; fails.push(`[X] ${name}: erwartet ${e}, bekam ${a}`); }
}

const TODAY = "2026-11-12";
const inv = (collection, product, unitWeight, quantity) => ({ collection, product, unitWeight, quantity, totalWeight: unitWeight * quantity });
const alert = (collection, product, variant, ankunft, sheetKey = "glatt") => ({
  collection, product, variant, lagerG: 0, sheetKey, unterwegsG: 100,
  perOrder: ankunft.map((a) => ({ name: "Amanda 01.09.2026", ankunft: a, menge: 100 })),
});

const CLIP = "Clip In Extensions Echthaar";
const stock = {
  ru: [
    inv("Standard Tapes Russisch", "#Coldness | Cremeblond | Echthaar I Standard Tape Extensions I RU Glatt ♡", 25, 43),
    inv("Standard Tapes Russisch", "#Pearl White | Eisblond | Echthaar I Standard Tape Extensions I RU Glatt ♡", 25, 0),
    inv("Mini Tapes Glatt", "#Mocha Melt | Balayage Braun  | Echthaar Mini Tape Extensions | Russisch Glatt ♡", 50, 14),
    inv("Standard Tapes Russisch", "#Mocha Melt | Balayage Braun | Echthaar I Standard Tape Extensions I RU Glatt ♡", 25, 0),
    inv("Standard Tapes Russisch", "#Norvegian | Echthaar I Standard Tape Extensions I RU Glatt ♡", 25, 30),
    inv("Russische Bondings (Glatt)", "#Smoky Taupe | Echthaar Russische Bondings | RU Glatt 1g ♡", 25, 27),
    inv("Russische Bondings (Glatt)", "#Taupe Warmes Graubraun | Echthaar Bondings | RU Glatt 1g ♡", 25, 0),
    inv(CLIP, "#Pearl White | Eisblond | Echthaar Invisible Clip Extensions ♡", 100, 12),
    inv(CLIP, "#Pearl White | Eisblond | Echthaar Invisible Clip Extensions ♡", 150, 2),
    inv(CLIP, "#Pearl White | Eisblond | Echthaar Invisible Clip Extensions ♡", 225, 3),
    inv(CLIP, "#Ebony | Tiefes Schwarz | Echthaar Invisible Clip Extensions ♡", 150, 2),
    inv(CLIP, "#Ebony | Tiefes Schwarz | Echthaar Invisible Clip Extensions ♡", 225, 0),
    inv(CLIP, "#Raw Schwarzbraun | Echthaar Invisible Clip Extensions ♡", 100, 1),
    inv(CLIP, "#Raw Schwarzbraun | Echthaar Invisible Clip Extensions ♡", 150, 0),
    inv(CLIP, "#Raw Schwarzbraun | Echthaar Invisible Clip Extensions ♡", 225, 0),
  ],
  uz: [
    inv("Tapes Wellig 45cm", "#Mocha Melt | Balayage Braun | Echthaar Tape Extensions 45 cm | US Wellig ♡", 25, 0),
    inv("Tapes Wellig 65cm", "#Mocha Melt | Balayage Braun| Echthaar Tape Extensions 65 cm | US Wellig ♡", 25, 84),
  ],
  unterwegs: [
    alert("Standard Tapes Russisch", "#Pearl White | Eisblond | Echthaar I Standard Tape Extensions I RU Glatt ♡", null, ["ca. Ankunft: 03.11.2026", "ca. Ankunft: 20.11.2026"]),
    alert(CLIP, "#Raw Schwarzbraun | Echthaar Invisible Clip Extensions ♡  [150g]", "150", ["ca. Ankunft: 14.11.2026"]),
    alert(CLIP, "#Raw Schwarzbraun | Echthaar Invisible Clip Extensions ♡  [225g]", "225", ["ca. Ankunft: 03.11.2026", "ca. Ankunft: 30.11.2026"]),
    alert(CLIP, "#Ebony | Tiefes Schwarz | Echthaar Invisible Clip Extensions ♡  [225g]", "225", ["ETA überfällig: 20.10.2026"]),
  ],
  nullbestand: [
    alert("Russische Bondings (Glatt)", "#Taupe Warmes Graubraun | Echthaar Bondings | RU Glatt 1g ♡", null, []),
  ],
};

const res = (id, product_name, color, method, extra = {}) => ({ id, product_name, color, method, line: null, length_cm: null, method_kind: null, structured_complete: false, ...extra });
const run = (rows) => M.matchReservationsAgainstStock(rows, stock, TODAY);
const one = (r) => run([r])[0];
const statusOf = (r) => one(r).status;

// ── Heuristik-Pfad (typischer Bot-Eintrag, structured_complete=false) ─────
check("Coldness Standard Tape → in_stock", statusOf(res("1", "Standard Tape Russisch Coldness", "COLDNESS", "Standard Tape Russisch")), "in_stock");
check("Pearl White Clip 150g → in_stock (150g q=2)", statusOf(res("2", "PEARL WHITE Clip-Ins 150g", "PEARL WHITE", "Clip-Ins")), "in_stock");
check("Pearl White Clip 150g → richtige Zeile", one(res("2", "PEARL WHITE Clip-Ins 150g", "PEARL WHITE", "Clip-Ins")).matchedProduct.startsWith("#Pearl White"), true);

// Gewicht muss auch bei unterwegs greifen
const raw225 = one(res("3", "RAW Clip-Ins 225g", "RAW", "Clip-Ins"));
check("RAW Clip 225g → unterwegs", raw225.status, "unterwegs");
check("RAW Clip 225g → [225g]-Zeile, nicht [150g]", raw225.matchedProduct.includes("[225g]"), true);
check("RAW Clip 225g → ETA = nächster ZUKÜNFTIGER Termin", raw225.eta, "30.11.2026");
check("RAW Clip 150g → ETA der [150g]-Zeile", one(res("4", "RAW Clip-Ins 150g", "RAW", "Clip-Ins")).eta, "14.11.2026");

// ETA nie in der Vergangenheit
check("Pearl White Tape: 03.11. vorbei → 20.11.", one(res("5", "PEARL WHITE Standard Tapes Russisch glatt 60cm", "Pearl White", "Standard Tapes")).eta, "20.11.2026");
check("alle Termine vorbei → überfällig", one(res("6", "Clip In 225g EBONY", "EBONY", "Clip In 225g")).eta, "überfällig");

// Linie: US Wellig darf nicht gegen Russisch (Mini) matchen, 65cm gegen 65cm
const mocha = one(res("7", "Mocha Melt Braune Balayage US Wellige Tape Extensions 65cm", "Mocha Melt", "Standard Tapes"));
check("Mocha Melt US Wellig 65cm → in_stock", mocha.status, "in_stock");
check("Mocha Melt US Wellig 65cm → UZ-65cm-Zeile", mocha.matchedProduct.includes("65 cm"), true);

// Russisch ist immer 60cm → 65cm-Wunsch darf russische Ware nicht treffen
check("Norvegian Standard Tapes 65cm ≠ russisch 60cm", statusOf(res("8", "NORVEGIAN Standard Tapes 65cm", "Norvegian", "Standard Tapes")) === "in_stock", false);

// Compound-Farbe: TAUPE darf nicht über SMOKY TAUPE „vorrätig" werden
check("Taupe Bondings ≠ Smoky Taupe", statusOf(res("9", "Taupe Bondings Russisch", "Taupe", "Bondings")), "out_of_stock");

// Subtype: Standard Tape darf nicht über Mini Tape „vorrätig" werden
check("Mocha Melt Standard Tape RU ≠ Mini Tape", statusOf(res("10", "Mocha Melt Standard Tapes Russisch", "Mocha Melt", "Standard Tapes")) === "in_stock", false);

check("Farbring → service_item", statusOf(res("11", "Farbring", "Farbring", "Farbring")), "service_item");
check("unbekannte Farbe → unknown", statusOf(res("12", "Invisible Butterfly Weft Usbekisch wellig", "noch offen", "Invisible Weft")), "unknown");

// ── Strukturierter Pfad ─────────────────────────────────────────────────
const S = { line: "russisch", length_cm: 60, structured_complete: true };
check("strukturiert: #EBONY 150g (Gewicht in Farbe) → in_stock",
  statusOf(res("13", "#EBONY 150G · Russisch glatt · Clip-In Extensions", "#EBONY 150g", "Clip-In Extensions", { ...S, method_kind: "clip" })), "in_stock");
check("strukturiert: #EBONY 225g → nicht vorrätig (225g q=0)",
  statusOf(res("14", "#EBONY 225G · Russisch glatt · Clip-In Extensions", "#EBONY 225g", "Clip-In Extensions", { ...S, method_kind: "clip" })) === "in_stock", false);
check("strukturiert: Coldness tape → in_stock",
  statusOf(res("15", "Coldness Standard Russische Tape Extensions 60cm", "Coldness", "Standard Tapes", { ...S, method_kind: "tape" })), "in_stock");
check("strukturiert: Mocha Melt tape ≠ Mini Tape",
  statusOf(res("16", "Mocha Melt Standard Russische Tape 60cm", "Mocha Melt", "Standard Tapes", { ...S, method_kind: "tape" })) === "in_stock", false);

// ── Persistenz-Ableitung (in_stock_since) ───────────────────────────────
const T1 = "2026-11-12T05:15:00.000Z", T2 = "2026-11-13T05:15:00.000Z";
const r = (id, status) => ({ reservationId: id, productName: "x", status });
const [neu] = M.planStockStatusUpdates([{ id: "a", last_stock_status: "unterwegs", in_stock_since: null }], [r("a", "in_stock")], T1);
check("neu vorrätig → in_stock_since = jetzt", neu.in_stock_since, T1);
check("neu vorrätig → last_checked_at", neu.last_checked_at, T1);
const [bleibt] = M.planStockStatusUpdates([{ id: "a", last_stock_status: "in_stock", in_stock_since: T1 }], [r("a", "in_stock")], T2);
check("bleibt vorrätig → since unverändert", bleibt.in_stock_since, T1);
check("bleibt vorrätig → checked aktualisiert", bleibt.last_checked_at, T2);
const [weg] = M.planStockStatusUpdates([{ id: "a", last_stock_status: "in_stock", in_stock_since: T1 }], [r("a", "out_of_stock")], T2);
check("nicht mehr vorrätig → since geleert", weg.in_stock_since, null);
check("nicht mehr vorrätig → Status übernommen", weg.last_stock_status, "out_of_stock");
const [ohnePrev] = M.planStockStatusUpdates([], [{ ...r("b", "unterwegs"), eta: "20.11.2026", matchedProduct: "#Pearl White" }], T1);
check("ETA + Treffer werden gespeichert", [ohnePrev.last_stock_eta, ohnePrev.last_stock_match, ohnePrev.in_stock_since], ["20.11.2026", "#Pearl White", null]);

// ── Halbe Tabelle (Sheet-Refresh läuft, beobachtet 12.11.2026: RU 1, UZ 27) ──
const fill = (n) => Array.from({ length: n }, (_, i) => inv("X", `#P${i}`, 25, 1));
check("vollständiger Snapshot → ok", M.snapshotProblem({ ...stock, ru: fill(320), uz: fill(301) }), null);
check("RU 1 Zeile → Abbruch", typeof M.snapshotProblem({ ...stock, ru: fill(1), uz: fill(301) }), "string");
check("UZ 27 Zeilen → Abbruch", typeof M.snapshotProblem({ ...stock, ru: fill(320), uz: fill(27) }), "string");
check("leer → Abbruch", typeof M.snapshotProblem({ ...stock, ru: [], uz: [] }), "string");
const RU_DONE = ["Clip In Extensions Echthaar", "Standard Tapes Russisch", "Mini Tapes Glatt", "Russische Bondings (Glatt)",
  "Russische Classic Tressen (Glatt)", "Russische Genius Tressen (Glatt)", "Russische Invisible Tressen (Glatt) | Butterfly Weft"];
const UZ_DONE = ["Tapes Wellig 45cm", "Bondings wellig 65cm", "Ponytail Extensions kaufen"];
// Echter fertiger Stand 12.11.2026: „Invisible Mini Tapes" existiert in Shopify nicht → keine Total-Zeile, trotzdem komplett
check("fertig (ohne Invisible Mini Tapes) → ok", M.snapshotProblem({ ...stock, ruCompleted: RU_DONE, uzCompleted: UZ_DONE, ru: fill(320), uz: fill(301) }), null);
// Beobachtet 12.11.2026: RU 152 Zeilen (über der Zeilen-Schwelle!), aber erst 2 Collections fertig
const halb = M.snapshotProblem({ ...stock, ruCompleted: RU_DONE.slice(0, 2), uzCompleted: UZ_DONE, ru: fill(152), uz: fill(301) });
check("RU 152 Zeilen, 2 Collections fertig → Abbruch", typeof halb, "string");
check("Abbruch nennt letzte Collection", halb.includes("Butterfly Weft"), true);
check("UZ ohne Ponytail-Total → Abbruch", typeof M.snapshotProblem({ ...stock, ruCompleted: RU_DONE, uzCompleted: UZ_DONE.slice(0, 2), ru: fill(320), uz: fill(301) }), "string");
check("Groß-/Kleinschreibung egal", M.snapshotProblem({ ...stock, ruCompleted: RU_DONE.map((c) => c.toUpperCase()), uzCompleted: UZ_DONE, ru: fill(320), uz: fill(301) }), null);

console.log("=== RESERVIERUNGS-LAGER-CHECK SMOKE-TEST ===");
console.log(`PASS: ${pass} / ${pass + fail}`);
if (fail > 0) { fails.forEach((f) => console.log(f)); process.exit(1); }
console.log("ALLE BESTANDEN — wieder-auf-Lager nur bei exakt passender, vorrätiger Variante.");
