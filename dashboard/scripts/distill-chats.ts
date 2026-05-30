/**
 * Re-Destillation: Chat-Sessions → Q&A-Pairs in chatbot_knowledge_archive_v2.
 *
 * MOTIVATION (2026-05-30): Die ursprüngliche Destillation (Mai 2026) hatte
 * einen hardcoded 40-pro-Topic-Cap in v1 und biz_score+conversion-Filter
 * in v2 → Themen wie Microringe, Tape-Kleber, Silikon-Zubehör fehlen
 * komplett. Mit diesem Skript füllt man gezielt Lücken ohne 3300 Chats
 * neu zu fahren.
 *
 * NUTZUNG:
 *   npx tsx scripts/distill-chats.ts --terms microring,mikroring
 *   npx tsx scripts/distill-chats.ts --session <uuid>
 *   npx tsx scripts/distill-chats.ts --since 2026-05-01 --topic produkte
 *   npx tsx scripts/distill-chats.ts --terms butterfly --dry-run
 *
 * Idempotent: source_chat_id wird im Format "[CHAT_<8chars>]" geschrieben
 * (kompatibel zur Original-Destillation), und vor Insert wird geprüft ob
 * für diese Session schon Einträge existieren.
 *
 * Kosten: ca. 0.5-1 Cent pro Session (Haiku 4.5, gewöhnlich 5-30 msgs).
 */
import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";
import fs from "node:fs";

const env = fs.readFileSync(".env.local", "utf8");
const supabaseUrl = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/)![1].trim();
const supabaseKey = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)![1].trim();
const anthropicKey = env.match(/ANTHROPIC_API_KEY=(.+)/)![1].trim();
const sb = createClient(supabaseUrl, supabaseKey);
const ai = new Anthropic({ apiKey: anthropicKey });

const MODEL = "claude-haiku-4-5";

// ── CLI args ────────────────────────────────────────────────────────
type Args = {
  terms?: string[];     // OR-Liste von Volltext-Begriffen
  session?: string;     // genau eine Session
  since?: string;       // ISO-Datum
  topic?: string;       // Filter-Topic
  dryRun?: boolean;
  maxSessions?: number;
};
function parseArgs(argv: string[]): Args {
  const a: Args = { maxSessions: 50 };
  for (let i = 0; i < argv.length; i++) {
    const x = argv[i];
    if (x === "--terms")    a.terms = argv[++i].split(",").map(s => s.trim());
    else if (x === "--session") a.session = argv[++i];
    else if (x === "--since")   a.since = argv[++i];
    else if (x === "--topic")   a.topic = argv[++i];
    else if (x === "--max")     a.maxSessions = parseInt(argv[++i], 10);
    else if (x === "--dry-run" || x === "--dry") a.dryRun = true;
  }
  return a;
}

const args = parseArgs(process.argv.slice(2));

// ── Schritt 1: Session-IDs ermitteln ────────────────────────────────
async function findSessions(): Promise<string[]> {
  if (args.session) return [args.session];

  // Cheap-search: chat_messages.content ilike → distinct session_id
  let q = sb.from("chat_messages")
    .select("session_id, created_at")
    .is("deleted_at", null);
  if (args.since) q = q.gte("created_at", args.since);
  if (args.terms && args.terms.length > 0) {
    // .or() mit ilike-Liste — Wir wollen ANY term matchen
    const orStr = args.terms.map(t => `content.ilike.%${t}%`).join(",");
    q = q.or(orStr);
  }
  const { data, error } = await q.limit(2000);
  if (error) { console.error("DB error:", error.message); process.exit(1); }
  const set = new Set<string>();
  for (const r of data || []) set.add(r.session_id as string);
  return Array.from(set);
}

// ── Schritt 2: Idempotenz-Check ─────────────────────────────────────
async function alreadyDistilled(sessionId: string): Promise<boolean> {
  const tag = `[CHAT_${sessionId.slice(0, 8).toUpperCase()}]`;
  const { count } = await sb.from("chatbot_knowledge_archive_v2")
    .select("*", { count: "exact", head: true })
    .eq("source_chat_id", tag);
  return (count || 0) > 0;
}

// ── Schritt 3: Conversation laden ───────────────────────────────────
type Msg = { role: string; content: string; created_at: string };
async function loadConversation(sessionId: string): Promise<Msg[]> {
  const { data } = await sb.from("chat_messages")
    .select("role, content, created_at")
    .eq("session_id", sessionId)
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  return (data || []).map(r => ({
    role: r.role as string,
    content: (r.content as string | null) || "",
    created_at: r.created_at as string,
  })).filter(m => m.content.trim().length > 0);
}

// ── Schritt 4: Haiku-Destillation ───────────────────────────────────
const ALLOWED_TOPICS = [
  "farbberatung", "preise", "produkte", "reklamation", "termine",
  "modell", "anfaenger", "pflege", "lager", "versand", "zahlung",
  "gewerbe", "kooperation", "rabatt", "sonstiges",
];

