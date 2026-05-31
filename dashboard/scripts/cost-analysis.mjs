import { readFileSync, writeFileSync, existsSync } from "fs";
import path from "path";

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
const url = env.NEXT_PUBLIC_SUPABASE_URL;
const key = env.SUPABASE_SERVICE_ROLE_KEY;

async function rest(table, qs) {
  const r = await fetch(`${url}/rest/v1/${table}?${qs}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Prefer: "count=exact" },
  });
  if (!r.ok) throw new Error(`${table}: ${r.status} ${await r.text()}`);
  const total = r.headers.get("content-range");
  const data = await r.json();
  return { data, total };
}

// Alle usage-log-Zeilen der letzten 30 Tage paginiert holen
async function fetchAllUsage(sinceIso) {
  const all = [];
  let offset = 0;
  const pageSize = 1000;
  for (;;) {
    const r = await fetch(
      `${url}/rest/v1/chatbot_usage_log?select=created_at,purpose,model,cost_usd,input_tokens,output_tokens,cache_read_input_tokens,cache_creation_input_tokens,session_id,extra&created_at=gte.${sinceIso}&order=created_at.asc&limit=${pageSize}&offset=${offset}`,
      { headers: { apikey: key, Authorization: `Bearer ${key}` } }
    );
    if (!r.ok) throw new Error(`usage page: ${r.status} ${await r.text()}`);
    const page = await r.json();
    all.push(...page);
    if (page.length < pageSize) break;
    offset += pageSize;
  }
  return all;
}

const out = { generatedAt: new Date().toISOString() };

try {
  const since30 = new Date(Date.now() - 30 * 86400e3).toISOString();
  const since7 = new Date(Date.now() - 7 * 86400e3).toISOString();
  const since1 = new Date(Date.now() - 1 * 86400e3).toISOString();
  const rows = await fetchAllUsage(since30);
  out.totalRows30d = rows.length;

  function analyze(rows, label) {
    const byPurpose = {};
    let totalCost = 0;
    for (const r of rows) {
      const c = Number(r.cost_usd) || 0;
      totalCost += c;
      const p = byPurpose[r.purpose] ??= { calls: 0, cost: 0, model: r.model, outLt20: 0, withTool: 0, cacheCreateRows: 0, cacheCreateCost: 0, cacheReadRows: 0 };
      p.calls++; p.cost += c;
      if ((Number(r.output_tokens) || 0) < 20) p.outLt20++;
      const tc = r.extra && typeof r.extra === "object" ? (r.extra.tool_calls || 0) : 0;
      if (tc > 0) p.withTool++;
      const cc = Number(r.cache_creation_input_tokens) || 0;
      const cr = Number(r.cache_read_input_tokens) || 0;
      if (cc > 0) { p.cacheCreateRows++; p.cacheCreateCost += c; }
      if (cr > 0) p.cacheReadRows++;
    }
    const purposes = Object.entries(byPurpose)
      .map(([k, v]) => ({ purpose: k, model: v.model, calls: v.calls, cost: +v.cost.toFixed(4), avgCt: +((v.cost / v.calls) * 100).toFixed(3), outLt20: v.outLt20, withTool: v.withTool, cacheCreateRows: v.cacheCreateRows, cacheCreateCost: +v.cacheCreateCost.toFixed(4), cacheReadRows: v.cacheReadRows }))
      .sort((a, b) => b.cost - a.cost);
    return { label, totalCostUsd: +totalCost.toFixed(4), days: label, purposes };
  }

  out.window30d = analyze(rows, "30d");
  out.window7d = analyze(rows.filter(r => r.created_at >= since7), "7d");
  out.window1d = analyze(rows.filter(r => r.created_at >= since1), "1d");

  // respond-Detailanalyse (30d)
  const respond = rows.filter(r => r.purpose === "respond");
  const respondCost = respond.reduce((s, r) => s + (Number(r.cost_usd) || 0), 0);
  const cacheCreate = respond.filter(r => (Number(r.cache_creation_input_tokens) || 0) > 0);
  const cacheCreateCost = cacheCreate.reduce((s, r) => s + (Number(r.cost_usd) || 0), 0);
  const emptyish = respond.filter(r => (Number(r.output_tokens) || 0) < 20);
  const emptyishCost = emptyish.reduce((s, r) => s + (Number(r.cost_usd) || 0), 0);

  // respond-Calls pro Session-Turn schätzen: gruppiere nach session_id + 5-Min-Bucket
  const turnKeys = new Set();
  for (const r of respond) {
    const t = Math.floor(new Date(r.created_at).getTime() / (5 * 60e3));
    turnKeys.add(`${r.session_id}_${t}`);
  }

  out.respondDetail30d = {
    respondCalls: respond.length,
    respondCostUsd: +respondCost.toFixed(4),
    estTurns: turnKeys.size,
    avgCallsPerTurn: +(respond.length / Math.max(1, turnKeys.size)).toFixed(2),
    avgCtPerTurn: +((respondCost / Math.max(1, turnKeys.size)) * 100).toFixed(2),
    cacheCreateCalls: cacheCreate.length,
    cacheCreateCostUsd: +cacheCreateCost.toFixed(4),
    cacheCreateShareOfRespond: +((cacheCreateCost / Math.max(1e-9, respondCost)) * 100).toFixed(1),
    lowOutputCalls: emptyish.length,
    lowOutputCostUsd: +emptyishCost.toFixed(4),
  };

  // Gegenprobe: tatsächlich gesendete Bot-Nachrichten + Drafts (30d)
  try {
    const sentAuto = await rest("chat_messages", `select=id&role=eq.assistant&auto_sent=is.true&created_at=gte.${since30}&limit=1`);
    const sentAll = await rest("chat_messages", `select=id&role=eq.assistant&created_at=gte.${since30}&limit=1`);
    const drafts = await rest("chat_drafts", `select=id&created_at=gte.${since30}&limit=1`);
    out.outcomes30d = {
      assistantMsgs_total_range: sentAll.total,
      assistantMsgs_autoSent_range: sentAuto.total,
      drafts_range: drafts.total,
    };
  } catch (e) {
    out.outcomes30d = { error: String(e.message || e) };
  }
} catch (e) {
  out.error = String(e.message || e);
}

writeFileSync("/tmp/cost-analysis.json", JSON.stringify(out, null, 2));

// Flacher Text-Report ins Projektverzeichnis (für zuverlässiges Lesen)
const L = [];
L.push("=== KOSTENANALYSE " + out.generatedAt + " ===");
L.push("usage-log Zeilen (30d): " + out.totalRows30d);
for (const w of [out.window1d, out.window7d, out.window30d]) {
  if (!w) continue;
  L.push("");
  L.push("--- Fenster " + w.label + " | Gesamt $" + w.totalCostUsd + " ---");
  L.push("purpose | model | calls | cost$ | avg_ct | out<20 | mitTool | cacheCreate(rows/$) | cacheRead_rows");
  for (const p of w.purposes) {
    L.push([p.purpose, p.model, p.calls, "$" + p.cost, p.avgCt + "ct", p.outLt20, p.withTool, p.cacheCreateRows + "/$" + p.cacheCreateCost, p.cacheReadRows].join(" | "));
  }
}
if (out.respondDetail30d) {
  const d = out.respondDetail30d;
  L.push("");
  L.push("--- RESPOND-DETAIL (30d) ---");
  L.push("respond-Calls: " + d.respondCalls + " | Kosten $" + d.respondCostUsd);
  L.push("geschätzte Antwort-Turns: " + d.estTurns + " | Calls/Turn: " + d.avgCallsPerTurn + " | Ø ct/Turn: " + d.avgCtPerTurn);
  L.push("Cache-Neuaufbau-Calls: " + d.cacheCreateCalls + " | Kosten $" + d.cacheCreateCostUsd + " | Anteil an respond: " + d.cacheCreateShareOfRespond + "%");
  L.push("Low-Output-Calls (<20 tok, evtl. verworfen): " + d.lowOutputCalls + " | Kosten $" + d.lowOutputCostUsd);
}
if (out.outcomes30d) {
  L.push("");
  L.push("--- OUTCOMES (30d, content-range) ---");
  L.push(JSON.stringify(out.outcomes30d));
}
if (out.error) L.push("ERROR: " + out.error);
writeFileSync(path.resolve(process.cwd(), "scripts/cost-report.txt"), L.join("\n") + "\n");
