"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireFeature } from "@/lib/auth";
import { parseBankCsv } from "@/lib/bank/rows";
import {
  assignTransactionByNumber,
  confirmTransactionOrders,
  ingestBankRows,
  runBankMatching,
  setBankMode,
  setTransactionIgnored,
  type BankMode,
  type RunSummary,
} from "@/lib/bank/engine";

const PATH = "/finances/payments";

export interface BankTransaction {
  id: string;
  source: "fints" | "csv";
  booking_date: string;
  value_date: string | null;
  amount: number;
  counterparty_name: string | null;
  counterparty_iban: string | null;
  purpose: string | null;
  posting_text: string | null;
  match_status: "pending" | "processing" | "shadow" | "auto_paid" | "manual_paid" | "review" | "ignored" | "debit";
  match_reason: string | null;
  match_detail: string | null;
  matched_orders: { gid: string; name: string; outstanding: number }[];
  candidates: { gid: string; name: string; outstanding: number; via: "number" | "amount"; nameMatch: boolean; isBankDeposit: boolean }[];
  marked_paid_at: string | null;
  resolved_at: string | null;
  created_at: string;
}

export interface BankSyncState {
  auto_mark_mode: BankMode;
  last_fetch_at: string | null;
  last_fetch_ok: boolean | null;
  last_fetch_code: string | null;
  last_fetch_message: string | null;
  last_success_at: string | null;
}

export async function fetchBankOverview(daysBack = 60): Promise<{ state: BankSyncState | null; transactions: BankTransaction[] }> {
  await requireFeature("finances");
  const supabase = await createClient();
  const since = new Date(Date.now() - daysBack * 86400000).toISOString().slice(0, 10);
  const [{ data: state }, { data: txs, error }] = await Promise.all([
    supabase.from("bank_sync_state").select("*").eq("id", 1).maybeSingle(),
    supabase
      .from("bank_transactions")
      .select("id, source, booking_date, value_date, amount, counterparty_name, counterparty_iban, purpose, posting_text, match_status, match_reason, match_detail, matched_orders, candidates, marked_paid_at, resolved_at, created_at")
      .gt("amount", 0)
      .gte("booking_date", since)
      .order("booking_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(600),
  ]);
  if (error) throw new Error(error.message);
  return {
    state: (state as BankSyncState | null) ?? null,
    transactions: ((txs ?? []) as BankTransaction[]).map((t) => ({ ...t, amount: Number(t.amount) })),
  };
}

type ActionResult = { ok: boolean; error?: string; info?: string };

export async function setBankModeAction(mode: BankMode): Promise<ActionResult> {
  const profile = await requireFeature("finances");
  if (profile.role !== "admin") return { ok: false, error: "Nur Admins dürfen den Modus ändern." };
  if (!["off", "shadow", "live"].includes(mode)) return { ok: false, error: "Ungültiger Modus" };
  await setBankMode(mode);
  revalidatePath(PATH);
  return { ok: true };
}

export async function runBankMatchingAction(): Promise<ActionResult & { summary?: RunSummary }> {
  await requireFeature("finances");
  try {
    const summary = await runBankMatching();
    revalidatePath(PATH);
    return { ok: true, summary };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function confirmBankMatchAction(txId: string, orderGids: string[]): Promise<ActionResult> {
  const profile = await requireFeature("finances");
  const res = await confirmTransactionOrders(txId, orderGids, { id: profile.id, name: profile.display_name ?? profile.username });
  revalidatePath(PATH);
  return res;
}

export async function assignBankByNumberAction(txId: string, orderNumber: string): Promise<ActionResult> {
  const profile = await requireFeature("finances");
  const res = await assignTransactionByNumber(txId, orderNumber, { id: profile.id, name: profile.display_name ?? profile.username });
  revalidatePath(PATH);
  return res;
}

export async function ignoreBankTxAction(txId: string, ignored: boolean): Promise<ActionResult> {
  const profile = await requireFeature("finances");
  const res = await setTransactionIgnored(txId, ignored, profile.id);
  if (res.ok && !ignored) await runBankMatching().catch(() => null);
  revalidatePath(PATH);
  return res;
}

/** CSV-Fallback: Umsatz-Export aus Lexware oder Sparkasse hochladen. */
export async function importBankCsvAction(_prev: unknown, formData: FormData): Promise<ActionResult & { summary?: RunSummary }> {
  await requireFeature("finances");
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Keine Datei gewählt." };
  if (file.size > 4 * 1024 * 1024) return { ok: false, error: "Datei zu groß (max. 4 MB)." };

  const buf = new Uint8Array(await file.arrayBuffer());
  let text = new TextDecoder("utf-8").decode(buf);
  // Sparkasse/Lexware exportieren teils Windows-1252 → Umlaute als U+FFFD
  if (text.includes("�")) text = new TextDecoder("windows-1252").decode(buf);

  const parsed = parseBankCsv(text);
  if (parsed.error) return { ok: false, error: parsed.error };
  if (parsed.rows.length === 0) return { ok: false, error: `Keine Umsätze erkannt (${parsed.skipped} Zeilen übersprungen).` };

  try {
    const imp = await ingestBankRows(parsed.rows, "csv");
    const summary = await runBankMatching();
    revalidatePath(PATH);
    const credits = parsed.rows.filter((r) => r.amount > 0).length;
    return {
      ok: true,
      summary,
      info:
        `${parsed.rows.length} Umsätze gelesen (${credits} Eingänge), ${imp.inserted} neu, ` +
        `${parsed.rows.length - imp.inserted} schon vorhanden` +
        (parsed.skipped ? `, ${parsed.skipped} Zeilen übersprungen` : "") + ".",
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
