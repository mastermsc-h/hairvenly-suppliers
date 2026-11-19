// Zahlungsabgleich-Engine — server-only. Läuft mit service_role, weil sie
// sowohl vom Worker-Endpoint (ohne User-Session) als auch aus Server Actions
// (nach requireFeature-Check) aufgerufen wird.
import { createServiceClient } from "@/lib/supabase/server";
import { dedupeKeys, type BankRow } from "./rows";
import { runKategorisierung } from "./kategorien-engine";
import { lieferantenZahlungenAbgleichen } from "./lieferanten-zahlungen";
import { effektiveIban } from "./kategorien";
import {
  institutionalCredit,
  matchTransaction,
  plausibleClosedNumbers,
  refineAmountOnly,
  stripForeignAmountOnly,
  toCents,
  type AmountOrder,
  type ClosedOrderInfo,
  type MatchResult,
  type MatchTx,
  type OpenOrder,
} from "./matcher";
import {
  fetchOpenOrdersForMatching,
  fetchOrderByNumber,
  fetchOrdersByAmount,
  lookupClosedOrders,
  markOrderPaidVerified,
} from "./shopify-orders";

export type BankMode = "off" | "shadow" | "live";
export type BankSource = "fints" | "csv";

type Sb = ReturnType<typeof createServiceClient>;

interface TxRow {
  id: string;
  booking_date: string;
  amount: number;
  purpose: string | null;
  counterparty_name: string | null;
  counterparty_iban?: string | null;
  posting_text?: string | null;
  end_to_end_ref: string | null;
  match_status: string;
  candidates?: unknown;
}

const TX_FIELDS =
  "id, booking_date, amount, purpose, counterparty_name, counterparty_iban, posting_text, end_to_end_ref, match_status";

/** Führt fn für alle Elemente aus, je `size` parallel. */
async function inBatches<T>(items: T[], size: number, fn: (x: T) => PromiseLike<unknown>): Promise<void> {
  for (let i = 0; i < items.length; i += size) await Promise.all(items.slice(i, i + size).map(fn));
}

function eur(n: number): string {
  return n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}
