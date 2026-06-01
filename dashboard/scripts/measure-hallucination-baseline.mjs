/**
 * BASELINE-MESSUNG: Wie oft halluziniert der Bot HEUTE?
 *
 * Läuft den fact-verifier (Schicht 2) über echte vergangene Bot-Antworten.
 * REINES MESSEN — kein Eingriff in den Live-Bot. Liefert die ehrliche
 * Ausgangszahl, gegen die wir künftige Verbesserungen beweisen.
 *
 * Run: node scripts/measure-hallucination-baseline.mjs [limit]
 */
import { readFileSync, existsSync, writeFileSync } from "fs";
import path from "path";
import Anthropic from "@anthropic-ai/sdk";

const env = {};
for (const f of [".env.local", ".env"]) {
  const p = path.resolve(process.cwd(), f);
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!(m[1] in env)) env[m[1]] = v;
  }
}
for (const k of ["NEXT_PUBLIC_SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "ANTHROPIC_API_KEY"]) {
  if (env[k] && !process.env[k]) process.env[k] = env[k];
}
const url = process.env.NEXT_PUBLIC_SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;

// verifyFacts — gespiegelt aus src/lib/chatbot/fact-verifier.ts (gleicher
// System-Prompt). Das Modul importiert das SDK relativ; hier inline mit
// node_modules-Import, damit das Mess-Skript standalone läuft.
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const VERIFIER_SYSTEM = `Du bist ein strenger Faktenprüfer für einen Haar-Extension-Shop (Hairvenly).
Du bekommst (A) eine Bot-Antwort an eine Kundin und (B) die Daten, die dem Bot in diesem Gespräch zur Verfügung standen (Tool-Ergebnisse + Stammdaten).

Deine Aufgabe: Finde JEDE ÜBERPRÜFBARE GESCHÄFTS-Tatsachenbehauptung in der Bot-Antwort, die sich NICHT aus den bereitgestellten Daten belegen lässt.

PRÜFE NUR diese Fakten-Kategorien:
- preis (konkrete ODER vergleichende Preisaussagen, z.B. "kostet 119€", "beide gleich teuer", "günstiger")
- verfuegbarkeit (auf Lager / ausverkauft / unterwegs)
- laenge / methode (welche Länge/Methode es in welcher Linie gibt)
- lieferdatum / eta (konkrete Termine)
- haltbarkeit (z.B. "hält 6-8 Monate")
- menge / mass (Packungsgrößen, Gramm, Strähnenzahl)

PRÜFE NICHT (das ist KEINE Halluzination):
- Begrüßung, Empathie, Smalltalk, Emojis
- subjektive Beratung/Geschmack ("würde dir stehen", "schöner Look")
- Rückfragen ("welche Länge schwebt dir vor?")
- allgemein bekannte Tatsachen über Haare/Pflege
- Aussagen, die durch die Daten GEDECKT sind

Eine Behauptung ist "nicht belegt", wenn die Daten sie nicht stützen ODER ihr widersprechen. Wenn in diesem Turn KEINE Tools aufgerufen wurden, sind ALLE konkreten Geschäfts-Fakten unbelegt (außer es sind triviale, allgemeine Aussagen).

Antworte als striktes JSON, nichts sonst:
{"unsupported":[{"claim":"<kurzes Zitat/Paraphrase>","category":"<kategorie>"}]}
Wenn alles belegt/unkritisch ist: {"unsupported":[]}`;

async function verifyFacts(botAnswer, toolResults) {
  const text = (botAnswer || "").trim();
  if (!text) return { hasUnsupported: false, unsupported: [] };
  const toolBlock = (toolResults || [])
    .map((t, i) => `[Tool ${i + 1}${t.name ? " " + t.name : ""}]\n${(t.content || "").slice(0, 2000)}`)
    .join("\n\n") || "(in diesem Turn wurden KEINE Tools aufgerufen)";
  const user = `=== (A) BOT-ANTWORT ===\n${text}\n\n=== (B) VERFÜGBARE DATEN ===\n${toolBlock}`;
  try {
    const resp = await anthropic.messages.create({
      model: "claude-haiku-4-5", max_tokens: 400, temperature: 0,
      system: VERIFIER_SYSTEM, messages: [{ role: "user", content: user }],
    });
    const out = resp.content.filter(b => b.type === "text").map(b => b.text).join("").trim();
    let parsed = null;
    const jm = out.match(/\{[\s\S]*\}/);
    if (jm) { try { parsed = JSON.parse(jm[0]); } catch {} }
    const unsupported = Array.isArray(parsed?.unsupported) ? parsed.unsupported : [];
    return { hasUnsupported: unsupported.length > 0, unsupported, raw: out };
  } catch (e) {
    console.warn("[verify] err:", e.message);
    return { hasUnsupported: false, unsupported: [], errored: true };
  }
}

const LIMIT = parseInt(process.argv[2] || "60", 10);
const since = new Date(Date.now() - 30 * 864e5).toISOString();

const r = await fetch(
  `${url}/rest/v1/chat_messages?select=id,content,tool_calls,tool_results,created_at,auto_sent&role=eq.assistant&created_at=gte.${since}&order=created_at.desc&limit=${LIMIT}`,
  { headers: { apikey: key, Authorization: `Bearer ${key}` } }
);
const msgs = await r.json();

let checked = 0, withTools = 0, hallucinated = 0, errored = 0;
const byCategory = {};
const examples = [];

for (const m of msgs) {
  const content = (m.content || "").trim();
  if (content.length < 25) continue; // Mini-Antworten überspringen
  const toolResults = Array.isArray(m.tool_results)
    ? m.tool_results.map(t => ({ name: t.name, content: typeof t.content === "string" ? t.content : JSON.stringify(t.content) }))
    : [];
  if (toolResults.length > 0) withTools++;

  const res = await verifyFacts(content, toolResults);
  if (res.errored) { errored++; continue; }
  checked++;
  if (res.hasUnsupported) {
    hallucinated++;
    for (const c of res.unsupported) byCategory[c.category] = (byCategory[c.category] || 0) + 1;
    if (examples.length < 15) {
      examples.push({
        date: m.created_at?.slice(0, 10),
        tools: toolResults.map(t => t.name).join(",") || "keine",
        snippet: content.slice(0, 100).replace(/\n/g, " "),
        claims: res.unsupported.map(c => `${c.category}: ${c.claim}`),
      });
    }
  }
}

const lines = [];
lines.push("=== HALLUZINATIONS-BASELINE (echte Bot-Antworten, 30 Tage) ===\n");
lines.push(`Geprüft:              ${checked} Antworten`);
lines.push(`Davon mit Tool-Beleg: ${withTools}`);
lines.push(`Verifier-Fehler:      ${errored} (übersprungen)`);
lines.push(`MIT unbelegtem Fakt:  ${hallucinated}  (${checked ? Math.round(hallucinated / checked * 100) : 0}%)`);
lines.push("");
lines.push("Unbelegte Fakten nach Kategorie:");
for (const [cat, n] of Object.entries(byCategory).sort((a, b) => b[1] - a[1])) lines.push(`  ${cat.padEnd(16)} ${n}`);
lines.push("");
lines.push("=== BEISPIELE (erste 15) ===");
for (const e of examples) {
  lines.push(`\n[${e.date}] tools=[${e.tools}]`);
  lines.push(`  "${e.snippet}"`);
  for (const c of e.claims) lines.push(`   ⚠ ${c}`);
}
const report = lines.join("\n");
writeFileSync("/tmp/hallucination-baseline.txt", report);
console.log(report);
