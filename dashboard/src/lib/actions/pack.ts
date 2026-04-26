"use server";

import QRCode from "qrcode";
import { createClient } from "@/lib/supabase/server";
import { requireProfile, hasFeature } from "@/lib/auth";
import {
  fetchOrderForPack,
  fulfillOrderInShopify,
  setOrderMetafield,
  type PackOrderLineItem,
} from "@/lib/shopify";
import { revalidatePath } from "next/cache";

const PACK_BASE_URL = "https://suppliers.hairvenly.de";

/**
 * Generiert ein QR-SVG für die Pack-Modus-URL der Order und speichert es als
 * Order-Metafield "custom.pack_qr_svg". Wird vom Lieferschein-Liquid inline
 * gerendert (kein externer Image-Request -> umgeht html2pdf-whitelist).
 *
 * Idempotent: kann mehrfach aufgerufen werden, setzt einfach den Wert neu.
 */
export async function ensureOrderPackQr(
  orderName: string,
  orderGid: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    const cleanName = orderName.replace(/^#/, "");
    const packUrl = `${PACK_BASE_URL}/pack/${cleanName}`;
    const svg = await QRCode.toString(packUrl, {
      type: "svg",
      margin: 2,
      width: 180,
      errorCorrectionLevel: "M",
      color: { dark: "#000000", light: "#FFFFFF" },
    });
    await setOrderMetafield(orderGid, "custom", "pack_qr_svg", "multi_line_text_field", svg);
    return { success: true };
  } catch (e) {
    return { success: false, error: e instanceof Error ? e.message : String(e) };
  }
}

interface ExpectedItem {
  variantId: string | null;
  barcode: string | null;
  title: string;
  variantTitle: string | null;
  quantity: number;
  imageUrl: string | null;
}

function toExpected(items: PackOrderLineItem[]): ExpectedItem[] {
  return items.map((li) => ({
    variantId: li.variantId,
    barcode: li.barcode,
    title: li.title,
    variantTitle: li.variantTitle,
    quantity: li.quantity,
    imageUrl: li.imageUrl,
  }));
}

/**
 * Lädt eine bestehende Pack-Session oder erstellt eine neue für die Order.
 * Liefert die Session-Id zurück.
 */
export async function getOrCreatePackSession(orderName: string): Promise<{
  sessionId: string;
  status: string;
  expectedItems: ExpectedItem[];
}> {
  const profile = await requireProfile();
  if (!hasFeature(profile, "shipping")) {
    throw new Error("Forbidden");
  }

  const cleanName = orderName.startsWith("#") ? orderName : `#${orderName}`;
  const supabase = await createClient();

  // Existierende Session?
  const { data: existing } = await supabase
    .from("pack_sessions")
    .select("id, status, expected_items, shopify_order_id, packed_by")
    .eq("order_name", cleanName)
    .maybeSingle();

  if (existing) {
    // Bei status=open → sofort auf in_progress setzen (Display switcht beim Page-Open)
    const updates: Record<string, unknown> = {};
    if (!existing.packed_by) updates.packed_by = profile.id;
    if (existing.status === "open") {
      updates.status = "in_progress";
      updates.started_at = new Date().toISOString();
    } else {
      // Status update um updated_at zu triggern → Display switcht zu dieser Session
      updates.updated_at = new Date().toISOString();
    }
    await supabase.from("pack_sessions").update(updates).eq("id", existing.id);

    return {
      sessionId: existing.id,
      status: existing.status === "open" ? "in_progress" : existing.status,
      expectedItems: (existing.expected_items as ExpectedItem[]) ?? [],
    };
  }

  // Neue Session: Order aus Shopify holen
  const order = await fetchOrderForPack(orderName);
  if (!order) {
    throw new Error(`Bestellung ${orderName} nicht gefunden`);
  }

  const expected = toExpected(order.lineItems);
  const numericId = parseInt(order.numericId, 10);

  const { data: created, error } = await supabase
    .from("pack_sessions")
    .insert({
      order_name: cleanName,
      shopify_order_id: Number.isFinite(numericId) ? numericId : null,
      status: "in_progress", // sofort aktiv damit Display switcht
      started_at: new Date().toISOString(),
      expected_items: expected,
      packed_by: profile.id,
    })
    .select("id, status")
    .single();

  if (error || !created) {
    throw new Error(`Pack-Session konnte nicht angelegt werden: ${error?.message}`);
  }

  return { sessionId: created.id, status: created.status, expectedItems: expected };
}

