/**
 * SMOKE-TEST: Lieferanten-Zahlungen aus Kontoumsätzen (src/lib/bank/lieferanten-zahlungen.ts)
 * KERN-INVARIANTEN: nur eindeutig über die Rechnungsnummer buchen; schon eingetragene Zahlung
 * (±1 $, ±21 Tage) nie doppelt; im Zweifel "unklar".
 * Run:  node scripts/smoke/lieferanten-zahlungen.spec.mjs
 */
import { readFileSync } from "fs";
import ts from "typescript";
const js = ts.transpileModule(readFileSync("src/lib/bank/lieferanten-zahlungen.ts", "utf8"), { compilerOptions: { module: "ESNext", target: "ES2022" } }).outputText;
const L = await import("data:text/javascript;base64," + Buffer.from(js).toString("base64"));
let pass = 0, fail = 0; const fails = [];
const check = (n, a, e) => { const x = JSON.stringify(a), y = JSON.stringify(e); if (x === y) pass++; else { fail++; fails.push(`[X] ${n}: erwartet ${y}, bekam ${x}`); } };

const EBRU = L.LZ_LIEFERANTEN[0], AMANDA = L.LZ_LIEFERANTEN[1];
const neu = "EMPF. Second Industrial Park CN Heze CityBETRAG. USD -40.000,00KURS. +1,09110GGW. EUR +36.660,25ENTGELTREGELUNG. DEBTVWZ. Invoice Nr. EHL20260616";
const alt = "FXP/260916737976BIC PCBCCNBJSDXUSD40000,00 1,14850INVOICE NR. EHL20250825";
check("USD neues Format", L.parseUsd(neu), 40000);
check("USD altes Format", L.parseUsd(alt), 40000);
check("USD kleiner Betrag", L.parseUsd("BETRAG. USD -20.994,95KURS. +1,10350"), 20994.95);
check("Rechnung Ebru", L.parseRechnung(neu), { nr: "EHL20260616", datum: "2026-06-16", teil: null });
check("Rechnung Amanda Part", L.parseRechnung("VWZ. Invoice No AmandaGRM20260821-Part 2 / Ext"), { nr: "AMANDAGRM20260821", datum: "2026-08-21", teil: 2 });
check("Lieferant", [L.lieferantVon("JUANCHENG COUNTY SHUNMIN")?.key, L.lieferantVon("YW BEAUTY LINK HAIR")?.key, L.lieferantVon("SPESEN")], ["ebru", "amanda", null]);

const tx = (purpose, d = "2026-11-18") => ({ id: "t", booking_date: d, counterparty_name: "X", purpose });
const o = (id, label, od, rest, status = "manual") => ({ id, label, status, order_date: od, remaining_balance: rest });
const ebruOrders = [o("a", "EHL20260616", "2026-06-16", 40000), o("b", "EHL20260623", "2026-06-23", 112500), o("c", "EHL20261026 China 21.08.2026", "2026-08-21", 79875, "stocked"), o("d", "EHL20261026 China 11.09.2026", "2026-09-11", 48903.75, "stocked")];
check("Ebru: Rechnung im Namen → buchen", L.entscheide(tx(neu), EBRU, ebruOrders, []).art + "/" + L.entscheide(tx(neu), EBRU, ebruOrders, []).orderId, "buchen/a");
check("Ebru: schon eingetragen", L.entscheide(tx(neu), EBRU, ebruOrders, [{ order_id: "a", paid_at: "2026-11-17", amount: 40000 }]).art, "vorhanden");
check("Ebru: Eintrag 30 Tage weg zählt nicht", L.entscheide(tx(neu), EBRU, ebruOrders, [{ order_id: "a", paid_at: "2026-10-16", amount: 40000 }]).art, "buchen");
check("Ebru: unbekannte Rechnung → unklar", L.entscheide(tx(alt), EBRU, ebruOrders, []).art, "unklar");
const r26 = L.entscheide(tx(neu.replace("EHL20260616", "EHL20261026")), EBRU, ebruOrders, []);
check("Ebru: zwei Positionen einer Rechnung → älteste", r26.orderId, "c");
check("Ebru: Betrag > Rest → unklar", L.entscheide(tx(neu.replace("40.000,00", "45.000,00")), EBRU, [o("a", "EHL20260616", "2026-06-16", 40000)], []).art, "unklar");
check("Ebru: ausgeblendete Position nie", L.entscheide(tx(neu), EBRU, [o("a", "EHL20260616", "2026-06-16", 40000, "hidden")], []).art, "unklar");

const am = (nr, usd) => `BETRAG. USD -${usd}KURS. +1,11170GGW. EUR +1,00ENTGELTREGELUNG. DEBTVWZ. Invoice No ${nr} / Extensions`;
const amOrders = [o("x", "Amanda 21.08.2026 (BF pt. 1)", "2026-08-21", 27243.48, "delivered"), o("y", "Amanda 25.08.2026", "2026-08-25", 20994.95, "delivered"), o("z", "Amanda 25.08.2026 (BF pt. 2)", "2026-08-25", 32647.58, "delivered"), o("w", "Amanda 11.09.2026", "2026-09-11", 9806.35, "in_production"), o("v", "Amanda 18.08.2026", "2026-08-18", 21917, "delivered")];
check("Amanda: Part 2 → pt. 2", L.entscheide(tx(am("AmandaGRM20260821-Part 2", "20.000,00")), AMANDA, amOrders, []).orderId, "z");
check("Amanda: exakter Rest entscheidet", L.entscheide(tx(am("AmandaGRM20260826", "20.994,95")), AMANDA, amOrders, []).orderId, "y");
check("Amanda: Rechnung 3 Tage nach Bestellung", L.entscheide(tx(am("AMANDAGRM20260914", "5.000,00")), AMANDA, amOrders, []).orderId, "w");
check("Amanda: mehrdeutig → unklar", L.entscheide(tx(am("AmandaGRM20260826", "5.000,00")), AMANDA, amOrders, []).art, "unklar");
check("Amanda: keine Position zum Datum → unklar", L.entscheide(tx(am("AmandaGRM20260101", "5.000,00")), AMANDA, amOrders, []).art, "unklar");

console.log(`lieferanten-zahlungen: ${pass} ok, ${fail} Fehler`);
if (fail) { console.log(fails.join("\n")); process.exit(1); }
