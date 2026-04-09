"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";

const BUCKET = "supplier-banners";

async function uploadFile(
  supplierId: string,
  formData: FormData,
  field: "avatar_path" | "overview_doc_path",
  prefix: "avatar" | "overview",
  imageOnly: boolean,
) {
  await requireAdmin();
  const supabase = await createClient();

  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { error: "Keine Datei ausgewählt." };
  if (imageOnly && !file.type.startsWith("image/")) {
    return { error: "Nur Bilddateien erlaubt." };
  }

  const ext = (file.name.split(".").pop() ?? "bin").toLowerCase().replace(/[^a-z0-9]/g, "");
  const cleanPath = `${prefix}_${supplierId}_${Date.now()}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(cleanPath, file, { contentType: file.type, upsert: true });
  if (upErr) return { error: upErr.message };

  const { data: old } = await supabase
    .from("suppliers")
    .select(field)
    .eq("id", supplierId)
    .single();
  const oldPath = (old as Record<string, string | null> | null)?.[field];
  if (oldPath && oldPath !== cleanPath) {
    await supabase.storage.from(BUCKET).remove([oldPath]);
  }

  const { error: dbErr } = await supabase
    .from("suppliers")
    .update({ [field]: cleanPath })
    .eq("id", supplierId);
  if (dbErr) return { error: dbErr.message };

  revalidatePath("/");
  return { ok: true };
}

async function removeFile(
  supplierId: string,
  field: "avatar_path" | "overview_doc_path",
) {
  await requireAdmin();
  const supabase = await createClient();
  const { data: s } = await supabase
    .from("suppliers")
    .select(field)
    .eq("id", supplierId)
    .single();
  const oldPath = (s as Record<string, string | null> | null)?.[field];
  if (oldPath) await supabase.storage.from(BUCKET).remove([oldPath]);
  await supabase.from("suppliers").update({ [field]: null }).eq("id", supplierId);
  revalidatePath("/");
  return { ok: true };
}

export async function uploadSupplierAvatar(supplierId: string, formData: FormData) {
  return uploadFile(supplierId, formData, "avatar_path", "avatar", true);
}

export async function removeSupplierAvatar(supplierId: string) {
  return removeFile(supplierId, "avatar_path");
}

export async function uploadSupplierOverview(supplierId: string, formData: FormData) {
  return uploadFile(supplierId, formData, "overview_doc_path", "overview", false);
}

export async function removeSupplierOverview(supplierId: string) {
  return removeFile(supplierId, "overview_doc_path");
}

export async function updateOverviewLabel(supplierId: string, label: string) {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from("suppliers")
    .update({ overview_doc_label: label.trim() || null })
    .eq("id", supplierId);
  if (error) return { error: error.message };
  revalidatePath("/");
  return { ok: true };
}

export async function setOverviewVisibility(supplierId: string, visible: boolean) {
  await requireAdmin();
  const supabase = await createClient();
  const { error } = await supabase
    .from("suppliers")
    .update({ overview_visible_to_supplier: visible })
    .eq("id", supplierId);
  if (error) return { error: error.message };
  revalidatePath("/");
  return { ok: true };
}

export async function reorderSuppliers(orderedIds: string[]) {
  await requireAdmin();
  const supabase = await createClient();
  // Update sort_order for each supplier based on array position
  const updates = orderedIds.map((id, i) =>
    supabase.from("suppliers").update({ sort_order: i + 1 }).eq("id", id),
  );
  await Promise.all(updates);
  revalidatePath("/");
  return { ok: true };
}

export async function updateSupplierProfile(supplierId: string, formData: FormData) {
  await requireAdmin();
  const supabase = await createClient();
  const s = (v: FormDataEntryValue | null) => {
    const x = String(v ?? "").trim();
    return x || null;
  };
  const { error } = await supabase
    .from("suppliers")
    .update({
      address: s(formData.get("address")),
      email: s(formData.get("email")),
      phone: s(formData.get("phone")),
      bank_name: s(formData.get("bank_name")),
      bank_account_holder: s(formData.get("bank_account_holder")),
      bank_address: s(formData.get("bank_address")),
      iban: s(formData.get("iban")),
      swift_bic: s(formData.get("swift_bic")),
      profile_notes: s(formData.get("profile_notes")),
    })
    .eq("id", supplierId);
  if (error) return { error: error.message };
  revalidatePath("/");
  return { ok: true };
}