/**
 * Verarbeitet einen Barcode-Scan. Vergleicht mit erwarteten Items.
 * Returns scan status: 'match' | 'mismatch' | 'overflow'.
 */
export async function recordPackScan(
  sessionId: string,
  scannedBarcode: string,
): Promise<{
  status: "match" | "mismatch" | "overflow";
  matchedTitle?: string;
  matchedVariantId?: string | null;
  scannedCounts: Record<string, number>; // barcode → count so far
  isComplete: boolean;
}> {
  const profile = await requireProfile();
  if (!hasFeature(profile, "shipping")) {
    throw new Error("Forbidden");
  }

  const supabase = await createClient();
  const trimmed = scannedBarcode.trim();
  if (!trimmed) {
    throw new Error("Leerer Barcode");
  }

  // Session laden
  const { data: session, error: sErr } = await supabase
    .from("pack_sessions")
    .select("id, status, expected_items")
    .eq("id", sessionId)
    .single();

  if (sErr || !session) {
    throw new Error("Session nicht gefunden");
  }

  const expected = (session.expected_items as ExpectedItem[]) ?? [];

  // Bestehende Match-Scans zählen
  const { data: prevScans } = await supabase
    .from("pack_scans")
    .select("scanned_barcode, status")
    .eq("session_id", sessionId)
    .eq("status", "match");

  const scannedCounts: Record<string, number> = {};
  for (const s of prevScans ?? []) {
    scannedCounts[s.scanned_barcode] = (scannedCounts[s.scanned_barcode] ?? 0) + 1;
  }

  // Erwartete Position für diesen Barcode finden
  const expectedItem = expected.find((e) => e.barcode === trimmed);

  let status: "match" | "mismatch" | "overflow";
  let matchedTitle: string | undefined;
  let matchedVariantId: string | null | undefined;

  if (!expectedItem) {
    status = "mismatch";
  } else {
    const alreadyScanned = scannedCounts[trimmed] ?? 0;
    if (alreadyScanned >= expectedItem.quantity) {
      status = "overflow";
      matchedTitle = expectedItem.title;
      matchedVariantId = expectedItem.variantId;
    } else {
      status = "match";
      matchedTitle = expectedItem.title;
      matchedVariantId = expectedItem.variantId;
      scannedCounts[trimmed] = alreadyScanned + 1;
    }
  }

  // Scan loggen
  const variantNumeric = matchedVariantId
    ? parseInt(matchedVariantId.split("/").pop() ?? "", 10)
    : null;
  await supabase.from("pack_scans").insert({
    session_id: sessionId,
    scanned_barcode: trimmed,
    matched_variant_id: variantNumeric && Number.isFinite(variantNumeric) ? variantNumeric : null,
    matched_title: matchedTitle ?? null,
    status,
    scanned_by: profile.id,
  });

  // Status der Session ggf. updaten (in_progress beim ersten Scan)
  if (session.status === "open") {
    await supabase
      .from("pack_sessions")
      .update({
        status: "in_progress",
        started_at: new Date().toISOString(),
        packed_by: profile.id,
      })
      .eq("id", sessionId);
  }

  // Vollständigkeit prüfen
  const isComplete = expected.every(
    (e) => (scannedCounts[e.barcode ?? ""] ?? 0) >= e.quantity,
  );

  return {
    status,
    matchedTitle,
    matchedVariantId,
    scannedCounts,
    isComplete,
  };
}

/**
 * Manuelle Bestätigung eines Items (für Produkte ohne Barcode auf der Packung).
 * Erhöht den Counter für das angegebene expected_item.
 */
