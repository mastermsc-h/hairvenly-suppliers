"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";

const num = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const str = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  return s || null;
};

async function logEvent(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orderId: string,
  actorId: string | null,
  event_type: string,
  message: string,
) {
  await supabase.from("order_events").insert({
    order_id: orderId,
    event_type,
    message,
    actor_id: actorId,
  });
}

/**
 * Create a new partial shipment for an order.
 * Suppliers can create for their own orders, admins for any.
 */
export async function createShipment(orderId: string, formData: FormData) {
  const profile = await requireProfile();
  const supabase = await createClient();

  const payload = {
    order_id: orderId,
    label: str(formData.get("label")),
    tracking_number: str(formData.get("tracking_number")),
    tracking_url: str(formData.get("tracking_url")),
    eta: str(formData.get("eta")),
    shipped_at: str(formData.get("shipped_at")),
    notes: str(formData.get("notes")),
    created_by: profile.id,
  };

  const { data, error } = await supabase
    .from("order_shipments")
    .insert(payload)
    .select("id")
    .single();
  if (error) return { error: error.message };

  // Optionally assign selected order_items to this new shipment
  const itemIds = formData.getAll("item_ids").map(String).filter(Boolean);
  if (itemIds.length > 0 && data?.id) {
    const { error: itemErr } = await supabase
      .from("order_items")
      .update({ shipment_id: data.id })
      .in("id", itemIds)
      .eq("order_id", orderId);
    if (itemErr) return { error: itemErr.message };
  }

  await logEvent(
    supabase,
    orderId,
    profile.id,
    "shipment",
    `Teillieferung angelegt${payload.label ? `: ${payload.label}` : ""}${
      itemIds.length > 0 ? ` · ${itemIds.length} Positionen` : ""
    }`,
  );

  revalidatePath(`/orders/${orderId}`);
  return { ok: true, id: data?.id };
}

export async function updateShipment(shipmentId: string, formData: FormData) {
  const profile = await requireProfile();
  const supabase = await createClient();

  const update: Record<string, unknown> = {};
  const setStr = (key: string) => {
    if (formData.has(key)) update[key] = str(formData.get(key));
  };
  setStr("label");
  setStr("tracking_number");
  setStr("tracking_url");
  setStr("eta");
  setStr("shipped_at");
  setStr("arrived_at");
  setStr("notes");

  // Find parent order for redirect + logging
  const { data: shipment } = await supabase
    .from("order_shipments")
    .select("order_id")
    .eq("id", shipmentId)
    .single();
  if (!shipment) return { error: "Teillieferung nicht gefunden." };

  const { error } = await supabase
    .from("order_shipments")
    .update(update)
    .eq("id", shipmentId);
  if (error) return { error: error.message };

  await logEvent(
    supabase,
    shipment.order_id,
    profile.id,
    "shipment",
    `Teillieferung aktualisiert: ${Object.keys(update).join(", ")}`,
  );

  revalidatePath(`/orders/${shipment.order_id}`);
  return { ok: true };
}

export async function deleteShipment(shipmentId: string) {
  const profile = await requireProfile();
  const supabase = await createClient();

  const { data: shipment } = await supabase
    .from("order_shipments")
    .select("order_id, label")
    .eq("id", shipmentId)
    .single();
  if (!shipment) return { error: "Teillieferung nicht gefunden." };

  // Unlink items (set shipment_id to null) before deleting
  await supabase
    .from("order_items")
    .update({ shipment_id: null })
    .eq("shipment_id", shipmentId);
  await supabase
    .from("documents")
    .update({ shipment_id: null })
    .eq("shipment_id", shipmentId);

  const { error } = await supabase
    .from("order_shipments")
    .delete()
    .eq("id", shipmentId);
  if (error) return { error: error.message };

  await logEvent(
    supabase,
    shipment.order_id,
    profile.id,
    "shipment",
    `Teillieferung gelöscht${shipment.label ? `: ${shipment.label}` : ""}`,
  );

  revalidatePath(`/orders/${shipment.order_id}`);
  return { ok: true };
}

/**
 * Assign / re-assign order_items to a shipment.
 * Pass shipmentId = null to unassign.
 */
export async function setItemsShipment(
  orderId: string,
  shipmentId: string | null,
  itemIds: string[],
) {
  const profile = await requireProfile();
  const supabase = await createClient();
  if (itemIds.length === 0) return { ok: true };

  const { error } = await supabase
    .from("order_items")
    .update({ shipment_id: shipmentId })
    .in("id", itemIds)
    .eq("order_id", orderId);
  if (error) return { error: error.message };

  await logEvent(
    supabase,
    orderId,
    profile.id,
    "shipment",
    shipmentId
      ? `${itemIds.length} Position(en) einer Teillieferung zugewiesen`
      : `${itemIds.length} Position(en) aus Teillieferung entfernt`,
  );
  revalidatePath(`/orders/${orderId}`);
  return { ok: true };
}
