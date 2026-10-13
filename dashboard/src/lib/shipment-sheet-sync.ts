import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Spiegelt den Ankunftsstatus einer Teillieferung in die ETA-Spalte des
 * Bestell-Sheets (Amanda/China-Tab).
 *
 * Hintergrund: Das Apps Script (Stock calculation) zählt eine Position nur dann
 * NICHT mehr als "unterwegs", wenn ihre ETA-Zelle explizit "angekommen …" enthält.
 * Eine vergangene ETA allein heißt nur "verspätet", nicht "angekommen".
 *
 * - arrived_at gesetzt → "angekommen DD.MM.YYYY"
 * - arrived_at entfernt → ETA-Datum zurückschreiben (Item → Shipment → Order)
 *
 * Fail-safe: Sheet-Fehler brechen die DB-Aktion nie ab, sie werden nur geloggt.
 */
export async function syncShipmentArrivalToSheet(
  supabase: Supabase,
  shipmentId: string,
  actorId: string | null,
): Promise<void> {
  try {
    const { data: shipment } = await supabase
      .from("order_shipments")
      .select("order_id, arrived_at, eta")
      .eq("id", shipmentId)
      .single();
    if (!shipment) return;

    const { data: order } = await supabase
      .from("orders")
      .select("sheet_url, eta")
      .eq("id", shipment.order_id)
      .single();
    if (!order?.sheet_url) return;

    const { data: items } = await supabase
      .from("order_items")
      .select("method_name, length_value, color_name, eta")
      .eq("shipment_id", shipmentId);
    if (!items || items.length === 0) return;

    const arrivedLabel = shipment.arrived_at
      ? `angekommen ${formatDe(shipment.arrived_at)}`
      : null;

    const values = new Map<string, string>();
    for (const it of items) {
      const value = arrivedLabel ?? it.eta ?? shipment.eta ?? order.eta;
      if (!value) continue;
      const key = `${(it.method_name || "").toLowerCase()}|${(it.length_value || "").toLowerCase()}|${(it.color_name || "").replace(/^#/, "").toLowerCase()}`;
      values.set(key, value);
    }
    if (values.size === 0) return;

    const { writeOrderSheetEtas } = await import("@/lib/google-sheets");
    const res = await writeOrderSheetEtas(order.sheet_url, values);
    await supabase.from("order_events").insert({
      order_id: shipment.order_id,
      event_type: "sheet_sync",
      message: res.error
        ? `Sheet-Sync Teillieferung fehlgeschlagen: ${res.error}`
        : `Sheet: ${res.updated ?? 0} Position(en) ${arrivedLabel ? "als angekommen markiert" : "wieder auf ETA gesetzt"}`,
      actor_id: actorId,
    });
  } catch (e) {
    console.warn("[syncShipmentArrivalToSheet]", e);
  }
}

function formatDe(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}