export async function recordManualConfirm(
  sessionId: string,
  itemIndex: number,
): Promise<{
  status: "match" | "overflow";
  matchedTitle?: string;
  scannedCounts: Record<string, number>;
  isComplete: boolean;
}> {
  const profile = await requireProfile();
  if (!hasFeature(profile, "shipping")) throw new Error("Forbidden");

  const supabase = await createClient();

  const { data: session, error: sErr } = await supabase
    .from("pack_sessions")
    .select("id, status, expected_items")
    .eq("id", sessionId)
    .single();
  if (sErr || !session) throw new Error("Session nicht gefunden");

  const expected = (session.expected_items as ExpectedItem[]) ?? [];
  const item = expected[itemIndex];
  if (!item) throw new Error("Item-Index ungültig");

  // Use barcode if available, otherwise pseudo-id `manual:${index}`
  const counterKey = item.barcode || `manual:${itemIndex}`;

  // Vorherige matches zählen (egal ob scan oder manual)
  const { data: prevScans } = await supabase
    .from("pack_scans")
    .select("scanned_barcode, status")
    .eq("session_id", sessionId)
    .eq("status", "match");
  const scannedCounts: Record<string, number> = {};
  for (const s of prevScans ?? []) {
    scannedCounts[s.scanned_barcode] = (scannedCounts[s.scanned_barcode] ?? 0) + 1;
  }

  const alreadyConfirmed = scannedCounts[counterKey] ?? 0;
  const remaining = item.quantity - alreadyConfirmed;
  let status: "match" | "overflow";

  const variantNumeric = item.variantId
    ? parseInt(item.variantId.split("/").pop() ?? "", 10)
    : null;

  if (remaining <= 0) {
    // schon vollständig — eine overflow-row loggen
    status = "overflow";
    await supabase.from("pack_scans").insert({
      session_id: sessionId,
      scanned_barcode: counterKey,
      matched_variant_id: variantNumeric && Number.isFinite(variantNumeric) ? variantNumeric : null,
      matched_title: item.title,
      status,
      scan_method: "manual",
      scanned_by: profile.id,
    });
  } else {
    // alle verbleibenden Mengen auf einmal als manuell bestätigt eintragen
    status = "match";
    const rows = Array.from({ length: remaining }, () => ({
      session_id: sessionId,
      scanned_barcode: counterKey,
      matched_variant_id: variantNumeric && Number.isFinite(variantNumeric) ? variantNumeric : null,
      matched_title: item.title,
      status: "match" as const,
      scan_method: "manual" as const,
      scanned_by: profile.id,
    }));
    await supabase.from("pack_scans").insert(rows);
    scannedCounts[counterKey] = item.quantity;
  }

  if (session.status === "open") {
    await supabase
      .from("pack_sessions")
      .update({
        status: "in_progress",
        started_at: new Date().toISOString(),
        packed_by: profile.id,
      })
      .eq("id", sessionId);
  }

  const isComplete = expected.every((e, idx) => {
    const key = e.barcode || `manual:${idx}`;
    return (scannedCounts[key] ?? 0) >= e.quantity;
  });

  return { status, matchedTitle: item.title, scannedCounts, isComplete };
}

/**
 * Markiert die Session als verifiziert (alle Scans + Fotos OK).
 * Triggert Auto-Fulfill in Shopify (Variante A: sofort nach Pack-Verify).
 */
