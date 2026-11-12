import type { SupabaseClient } from "@supabase/supabase-js";
import {
  matchReservationsAgainstStock,
  planStockStatusUpdates,
  snapshotProblem,
  type PreviousStockState,
  type ReservationForMatch,
  type StockCheckResult,
  type StockSnapshot,
} from "./stock-match";
import { decideAutoNotify, type AutoNotifyDecision, type NotifyState } from "./auto-notify";

/**
 * Lager-Check der Warteliste: liest die Stock-Sheets (gleiche Quelle wie das
 * get_stock_eta-Tool des Bots), matcht alle wartenden Reservierungen und
 * speichert das Ergebnis pro Reservierung (last_stock_status & Co., Migration
 * 0149). Läuft täglich per Cron und beim manuellen „Lager-Check"-Button.
 *
 * Sendet NIE etwas an Kundinnen — benachrichtigt wird weiterhin per 1-Klick.
 * Schlägt das Lesen der Sheets fehl, wird nichts überschrieben (Exception
 * vor dem Speichern) — der letzte bekannte Stand bleibt sichtbar.
 */
export async function loadStockSnapshot(svc: SupabaseClient): Promise<StockSnapshot> {
  const { readDashboardAlerts, readInventorySheet } = await import("@/lib/stock-sheets");
  const { fetchOrderIdByName } = await import("@/lib/order-name-map");
  const { filterArchivedFromStock } = await import("@/lib/filter-archived-orders");
  const [{ unterwegs: rawUnterwegs, nullbestand: rawNullbestand }, ruSheet, uzSheet, orderIdByName] = await Promise.all([
    readDashboardAlerts(),
    readInventorySheet("Russisch - GLATT"),
    readInventorySheet("Usbekisch - WELLIG"),
    // Service-Client: im Cron gibt es keine Login-Session (RLS → leere Map).
    fetchOrderIdByName(svc),
  ]);
  // Wende DB-Override an: ersetzt Sheet-Ankunft durch präzise Per-Position-/
  // Shipment-/Order-ETA aus unserer DB. Sonst zeigt der Lager-Check stale
  // Sheet-ETAs (z.B. CAPPUCCINO 30.05. statt 03.06.) — Sheet wird nur
  // periodisch von Apps Script gepflegt, DB ist Source-of-Truth.
  return {
    ru: ruSheet.rows,
    uz: uzSheet.rows,
    ruCompleted: ruSheet.completedCollections,
    uzCompleted: uzSheet.completedCollections,
    unterwegs: filterArchivedFromStock(rawUnterwegs, orderIdByName),
    nullbestand: filterArchivedFromStock(rawNullbestand, orderIdByName),
  };
}

export interface CheckedReservation extends NotifyState {
  product_name: string;
  color: string | null;
  method: string | null;
  product_url: string | null;
  session_id: string | null;
  result: StockCheckResult | undefined;
  decision: AutoNotifyDecision;
  reason: string;
}

export interface ReservationStockCheckRun {
  results: StockCheckResult[];
  /** Pro wartender Reservierung: Treffer + Auto-Benachrichtigungs-Entscheidung */
  checked: CheckedReservation[];
  counts: Record<StockCheckResult["status"], number>;
  newlyInStock: number;
}

/**
 * `retries`: Crons warten bei halber Tabelle (Sheet-Refresh) und lesen erneut;
 * der Button meldet es sofort (retries 0).
 */
export async function runReservationStockCheck(
  svc: SupabaseClient,
  now: Date = new Date(),
  opts: { retries?: number; retryDelayMs?: number } = {},
): Promise<ReservationStockCheckRun> {
  const { data: rows, error } = await svc
    .from("chat_reservations")
    .select(
      "id, status, session_id, channel, external_id, product_name, product_url, color, method, line, length_cm, method_kind, " +
      "structured_complete, last_stock_status, in_stock_since, notify_attempts, last_notify_attempt_at",
    )
    .eq("status", "waiting")
    .returns<(ReservationForMatch & PreviousStockState & CheckedReservation)[]>();
  if (error) throw new Error(`chat_reservations lesen: ${error.message}`);

  const counts: ReservationStockCheckRun["counts"] = { in_stock: 0, unterwegs: 0, out_of_stock: 0, unknown: 0, service_item: 0 };
  if (!rows || rows.length === 0) return { results: [], checked: [], counts, newlyInStock: 0 };

  // Halbe Tabelle (Sheet-Refresh läuft) → erneut lesen; bleibt sie halb,
  // abbrechen: letzter Stand bleibt stehen, nichts wird gesendet.
  let stock = await loadStockSnapshot(svc);
  let problem = snapshotProblem(stock);
  for (let i = 0; problem && i < (opts.retries ?? 0); i++) {
    await new Promise(res => setTimeout(res, opts.retryDelayMs ?? 60_000));
    stock = await loadStockSnapshot(svc);
    problem = snapshotProblem(stock);
  }
  if (problem) throw new Error(problem);
  const results = matchReservationsAgainstStock(rows, stock);
  const resultById = new Map(results.map(r => [r.reservationId, r]));
  const checked: CheckedReservation[] = rows.map(r => {
    const result = resultById.get(r.id);
    const { decision, reason } = decideAutoNotify(r, result, now);
    return {
      id: r.id, status: r.status, session_id: r.session_id, channel: r.channel, external_id: r.external_id,
      product_name: r.product_name, product_url: r.product_url, color: r.color, method: r.method,
      notify_attempts: r.notify_attempts, last_notify_attempt_at: r.last_notify_attempt_at,
      result, decision, reason,
    };
  });
  const checkedById = new Map(checked.map(c => [c.id, c]));
  const updates = planStockStatusUpdates(rows, results, now.toISOString()).map(u => ({
    ...u,
    auto_notify_decision: checkedById.get(u.id)?.decision ?? null,
    auto_notify_reason: checkedById.get(u.id)?.reason ?? null,
  }));

  // Pro Zeile updaten (Warteliste = zweistellig) — Fehler einzelner Zeilen
  // sammeln statt abbrechen, damit ein Ausreißer nicht den Rest blockiert.
  const failures: string[] = [];
  await Promise.all(updates.map(async ({ id, ...fields }) => {
    // .eq("status","waiting"): falls parallel gerade benachrichtigt/storniert
    // wurde, den abgeschlossenen Eintrag nicht mehr anfassen.
    const { error: upErr } = await svc.from("chat_reservations").update(fields).eq("id", id).eq("status", "waiting");
    if (upErr) failures.push(`${id}: ${upErr.message}`);
  }));
  if (failures.length > 0) throw new Error(`Lager-Status speichern fehlgeschlagen (${failures.length}): ${failures[0]}`);

  for (const r of results) counts[r.status]++;
  const prevInStock = new Set(rows.filter(r => r.last_stock_status === "in_stock").map(r => r.id));
  const newlyInStock = results.filter(r => r.status === "in_stock" && !prevInStock.has(r.reservationId)).length;
  return { results, checked, counts, newlyInStock };
}
