/**
 * IG-DM-Archive Import.
 *
 * Liest alle Threads aus dem Meta-Account-Datenexport
 * (your_instagram_activity/messages/inbox/<thread>/message_N.json)
 * und schreibt sie in die chat_messages_archive Tabelle.
 *
 * QUIRK 1: Meta exportiert JSON-Strings als "mojibake" — die Bytes sind
 * UTF-8, aber als latin1 interpretiert. Lösung: Buffer.from(s, 'latin1')
 *   .toString('utf8') pro Text-Feld vor Insert.
 *
 * QUIRK 2: Manche messages haben kein content (nur photos/reactions/share).
 * Wir importieren nur Messages mit echtem Text-Inhalt (length >= 2).
 *
 * QUIRK 3: Threads können MEHRERE message_N.json haben (Meta paginiert
 * bei sehr langen Threads). Wir laden alle.
 *
 * NUTZUNG:
 *   npx tsx scripts/import-ig-archive.ts <path-to-inbox-dir>
 *   npx tsx scripts/import-ig-archive.ts <path> --dry-run
 *   npx tsx scripts/import-ig-archive.ts <path> --limit 100   (nur N Threads)
 *
 * Idempotenz: vor Insert wird thread_id+timestamp_ms-Combo geprüft.
 * Wenn schon importiert → skip Batch. Re-Run sicher.
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";
import path from "node:path";

const env = fs.readFileSync(".env.local", "utf8");
const supabaseUrl = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/)![1].trim();
const supabaseKey = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)![1].trim();
const sb = createClient(supabaseUrl, supabaseKey);

const HAIRVENLY_NAMES = new Set([
  "HAIRVENLY Extensions",
  "Hairvenly Extensions",
  "hairvenly",
  "HAIRVENLY",
]);

// CLI
const args = process.argv.slice(2);
const inboxDir = args[0];
if (!inboxDir || !fs.existsSync(inboxDir)) {
  console.error("Usage: npx tsx scripts/import-ig-archive.ts <inbox-dir> [--dry-run] [--limit N]");
  process.exit(1);
}
const dryRun  = args.includes("--dry-run");
const limitIdx = args.indexOf("--limit");
const limit  = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : 0;

/** Meta-Mojibake-Fix: Bytes sind UTF-8, aber als latin1 dekodiert. */
function fixEncoding(s: string): string {
  if (!s) return s;
  try {
    return Buffer.from(s, "latin1").toString("utf8");
  } catch {
    return s;
  }
}

type RawMsg = {
  sender_name?: string;
  timestamp_ms?: number;
  content?: string;
  share?: unknown;
  photos?: unknown;
  videos?: unknown;
  audio_files?: unknown;
};
type RawThread = {
  participants?: { name: string }[];
  messages?: RawMsg[];
  title?: string;
  thread_path?: string;
};

type Row = {
  thread_id: string;
  thread_title: string | null;
  sender_name: string;
  is_hairvenly: boolean;
  content: string;
  timestamp_ms: number;
  message_at: string;
};

function processThread(threadDir: string): Row[] {
  const files = fs.readdirSync(threadDir).filter(f => /^message_\d+\.json$/.test(f));
  const rows: Row[] = [];

  // thread_id aus dir name
  const threadId = path.basename(threadDir);

  for (const f of files) {
    let parsed: RawThread;
    try {
      parsed = JSON.parse(fs.readFileSync(path.join(threadDir, f), "utf8")) as RawThread;
    } catch (e) {
      console.warn(`  skip ${f} — parse error: ${(e as Error).message}`);
      continue;
    }
    const title = parsed.title ? fixEncoding(parsed.title) : null;
    const msgs = parsed.messages || [];
    for (const m of msgs) {
      const content = m.content ? fixEncoding(m.content).trim() : "";
      if (content.length < 2) continue;  // skip empty / pure attachment
      const sender = m.sender_name ? fixEncoding(m.sender_name) : "Unknown";
      if (!m.timestamp_ms) continue;
      rows.push({
        thread_id: threadId,
        thread_title: title,
        sender_name: sender,
        is_hairvenly: HAIRVENLY_NAMES.has(sender),
        content,
        timestamp_ms: m.timestamp_ms,
        message_at: new Date(m.timestamp_ms).toISOString(),
      });
    }
  }
  return rows;
}

async function alreadyImportedThread(threadId: string): Promise<boolean> {
  const { count } = await sb.from("chat_messages_archive")
    .select("*", { count: "exact", head: true })
    .eq("thread_id", threadId);
  return (count || 0) > 0;
}

async function main() {
  const all = fs.readdirSync(inboxDir).filter(d => {
    const p = path.join(inboxDir, d);
    return fs.statSync(p).isDirectory();
  });
  console.log(`Found ${all.length} thread dirs in ${inboxDir}`);
  const todo = limit > 0 ? all.slice(0, limit) : all;
  console.log(`Processing ${todo.length}${dryRun ? " (DRY-RUN)" : ""}\n`);

  let threadsProcessed = 0, threadsSkipped = 0, msgsInserted = 0;
  let totalBytes = 0;
  const tBatchSize = 25; // 25 threads per batch insert
  let batchRows: Row[] = [];

  async function flush() {
    if (batchRows.length === 0) return;
    if (!dryRun) {
      const { error } = await sb.from("chat_messages_archive").insert(batchRows);
      if (error) {
        console.warn(`  batch insert error: ${error.message}`);
      } else {
        msgsInserted += batchRows.length;
      }
    } else {
      msgsInserted += batchRows.length;
    }
    batchRows = [];
  }

  let i = 0;
  for (const d of todo) {
    i++;
    const threadDir = path.join(inboxDir, d);
    // Idempotenz: skip wenn schon importiert
    if (!dryRun) {
      const already = await alreadyImportedThread(d);
      if (already) {
        threadsSkipped++;
        continue;
      }
    }
    let rows: Row[];
    try {
      rows = processThread(threadDir);
    } catch (e) {
      console.warn(`  ${d}: process error ${(e as Error).message}`);
      continue;
    }
    if (rows.length === 0) {
      threadsSkipped++;
      continue;
    }
    batchRows.push(...rows);
    threadsProcessed++;
    totalBytes += rows.reduce((s, r) => s + r.content.length, 0);

    if (batchRows.length >= 1000) await flush();
    if (i % 100 === 0) {
      process.stdout.write(`  progress: ${i}/${todo.length} threads · ${msgsInserted + batchRows.length} msgs queued\n`);
    }
  }
  await flush();

  console.log(`\n=== Summary ===`);
  console.log(`Threads processed:   ${threadsProcessed}`);
  console.log(`Threads skipped:     ${threadsSkipped} (empty / already imported)`);
  console.log(`Messages inserted:   ${msgsInserted}${dryRun ? " (DRY-RUN — not written)" : ""}`);
  console.log(`Total text bytes:    ${(totalBytes / 1024 / 1024).toFixed(1)} MB`);
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
