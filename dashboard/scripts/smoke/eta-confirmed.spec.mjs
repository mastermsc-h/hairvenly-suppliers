/**
 * SMOKE-TEST: filter-archived-orders.ts — ETA-Quelle & Bestätigungs-Flag.
 *
 * HINTERGRUND (User-Bug 2026-06-15, Autumn/Dubai):
 *   Der Bot nannte ETAs aus der SHEET-FORMEL (Bestelldatum + ~53 Tage),
 *   obwohl die echten, gepflegten ETAs in der DB (orders/order_items) stehen.
 *   Regel: Die DB ist die ETA-Quelle. Ein SHEET-Datum darf NIE als bestätigt
 *   ausgegeben werden.
 *
 * KERN-INVARIANTE: etaConfirmed=true ⟺ Datum stammt aus der DB.
 *   Sheet-Schätzung ⟹ etaConfirmed=false (Bot formuliert "noch nicht bestätigt").
 *
 * Run:  node scripts/smoke/eta-confirmed.spec.mjs
 * Läuft gegen das ECHTE Modul (buildAnkunftFromMeta + filterArchivedFromStock),
 * nur der triviale isArchived-Import wird inline ersetzt.
 */
import { readFileSync } from "fs";
import path from "path";
import ts from "typescript";

const tsPath = path.resolve(process.cwd(), "src/lib/filter-archived-orders.ts");
let src = readFileSync(tsPath, "utf8");
// Laufzeit-Import auf order-name-map (nur isArchived) durch Inline-Variante ersetzen.
src = src.replace(
  /import\s*\{\s*isArchived\s*\}\s*from\s*["']@\/lib\/order-name-map["'];?/,
  `const ARCHIVED_STATUS = new Set(["stocked","cancelled"]);
   function isArchived(m){ return !!m && !!m.status && ARCHIVED_STATUS.has(m.status); }`
);
const js = ts.transpileModule(src, {
  compilerOptions: { module: "ESNext", target: "ES2022" },
}).outputText;
const mod = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
const { filterArchivedFromStock } = mod;

let pass = 0, fail = 0;
const fails = [];
function check(name, actual, expected) {
  if (JSON.stringify(actual) === JSON.stringify(expected)) { pass++; }
  else { fail++; fails.push(`[X] ${name}: erwartet ${JSON.stringify(expected)}, bekam ${JSON.stringify(actual)}`); }
}

// ── Helper: OrderMeta-Stub bauen ────────────────────────────────────────
function meta({ status = "in_production", eta = null, itemEtas = {}, shipmentEtas = [], arrived = [] }) {
  const itemEtasByShopify = new Map();
  for (const [k, v] of Object.entries(itemEtas)) itemEtasByShopify.set(k, v);
  return { id: "x", trackingNumber: null, trackingUrl: null, status, eta, shipmentEtas, itemEtasByShopify, arrivedShopifyNames: new Set(arrived) };
}
// AlertProduct-Stub mit EINER perOrder-Position (Sheet-Schätzdatum).
function alert(product, orderName, sheetAnkunft) {
  return { collection: "Standard Tapes Russisch", product, variant: null, lagerG: 0, sheetKey: "glatt",
           unterwegsG: 1000, perOrder: [{ name: orderName, ankunft: sheetAnkunft, menge: 1000 }] };
}
const SHEET_DUBAI = "ca. Ankunft: 04.07.2026"; // die falsche Sheet-Formel
const NAME = "#DUBAI STANDARD RUSSISCHE TAPE EXTENSIONS GLATT ♡";

// ── 1) DB item-eta (exakter name_shopify-Match) → bestätigt, überschreibt Sheet
{
  const map = { "Amanda 12.05.2026": meta({ itemEtas: { [NAME]: ["2026-06-22"] } }) };
  const out = filterArchivedFromStock([alert(NAME, "Amanda 12.05.2026", SHEET_DUBAI)], map);
  check("item-eta: ankunft = DB-Datum", out[0].perOrder[0].ankunft, "ca. Ankunft: 22.06.2026");
  check("item-eta: etaConfirmed=true", out[0].perOrder[0].etaConfirmed, true);
}

// ── 2) KEIN DB-Match → Sheet-Datum bleibt, aber als UNBESTÄTIGT markiert
{
  const out = filterArchivedFromStock([alert(NAME, "Amanda 12.05.2026", SHEET_DUBAI)], { /* leer */ });
  check("kein DB-Match: Sheet-Datum bleibt", out[0].perOrder[0].ankunft, SHEET_DUBAI);
  check("kein DB-Match: etaConfirmed=false", out[0].perOrder[0].etaConfirmed, false);
}

// ── 3) order.eta in der ZUKUNFT, kein item-eta → bestätigt (DB order-eta)
{
  const map = { "Amanda 12.05.2026": meta({ eta: "2026-12-31" }) };
  const out = filterArchivedFromStock([alert(NAME, "Amanda 12.05.2026", SHEET_DUBAI)], map);
  check("order-eta zukunft: ankunft = order.eta", out[0].perOrder[0].ankunft, "ca. Ankunft: 31.12.2026");
  check("order-eta zukunft: etaConfirmed=true", out[0].perOrder[0].etaConfirmed, true);
}

// ── 4) order.eta in der VERGANGENHEIT → kein Override → Sheet bleibt UNBESTÄTIGT
//     (stale order.eta darf nicht als bestätigt durchgehen)
{
  const map = { "Amanda 12.05.2026": meta({ eta: "2020-01-01" }) };
  const out = filterArchivedFromStock([alert(NAME, "Amanda 12.05.2026", SHEET_DUBAI)], map);
  check("order-eta vergangen: Sheet-Datum bleibt", out[0].perOrder[0].ankunft, SHEET_DUBAI);
  check("order-eta vergangen: etaConfirmed=false", out[0].perOrder[0].etaConfirmed, false);
}

// ── 5) Archivierte Bestellung (stocked) → perOrder-Position wird entfernt
{
  const map = { "Amanda 12.05.2026": meta({ status: "stocked", eta: "2026-12-31" }) };
  const out = filterArchivedFromStock([alert(NAME, "Amanda 12.05.2026", SHEET_DUBAI)], map);
  check("stocked: perOrder leer", out[0].perOrder.length, 0);
  check("stocked: unterwegsG=0", out[0].unterwegsG, 0);
}

// ── 6) KERN-INVARIANTE: ein Sheet-Datum ist NIE etaConfirmed=true ───────────
{
  // Mehrere Positionen gemischt: eine mit DB-eta, eine ohne.
  const NAME2 = "#AUTUMN STANDARD RUSSISCHE TAPE EXTENSIONS GLATT";
  const ap = { collection: "Standard Tapes Russisch", product: NAME, variant: null, lagerG: 0, sheetKey: "glatt",
    unterwegsG: 2000, perOrder: [
      { name: "Amanda 23.04.2026", ankunft: "ca. Ankunft: 15.06.2026", menge: 1000 }, // Sheet, kein DB-Match
      { name: "Amanda 12.05.2026", ankunft: SHEET_DUBAI, menge: 1000 },                // DB-Match
    ] };
  const map = { "Amanda 12.05.2026": meta({ itemEtas: { [NAME]: ["2026-06-22"] } }) };
  const out = filterArchivedFromStock([ap], map);
  const confirmedSheet = out[0].perOrder.filter(o => o.etaConfirmed === true && !/22\.06/.test(o.ankunft));
  check("INVARIANTE: kein Sheet-Datum als bestätigt", confirmedSheet.length, 0);
  check("gemischt: DB-Position bestätigt", out[0].perOrder.find(o => /22\.06/.test(o.ankunft))?.etaConfirmed, true);
  check("gemischt: Sheet-Position unbestätigt", out[0].perOrder.find(o => /15\.06/.test(o.ankunft))?.etaConfirmed, false);
  void NAME2;
}

console.log("=== ETA-CONFIRMED SMOKE-TEST ===");
console.log(`PASS: ${pass} / ${pass + fail}`);
if (fail > 0) { fails.forEach(f => console.log(f)); process.exit(1); }
console.log("ALLE BESTANDEN — Bot zitiert Sheet-Schätzungen nie als bestätigten Liefertermin.");