function deDate(iso: string): string {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
}
/** YYYY-MM-DD minus n Tage (UTC, mittag-sicher gegen DST). */
function minusDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}
/** Bestellnummer aus "#29054" / "29054" normalisieren (wie lookupClosedOrders). */
function orderNum(name: string): string {
  return String(name).replace(/^#/, "").replace(/^0+/, "");
}

function noteFor(tx: TxRow, how: string): string {
  return [
    `Zahlungseingang ${deDate(tx.booking_date)}: ${eur(Number(tx.amount))}${tx.counterparty_name ? ` von ${tx.counterparty_name}` : ""}.`,
    tx.purpose ? `Verwendungszweck: ${tx.purpose.slice(0, 200)}` : null,
    how,
  ].filter(Boolean).join("\n");
}

// ── Zustand / Flag ──────────────────────────────────────────────────────────

export async function getBankMode(sb: Sb = createServiceClient()): Promise<BankMode> {
  const { data } = await sb.from("bank_sync_state").select("auto_mark_mode").eq("id", 1).maybeSingle();
  const m = (data?.auto_mark_mode ?? "shadow") as BankMode;
  return ["off", "shadow", "live"].includes(m) ? m : "shadow";
}

export async function setBankMode(mode: BankMode): Promise<void> {
  const sb = createServiceClient();
  const { error } = await sb.from("bank_sync_state").upsert({ id: 1, auto_mark_mode: mode, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
}

export async function recordFetchStatus(s: { ok: boolean; code: string; message?: string | null; success?: boolean }): Promise<void> {
  const sb = createServiceClient();
  const now = new Date().toISOString();
  const patch: Record<string, unknown> = {
    id: 1,
    last_fetch_at: now,
    last_fetch_ok: s.ok,
    last_fetch_code: s.code.slice(0, 40),
    last_fetch_message: s.message ? s.message.slice(0, 500) : null,
    updated_at: now,
  };
  if (s.success) patch.last_success_at = now;
  await sb.from("bank_sync_state").upsert(patch);
}

/**
 * Kontostände von der Bank (FinTS HKSAL) speichern — je Konto der neueste Stand.
 * Ungültige Einträge werden verworfen (Worker-Daten nie ungeprüft übernehmen).
 */
export async function recordBalances(list: unknown[]): Promise<number> {
  const rows = list
    .map((b) => (b && typeof b === "object" ? (b as Record<string, unknown>) : null))
    .filter((b): b is Record<string, unknown> => !!b)
    .map((b) => ({
      account_iban: String(b.account_iban ?? "").replace(/\s/g, "").toUpperCase(),
      saldo: Number(b.saldo),
      stand: String(b.stand ?? ""),
    }))
    // "PAYPAL" = PayPal-Guthaben (Worker, REST API) — kein IBAN, aber gleiches Format
    .filter((b) => (/^[A-Z]{2}\d{2}[A-Z0-9]{10,30}$/.test(b.account_iban) || b.account_iban === "PAYPAL") && Number.isFinite(b.saldo) && Math.abs(b.saldo) < 1e9 && /^\d{4}-\d{2}-\d{2}$/.test(b.stand))
    .slice(0, 20);
  if (!rows.length) return 0;
  const sb = createServiceClient();
  const now = new Date().toISOString();
  const { error } = await sb.from("bank_salden").upsert(rows.map((r) => ({ ...r, abgerufen_am: now })), { onConflict: "account_iban" });
  if (error) throw new Error(error.message);
  return rows.length;
}

// ── Import ──────────────────────────────────────────────────────────────────

export async function ingestBankRows(
  rows: BankRow[],
  source: BankSource,
  raws?: unknown[],
): Promise<{ received: number; inserted: number }> {
  if (rows.length === 0) return { received: 0, inserted: 0 };
  const sb = createServiceClient();
  const keys = dedupeKeys(rows);
  const records = rows.map((r, i) => ({
    dedupe_key: keys[i],
    source,
    ...r,
    match_status: r.amount > 0 ? "pending" : r.amount < 0 ? "debit" : "ignored",
    raw: raws?.[i] ?? null,
  }));
  let inserted = 0;
  for (let i = 0; i < records.length; i += 200) {
    const chunk = records.slice(i, i + 200);
    const { data, error } = await sb
      .from("bank_transactions")
      .upsert(chunk, { onConflict: "dedupe_key", ignoreDuplicates: true })
      .select("id");
    if (error) throw new Error(`Import fehlgeschlagen: ${error.message}`);
    inserted += data?.length ?? 0;
  }
  return { received: rows.length, inserted };
}

// ── Abgleich-Lauf ───────────────────────────────────────────────────────────

export interface RunSummary {
  mode: BankMode;
  processed: number;
  autoPaid: number;
  shadow: number;
  review: number;
  ignored: number;
  /** Noch offen (Zeitbudget erschöpft) — Aufrufer kann erneut anstoßen. */
  remaining: number;
  errors: string[];
  /** Kategorisierung der Kontoumsätze (nach dem Abgleich). */
  kategorien?: { geprueft: number; geaendert: number; remaining: number };
  /** Selbstheilung: Prüf-/Shadow-Fälle, deren Bestellung inzwischen bezahlt oder
   *  per Betrag+Name als Fremd-/Eigen-Bestellung neu bewertet wurde. */
  healed?: { checked: number; resolved: number; relabeled: number; refined: number };
  /** Überweisungen an Ebru/Amanda, die automatisch als Zahlung eingetragen wurden. */
  lieferantenZahlungen?: { geprueft: number; gebucht: number; unklar: number };
}

/**
 * Gleicht alle offenen Eingänge ab. Idempotent, parallel-sicher, zeitbegrenzt:
 *  - Umsätze werden blockweise per bedingtem Update "geclaimt"
 *    (pending/shadow → processing); ein zweiter Lauf überspringt sie;
 *  - vor jedem orderMarkAsPaid liest markOrderPaidVerified den Live-Status —
 *    eine schon bezahlte Bestellung wird nie zweimal markiert;
 *  - nach `budgetMs` werden unbearbeitete Claims sofort zurückgegeben
 *    (Vercel bricht Funktionen nach 60 s ab — gemessen beim Erstimport
 *    von 243 Eingängen am 15.10.2026); `remaining` sagt, ob noch etwas offen ist;
 *  - hängengebliebene Claims (>10 Min) gibt der nächste Lauf frei.
 */
export async function runBankMatching(opts: { budgetMs?: number } = {}): Promise<RunSummary> {
  const summary = await abgleichLauf(opts);
  // Selbstheilung: Prüf-/Shadow-Fälle, deren vorgeschlagene Bestellung inzwischen
  // (meist von Hand in Shopify) bezahlt wurde, auflösen — sonst bleiben sie ewig
  // in "Zu prüfen" stehen, obwohl die Bestellung längst bezahlt ist.
  // Ein Fehler hier darf den Zahlungsabgleich nie scheitern lassen.
  try {
    summary.healed = await healResolvedReviews();
  } catch (e) {
    summary.errors.push(`Selbstheilung: ${e instanceof Error ? e.message : String(e)}`);
  }
  // Kategorien (Reiter Kontoumsätze) + Steuer-Ledger nachziehen — auch im Modus "off".
  // Läuft nach dem Abgleich, weil Kunden-Überweisungen erst dann als Vorkasse erkennbar sind.
  // Ein Fehler hier darf den Zahlungsabgleich nie scheitern lassen.
  try {
    summary.kategorien = await runKategorisierung({ scope: "neu", maxRows: 500 });
  } catch (e) {
    summary.errors.push(`Kategorisierung: ${e instanceof Error ? e.message : String(e)}`);
  }
  // Vergessene Zahlungen an Auslandslieferanten nachtragen — Fehler hier stoppen nichts.
  try {
    const lz = await lieferantenZahlungenAbgleichen(createServiceClient());
    summary.lieferantenZahlungen = { geprueft: lz.geprueft, gebucht: lz.gebucht.length, unklar: lz.unklar };
    summary.errors.push(...lz.errors.map((x) => `Lieferanten-Zahlung: ${x}`));
  } catch (e) {
    summary.errors.push(`Lieferanten-Zahlungen: ${e instanceof Error ? e.message : String(e)}`);
  }
  return summary;
}

async function abgleichLauf(opts: { budgetMs?: number }): Promise<RunSummary> {
  const started = Date.now();
  const budget = opts.budgetMs ?? 40_000;
  const sb = createServiceClient();
  const { data: st } = await sb
    .from("bank_sync_state").select("auto_mark_mode, matching_since").eq("id", 1).maybeSingle();
  const mode = (["off", "shadow", "live"].includes(st?.auto_mark_mode) ? st?.auto_mark_mode : "shadow") as BankMode;
  // Vor dem Start des Abgleichs gebuchte Eingänge ohne jeden Bezug werden nicht
  // zur Prüfung vorgelegt (Rückgriff beim Erstimport = 90 Tage Altlasten).
  const matchingSince: string = st?.matching_since ?? "1970-01-01";
  const summary: RunSummary = { mode, processed: 0, autoPaid: 0, shadow: 0, review: 0, ignored: 0, remaining: 0, errors: [] };
  if (mode === "off") return summary;

  await sb
    .from("bank_transactions")
    .update({ match_status: "pending" })
    .eq("match_status", "processing")
    .lt("updated_at", new Date(Date.now() - 10 * 60_000).toISOString());

  const statuses = mode === "live" ? ["pending", "shadow"] : ["pending"];
  const countRemaining = async () => {
    const { count } = await sb
      .from("bank_transactions").select("id", { count: "exact", head: true })
      .in("match_status", statuses).gt("amount", 0);
    return count ?? 0;
  };

  const { data: txData, error } = await sb
    .from("bank_transactions")
    .select(TX_FIELDS)
    .in("match_status", statuses)
    .gt("amount", 0)
    .order("booking_date", { ascending: true })
    .limit(400);
  if (error) throw new Error(error.message);
  const candidates = (txData ?? []) as TxRow[];
  if (candidates.length === 0) return summary;

  // Blockweise claimen
  const original = new Map(candidates.map((t) => [t.id, t.match_status]));
  const byId = new Map(candidates.map((t) => [t.id, t]));
  const txs: TxRow[] = [];
  for (let i = 0; i < candidates.length; i += 100) {
    const ids = candidates.slice(i, i + 100).map((t) => t.id);
    const { data: claimed } = await sb
      .from("bank_transactions")
      .update({ match_status: "processing" })
      .in("id", ids)
      .in("match_status", statuses)
      .select("id");
    for (const c of claimed ?? []) txs.push(byId.get(c.id)!);
  }

  // Eigene Konten (Überträge untereinander ignorieren)
  const { data: accRows } = await sb.from("bank_transactions").select("account_iban").not("account_iban", "is", null).limit(2000);
  const ownIbans = [...new Set((accRows ?? []).map((r: { account_iban: string }) => r.account_iban))];

  let openOrders: OpenOrder[] = await fetchOpenOrdersForMatching();
  const lookupNums = new Set<string>();
  for (const tx of txs) for (const n of plausibleClosedNumbers({ ...tx, amount: Number(tx.amount) }, openOrders)) lookupNums.add(n);
  const closed: Record<string, ClosedOrderInfo> = lookupNums.size ? await lookupClosedOrders([...lookupNums]) : {};

  const patches: { id: string; patch: Record<string, unknown> }[] = [];
  const release: string[] = [];
  const amountCache = new Map<number, Promise<AmountOrder[]>>();

  for (const tx of txs) {
    if (Date.now() - started > budget) {
      release.push(tx.id);
      continue;
    }
    summary.processed++;
    let patch: Record<string, unknown>;
    try {
      // Targobank: IBAN steht nur im Verwendungszweck → sonst würden Überträge zwischen
      // eigenen Konten als Kundenzahlung geprüft
      const mtx = { ...tx, amount: Number(tx.amount), counterparty_iban: effektiveIban(tx) };
      let r = matchTransaction(mtx, openOrders, closed, ownIbans);
      // Ohne Bestellnr. im Zweck: Betrag + Name gegen ALLE Bestellungen (inkl. bezahlter)
      // prüfen — sonst wird bei Standardpreisen die Bestellung eines fremden Kunden vorgeschlagen.
      r = await refineByPayerAmount(mtx, r, amountCache);
      if (r.kind === "debit") {
        patch = { match_status: "debit" };
      } else if (r.kind === "ignored") {
        patch = { match_status: "ignored", match_reason: r.reason, match_detail: r.detail, candidates: [] };
        summary.ignored++;
      } else if (r.kind === "review") {
        if (r.reason === "no_candidate" && tx.booking_date < matchingSince) {
          patch = {
            match_status: "ignored", match_reason: "before_start",
            match_detail: "Vor Start des Abgleichs gebucht, keine passende Bestellung – nicht zur Prüfung vorgelegt.",
            candidates: [],
          };
          summary.ignored++;
        } else {
          patch = { match_status: "review", match_reason: r.reason, match_detail: r.detail, candidates: r.candidates };
          summary.review++;
        }
      } else {
        // Sicherer Treffer — Bestellungen für den Rest des Laufs "verbrauchen",
        // damit ein zweiter Eingang zur selben Bestellung als Doppelzahlung auffällt.
        const ids = new Set(r.orders.map((o) => o.gid));
        openOrders = openOrders.filter((o) => !ids.has(o.gid));
        for (const o of r.orders) closed[o.number] = { name: o.name, state: "matched", detail: "" };
        const matched = r.orders.map((o) => ({ gid: o.gid, name: o.name, outstanding: o.outstanding }));
        const names = r.orders.map((o) => o.name).join(" + ");

        if (mode === "shadow") {
          patch = {
            match_status: "shadow",
            match_reason: r.reason,
            match_detail: `Sicherer Treffer: ${names} – würde im Live-Modus automatisch als bezahlt markiert.`,
            matched_orders: matched,
            candidates: [],
          };
          summary.shadow++;
        } else {
          const results = [];
          for (const o of r.orders) {
            results.push({
              o,
              res: await markOrderPaidVerified(o.gid, {
                expectedOutstanding: o.outstanding,
                note: noteFor(tx, "Automatisch als bezahlt markiert (Bestellnummer + Betrag stimmen)."),
              }),
            });
          }
          const ok = results.filter((x) => x.res.ok);
          const failed = results.filter((x) => !x.res.ok);
          if (failed.length === 0) {
            patch = {
              match_status: "auto_paid",
              match_reason: r.reason,
              match_detail: `Automatisch als bezahlt markiert: ${names}`,
              matched_orders: matched,
              marked_paid_at: new Date().toISOString(),
              candidates: [],
            };
            summary.autoPaid++;
          } else {
            patch = {
              match_status: "review",
              match_reason: ok.length ? "mark_partial" : "mark_failed",
              match_detail:
                (ok.length ? `Markiert: ${ok.map((x) => x.o.name).join(", ")}. ` : "") +
                `Nicht markiert: ${failed.map((x) => x.res.error).join("; ")}`,
              matched_orders: ok.map((x) => ({ gid: x.o.gid, name: x.o.name, outstanding: x.o.outstanding })),
              candidates: failed.map((x) => ({
                gid: x.o.gid, name: x.o.name, outstanding: x.o.outstanding, via: "number", nameMatch: false, isBankDeposit: true,
              })),
              marked_paid_at: ok.length ? new Date().toISOString() : null,
            };
            summary.review++;
            summary.errors.push(...failed.map((x) => x.res.error ?? "?"));
          }
          // Shopify-Markierung ist erfolgt → Ergebnis SOFORT schreiben, nicht erst
          // im Sammel-Update (bricht der Lauf ab, darf das nicht verloren gehen).
          await sb.from("bank_transactions").update(patch).eq("id", tx.id);
          continue;
        }
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      patch = { match_status: "review", match_reason: "error", match_detail: `Fehler beim Abgleich: ${msg.slice(0, 300)}` };
      summary.errors.push(msg);
    }
    patches.push({ id: tx.id, patch });
  }

  await inBatches(patches, 10, (p) => sb.from("bank_transactions").update(p.patch).eq("id", p.id));

  // Unbearbeitete Claims sofort zurückgeben (sonst erst nach 10 Min frei)
  for (const status of statuses) {
    const ids = release.filter((id) => original.get(id) === status);
    for (let i = 0; i < ids.length; i += 100) {
      await sb.from("bank_transactions").update({ match_status: status }).in("id", ids.slice(i, i + 100)).eq("match_status", "processing");
    }
  }

  summary.remaining = await countRemaining();
  return summary;
}

// ── Betrags-/Namens-Verfeinerung (Zahlungen ohne Bestellnummer) ─────────────

/**
 * Verfeinert amount_only/no_candidate-Ergebnisse mit einer Shopify-Betragssuche
 * (inkl. bezahlter Bestellungen) + Namensabgleich. Verhindert, dass bei
 * Standardpreisen die Gleichpreis-Bestellung eines FREMDEN Kunden vorgeschlagen
 * wird. Pro Betrag und Lauf nur eine Suche (Cache).
 */
async function refineByPayerAmount(
  tx: MatchTx,
  result: MatchResult,
  cache: Map<number, Promise<AmountOrder[]>>,
): Promise<MatchResult> {
  if (result.kind !== "review") return result;
  if (result.reason !== "amount_only" && result.reason !== "no_candidate") return result;
  if (!tx.counterparty_name || !tx.counterparty_name.trim()) return result;
  const cents = toCents(tx.amount);
  if (cents <= 0) return result;
  let p = cache.get(cents);
  if (!p) { p = fetchOrdersByAmount(tx.amount); cache.set(cents, p); }
  const same = await p.catch(() => [] as AmountOrder[]);
  const refined = refineAmountOnly(tx, same);
  return refined ?? stripForeignAmountOnly(tx, result);
}

// ── Selbstheilung stehengebliebener Prüf-/Shadow-Fälle ──────────────────────

interface HealRow {
  id: string;
  booking_date: string;
  amount: number;
  counterparty_name: string | null;
  purpose: string | null;
  end_to_end_ref: string | null;
  match_status: string;
  match_reason: string | null;
  candidates?: { gid: string; name: string; outstanding: number }[] | null;
  matched_orders?: { gid: string; name: string; outstanding: number }[] | null;
}

/**
 * Gleicht offene Prüf-/Shadow-Fälle mit dem LIVE-Status ihrer vorgeschlagenen
 * Bestellung ab. Hintergrund: Die "Zu prüfen"-Liste ist eine Momentaufnahme vom
 * letzten Abgleich. Zahlt der User eine Vorkasse-Bestellung von Hand in Shopify
 * (ohne Bestellnr. im Verwendungszweck findet der Matcher sie nie sicher), bleibt
 * der Eingang hier ewig als "prüfen" stehen, obwohl die Bestellung längst bezahlt ist.
 *
 * WICHTIG: markiert NIE etwas in Shopify als bezahlt — ändert nur die Dashboard-
 * Einordnung, voll reversibel (Wiederherstellen-Knopf). Nur wenn ALLE
 * referenzierten Bestellungen geschlossen sind, wird gehandelt:
 *  - am/nach (Buchung−1 Tag) bezahlt → "von Hand erledigt" → ignored/already_paid
 *    (verlässt "Zu prüfen"); das Zeitfenster schließt Zufallstreffer praktisch aus.
 *  - vorher bezahlt / storniert → bleibt zur Prüfung, aber ohne den irreführenden
 *    Vorschlag auf eine bezahlte Bestellung (order_not_open, mögliche Doppelzahlung).
 *  - mind. eine Bestellung noch offen → unverändert (echter Kandidat bleibt).
 */
async function healResolvedReviews(daysBack = 150): Promise<{ checked: number; resolved: number; relabeled: number; refined: number }> {
  const sb = createServiceClient();
  const since = new Date(Date.now() - daysBack * 86400000).toISOString().slice(0, 10);
  const { data } = await sb
    .from("bank_transactions")
    .select("id, booking_date, amount, counterparty_name, purpose, end_to_end_ref, match_status, match_reason, candidates, matched_orders")
    .in("match_status", ["review", "shadow"])
    .gt("amount", 0)
    .gte("booking_date", since)
    .limit(500);
  const rows = (data ?? []) as HealRow[];

  // Shadow-Fälle referenzieren matched_orders (sicherer Treffer), Prüf-Fälle candidates.
  const refsOf = (r: HealRow) => (r.match_status === "shadow" ? r.matched_orders : r.candidates) ?? [];

  const numbers = new Set<string>();
  for (const r of rows) for (const o of refsOf(r)) { const n = orderNum(o.name); if (n) numbers.add(n); }
  // Nur GESCHLOSSENE Bestellungen landen in der Map (offene werden übersprungen) → inkl. paidAt.
  const closed = numbers.size ? await lookupClosedOrders([...numbers]) : {};

  let resolved = 0, relabeled = 0, refined = 0;
  const patches: { id: string; patch: Record<string, unknown> }[] = [];
  const handledIds = new Set<string>();
  const now = new Date().toISOString();

  // Teil A: referenzierte Bestellung inzwischen bezahlt/geschlossen.
  for (const r of rows) {
    const refs = refsOf(r);
    if (refs.length === 0) continue;
    const infos = refs.map((o) => closed[orderNum(o.name)]);
    if (infos.some((c) => !c)) continue; // mind. eine noch offen → hier nichts tun

    const handledFrom = minusDaysIso(r.booking_date, 1);
    const allHandled = infos.every((c) => c!.state === "paid" && c!.paidAt && c!.paidAt.slice(0, 10) >= handledFrom);
    handledIds.add(r.id);

    if (allHandled) {
      const names = infos.map((c) => c!.name).join(", ");
      const dates = infos.map((c) => deDate(c!.paidAt!)).join(", ");
      patches.push({ id: r.id, patch: {
        match_status: "ignored",
        match_reason: "already_paid",
        match_detail: `${names} war bereits als bezahlt markiert (${dates}) – vermutlich von Hand erledigt.`,
        candidates: [],
        resolved_at: now,
      } });
      resolved++;
    } else {
      const parts = infos.map((c) =>
        c!.state === "cancelled" ? `${c!.name} ist storniert – ggf. erstatten`
        : c!.state === "paid" ? `${c!.name} ist bereits bezahlt${c!.paidAt ? ` am ${deDate(c!.paidAt)}` : ""} – mögliche Doppelzahlung, bitte prüfen`
        : `${c!.name} ist nicht offen (${c!.detail})`,
      );
      patches.push({ id: r.id, patch: {
        match_status: "review",
        match_reason: "order_not_open",
        match_detail: parts.join(". ") + ".",
        candidates: [],
        matched_orders: [],
      } });
      relabeled++;
    }
  }

  // Teil B: bestehende amount_only/no_candidate-Prüffälle mit Betrag+Name gegen
  // ALLE Bestellungen (inkl. bezahlter) neu bewerten — fängt Fremd-Kunden-
  // Vorschläge bei Standardpreisen rückwirkend ab (z.B. "Luana zahlt, aber
  // Yasirs Gleichpreis-Bestellung wird vorgeschlagen").
  const amountCache = new Map<number, Promise<AmountOrder[]>>();
  for (const r of rows) {
    if (handledIds.has(r.id)) continue;
    if (r.match_status !== "review") continue;
    if (r.match_reason !== "amount_only" && r.match_reason !== "no_candidate") continue;

    // Behörden-/Kassen-Erstattungen (AAG, Bundesagentur, Finanzamt, AOK/BARMER/…) →
    // keine Kundenzahlung, raus aus der Prüfliste. Absender oft nur im Zweck.
    const inst = institutionalCredit({ counterparty_name: r.counterparty_name, purpose: r.purpose });
    if (inst) {
      patches.push({ id: r.id, patch: {
        match_status: "ignored", match_reason: "payout_source",
        match_detail: `Behörden-/Kassen-Erstattung: ${inst}`, candidates: [], resolved_at: now,
      } });
      refined++;
      continue;
    }

    if (!r.counterparty_name || !r.counterparty_name.trim()) continue;

    const mtx: MatchTx = { amount: Number(r.amount), booking_date: r.booking_date, purpose: r.purpose, counterparty_name: r.counterparty_name, end_to_end_ref: r.end_to_end_ref };
    const stored: MatchResult = {
      kind: "review",
      reason: r.match_reason as "amount_only" | "no_candidate",
      detail: "",
      candidates: (r.candidates ?? []).map((c) => ({ gid: c.gid, name: c.name, outstanding: c.outstanding, via: "amount" as const, nameMatch: false, isBankDeposit: false })),
    };
    const res = await refineByPayerAmount(mtx, stored, amountCache);
    const storedGids = (r.candidates ?? []).map((c) => c.gid).sort().join(",");

    if (res.kind === "ignored") {
      patches.push({ id: r.id, patch: {
        match_status: "ignored", match_reason: res.reason, match_detail: res.detail, candidates: [], resolved_at: now,
      } });
      refined++;
    } else if (res.kind === "review") {
      const newGids = res.candidates.map((c) => c.gid).sort().join(",");
      if (res.reason === r.match_reason && newGids === storedGids) continue; // nichts geändert
      patches.push({ id: r.id, patch: {
        match_status: "review", match_reason: res.reason, match_detail: res.detail, candidates: res.candidates, matched_orders: [],
      } });
      refined++;
    }
  }

  await inBatches(patches, 10, (p) => sb.from("bank_transactions").update(p.patch).eq("id", p.id));
  return { checked: rows.length, resolved, relabeled, refined };
}

// ── Manuelle Aktionen ───────────────────────────────────────────────────────

const RESOLVABLE = ["review", "shadow", "pending", "ignored"];

async function claim(sb: Sb, txId: string): Promise<TxRow | null> {
  const { data: tx } = await sb
    .from("bank_transactions")
    .select("id, booking_date, amount, purpose, counterparty_name, end_to_end_ref, match_status")
    .eq("id", txId)
    .maybeSingle();
  if (!tx || !RESOLVABLE.includes(tx.match_status)) return null;
  const { data: claimed } = await sb
    .from("bank_transactions")
    .update({ match_status: "processing" })
    .eq("id", txId)
    .eq("match_status", tx.match_status)
    .select("id");
  return claimed?.length ? (tx as TxRow) : null;
}

/** Mensch bestätigt: dieser Eingang bezahlt diese Bestellung(en) → als bezahlt markieren. */
export async function confirmTransactionOrders(
  txId: string,
  orderGids: string[],
  actor: { id: string; name: string | null },
): Promise<{ ok: boolean; error?: string; info?: string }> {
  const gids = [...new Set(orderGids)].filter(Boolean).slice(0, 10);
  if (gids.length === 0) return { ok: false, error: "Keine Bestellung gewählt." };
  const sb = createServiceClient();
  const tx = await claim(sb, txId);
  if (!tx) return { ok: false, error: "Umsatz ist nicht (mehr) offen – Seite neu laden." };

  const note = noteFor(tx, `Manuell zugeordnet und als bezahlt markiert${actor.name ? ` von ${actor.name}` : ""}.`);
  const results = [];
  for (const gid of gids) results.push({ gid, res: await markOrderPaidVerified(gid, { note }) });

  const linked = results.filter((x) => x.res.ok || x.res.alreadyPaid);
  const failed = results.filter((x) => !(x.res.ok || x.res.alreadyPaid));
  const now = new Date().toISOString();
  if (linked.length === 0) {
    await sb.from("bank_transactions").update({ match_status: tx.match_status }).eq("id", txId);
    return { ok: false, error: failed.map((x) => x.res.error).join("; ") };
  }
  const already = linked.filter((x) => !x.res.ok).map((x) => x.res.name);
  const marked = linked.filter((x) => x.res.ok).map((x) => x.res.name);
  const detail = [
    marked.length ? `Manuell als bezahlt markiert: ${marked.join(", ")}` : null,
    already.length ? `Bereits bezahlt, nur verknüpft: ${already.join(", ")}` : null,
    failed.length ? `Fehlgeschlagen: ${failed.map((x) => x.res.error).join("; ")}` : null,
  ].filter(Boolean).join(". ");
  await sb.from("bank_transactions").update({
    match_status: "manual_paid",
    match_reason: marked.length ? "manual" : "manual_linked",
    match_detail: detail,
    matched_orders: linked.map((x) => ({ gid: x.gid, name: x.res.name, outstanding: x.res.outstanding })),
    marked_paid_at: marked.length ? now : null,
    resolved_by: actor.id,
    resolved_at: now,
  }).eq("id", txId);
  return {
    ok: failed.length === 0,
    error: failed.length ? detail : undefined,
    info: already.length ? `Bereits bezahlt, nur verknüpft: ${already.join(", ")}` : undefined,
  };
}

export async function assignTransactionByNumber(
  txId: string,
  orderNumber: string,
  actor: { id: string; name: string | null },
): Promise<{ ok: boolean; error?: string; info?: string }> {
  const order = await fetchOrderByNumber(orderNumber);
  if (!order) return { ok: false, error: `Bestellung ${orderNumber} nicht gefunden.` };
  if (order.cancelled) return { ok: false, error: `${order.name} ist storniert.` };
  return confirmTransactionOrders(txId, [order.gid], actor);
}

export async function setTransactionIgnored(txId: string, ignored: boolean, actorId: string): Promise<{ ok: boolean; error?: string }> {
  const sb = createServiceClient();
  const now = new Date().toISOString();
  const q = sb.from("bank_transactions").update(
    ignored
      ? { match_status: "ignored", match_reason: "manual_ignore", match_detail: "Manuell ignoriert", resolved_by: actorId, resolved_at: now }
      : { match_status: "pending", match_reason: null, match_detail: null, resolved_by: null, resolved_at: null, candidates: [] },
  ).eq("id", txId);
  const { error } = ignored ? await q.in("match_status", ["review", "shadow", "pending"]) : await q.eq("match_status", "ignored");
  return error ? { ok: false, error: error.message } : { ok: true };
}
