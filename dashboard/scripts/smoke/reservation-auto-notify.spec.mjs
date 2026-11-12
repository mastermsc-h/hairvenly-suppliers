/**
 * SMOKE-TEST: Automatische Wartelisten-Benachrichtigung — senden ja/nein
 * (src/lib/reservations/auto-notify.ts + Eindeutigkeit aus stock-match.ts)
 *
 * KERN-INVARIANTEN:
 *  - Gesendet wird NUR bei eindeutig vorrätiger Variante (genau 1 passende
 *    Lager-Variante), Instagram-Kontakt, offen, < 3 Fehlversuche, heute noch
 *    nicht versucht. Alles andere → skip (Mitarbeiterin klickt selbst).
 *  - Eine Nachricht pro Kundin, max. 30 Nachrichten pro Lauf.
 *  - Nur Mo–Sa 9–19 Uhr Berlin; der Cron (10:00 UTC) arbeitet nur um 11/12 Uhr
 *    Berlin (nach dem Lager-Refresh 9–10 Uhr).
 *  - Ein-Produkt-Text = exakt der bisherige Standardtext (+ Signatur bei Auto).
 *
 * Run:  node scripts/smoke/reservation-auto-notify.spec.mjs
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
const A = await import(toUrl(transpile("src/lib/reservations/auto-notify.ts")));
const etaPickUrl = toUrl(transpile("src/lib/chatbot/eta-pick.ts"));
const M = await import(toUrl(transpile("src/lib/reservations/stock-match.ts").replace('"@/lib/chatbot/eta-pick"', JSON.stringify(etaPickUrl))));

let pass = 0, fail = 0; const fails = [];
function check(name, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) pass++;
  else { fail++; fails.push(`[X] ${name}: erwartet ${e}, bekam ${a}`); }
}

const NOW = new Date("2026-11-12T09:00:00Z"); // Do 10:00 Berlin
const base = { id: "r1", status: "waiting", channel: "instagram", external_id: "1226620", notify_attempts: 0, last_notify_attempt_at: null };
const inStock = { reservationId: "r1", productName: "x", status: "in_stock", matchedProduct: "#Coldness", variantCount: 1 };
const dec = (r, res) => A.decideAutoNotify({ ...base, ...r }, res === undefined ? inStock : res, NOW).decision;

// ── senden ja/nein ───────────────────────────────────────────────────────
check("eindeutig auf Lager → senden", dec({}), "would_send");
check("unterwegs → nicht senden", dec({}, { ...inStock, status: "unterwegs", variantCount: undefined }), "skip");
check("ausverkauft → nicht senden", dec({}, { ...inStock, status: "out_of_stock" }), "skip");
check("unknown → nicht senden", dec({}, { ...inStock, status: "unknown" }), "skip");
check("service_item → nicht senden", dec({}, { ...inStock, status: "service_item" }), "skip");
check("nicht geprüft → nicht senden", dec({}, null), "skip");
check("ungefährer Treffer (3 Varianten) → nicht senden", dec({}, { ...inStock, variantCount: 3 }), "skip");
check("Eindeutigkeit unbekannt → nicht senden", dec({}, { ...inStock, variantCount: undefined }), "skip");
check("bereits benachrichtigt → nicht senden", dec({ status: "notified" }), "skip");
check("storniert → nicht senden", dec({ status: "cancelled" }), "skip");
check("WhatsApp → nicht automatisch", dec({ channel: "whatsapp" }), "skip");
check("Web-Chat → nicht automatisch", dec({ channel: "web" }), "skip");
check("Instagram ohne ID → nicht senden", dec({ external_id: null }), "skip");
check("3 Fehlversuche → nicht mehr", dec({ notify_attempts: 3, last_notify_attempt_at: "2026-11-01T09:00:00Z" }), "skip");
check("2 Fehlversuche, gestern → nochmal", dec({ notify_attempts: 2, last_notify_attempt_at: "2026-11-11T09:00:00Z" }), "would_send");
check("heute schon versucht → morgen", dec({ notify_attempts: 1, last_notify_attempt_at: "2026-11-12T08:00:00Z" }), "skip");
// 23:30 UTC = 00:30 Berlin des NÄCHSTEN Tages → Berliner Kalendertag zählt
check("Versuch 00:30 Berlin = heute (Zeitzone)", A.decideAutoNotify({ ...base, notify_attempts: 1, last_notify_attempt_at: "2026-11-12T23:30:00Z" }, inStock, new Date("2026-11-13T09:00:00Z")).decision, "skip");
check("Grund wird mitgeliefert", A.decideAutoNotify({ ...base }, { ...inStock, variantCount: 3 }, NOW).reason.includes("nicht eindeutig"), true);

// ── Eindeutigkeit kommt aus dem Matcher (echte Sheet-Zeilen) ─────────────
const CLIP = "Clip In Extensions Echthaar";
const inv = (collection, product, unitWeight, quantity, url) => ({ collection, product, unitWeight, quantity, totalWeight: 0, url });
const stock = {
  ru: [
    inv(CLIP, "#Pearl White | Eisblond | Echthaar Invisible Clip Extensions ♡", 100, 12, "https://hairvenly.de/products/pearl-white-clip"),
    inv(CLIP, "#Pearl White | Eisblond | Echthaar Invisible Clip Extensions ♡", 150, 2, "https://hairvenly.de/products/pearl-white-clip"),
    inv(CLIP, "#Pearl White | Eisblond | Echthaar Invisible Clip Extensions ♡", 225, 3, "https://hairvenly.de/products/pearl-white-clip"),
    inv("Standard Tapes Russisch", "#Coldness | Cremeblond | Echthaar I Standard Tape Extensions I RU Glatt ♡", 25, 43),
    // gleiche Variante zweimal im Sheet (andere Collection) → bleibt eindeutig
    inv("Russische Tape Extensions", "#Coldness | Cremeblond | Echthaar I Standard Tape Extensions I RU Glatt ♡", 25, 43),
    inv(CLIP, "#Latte Balayage | Echthaar Invisible Clip Extensions ♡", 225, 7),
    inv(CLIP, "#Latte Brown Kühles Hellbraun | Echthaar Invisible Clip Extensions ♡", 225, 5),
  ],
  uz: [], unterwegs: [], nullbestand: [],
};
const res = (id, product_name, color, method) => ({ id, product_name, color, method, line: null, length_cm: null, method_kind: null, structured_complete: false });
const [clip150, clipOhneGramm, coldness] = M.matchReservationsAgainstStock([
  res("a", "PEARL WHITE Clip-Ins 150g", "PEARL WHITE", "Clip-Ins"),
  res("b", "PEARL WHITE Clip-Ins", "PEARL WHITE", "Clip-Ins"),
  res("c", "Standard Tape Russisch Coldness", "COLDNESS", "Standard Tape Russisch"),
], stock, "2026-11-12");
check("Clip 150g → 1 Variante (eindeutig)", clip150.variantCount, 1);
check("Clip ohne Gramm → 3 Varianten (nicht eindeutig)", clipOhneGramm.variantCount, 3);
check("Clip ohne Gramm → NICHT senden", A.decideAutoNotify(base, clipOhneGramm, NOW).decision, "skip");
check("Doppelte Sheet-Zeile → trotzdem eindeutig", coldness.variantCount, 1);
// „balayage" ist STOP-Wort → „Latte Balayage" traf auch „Latte Brown" (12.11.2026)
const [latte] = M.matchReservationsAgainstStock([res("d", "LATTE BALAYAGE Clip-Ins 225g", "LATTE BALAYAGE", "Clip-Ins")], stock, "2026-11-12");
check("Latte Balayage ≠ Latte Brown → eindeutig", latte.variantCount, 1);
check("Latte Balayage → richtige Farbe", latte.matchedProduct.startsWith("#Latte Balayage"), true);
check("Treffer liefert Shop-URL", clip150.matchedUrl, "https://hairvenly.de/products/pearl-white-clip");

// ── Bündelung + Deckel ──────────────────────────────────────────────────
const cands = Array.from({ length: 35 }, (_, i) => ({ id: `r${i}`, channel: "instagram", external_id: `k${i}` }));
cands.push({ id: "r-extra", channel: "instagram", external_id: "k0" }); // zweite Reservierung derselben Kundin
const plan = A.planAutoNotifyBatch(cands, 30);
check("Deckel: 30 Nachrichten", plan.groups.length, 30);
check("Deckel: 5 Reservierungen auf morgen", plan.deferredIds.length, 5);
check("eine Nachricht pro Kundin", plan.groups[0].ids, ["r0", "r-extra"]);
check("Deckel 0 → nichts senden", A.planAutoNotifyBatch(cands, 0).groups.length, 0);

// ── Zeitfenster ─────────────────────────────────────────────────────────
check("Do 10 Uhr Berlin → Fenster", A.isInSendWindow(NOW), true);
check("Sa 10 Uhr Berlin → Fenster", A.isInSendWindow(new Date("2026-11-14T09:00:00Z")), true);
check("So 10 Uhr Berlin → kein Versand", A.isInSendWindow(new Date("2026-11-15T09:00:00Z")), false);
check("Do 07 Uhr Berlin → kein Versand", A.isInSendWindow(new Date("2026-11-12T06:00:00Z")), false);
check("Do 19 Uhr Berlin → kein Versand", A.isInSendWindow(new Date("2026-11-12T18:00:00Z")), false);
const inHour = (iso) => A.AUTO_NOTIFY_HOURS_BERLIN.includes(A.berlinHour(new Date(iso)));
check("Winter: Cron 10 UTC = 11 Uhr Berlin → Versand", inHour("2026-11-12T10:00:00Z"), true);
check("Sommer: Cron 10 UTC = 12 Uhr Berlin → Versand", inHour("2026-07-01T10:00:00Z"), true);
check("10 Uhr Berlin (Refresh-Stunde) → kein Versand", inHour("2026-11-12T09:00:00Z"), false);
check("18 Uhr Berlin (Refresh-Stunde) → kein Versand", inHour("2026-11-12T17:00:00Z"), false);

// ── Text ────────────────────────────────────────────────────────────────
const p1 = { product_name: "Taupe Standard Russische Tape Extensions 60cm", color: "Taupe", method: "Standard Tapes", product_url: "https://hairvenly.de/products/taupe" };
check("Ein Produkt = bisheriger Standardtext",
  A.buildNotificationText([p1]),
  "Hallo Liebes 💕\n\nGute Nachrichten — die Taupe Standard Tapes sind jetzt wieder da! 🥳\n\nhttps://hairvenly.de/products/taupe\n\nMagst du sie noch? Sag Bescheid wenn ich dir weiterhelfen soll 🩷");
check("Auto signiert mit Ava", A.buildNotificationText([p1], { signature: A.AUTO_NOTIFY_SIGNATURE }).endsWith("\n\n/Ava von Hairvenly"), true);
const multi = A.buildNotificationText([p1, { product_name: "Latte Clip 225g", color: null, method: null, product_url: null }], { signature: A.AUTO_NOTIFY_SIGNATURE });
check("Mehrere Produkte → Liste", multi.includes("• Taupe Standard Tapes") && multi.includes("• Latte Clip 225g"), true);
check("leer → kein Text", A.buildNotificationText([]), "");
check("Modus-Parser: Unbekanntes → off", A.parseAutoNotifyMode("an"), "off");

console.log("=== RESERVIERUNGS-AUTO-BENACHRICHTIGUNG SMOKE-TEST ===");
console.log(`PASS: ${pass} / ${pass + fail}`);
if (fail > 0) { fails.forEach((f) => console.log(f)); process.exit(1); }
console.log("ALLE BESTANDEN — automatisch nur bei eindeutig vorrätiger Variante, einmal pro Kundin, zu Geschäftszeiten.");