export async function completePackSession(sessionId: string): Promise<{
  success: boolean;
  error?: string;
}> {
  const profile = await requireProfile();
  if (!hasFeature(profile, "shipping")) {
    throw new Error("Forbidden");
  }

  const supabase = await createClient();

  // Session laden
  const { data: session, error: sErr } = await supabase
    .from("pack_sessions")
    .select("id, status, expected_items, order_name, shopify_order_id")
    .eq("id", sessionId)
    .single();

  if (sErr || !session) return { success: false, error: "Session nicht gefunden" };

  // Foto-Check: alle 3 müssen vorhanden sein
  const { data: photos } = await supabase
    .from("pack_photos")
    .select("photo_type")
    .eq("session_id", sessionId);

  const photoTypes = new Set((photos ?? []).map((p) => p.photo_type));
  const requiredPhotos = ["products_invoice", "products_in_box", "package_on_scale"];
  const missingPhotos = requiredPhotos.filter((t) => !photoTypes.has(t));
  if (missingPhotos.length > 0) {
    return {
      success: false,
      error: `Fehlende Fotos: ${missingPhotos.join(", ")}`,
    };
  }

  // Scan-Check: alle erwarteten Items vollständig (barcode + manual confirms)
  const expected = (session.expected_items as ExpectedItem[]) ?? [];
  const { data: matchScans } = await supabase
    .from("pack_scans")
    .select("scanned_barcode")
    .eq("session_id", sessionId)
    .eq("status", "match");
  const counts: Record<string, number> = {};
  for (const s of matchScans ?? []) {
    counts[s.scanned_barcode] = (counts[s.scanned_barcode] ?? 0) + 1;
  }
  const incomplete = expected.filter((e, idx) => {
    const key = e.barcode || `manual:${idx}`;
    return (counts[key] ?? 0) < e.quantity;
  });
  if (incomplete.length > 0) {
    return {
      success: false,
      error: `Nicht alle Items bestätigt: ${incomplete.map((e) => e.title).join(", ")}`,
    };
  }

  // Status auf "verified" setzen + finished_at
  await supabase
    .from("pack_sessions")
    .update({
      status: "verified",
      finished_at: new Date().toISOString(),
    })
    .eq("id", sessionId);

  // Auto-Fulfill in Shopify (Variante A)
  // Wir brauchen die fulfillmentOrder-IDs aus dem Live-Order
  const order = await fetchOrderForPack(session.order_name);
  if (!order) {
    return { success: false, error: "Order konnte nicht erneut geladen werden" };
  }
  const openFulfillmentOrders = order.fulfillmentOrders.filter(
    (fo) => fo.status === "OPEN" || fo.status === "IN_PROGRESS",
  );
  if (openFulfillmentOrders.length === 0) {
    // Vermutlich schon fulfilled in Shopify — als shipped markieren
    await supabase
      .from("pack_sessions")
      .update({ status: "shipped", fulfilled_at: new Date().toISOString() })
      .eq("id", sessionId);
    revalidatePath("/pack");
    return { success: true };
  }

  const result = await fulfillOrderInShopify(
    openFulfillmentOrders.map((fo) => fo.id),
    true,
  );

  if (!result.success) {
    return {
      success: false,
      error: `Shopify-Fulfill fehlgeschlagen: ${result.errors?.join(", ")}`,
    };
  }

  await supabase
    .from("pack_sessions")
    .update({ status: "shipped", fulfilled_at: new Date().toISOString() })
    .eq("id", sessionId);

  revalidatePath("/pack");
  revalidatePath(`/pack/${session.order_name.replace(/^#/, "")}`);
  return { success: true };
}

/**
 * Setzt alle Match-Scans einer Item-Position auf 'reset' zurück (Counter -> 0).
 * Audit-Log bleibt erhalten (status='reset' statt löschen).
 */
export async function resetItemConfirms(
  sessionId: string,
  itemIndex: number,
): Promise<{
  success: boolean;
  error?: string;
  scannedCounts: Record<string, number>;
}> {
  const profile = await requireProfile();
  if (!hasFeature(profile, "shipping")) {
    return { success: false, error: "Forbidden", scannedCounts: {} };
  }
  const supabase = await createClient();
  const { data: session } = await supabase
    .from("pack_sessions")
    .select("expected_items")
    .eq("id", sessionId)
    .single();
  if (!session) return { success: false, error: "Session nicht gefunden", scannedCounts: {} };

  const expected = (session.expected_items as ExpectedItem[]) ?? [];
  const item = expected[itemIndex];
  if (!item) return { success: false, error: "Item nicht gefunden", scannedCounts: {} };

  const counterKey = item.barcode || `manual:${itemIndex}`;

  await supabase
    .from("pack_scans")
    .update({ status: "reset" })
    .eq("session_id", sessionId)
    .eq("scanned_barcode", counterKey)
    .eq("status", "match");

  // Counter neu berechnen
  const { data: matches } = await supabase
    .from("pack_scans")
    .select("scanned_barcode")
    .eq("session_id", sessionId)
    .eq("status", "match");
  const counts: Record<string, number> = {};
  for (const s of matches ?? []) {
    counts[s.scanned_barcode] = (counts[s.scanned_barcode] ?? 0) + 1;
  }
  return { success: true, scannedCounts: counts };
}

