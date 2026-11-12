import type { SupabaseClient } from "@supabase/supabase-js";
import {
  matchReservationsAgainstStock,
  planStockStatusUpdates,
  type PreviousStockState,
  type ReservationForMatch,
  type StockCheckResult,
  type StockSnapshot,
} from "./stock-match";

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
    unterwegs: filterArchivedFromStock(rawUnterwegs, orderIdByName),
    nullbestand: filterArchivedFromStock(rawNullbestand, orderIdByName),
  };
}

export interface ReservationStockCheckRun {
  results: StockCheckResult[];
  counts: Record<StockCheckResult["status"], number>;
  newlyInStock: number;
}

export async function runReservationStockCheck(svc: SupabaseClient): Promise<ReservationStockCheckRun> {
  const { data: rows, error } = await svc
    .from("chat_reservations")
    .select("id, product_name, color, method, line, length_cm, method_kind, structured_complete, last_stock_status, in_stock_since")
    .eq("status", "waiting");
  if (error) throw new Error(`chat_reservations lesen: ${error.message}`);

  const counts: ReservationStockCheckRun["counts"] = { in_stock: 0, unterwegs: 0, out_of_stock: 0, unknown: 0, service_item: 0 };
  if (!rows || rows.length === 0) return { results: [], counts, newlyInStock: 0 };

  const stock = await loadStockSnapshot(svc);
  const results = matchReservationsAgainstStock(rows as ReservationForMatch[], stock);
  const updates = planStockStatusUpdates(rows as PreviousStockState[], results, new Date().toISOString());

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
  return { results, counts, newlyInStock };
}
