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

  // Lade vorherige eta für Vergleich (Auto-Propagation bei Änderung)
  const { data: prevOrder } = await supabase
    .from("orders")
    .select("eta")
    .eq("id", orderId)
    .single();

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

  // AUTO-PROPAGATION: Wenn ETA geändert wurde, automatisch auf alle Positionen
  // ohne Teillieferung übernehmen UND ins Google Sheet schreiben.
  // User-Anweisung 06.06: 'wenn ich die eta aus der bestellung anpasse, dann
  // soll automatisch das auf alle verbliebenen positionen übernommen werden'
  // + 'sheet soll auch automatisch geupdatet werden'.
  // Items mit shipment_id bleiben unberührt (ihre ETA kommt aus der Teillieferung).
  if (Object.prototype.hasOwnProperty.call(update, "eta") && update.eta !== prevOrder?.eta) {
    const newEta = update.eta as string | null;
    if (newEta) {
      const { data: propagated } = await supabase
        .from("order_items")
        .update({ eta: newEta })
        .eq("order_id", orderId)
        .is("shipment_id", null)
        .select("id, method_name, length_value, color_name");
      const items = propagated ?? [];
      const n = items.length;
      if (n > 0) {
        await logEvent(
          supabase,
          orderId,
          profile.id,
          "eta_propagated",
          `ETA-Änderung auf ${n} Position(en) ohne Teillieferung automatisch übernommen (${newEta})`,
        );

        // Sheet-Schreibung: laden sheet_url, schreiben pro Item-Zeile.
        // Sheet-Fehler werden NICHT als orders.update-Fehler zurückgegeben —
        // DB-Update soll auch bei Sheet-Problem persistiert bleiben.
        const { data: orderForSheet } = await supabase
          .from("orders")
          .select("sheet_url")
          .eq("id", orderId)
          .single();
        if (orderForSheet?.sheet_url) {
          try {
            const { writeOrderSheetEtas } = await import("@/lib/google-sheets");
            const etas = new Map<string, string>();
            for (const it of items) {
              const key = `${(it.method_name || "").toLowerCase()}|${(it.length_value || "").toLowerCase()}|${(it.color_name || "").replace(/^#/, "").toLowerCase()}`;
              etas.set(key, newEta);
            }
            const res = await writeOrderSheetEtas(orderForSheet.sheet_url, etas);
            if (res.error) {
              console.warn(`[updateOrder] Sheet-Write fehlgeschlagen für ${orderId}: ${res.error}`);
              await logEvent(supabase, orderId, profile.id, "sheet_sync_error",
                `Sheet-ETA-Schreibung fehlgeschlagen: ${res.error}`);
            } else {
              await logEvent(supabase, orderId, profile.id, "sheet_sync",
                `ETA im Sheet aktualisiert: ${res.updated} Position(en)${res.created_eta_column ? " (ETA-Spalte neu angelegt)" : ""}`);
            }
          } catch (e) {
            console.warn(`[updateOrder] Sheet-Write exception:`, e);
          }
        }
      }
    }
  }

  // Sync status change to Google Sheet (if sheet_url exists)
  if (update.status) {
    const { data: order } = await supabase.from("orders").select("sheet_url").eq("id", orderId).single();
    if (order?.sheet_url) {
      try {
        const { updateSheetStatus } = await import("@/lib/google-sheets");
        const res = await updateSheetStatus(order.sheet_url, String(update.status));
        if (res.ok) {
          await logEvent(supabase, orderId, profile.id, "sheet_sync",
            `Status im Google Sheet aktualisiert: ${update.status}`);
        } else {
          console.error(`[updateSheetStatus] failed for order ${orderId}:`, res.error);
          await logEvent(supabase, orderId, profile.id, "sheet_sync",
            `Sheet-Sync fehlgeschlagen: ${res.error}`);
        }
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        console.error(`[updateSheetStatus] exception for order ${orderId}:`, msg);
        await logEvent(supabase, orderId, profile.id, "sheet_sync",
          `Sheet-Sync Fehler: ${msg}`);
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
  const shipmentIdRaw = String(formData.get("shipment_id") ?? "").trim();
  const shipmentId = shipmentIdRaw || null;
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
    shipment_id: shipmentId,
  });
  if (dbErr) return { error: dbErr.message };

  await logEvent(supabase, orderId, profile.id, "document",
    `Dokument hochgeladen: ${file.name} (${kind})${shipmentId ? " · Teillieferung" : ""}`);

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

  // Insert order items (eta defaults to parent order's eta; can be overridden later via sheet sync)
  const items = data.items.map((item) => ({
    order_id: order.id,
    color_id: item.colorId,
    method_name: item.methodName,
    length_value: item.lengthValue,
    color_name: item.colorName,
    quantity: item.quantity,
    unit: item.unit,
    eta,
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
      eta: i.eta ?? null,
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

  // Re-Sync abgeschlossen — Banner ausblenden
  await supabase.from("orders").update({ pending_resync: false }).eq("id", orderId);

  revalidatePath(`/orders/${orderId}`);

  // Return signed URL for immediate viewing
  const { data: signedData } = await supabase.storage
    .from("order-files")
    .createSignedUrl(filePath, 60 * 10);

  return { signedUrl: signedData?.signedUrl };
}

/**
 * Sync items + per-position ETAs from the order's Google Sheet back into our DB.
 *
 * - If DB has items: just updates their `eta` field where the sheet has a date.
 * - If DB is empty (e.g. legacy order, only in sheet): IMPORTS items from the
 *   sheet (method, length, color, qty, eta) + tries to link to product_colors
 *   for color_id via Hairvenly name matching.
 */
/**
 * Order-ETA als Quelle der Wahrheit nehmen und auf alle Positionen anwenden.
 * Items in Teillieferungen (shipment_id gesetzt) bleiben unberührt — ihr ETA
 * kommt aus dem Shipment. Optional wird die ETA-Spalte im Google Sheet
 * gleichzeitig aktualisiert, damit der nächste Sheet-Sync nicht wieder die
 * alten Werte reinholt.
 */
export async function propagateOrderEtaToItems(
  orderId: string,
  opts: { writeToSheet?: boolean } = {},
): Promise<{ updated_db?: number; updated_sheet?: number; created_eta_col?: boolean; error?: string }> {
  const profile = await requireProfile();
  const supabase = await createClient();

  const { data: order } = await supabase
    .from("orders")
    .select("id, eta, sheet_url, label")
    .eq("id", orderId)
    .single();
  if (!order) return { error: "Bestellung nicht gefunden" };
  if (!order.eta) return { error: "Diese Bestellung hat keine ETA gesetzt" };

  // 1) DB: alle Items ohne shipment_id → eta = order.eta
  const { data: updatedItems, error: upErr } = await supabase
    .from("order_items")
    .update({ eta: order.eta })
    .eq("order_id", orderId)
    .is("shipment_id", null)
    .select("id, method_name, length_value, color_name");
  if (upErr) return { error: upErr.message };

  const updatedDb = updatedItems?.length ?? 0;

  // Logging
  await supabase.from("order_events").insert({
    order_id: orderId,
    event_type: "eta_propagated",
    message: `Order-ETA (${order.eta}) auf ${updatedDb} Positionen ohne Teillieferung übernommen.`,
    actor_id: profile.id,
  });

  // 2) Sheet (optional)
  let updatedSheet = 0;
  let createdEtaCol = false;
  if (opts.writeToSheet && order.sheet_url && updatedItems && updatedItems.length > 0) {
    const gs = await import("@/lib/google-sheets");
    const etas = new Map<string, string>();
    for (const it of updatedItems) {
      const key = `${(it.method_name || "").toLowerCase()}|${(it.length_value || "").toLowerCase()}|${(it.color_name || "").replace(/^#/, "").toLowerCase()}`;
      etas.set(key, order.eta as string);
    }
    const r = await gs.writeOrderSheetEtas(order.sheet_url, etas);
    if (r.error) {
      // Sheet-Fehler nicht als Gesamtfehler zurückgeben — DB-Update bleibt gültig
      console.warn("[propagateOrderEtaToItems] Sheet-Write Fehler:", r.error);
    } else {
      updatedSheet = r.updated ?? 0;
      createdEtaCol = !!r.created_eta_column;
    }
  }

  revalidatePath(`/orders/${orderId}`);
  return { updated_db: updatedDb, updated_sheet: updatedSheet, created_eta_col: createdEtaCol };
}

export async function syncOrderItemsEtaFromSheet(
  orderId: string,
): Promise<{ updated?: number; imported?: number; error?: string }> {
  const profile = await requireProfile();
  const supabase = await createClient();

  const { data: order } = await supabase
    .from("orders")
    .select("sheet_url, supplier_id")
    .eq("id", orderId)
    .single();
  if (!order?.sheet_url) return { error: "Bestellung hat kein Sheet-Link" };

  const { data: items } = await supabase
    .from("order_items")
    .select("id, method_name, length_value, color_name, eta")
    .eq("order_id", orderId);

  const gs = await import("@/lib/google-sheets");

  // Case A: items exist → update ETAs only
  if (items && items.length > 0) {
    const r = await gs.readOrderSheetEtas(order.sheet_url);
    if (r.error || !r.etas) return { error: r.error ?? "Sheet konnte nicht gelesen werden" };

    let updated = 0;
    for (const it of items) {
      const key = `${it.method_name.toLowerCase()}|${it.length_value.toLowerCase()}|${it.color_name.replace(/^#/, "").toLowerCase()}`;
      const newEta = r.etas.get(key) ?? null;
      if (newEta === it.eta || !newEta) continue;
      const { error: updErr } = await supabase
        .from("order_items")
        .update({ eta: newEta })
        .eq("id", it.id);
      if (!updErr) updated++;
    }

    if (updated > 0) {
      await logEvent(supabase, orderId, profile.id, "sheet_sync",
        `${updated} Positions-ETA(s) aus Sheet synchronisiert`);
    }
    revalidatePath(`/orders/${orderId}`);
    revalidatePath(`/stock`, "layout");
    return { updated };
  }

  // Case B: no items in DB → import from sheet
  const r = await gs.readOrderSheetItems(order.sheet_url);
  if (r.error || !r.items) return { error: r.error ?? "Sheet konnte nicht gelesen werden" };
  if (r.items.length === 0) return { error: "Im Sheet wurden keine Positionen gefunden" };

  // Best-effort color_id lookup via product_colors for this supplier
  const { data: catalogRows } = await supabase
    .from("product_colors")
    .select("id, name_hairvenly, product_lengths!length_id(value, product_methods!method_id(name, supplier_id))")
    .order("name_hairvenly");

  type CatRow = {
    id: string;
    name_hairvenly: string | null;
    product_lengths: {
      value: string | null;
      product_methods: { name: string | null; supplier_id: string | null } | { name: string | null; supplier_id: string | null }[] | null;
    } | { value: string | null; product_methods: { name: string | null; supplier_id: string | null } | { name: string | null; supplier_id: string | null }[] | null }[] | null;
  };
  const colorLookup = new Map<string, string>();
  for (const c of (catalogRows ?? []) as CatRow[]) {
    if (!c.name_hairvenly) continue;
    const pl = Array.isArray(c.product_lengths) ? c.product_lengths[0] : c.product_lengths;
    if (!pl?.value) continue;
    const pm = Array.isArray(pl.product_methods) ? pl.product_methods[0] : pl.product_methods;
    if (!pm?.name) continue;
    if (pm.supplier_id && pm.supplier_id !== order.supplier_id) continue;
    const key = `${pm.name.toLowerCase()}|${pl.value.toLowerCase()}|${c.name_hairvenly.toLowerCase()}`;
    colorLookup.set(key, c.id);
  }

  const inserts = r.items.map((it) => ({
    order_id: orderId,
    color_id: colorLookup.get(
      `${it.method.toLowerCase()}|${it.length.toLowerCase()}|${it.color.toLowerCase()}`,
    ) ?? null,
    method_name: it.method,
    length_value: it.length,
    color_name: it.color,
    quantity: it.quantity,
    unit: "g",
    eta: it.eta,
  }));

  const { error: insErr } = await supabase.from("order_items").insert(inserts);
  if (insErr) return { error: insErr.message };

  await logEvent(supabase, orderId, profile.id, "sheet_sync",
    `${inserts.length} Position(en) aus Sheet importiert`);

  revalidatePath(`/orders/${orderId}`);
  revalidatePath(`/stock`, "layout");
  return { imported: inserts.length };
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
      eta: i.eta ?? null,
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
    .update({ sheet_url: result.sheetUrl, pending_resync: false })
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

/**
 * Triggert einen Apps-Script-Refresh für den Lieferant dieser Bestellung.
 * Nutzt das letzte bekannte Budget aus dem Stock-Sheet-Vorschlag-Tab
 * (Zelle J2 für Amanda, I2 für China) — falls das fehlt: Default 20kg.
 *
 * Dauer: 2-5 Minuten (Apps Script createBestellungAmanda/China).
 * Effekt: Stock-Sheet (Russisch-GLATT / Usbekisch-WELLIG) wird komplett
 * neu berechnet inkl. der 'unterwegs'-Spalten pro Bestellung.
 */
export async function refreshStockForOrder(orderId: string): Promise<{ error?: string; title?: string }> {
  await requireAdmin();
  const supabase = await createClient();

  const { data: order } = await supabase
    .from("orders")
    .select("supplier_id")
    .eq("id", orderId)
    .single();
  if (!order) return { error: "Bestellung nicht gefunden" };

  const { data: supplier } = await supabase
    .from("suppliers")
    .select("name")
    .eq("id", order.supplier_id)
    .single();
  if (!supplier) return { error: "Lieferant nicht gefunden" };

  // Letztes bekanntes Budget aus dem Vorschlag-Tab holen (getSuggestionMeta
  // ist in dieser Datei weiter unten definiert)
  const meta = await getSuggestionMeta(supplier.name);
  const budgetKg = meta?.budgetKg && meta.budgetKg > 0 ? meta.budgetKg : 20;

  return triggerSuggestionGeneration(supplier.name, budgetKg);
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

/**
 * Startet die Bestellvorschlag-Generierung asynchron (Apps Script Job +
 * Trigger, Antwort in <5s). Fortschritt via getGenerationStatus() pollen.
 */
export async function startGeneration(supplierName: string, budgetKg: number): Promise<{ ok: boolean; error?: string }> {
  await requireAdmin();

  const lower = supplierName.toLowerCase();
  const supplier = lower.includes("amanda") ? "amanda" as const
    : (lower.includes("eyfel") || lower.includes("china") || lower.includes("ebru")) ? "china" as const
    : null;
  if (!supplier) return { ok: false, error: "Kein Vorschlag für diesen Lieferanten" };

  const budgetGrams = Math.round(budgetKg * 1000);
  const { startSuggestionGeneration } = await import("@/lib/google-sheets");
  return startSuggestionGeneration(supplier, budgetGrams);
}

/** Pollt den Status des laufenden Generierungs-Jobs. */
export async function getGenerationStatus(): Promise<{
  status: string;
  title?: string;
  error?: string;
  activeStep?: string | null;
  pollError?: string;
}> {
  await requireAdmin();
  const { pollSuggestionGeneration } = await import("@/lib/google-sheets");
  const result = await pollSuggestionGeneration();
  if ("pollError" in result) return { status: "poll_error", pollError: result.pollError };
  return result;
}

// ── Order Item Editing ──────────────────────────────────────────
// Erlaubt admins + mitarbeitern, bestellpositionen nachträglich zu
// ändern (Menge, hinzufügen, entfernen) — solange die Bestellung im
// editierbaren Status ist (bis inkl. "in_production"). Setzt
// orders.pending_resync = true, damit das UI den Re-Sync-Banner zeigt.

// Positionen sind in jedem aktiven Status editierbar — auch nach shipped,
// damit nachträgliche Korrekturen (z.B. nachgereichter Lieferschein-Eintrag,
// vergessene Position) möglich sind. Gesperrt nur in den Endzuständen.
const EDITABLE_STATUSES = [
  "draft", "sent_to_supplier", "confirmed", "in_production",
  "ready_to_ship", "shipped", "in_customs", "delivered",
] as const;

async function requireOrderEditor(orderId: string) {
  const profile = await requireProfile();
  // Nur admins + mitarbeiter (employees haben is_admin=true)
  if (!profile.is_admin) throw new Error("Keine Berechtigung");
  if (profile.role !== "admin" && profile.role !== "employee") throw new Error("Keine Berechtigung");

  const supabase = await createClient();
  const { data: order } = await supabase
    .from("orders")
    .select("id, status")
    .eq("id", orderId)
    .single();

  if (!order) throw new Error("Bestellung nicht gefunden");
  if (!(EDITABLE_STATUSES as readonly string[]).includes(order.status)) {
    throw new Error(`Bestellung kann im Status "${order.status}" nicht mehr bearbeitet werden`);
  }

  return { profile, supabase };
}

/**
 * Auto-Sync: nach einer Positions-Änderung das Order-Sheet aktualisieren.
 * Wenn die Bestellung noch kein Sheet hat, wird nichts gemacht (User muss
 * initial via 'Sheet Export' anlegen). Bei Erfolg pending_resync = false,
 * bei Fehler bleibt pending_resync = true → User sieht Banner und kann
 * manuell nachziehen.
 *
 * Aufruf best-effort — Sheet-Fehler dürfen die DB-Änderung nicht rückgängig
 * machen (die Position bleibt gültig, nur die Sync ist temp offline).
 */
async function autoSyncOrderSheet(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orderId: string,
): Promise<void> {
  try {
    const { data: order } = await supabase
      .from("orders")
      .select("sheet_url")
      .eq("id", orderId)
      .single();
    if (!order?.sheet_url) return; // Kein Sheet → nichts zu syncen

    const res = await exportOrderToGoogleSheet(orderId);
    if (res.error) {
      console.warn(`[autoSyncOrderSheet] ${orderId}: ${res.error}`);
    }
    // exportOrderToGoogleSheet setzt bei Erfolg selbst pending_resync=false.
  } catch (e) {
    console.warn("[autoSyncOrderSheet] Exception:", e);
  }
}

export async function updateOrderItemQuantity(input: {
  orderId: string;
  itemId: string;
  quantity: number;
}): Promise<{ error?: string }> {
  try {
    const { profile, supabase } = await requireOrderEditor(input.orderId);

    if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
      return { error: "Menge muss eine positive Zahl sein" };
    }

    const { data: oldItem } = await supabase
      .from("order_items")
      .select("color_name, quantity, unit, order_id")
      .eq("id", input.itemId)
      .single();
    if (!oldItem || oldItem.order_id !== input.orderId) return { error: "Position nicht gefunden" };

    if (oldItem.quantity === input.quantity) return {}; // no-op

    const { error } = await supabase
      .from("order_items")
      .update({ quantity: input.quantity })
      .eq("id", input.itemId);
    if (error) return { error: error.message };

    await supabase.from("orders").update({ pending_resync: true }).eq("id", input.orderId);
    await logEvent(
      supabase,
      input.orderId,
      profile.id,
      "edit",
      `Menge geändert: #${oldItem.color_name} ${oldItem.quantity}${oldItem.unit} → ${input.quantity}${oldItem.unit}`,
    );

    await autoSyncOrderSheet(supabase, input.orderId);
    revalidatePath(`/orders/${input.orderId}`);
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Fehler" };
  }
}

export async function deleteOrderItem(input: {
  orderId: string;
  itemId: string;
}): Promise<{ error?: string }> {
  try {
    const { profile, supabase } = await requireOrderEditor(input.orderId);

    const { data: oldItem } = await supabase
      .from("order_items")
      .select("color_name, quantity, unit, method_name, length_value, order_id")
      .eq("id", input.itemId)
      .single();
    if (!oldItem || oldItem.order_id !== input.orderId) return { error: "Position nicht gefunden" };

    const { error } = await supabase.from("order_items").delete().eq("id", input.itemId);
    if (error) return { error: error.message };

    await supabase.from("orders").update({ pending_resync: true }).eq("id", input.orderId);
    await logEvent(
      supabase,
      input.orderId,
      profile.id,
      "edit",
      `Position entfernt: #${oldItem.color_name} ${oldItem.quantity}${oldItem.unit} (${oldItem.method_name} ${oldItem.length_value})`,
    );

    await autoSyncOrderSheet(supabase, input.orderId);
    revalidatePath(`/orders/${input.orderId}`);
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Fehler" };
  }
}

export async function addOrderItem(input: {
  orderId: string;
  methodName: string;
  lengthValue: string;
  colorId: string | null;
  colorName: string;
  quantity: number;
  unit?: string;
}): Promise<{ error?: string }> {
  try {
    const { profile, supabase } = await requireOrderEditor(input.orderId);

    if (!Number.isFinite(input.quantity) || input.quantity <= 0) {
      return { error: "Menge muss eine positive Zahl sein" };
    }
    if (!input.colorName.trim()) return { error: "Farbe darf nicht leer sein" };
    if (!input.methodName.trim() || !input.lengthValue.trim()) {
      return { error: "Methode und Länge sind erforderlich" };
    }

    const { error } = await supabase.from("order_items").insert({
      order_id: input.orderId,
      color_id: input.colorId,
      method_name: input.methodName,
      length_value: input.lengthValue,
      color_name: input.colorName,
      quantity: input.quantity,
      unit: input.unit ?? "g",
    });
    if (error) return { error: error.message };

    await supabase.from("orders").update({ pending_resync: true }).eq("id", input.orderId);
    await logEvent(
      supabase,
      input.orderId,
      profile.id,
      "edit",
      `Position hinzugefügt: #${input.colorName} ${input.quantity}${input.unit ?? "g"} (${input.methodName} ${input.lengthValue})`,
    );

    await autoSyncOrderSheet(supabase, input.orderId);
    revalidatePath(`/orders/${input.orderId}`);
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Fehler" };
  }
}