/**
 * Lädt die letzten N Scans einer Session (für Live-Statistik im Pack-Modus).
 */
export async function fetchSessionScans(
  sessionId: string,
  limit = 30,
): Promise<
  {
    id: string;
    scannedBarcode: string;
    matchedTitle: string | null;
    status: string;
    scanMethod: string;
    scannedAt: string;
    scannedByName: string | null;
  }[]
> {
  const profile = await requireProfile();
  if (!hasFeature(profile, "shipping")) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("pack_scans")
    .select("id, scanned_barcode, matched_title, status, scan_method, scanned_at, profiles:scanned_by(display_name, username)")
    .eq("session_id", sessionId)
    .order("scanned_at", { ascending: false })
    .limit(limit);
  return (data ?? []).map((s) => {
    const p = (s as { profiles?: { display_name?: string | null; username?: string | null } | null }).profiles;
    return {
      id: s.id,
      scannedBarcode: s.scanned_barcode,
      matchedTitle: s.matched_title,
      status: s.status,
      scanMethod: s.scan_method,
      scannedAt: s.scanned_at,
      scannedByName: p?.display_name || p?.username || null,
    };
  });
}

/**
 * Pack-Statistik-Reset (NUR ADMIN). Zwei Modi:
 * - "completed" (Default, sicher): nur verified + shipped Sessions löschen
 * - "all" (destruktiv): zusätzlich auch open + in_progress (laufende Pack-Vorgänge)
 *
 * Storage-Files der gelöschten Sessions werden mit entfernt.
 * NICHT umkehrbar. Shopify-Bestellungen bleiben unangetastet.
 */
export async function resetPackStats(
  confirm: string,
  scope: "completed" | "all" = "completed",
): Promise<{ success: boolean; error?: string; sessionsDeleted?: number; photosDeleted?: number }> {
  const profile = await requireProfile();
  if (profile.role !== "admin") {
    return { success: false, error: "Nur Administratoren dürfen die Statistik zurücksetzen." };
  }
  if (confirm !== "LÖSCHEN") {
    return { success: false, error: "Bestätigung fehlt." };
  }

  const supabase = await createClient();

  // 1. IDs der zu löschenden Sessions ermitteln
  let sessionsQuery = supabase.from("pack_sessions").select("id");
  if (scope === "completed") {
    sessionsQuery = sessionsQuery.in("status", ["verified", "shipped"]);
  }
  const { data: sessionRows } = await sessionsQuery;
  const sessionIds = (sessionRows ?? []).map((s) => s.id);

  if (sessionIds.length === 0) {
    return { success: true, sessionsDeleted: 0, photosDeleted: 0 };
  }

  // 2. Storage-Pfade nur der zu löschenden Sessions sammeln
  const { data: photos } = await supabase
    .from("pack_photos")
    .select("storage_path")
    .in("session_id", sessionIds);
  const photoPaths = (photos ?? []).map((p) => p.storage_path);
  if (photoPaths.length > 0) {
    await supabase.storage.from("pack-photos").remove(photoPaths);
  }

  // 3. Sessions löschen (cascade entfernt scans + photos)
  const { error, count } = await supabase
    .from("pack_sessions")
    .delete({ count: "exact" })
    .in("id", sessionIds);

  if (error) return { success: false, error: error.message };

  revalidatePath("/pack");
  revalidatePath("/pack/archive");
  revalidatePath("/pack/stats");
  return {
    success: true,
    sessionsDeleted: count ?? 0,
    photosDeleted: photoPaths.length,
  };
}

/**
 * Pack-Vorgang abbrechen — alle Scans auf "reset", Fotos löschen, Session zurück auf "open".
 * User kann die Bestellung danach erneut von vorn packen.
 * Audit-Log der Scans bleibt mit status='reset' erhalten.
 */
