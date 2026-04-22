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

  const supplierId = String(formData.get("supplier_id"));
  const orderDate = str(formData.get("order_date"));
  const region = str(formData.get("region"));
  let label = String(formData.get("label") ?? "").trim();

  // Auto-generate label from supplier name + region + order_date if label is empty
  if (!label && supplierId && orderDate) {
    const { data: sup } = await supabase
      .from("suppliers")
      .select("name")
      .eq("id", supplierId)
      .single();
    const { buildOrderLabel } = await import("@/lib/order-label");
    label = buildOrderLabel(sup?.name, region, orderDate);
  }

  const payload = {
    supplier_id: supplierId,
    label,
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
    order_date: orderDate,
    region: region || null,
    notes: str(formData.get("notes")),
    status: "draft" as const,
  };

  if (!payload.supplier_id) {
    return { error: "Lieferant ist erforderlich." };
  }
  if (!payload.order_date) {
    return { error: "Bestelldatum ist erforderlich." };
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
    setStr("order_date");
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

  // Sync status change to Google Sheet (if sheet_url exists)
  if (update.status) {
    const { data: order } = await supabase.from("orders").select("sheet_url").eq("id", orderId).single();
    if (order?.sheet_url) {
      try {
        const { updateSheetStatus } = await import("@/lib/google-sheets");
        await updateSheetStatus(order.sheet_url, String(update.status));
      } catch {
        // Silent fail — sheet sync is best-effort
      }
    }
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

export async function deleteOrder(orderId: string) {
  await requireAdmin();
  const supabase = await createClient();

  // Delete related data first (payments, documents, events)
  const { data: docs } = await supabase
    .from("documents")
    .select("file_path")
    .eq("order_id", orderId);
  if (docs && docs.length > 0) {
    await supabase.storage
      .from("order-files")
      .remove(docs.map((d) => d.file_path));
  }
  await supabase.from("documents").delete().eq("order_id", orderId);
  await supabase.from("payments").delete().eq("order_id", orderId);
  await supabase.from("order_events").delete().eq("order_id", orderId);

  const { error } = await supabase.from("orders").delete().eq("id", orderId);
  if (error) return { error: error.message };

  revalidatePath("/orders");
  revalidatePath("/");
  redirect("/");
}

export async function getSignedUrl(filePath: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.storage
    .from("order-files")
    .createSignedUrl(filePath, 60 * 10);
  if (error) return null;
  return data.signedUrl;
}

// ── Wizard Order Creation ───────────────────────────────────────

interface WizardItem {
  colorId: string | null;
  methodName: string;
  lengthValue: string;
  colorName: string;
  quantity: number;
  unit: string;
}

export async function createWizardOrder(data: {
  supplierId: string;
  orderDate: string;
  region: string | null;
  notes: string;
  items: WizardItem[];
}): Promise<{ error?: string; orderId?: string }> {
  const profile = await requireAdmin();
  const supabase = await createClient();

  if (!data.supplierId || !data.orderDate || data.items.length === 0) {
    return { error: "Lieferant, Datum und mindestens ein Artikel erforderlich" };
  }

  // Get supplier name for auto-label
  const { data: supplier } = await supabase
    .from("suppliers")
    .select("name, default_lead_weeks")
    .eq("id", data.supplierId)
    .single();

  const { buildOrderLabel } = await import("@/lib/order-label");
  const label = buildOrderLabel(supplier?.name, data.region, data.orderDate);

  // Determine tags from methods
  const tags = ["extensions"];

  // Calculate total weight from items
  const totalGrams = data.items.reduce((sum, i) => sum + i.quantity, 0);
  const weightKg = Math.round(totalGrams / 10) / 100; // Round to 2 decimals

  // Calculate ETA based on supplier lead times
  const leadWeeks = data.region === "TR" ? 2 : data.region === "CN" ? 8 : (supplier?.default_lead_weeks ?? 6);
  const etaDate = new Date(data.orderDate);
  etaDate.setDate(etaDate.getDate() + leadWeeks * 7);
  const eta = etaDate.toISOString().slice(0, 10);

  // Auto-notes
  const autoNote = "Durch Wizard erstellte Bestellung (KI-Automatisierung)";
  const notes = data.notes ? `${data.notes}\n\n${autoNote}` : autoNote;

  // Create order
  const { data: order, error: orderErr } = await supabase
    .from("orders")
    .insert({
      supplier_id: data.supplierId,
      label,
      order_date: data.orderDate,
      region: data.region,
      status: "draft",
      tags,
      weight_kg: weightKg,
      package_count: 1,
      eta,
      notes,
      created_by: profile.id,
    })
    .select("id")
    .single();

  if (orderErr || !order) return { error: orderErr?.message ?? "Fehler beim Erstellen" };

  // Insert order items
  const items = data.items.map((item) => ({
    order_id: order.id,
    color_id: item.colorId,
    method_name: item.methodName,
    length_value: item.lengthValue,
    color_name: item.colorName,
    quantity: item.quantity,
    unit: item.unit,
  }));

  const { error: itemsErr } = await supabase.from("order_items").insert(items);
  if (itemsErr) return { error: itemsErr.message };

  // Log event
  await logEvent(supabase, order.id, "note", `Bestellung via Wizard erstellt: ${data.items.length} Positionen`, profile.id);

  revalidatePath("/orders");
  revalidatePath("/");
  return { orderId: order.id };
}

// ── Google Sheets Export ────────────────────────────────────────

// ── PDF Generation + Upload ─────────────────────────────────────

export async function generateAndUploadPDF(orderId: string): Promise<{ signedUrl?: string; error?: string }> {
  const profile = await requireAdmin();
  const supabase = await createClient();

  const { data: order } = await supabase.from("orders").select("*").eq("id", orderId).single();
  if (!order) return { error: "Bestellung nicht gefunden" };

  const { data: supplier } = await supabase.from("suppliers").select("name").eq("id", order.supplier_id).single();
  if (!supplier) return { error: "Lieferant nicht gefunden" };

  const { data: items } = await supabase.from("order_items").select("*").eq("order_id", orderId).order("created_at");
  if (!items || items.length === 0) return { error: "Keine Bestellpositionen vorhanden" };

  const { generateOrderPDF } = await import("@/lib/generate-pdf");

  const regionLabel = order.region === "CN" ? "China" : order.region === "TR" ? "Türkei" : null;
  const displayName = regionLabel ? `Eyfel Ebru (${regionLabel})` : supplier.name;
  const pdfBuffer = generateOrderPDF(
    displayName,
    order.order_date ?? order.created_at.slice(0, 10),
    items.map((i) => ({
      methodName: i.method_name,
      lengthValue: i.length_value,
      colorName: i.color_name,
      quantity: i.quantity,
    })),
  );

  // Upload to Supabase storage
  const safeName = `${order.label?.replace(/[^a-zA-Z0-9_-]/g, "_") ?? orderId}.pdf`;
  const filePath = `${orderId}/${Date.now()}_${safeName}`;

  const { error: uploadErr } = await supabase.storage
    .from("order-files")
    .upload(filePath, pdfBuffer, { contentType: "application/pdf", upsert: false });

  if (uploadErr) return { error: `Upload fehlgeschlagen: ${uploadErr.message}` };

  // Save as document with kind "order_overview"
  await supabase.from("documents").insert({
    order_id: orderId,
    kind: "order_overview",
    file_path: filePath,
    file_name: safeName,
    uploaded_by: profile.id,
  });

  await logEvent(supabase, orderId, "document", `Bestellübersicht-PDF erstellt und hochgeladen`, profile.id);

  revalidatePath(`/orders/${orderId}`);

  // Return signed URL for immediate viewing
  const { data: signedData } = await supabase.storage
    .from("order-files")
    .createSignedUrl(filePath, 60 * 10);

  return { signedUrl: signedData?.signedUrl };
}

export async function exportOrderToGoogleSheet(orderId: string): Promise<{ sheetUrl?: string; error?: string }> {
  const profile = await requireAdmin();
  const supabase = await createClient();

  // Load order + supplier + items
  const { data: order } = await supabase.from("orders").select("*").eq("id", orderId).single();
  if (!order) return { error: "Bestellung nicht gefunden" };

  const { data: supplier } = await supabase.from("suppliers").select("name").eq("id", order.supplier_id).single();
  if (!supplier) return { error: "Lieferant nicht gefunden" };

  const { data: items } = await supabase
    .from("order_items")
    .select("*")
    .eq("order_id", orderId)
    .order("created_at");

  if (!items || items.length === 0) return { error: "Keine Bestellpositionen vorhanden" };

  // Dynamic import to avoid loading googleapis on every request
  const { exportOrderToSheet } = await import("@/lib/google-sheets");

  // Use region for tab name: "China 07.04.2026" or "Türkei 07.04.2026"
  const sheetName = order.region === "CN" ? "China"
    : order.region === "TR" ? "Türkei"
    : supplier.name;

  const result = await exportOrderToSheet(
    sheetName,
    order.order_date ?? order.created_at.slice(0, 10),
    items.map((i) => ({
      methodName: i.method_name,
      lengthValue: i.length_value,
      colorName: i.color_name,
      quantity: i.quantity,
    })),
    {
      status: order.status,
      weightKg: order.weight_kg ? Number(order.weight_kg) : undefined,
      eta: order.eta ?? undefined,
      notes: order.notes ?? undefined,
    },
  );

  if ("error" in result) return { error: result.error };

  // Save sheet URL to order
  await supabase
    .from("orders")
    .update({ sheet_url: result.sheetUrl })
    .eq("id", orderId);

  // Log event
  await logEvent(supabase, orderId, "note", `Bestellung nach Google Sheets exportiert`, profile.id);

  revalidatePath(`/orders/${orderId}`);
  return { sheetUrl: result.sheetUrl };
}

// ── Import Suggestions from Stock Sheet ─────────────────────────

export async function importOrderSuggestions(supplierName: string): Promise<{
  suggestions?: Array<{
    method: string;
    length: string;
    colorCode: string;
    stock: number;
    inTransit: number;
    target: number;
    orderQty: number;
  }>;
  error?: string;
}> {
  await requireAdmin();

  // Determine tab name based on supplier
  const lower = supplierName.toLowerCase();
  let tabName: string;
  if (lower.includes("amanda")) {
    tabName = "Vorschlag - Amanda";
  } else if (lower.includes("eyfel") || lower.includes("china") || lower.includes("ebru")) {
    tabName = "Vorschlag - China";
  } else {
    return { error: `Kein Bestellvorschlag für "${supplierName}" verfügbar` };
  }

  const { importSuggestions } = await import("@/lib/google-sheets");
  const result = await importSuggestions(tabName);

  if ("error" in result) return { error: result.error };
  return { suggestions: result.rows };
}

// ── Suggestion Meta & Budget Trigger ────────────────────────────

export async function getSuggestionMeta(supplierName: string): Promise<{
  title?: string; budgetKg?: number; usedKg?: number; error?: string;
}> {
  await requireAdmin();

  const lower = supplierName.toLowerCase();
  const tabName = lower.includes("amanda") ? "Vorschlag - Amanda"
    : (lower.includes("eyfel") || lower.includes("china") || lower.includes("ebru")) ? "Vorschlag - China"
    : null;
  if (!tabName) return { error: "Kein Vorschlag-Tab" };

  const { readSuggestionMeta } = await import("@/lib/google-sheets");
  const meta = await readSuggestionMeta(tabName);
  if (!meta) return { error: "Konnte Metadaten nicht lesen" };
  return { title: meta.title, budgetKg: meta.budgetKg, usedKg: meta.usedKg };
}

export async function triggerSuggestionGeneration(supplierName: string, budgetKg: number): Promise<{ error?: string; title?: string }> {
  await requireAdmin();

  const lower = supplierName.toLowerCase();
  const supplier = lower.includes("amanda") ? "amanda" as const
    : (lower.includes("eyfel") || lower.includes("china") || lower.includes("ebru")) ? "china" as const
    : null;
  if (!supplier) return { error: "Kein Vorschlag für diesen Lieferanten" };

  const budgetGrams = Math.round(budgetKg * 1000);
  const { triggerAppsScript } = await import("@/lib/google-sheets");
  const result = await triggerAppsScript(supplier, budgetGrams);
  if (!result.ok) return { error: result.error };
  return { title: result.title };
}
