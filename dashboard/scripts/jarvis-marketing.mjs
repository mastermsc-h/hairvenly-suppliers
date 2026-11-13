#!/usr/bin/env node
// Jarvis-Zugriff (nur lesen) auf Marketing-Zahlen und HALO-Team-Aufgaben.
//   node scripts/jarvis-marketing.mjs halo                → offene Aufgaben (JSON)
//   node scripts/jarvis-marketing.mjs marketing [tage]    → Kennzahlen der letzten N Tage (Standard 28)
// Liest HALO_* / MKT_* aus .env.local. SQL der Gegenstellen: supabase/external/*.sql
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const env = {};
const envPfad = join(dirname(fileURLToPath(import.meta.url)), "..", ".env.local");
for (const z of readFileSync(envPfad, "utf8").split("\n")) {
  const m = z.match(/^(HALO_|MKT_)([A-Z_]+)=(.*)$/);
  if (m) env[m[1] + m[2]] = m[3].trim();
}

const [was = "halo", tage = "28"] = process.argv.slice(2);
const P = was === "halo" ? "HALO" : was === "marketing" ? "MKT" : null;
if (!P) {
  console.error("Aufruf: jarvis-marketing.mjs halo | marketing [tage]");
  process.exit(1);
}
const fn = P === "HALO" ? "jarvis_halo" : "jarvis_marketing";
const body = { p_key: env[`${P}_JARVIS_KEY`], ...(P === "MKT" ? { p_days: Number(tage) } : {}) };
const r = await fetch(`${env[`${P}_SUPABASE_URL`]}/rest/v1/rpc/${fn}`, {
  method: "POST",
  headers: { apikey: env[`${P}_SUPABASE_ANON_KEY`], Authorization: `Bearer ${env[`${P}_SUPABASE_ANON_KEY`]}`, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
const text = await r.text();
if (!r.ok) {
  console.error(`HTTP ${r.status}: ${text}`);
  process.exit(1);
}
console.log(JSON.stringify(JSON.parse(text), null, 2));
