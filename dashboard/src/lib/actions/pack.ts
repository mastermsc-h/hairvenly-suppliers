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
  quantity: number;
  imageUrl: string | null;
}

function toExpected(items: PackOrderLineItem[]): ExpectedItem[] {
  return items.map((li) => ({
    variantId: li.variantId,
    barcode: li.barcode,
    title: li.title,
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
    .select("id, status, expected_items, shopify_order_id")
    .eq("order_name", cleanName)
    .maybeSingle();

  if (existing) {
    return {
      sessionId: existing.id,
      status: existing.status,
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
      status: "open",
      expected_items: expected,
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

  // Scan-Check: alle erwarteten Items vollständig
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
  const incomplete = expected.filter(
    (e) => (counts[e.barcode ?? ""] ?? 0) < e.quantity,
  );
  if (incomplete.length > 0) {
    return {
      success: false,
      error: `Nicht alle Items gescannt: ${incomplete.map((e) => e.title).join(", ")}`,
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

  // Vorherige Foto-Records dieses Typs für die Session löschen (Re-Upload)
  await supabase
    .from("pack_photos")
    .delete()
    .eq("session_id", sessionId)
    .eq("photo_type", photoType);

  const { error: insErr } = await supabase.from("pack_photos").insert({
    session_id: sessionId,
    photo_type: photoType,
    storage_path: path,
    taken_by: profile.id,
  });

  if (insErr) return { success: false, error: insErr.message };

  return { success: true, storagePath: path };
}
