/**
 * SMOKE-TEST BASELINE — misst was aktuell funktioniert.
 * Läuft direkt gegen detectContactIntent + renderContactResponse,
 * KEINE Auswirkung auf Live-Bot.
 *
 * Run: npx tsx scripts/smoke/bypass-baseline.ts
 */
import { detectContactIntent, renderContactResponse } from "../../src/lib/chatbot/intent-contact";
import { BUSINESS_CONFIG } from "../../src/lib/chatbot/business-config";

type Case = { msg: string; expect: string | null; note?: string };

// 30 kanonische Test-Inputs aus echten chat_messages + heutigen Bug-Reports
const CASES: Case[] = [
  // ─── ADDRESS (basics) ─────────────────────────────────────────
  { msg: "wo seid ihr?",                              expect: "address_or_location" },
  { msg: "wie lautet eure adresse?",                  expect: "address_or_location" },
  { msg: "wo finde ich euch?",                        expect: "address_or_location" },
  { msg: "kann ich vorbeikommen?",                    expect: "address_or_location" },
  { msg: "nochmal eure adresse bitte",                expect: "address_or_location" },

  // ─── ADDRESS CORRECTION (heute bewiesen problematisch) ───────
  { msg: "okay ich muss in die hans-bernhard-str. richtig ?",            expect: "address_correction" },
  { msg: "ihr seid ja in der hans-bernhard-str. richtig ? komme vorbei", expect: "address_correction" },
  { msg: "muss ich in die parkallee?",                                   expect: "address_correction" },
  { msg: "wir kommen zur buchtstraße 8 oder?",                           expect: "address_correction" },
  { msg: "ist das eure adresse: haferwende 1?",                          expect: "address_correction" },

  // ─── PHONE ────────────────────────────────────────────────────
  { msg: "wie ist eure telefonnummer?",               expect: "phone" },
  { msg: "kann ich euch anrufen?",                    expect: "phone" },

  // ─── PHONE CORRECTION ─────────────────────────────────────────
  { msg: "ist 0421/12345 eure nummer?",               expect: "phone_correction" },

  // ─── EMAIL ────────────────────────────────────────────────────
  { msg: "wie ist eure email?",                       expect: "email" },
  { msg: "eure mail adresse?",                        expect: "email" },

  // ─── EMAIL CORRECTION ─────────────────────────────────────────
  { msg: "info@hairvenli.de richtig?",                expect: "email_correction" },

  // ─── OPENING HOURS ────────────────────────────────────────────
  { msg: "wann habt ihr offen?",                      expect: "opening_hours" },
  { msg: "wie sind eure öffnungszeiten?",             expect: "opening_hours" },

  // ─── HOURS CORRECTION ─────────────────────────────────────────
  { msg: "habt ihr bis 19 uhr offen?",                expect: "hours_correction" },
  { msg: "samstag geöffnet?",                         expect: "hours_correction" },

  // ─── APPOINTMENT ──────────────────────────────────────────────
  { msg: "kann ich einen termin buchen?",             expect: "appointment" },
  { msg: "wann hättet ihr nächste woche frei?",       expect: "appointment" },
  { msg: "ich möchte einen termin am 1.8.",           expect: "appointment" },

  // ─── NEGATIVE TESTS (dürfen NICHT als Contact erkannt werden) ─
  { msg: "welche tape farbe gibt es?",                expect: null },
  { msg: "habt ihr 5p18a?",                           expect: null },
  { msg: "feines haar, was passt?",                   expect: null },
  { msg: "hallo!",                                    expect: null },
  { msg: "kannst du mir das produkt zeigen?",         expect: null },
  { msg: "sicher?",                                   expect: null },
  { msg: "ist die straße einfach zu finden?",         expect: null, note: "edge: generic street word ohne konkrete adresse" },
];

let pass = 0, fail = 0;
const failures: Array<Case & { got: string | null }> = [];

console.log(`\n=== Bypass-Baseline-Smoke-Test (${CASES.length} Cases) ===\n`);
for (const tc of CASES) {
  const got = detectContactIntent(tc.msg);
  const ok = got === tc.expect;
  if (ok) {
    pass++;
    const expLabel = (tc.expect || "(null)").padEnd(24);
    console.log(`✓ ${expLabel} ← ${tc.msg.slice(0, 65)}`);
  } else {
    fail++;
    failures.push({ ...tc, got });
    console.log(`✗ expect=${tc.expect || "null"}, got=${got || "null"}  ← ${tc.msg}`);
  }
}

// Render-Test für die erkannten Intents — Templates müssen die Config-Daten enthalten
console.log(`\n=== Render-Verifikation (Templates müssen Config-Daten enthalten) ===\n`);
const renderTests = [
  { intent: "address_or_location" as const, mustContain: [BUSINESS_CONFIG.street, BUSINESS_CONFIG.postal_code] },
  { intent: "address_correction" as const,  mustContain: [BUSINESS_CONFIG.street, BUSINESS_CONFIG.postal_code] },
  { intent: "phone" as const,               mustContain: [BUSINESS_CONFIG.whatsapp_number] },
  { intent: "phone_correction" as const,    mustContain: [BUSINESS_CONFIG.whatsapp_number] },
  { intent: "email" as const,               mustContain: [BUSINESS_CONFIG.email] },
  { intent: "email_correction" as const,    mustContain: [BUSINESS_CONFIG.email] },
  { intent: "opening_hours" as const,       mustContain: [BUSINESS_CONFIG.opening_hours_text] },
  { intent: "hours_correction" as const,    mustContain: [BUSINESS_CONFIG.opening_hours_text] },
  { intent: "appointment" as const,         mustContain: [BUSINESS_CONFIG.planity_url] },
];
let renderPass = 0, renderFail = 0;
for (const rt of renderTests) {
  const out = renderContactResponse(rt.intent);
  const missing = rt.mustContain.filter(s => !out.includes(s));
  if (missing.length === 0) {
    renderPass++;
    console.log(`✓ ${rt.intent.padEnd(24)} enthält alle Pflicht-Strings`);
  } else {
    renderFail++;
    console.log(`✗ ${rt.intent.padEnd(24)} FEHLT: ${missing.join(", ")}`);
    console.log(`    Output: ${out.slice(0, 200)}...`);
  }
}

console.log(`\n=== ERGEBNIS ===`);
console.log(`Detect:  ${pass}/${CASES.length} pass, ${fail} fail`);
console.log(`Render:  ${renderPass}/${renderTests.length} pass, ${renderFail} fail`);

if (fail > 0) {
  console.log("\n--- FAILURES (detect) ---");
  for (const f of failures) {
    console.log(`  msg:      "${f.msg}"`);
    console.log(`  expected: ${f.expect || "null"}`);
    console.log(`  got:      ${f.got || "null"}`);
    if (f.note) console.log(`  note:     ${f.note}`);
    console.log();
  }
}

process.exit(fail + renderFail > 0 ? 1 : 0);
