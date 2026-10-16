import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { sanitizeRow, type BankRow } from "@/lib/bank/rows";
import { ingestBankRows, recordFetchStatus, runBankMatching } from "@/lib/bank/engine";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Empfängt Kontoumsätze vom lokalen FinTS-Worker (scripts/fints-worker).
 *
 * Auth: "Authorization: Bearer <secret>". Secret = BANK_INGEST_SECRET, falls in
 * Vercel gesetzt, sonst SUPABASE_SERVICE_ROLE_KEY (der Worker liest ihn aus
 * dashboard/.env.local). Fail-closed: ohne konfiguriertes Secret → 503.
 *
 * Body:
 *   { status: { ok: boolean, code: string, message?: string },
 *     transactions?: [{ booking_date, value_date, amount, currency, counterparty_name,
 *                       counterparty_iban, purpose, posting_text, end_to_end_ref, account_iban }] }
 *
 * Nach dem Import läuft sofort der Abgleich (Modus off/shadow/live aus bank_sync_state).
 */

function authorized(req: NextRequest): boolean | null {
  const secret = process.env.BANK_INGEST_SECRET || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) return null;
  const header = req.headers.get("authorization") ?? "";
  const given = header.startsWith("Bearer ") ? header.slice(7) : "";
  const a = crypto.createHash("sha256").update(given).digest();
  const b = crypto.createHash("sha256").update(secret).digest();
  return given.length > 0 && crypto.timingSafeEqual(a, b);
}

export async function POST(req: NextRequest) {
  const auth = authorized(req);
  if (auth === null) return NextResponse.json({ error: "Ingest secret not configured" }, { status: 503 });
  if (!auth) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { action?: string; status?: { ok?: boolean; code?: string; message?: string; success?: boolean }; transactions?: unknown[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Nur Abgleich fortsetzen (Zeitbudget des vorigen Aufrufs war erschöpft)
  if (body.action === "match") {
    try {
      return NextResponse.json({ ok: true, matching: await runBankMatching({ budgetMs: 40_000 }) });
    } catch (e) {
      return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
    }
  }

  const list = Array.isArray(body.transactions) ? body.transactions.slice(0, 5000) : [];
  const rows: BankRow[] = [];
  let rejected = 0;
  for (const item of list) {
    const row = item && typeof item === "object" ? sanitizeRow(item as Record<string, unknown>) : null;
    if (row) rows.push(row);
    else rejected++;
  }

  const ok = body.status?.ok !== false;
  const code = body.status?.code ?? (ok ? "ok" : "error");
  try {
    const imported = await ingestBankRows(rows, "fints");
    // Mehrere Banken: "success" = mindestens eine Bank hat geliefert (Worker setzt das Feld);
    // ältere Worker ohne das Feld → wie bisher nur bei ok + code "ok".
    const success = typeof body.status?.success === "boolean" ? body.status.success : ok && code === "ok";
    await recordFetchStatus({ ok, code, message: body.status?.message ?? null, success });
    // Import ist schnell; der Abgleich hat ein Zeitbudget unter dem 60-s-Limit.
    // Rest (matching.remaining > 0) holt der Worker per action "match" nach.
    const matching = await runBankMatching({ budgetMs: 35_000 });
    return NextResponse.json({ ok: true, ...imported, rejected, matching });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[bank/ingest]", msg);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