const SYSTEM_PROMPT = `Du destillierst Customer-Service-Chats von Hairvenly (Haarverlängerungen) in eine FAQ-Wissensbasis.

Lies die folgende Conversation komplett und extrahiere alle business-relevanten Q&A-Pairs. Pro Chat können 0 bis 5 Q&A entstehen.

REGELN:
1. Quelle der Antwort ist IMMER die Mitarbeiter:in (human_agent) oder der Bot (assistant) — nie der Customer.
2. Frage muss ein generalisierbares Wissens-Thema sein, nicht situativ ("kommst du am Dienstag?" → NEIN; "Was kosten Bondings?" → JA).
3. Antwort muss ALLE im Chat genannten Fakten enthalten, knapp aber vollständig.
4. Wenn der Chat NUR Termin-Buchung / Hin-und-Her ohne Sach-Inhalt enthält → leeres Array.
5. NIEMALS halluzinieren — nur was in der Conversation steht.

OUTPUT-FORMAT (strict JSON):
{
  "qa_pairs": [
    {
      "topic": "<einer von: ${ALLOWED_TOPICS.join(", ")}>",
      "question": "<klar formulierte generische Frage>",
      "answer": "<kompakte Antwort, max 400 Zeichen>",
      "facts": ["<Fakt 1>", "<Fakt 2>", ...],
      "tags": ["<tag1>", "<tag2>", ...],
      "biz_score": <1-5: wie häufig wird das gefragt?>,
      "conversion": <true wenn Kundin am Ende gekauft/gebucht hat>
    }
  ]
}

Wenn keine sinnvollen Q&A extrahierbar → {"qa_pairs": []}.
`;

type DistilledPair = {
  topic: string;
  question: string;
  answer: string;
  facts?: string[];
  tags?: string[];
  biz_score?: number;
  conversion?: boolean;
};

async function distill(sessionId: string, msgs: Msg[]): Promise<DistilledPair[]> {
  const transcript = msgs.map(m => {
    const role = m.role === "user" ? "CUSTOMER" : m.role === "assistant" ? "BOT" : m.role === "human_agent" ? "MA" : m.role.toUpperCase();
    return `[${role}] ${m.content}`;
  }).join("\n\n");

  const res = await ai.messages.create({
    model: MODEL,
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: `CHAT-ID: ${sessionId.slice(0, 8)}\n\n${transcript}` }],
  });
  const text = res.content.filter(c => c.type === "text").map(c => (c as { text: string }).text).join("");
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return [];
  try {
    const parsed = JSON.parse(jsonMatch[0]) as { qa_pairs?: DistilledPair[] };
    return (parsed.qa_pairs || []).filter(p =>
      p.topic && p.question && p.answer && ALLOWED_TOPICS.includes(p.topic)
    );
  } catch (e) {
    console.warn(`  parse error for ${sessionId.slice(0, 8)}:`, (e as Error).message);
    return [];
  }
}

// ── Schritt 5: Insert ───────────────────────────────────────────────
async function insertPairs(sessionId: string, pairs: DistilledPair[]): Promise<number> {
  if (pairs.length === 0) return 0;
  const sourceTag = `[CHAT_${sessionId.slice(0, 8).toUpperCase()}]`;
  const rows = pairs.map(p => ({
    topic: p.topic,
    question: p.question,
    answer: p.answer,
    facts: p.facts || [],
    tags: p.tags || [],
    biz_score: p.biz_score ?? 3,
    conversion: p.conversion ?? false,
    source_chat_id: sourceTag,
  }));
  const { error } = await sb.from("chatbot_knowledge_archive_v2").insert(rows);
  if (error) { console.warn(`  insert error: ${error.message}`); return 0; }
  return rows.length;
}

// ── Main ────────────────────────────────────────────────────────────
async function main() {
  console.log("=== distill-chats ===");
  console.log("args:", JSON.stringify(args, null, 2));
  const sessions = await findSessions();
  console.log(`Found ${sessions.length} candidate sessions.`);
  if (args.maxSessions && sessions.length > args.maxSessions) {
    console.log(`Capping to first ${args.maxSessions} (use --max to change).`);
  }
  const target = sessions.slice(0, args.maxSessions);

  let processed = 0, skipped = 0, totalPairs = 0, totalCost = 0;
  for (const sid of target) {
    const already = await alreadyDistilled(sid);
    if (already) {
      console.log(`  skip ${sid.slice(0, 8)} — already distilled`);
      skipped++;
      continue;
    }
    const msgs = await loadConversation(sid);
    if (msgs.length < 2) {
      console.log(`  skip ${sid.slice(0, 8)} — only ${msgs.length} msg`);
      skipped++;
      continue;
    }
    process.stdout.write(`  ${sid.slice(0, 8)} (${msgs.length} msgs) → `);
    const pairs = await distill(sid, msgs);
    // Rough cost estimate (haiku: 1$/M input, 5$/M output)
    const approxIn = msgs.reduce((s, m) => s + m.content.length / 4, 0) + 800;
    totalCost += (approxIn * 1 / 1e6) + (500 * 5 / 1e6);
    console.log(`${pairs.length} Q&A`);
    for (const p of pairs) {
      console.log(`    [${p.topic}] ${p.question.slice(0, 80)}`);
    }
    if (!args.dryRun) {
      const inserted = await insertPairs(sid, pairs);
      totalPairs += inserted;
    } else {
      totalPairs += pairs.length;
    }
    processed++;
  }
  console.log("\n=== Summary ===");
  console.log(`Sessions processed: ${processed}`);
  console.log(`Skipped (already done / too short): ${skipped}`);
  console.log(`Total Q&A ${args.dryRun ? "extracted" : "inserted"}: ${totalPairs}`);
  console.log(`Approx cost: $${totalCost.toFixed(4)}`);
  if (args.dryRun) console.log("\n[DRY-RUN] No DB writes.");
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
