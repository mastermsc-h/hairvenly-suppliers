"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";

const str = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  return s || null;
};
const num = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
};
const date = (v: FormDataEntryValue | null) => {
  const s = String(v ?? "").trim();
  return s || null;
};

export async function createInboundDelivery(formData: FormData) {
  const profile = await requireProfile();
  const supabase = await createClient();

  const supplier_id = str(formData.get("supplier_id"));
  if (!supplier_id) throw new Error("Lieferant fehlt");

  // Supplier-User dürfen nur eigene Wareneingänge anlegen
  if (profile.role === "supplier" && profile.supplier_id !== supplier_id) {
    throw new Error("Keine Berechtigung");
  }

  const payload = {
    supplier_id,
    label: str(formData.get("label")),
    tracking_number: str(formData.get("tracking_number")),
    tracking_url: str(formData.get("tracking_url")),
    eta: date(formData.get("eta")),
    shipped_at: date(formData.get("shipped_at")),
    arrived_at: date(formData.get("arrived_at")),
    notes: str(formData.get("notes")),
  };

  const { data, error } = await supabase
    .from("inbound_deliveries")
    .insert(payload)
    .select("id")
    .single();

  if (error) throw new Error(error.message);
  revalidatePath("/inbound-deliveries");
  redirect(`/inbound-deliveries/${data.id}`);
}

export async function updateInboundDelivery(formData: FormData) {
  await requireProfile();
  const supabase = await createClient();
  const id = str(formData.get("id"));
  if (!id) throw new Error("ID fehlt");

  const payload: Record<string, string | null> = {
    label: str(formData.get("label")),
    tracking_number: str(formData.get("tracking_number")),
    tracking_url: str(formData.get("tracking_url")),
    eta: date(formData.get("eta")),
    shipped_at: date(formData.get("shipped_at")),
    arrived_at: date(formData.get("arrived_at")),
    notes: str(formData.get("notes")),
  };

  const { error } = await supabase
    .from("inbound_deliveries")
    .update(payload)
    .eq("id", id);
  if (error) throw new Error(error.message);

  revalidatePath(`/inbound-deliveries/${id}`);
  revalidatePath("/inbound-deliveries");
}

export async function deleteInboundDelivery(id: string) {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase
    .from("inbound_deliveries")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath("/inbound-deliveries");
  redirect("/inbound-deliveries");
}

export async function addInboundItem(formData: FormData) {
  await requireProfile();
  const supabase = await createClient();

  const inbound_delivery_id = str(formData.get("inbound_delivery_id"));
  const method_name = str(formData.get("method_name"));
  const length_value = str(formData.get("length_value"));
  const color_name = str(formData.get("color_name"));
  const color_id = str(formData.get("color_id"));
  const quantity = num(formData.get("quantity"));
  const unit = str(formData.get("unit")) ?? "g";
  const notes = str(formData.get("notes"));

  if (!inbound_delivery_id) throw new Error("Wareneingang fehlt");
  if (!method_name || !length_value || !color_name) throw new Error("Methode/Länge/Farbe fehlen");
  if (!quantity || quantity <= 0) throw new Error("Menge ungültig");

  const { error } = await supabase.from("inbound_delivery_items").insert({
    inbound_delivery_id,
    color_id,
    method_name,
    length_value,
    color_name,
    quantity,
    unit,
    notes,
  });
  if (error) throw new Error(error.message);

  revalidatePath(`/inbound-deliveries/${inbound_delivery_id}`);
}

export async function updateInboundItem(formData: FormData) {
  await requireProfile();
  const supabase = await createClient();
  const id = str(formData.get("id"));
  const inbound_delivery_id = str(formData.get("inbound_delivery_id"));
  if (!id) throw new Error("ID fehlt");

  const quantity = num(formData.get("quantity"));
  if (!quantity || quantity <= 0) throw new Error("Menge ungültig");

  const payload = {
    quantity,
    notes: str(formData.get("notes")),
  };
  const { error } = await supabase
    .from("inbound_delivery_items")
    .update(payload)
    .eq("id", id);
  if (error) throw new Error(error.message);

  if (inbound_delivery_id) revalidatePath(`/inbound-deliveries/${inbound_delivery_id}`);
}

export async function removeInboundItem(id: string, deliveryId: string) {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase
    .from("inbound_delivery_items")
    .delete()
    .eq("id", id);
  if (error) throw new Error(error.message);
  revalidatePath(`/inbound-deliveries/${deliveryId}`);
}