export async function cancelPackSession(
  sessionId: string,
): Promise<{ success: boolean; error?: string }> {
  const profile = await requireProfile();
  if (!hasFeature(profile, "shipping")) {
    return { success: false, error: "Forbidden" };
  }
  const supabase = await createClient();

  // 1. Alle erfolgreichen Scans auf "reset" setzen
  await supabase
    .from("pack_scans")
    .update({ status: "reset" })
    .eq("session_id", sessionId)
    .eq("status", "match");

  // 2. Fotos: aus Storage entfernen + DB-Einträge löschen
  const { data: photos } = await supabase
    .from("pack_photos")
    .select("storage_path")
    .eq("session_id", sessionId);
  if (photos && photos.length > 0) {
    const paths = photos.map((p) => p.storage_path);
    await supabase.storage.from("pack-photos").remove(paths);
    await supabase.from("pack_photos").delete().eq("session_id", sessionId);
  }

  // 3. Session-Status zurück auf "open"
  await supabase
    .from("pack_sessions")
    .update({
      status: "open",
      started_at: null,
      finished_at: null,
    })
    .eq("id", sessionId);

  revalidatePath("/pack");
  revalidatePath(`/pack/${sessionId}`);
  return { success: true };
}

/**
 * Notizen einer Pack-Session speichern (z.B. "Karton beschädigt", Reklamations-Hinweis).
 */
export async function savePackSessionNotes(
  sessionId: string,
  notes: string,
): Promise<{ success: boolean; error?: string }> {
  const profile = await requireProfile();
  if (!hasFeature(profile, "shipping")) {
    return { success: false, error: "Forbidden" };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("pack_sessions")
    .update({ notes: notes.trim() || null })
    .eq("id", sessionId);
  if (error) return { success: false, error: error.message };
  revalidatePath(`/pack/archive`);
  return { success: true };
}

/**
 * Speichert ein Pack-Foto. Erwartet das File als FormData.
 */
export async function uploadPackPhoto(
  sessionId: string,
  photoType: "products_invoice" | "products_in_box" | "package_on_scale",
  formData: FormData,
): Promise<{ success: boolean; error?: string; storagePath?: string }> {
  const profile = await requireProfile();
  if (!hasFeature(profile, "shipping")) {
    throw new Error("Forbidden");
  }

  const file = formData.get("photo") as File | null;
  if (!file) return { success: false, error: "Keine Datei" };

  const supabase = await createClient();
  const ext = file.type === "image/png" ? "png" : file.type === "image/webp" ? "webp" : "jpg";
  const path = `${sessionId}/${photoType}-${Date.now()}.${ext}`;

  const { error: upErr } = await supabase.storage
    .from("pack-photos")
    .upload(path, file, { contentType: file.type, upsert: false });

  if (upErr) return { success: false, error: upErr.message };

  // Mehrere Fotos pro Typ erlaubt — einfach neu einfügen, alte bleiben.
  const { error: insErr } = await supabase.from("pack_photos").insert({
    session_id: sessionId,
    photo_type: photoType,
    storage_path: path,
    taken_by: profile.id,
  });

  if (insErr) return { success: false, error: insErr.message };

  return { success: true, storagePath: path };
}

/**
 * Löscht ein einzelnes Pack-Foto (für "Foto entfernen"-Button bei mehreren Fotos pro Typ).
 */
export async function deletePackPhoto(
  photoId: string,
): Promise<{ success: boolean; error?: string }> {
  const profile = await requireProfile();
  if (!hasFeature(profile, "shipping")) return { success: false, error: "Forbidden" };
  const supabase = await createClient();
  const { data: photo } = await supabase
    .from("pack_photos")
    .select("storage_path")
    .eq("id", photoId)
    .single();
  if (photo?.storage_path) {
    await supabase.storage.from("pack-photos").remove([photo.storage_path]);
  }
  const { error } = await supabase.from("pack_photos").delete().eq("id", photoId);
  if (error) return { success: false, error: error.message };
  return { success: true };
}
