"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin, requireProfile } from "@/lib/auth";

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
  await supabase
    .from("order_events")
    .insert({ order_id: orderId, event_type, message, actor_id: actorId });
}

export async function createOrder(_prev: unknown, formData: FormData) {
  await requireAdmin();
  const supabase = await createClient();

  const payload = {
    supplier_id: String(formData.get("supplier_id")),
    label: String(formData.get("label") ?? "").trim(),
    description: str(formData.get("description")),
    tags: formData.getAll("tags").map(String),
    sheet_url: str(formData.get("sheet_url")),
    invoice_total: num(formData.get("invoice_total")),
    goods_value: num(formData.get("goods_value")),
    shipping_cost: num(formData.get("shipping_cost")),
    customs_duty: num(formData.get("customs_duty")),
    import_vat: num(formData.get("import_vat")),
    weight_kg: num(formData.get("weight_kg")),
    package_count: num(formData.get("package_count")),
    tracking_number: str(formData.get("tracking_number")),
    tracking_url: str(formData.get("tracking_url")),
    eta: str(formData.get("eta")),
    notes: str(formData.get("notes")),
    status: "draft" as const,
  };

  if (!payload.supplier_id || !payload.label) {
    return { error: "Lieferant und Label sind erforderlich." };
  }

  const { data, error } = await supabase.from("orders").insert(payload).select("id").single();
  if (error) return { error: error.message };

  revalidatePath("/orders");
  redirect(`/orders/${data!.id}`);
}

export async function updateOrder(orderId: string, formData: FormData) {
  const profile = await requireProfile();
  const supabase = await createClient();

  // Build the patch from fields actually present in the submitted form, so
  // partial edits never accidentally null out required columns like `label`.
  const update: Record<string, unknown> = {};
  const setStr = (key: string) => {
    if (formData.has(key)) update[key] = str(formData.get(key));
  };
  const setNum = (key: string) => {
    if (formData.has(key)) update[key] = num(formData.get(key));
  };
  const setRequired = (key: string) => {
    if (formData.has(key)) {
      const v = str(formData.get(key));
      if (v) update[key] = v;
    }
  };

  // Shared (Admin + Lieferant)
  setRequired("status");
  setStr("tracking_number");
  setStr("tracking_url");
  setStr("eta");
  setStr("last_supplier_update");
  setStr("notes");

  // Nur Admin
  if (profile.is_admin) {
    setRequired("label");
    setStr("description");
    setStr("sheet_url");
    if (formData.has("tags")) update.tags = formData.getAll("tags").map(String);
    setNum("invoice_total");
    setNum("goods_value");
    setNum("shipping_cost");
    setNum("customs_duty");
    setNum("import_vat");
    setNum("package_count");
    setNum("weight_kg");
  }

  const { error } = await supabase.from("orders").update(update).eq("id", orderId);
  if (error) return { error: error.message };

  const changedKeys = Object.keys(update).filter((k) => k !== "status");
  if (changedKeys.length > 0) {
    await logEvent(
      supabase,
      orderId,
      profile.id,
      "field_change",
      `Felder aktualisiert: ${changedKeys.join(", ")}`,
    );
  }

  revalidatePath(`/orders/${orderId}`);
  revalidatePath("/orders");
  return { ok: true };
}

export async function addPayment(orderId: string, formData: FormData) {
  const profile = await requireAdmin();
  const supabase = await createClient();

  const amount = num(formData.get("amount"));
  if (!amount || amount <= 0) return { error: "Betrag ist erforderlich." };

  const { error } = await supabase.from("payments").insert({
    order_id: orderId,
    amount,
    paid_at: str(formData.get("paid_at")) ?? new Date().toISOString().slice(0, 10),
    method: str(formData.get("method")),
    note: str(formData.get("note")),
  });
  if (error) return { error: error.message };

  await logEvent(supabase, orderId, profile.id, "payment", `Zahlung hinzugefügt: ${amount} USD`);

  revalidatePath(`/orders/${orderId}`);
  return { ok: true };
}

export async function updatePayment(orderId: string, paymentId: string, formData: FormData) {
  const profile = await requireAdmin();
  const supabase = await createClient();
  const amount = num(formData.get("amount"));
  if (!amount || amount <= 0) return { error: "Betrag ist erforderlich." };
  const { error } = await supabase
    .from("payments")
    .update({
      amount,
      paid_at: str(formData.get("paid_at")) ?? new Date().toISOString().slice(0, 10),
      method: str(formData.get("method")),
      note: str(formData.get("note")),
    })
    .eq("id", paymentId);
  if (error) return { error: error.message };
  await logEvent(supabase, orderId, profile.id, "payment", `Zahlung bearbeitet: ${num(formData.get("amount"))} USD`);
  revalidatePath(`/orders/${orderId}`);
  return { ok: true };
}

export async function deletePayment(orderId: string, paymentId: string) {
  const profile = await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase.from("payments").delete().eq("id", paymentId);
  if (error) return { error: error.message };
  await logEvent(supabase, orderId, profile.id, "payment", "Zahlung gelöscht");
  revalidatePath(`/orders/${orderId}`);
  return { ok: true };
}

export async function uploadDocument(orderId: string, formData: FormData) {
  const profile = await requireProfile();
  const supabase = await createClient();
  const file = formData.get("file") as File | null;
  const kind = String(formData.get("kind") ?? "other");
  if (!file || file.size === 0) return { error: "Keine Datei ausgewählt." };

  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const path = `${orderId}/${Date.now()}_${safeName}`;
  const { error: upErr } = await supabase.storage
    .from("order-files")
    .upload(path, file, { contentType: file.type });
  if (upErr) return { error: upErr.message };

  const { error: dbErr } = await supabase.from("documents").insert({
    order_id: orderId,
    kind,
    file_path: path,
    file_name: file.name,
  });
  if (dbErr) return { error: dbErr.message };

  await logEvent(supabase, orderId, profile.id, "document", `Dokument hochgeladen: ${file.name} (${kind})`);

  revalidatePath(`/orders/${orderId}`);
  return { ok: true };
}

export async function deleteDocument(orderId: string, documentId: string, filePath: string) {
  const profile = await requireAdmin();
  const supabase = await createClient();
  await supabase.storage.from("order-files").remove([filePath]);
  const { error } = await supabase.from("documents").delete().eq("id", documentId);
  if (error) return { error: error.message };
  await logEvent(supabase, orderId, profile.id, "document", "Dokument gelöscht");
  revalidatePath(`/orders/${orderId}`);
  return { ok: true };
}

export async function getSignedUrl(filePath: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from("order-files")
    .createSignedUrl(filePath, 60 * 10);
  if (error) return null;
  return data.signedUrl;
}
