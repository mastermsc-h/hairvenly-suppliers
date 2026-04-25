import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { ensureOrderPackQr } from "@/lib/actions/pack";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Shopify Webhook Receiver für Order-Events.
 * Konfiguration in Shopify Admin → Notifications → Webhooks:
 *   Event: "Order paid" oder "Order creation"
 *   Format: JSON
 *   URL:    https://suppliers.hairvenly.de/api/webhooks/shopify/orders
 *
 * Verifiziert HMAC-Signatur via env SHOPIFY_WEBHOOK_SECRET.
 * Bei jeder neuen bezahlten Order: setzt das custom.pack_qr_svg Metafield.
 */

function verifyHmac(rawBody: string, hmacHeader: string | null, secret: string): boolean {
  if (!hmacHeader) return false;
  const computed = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
  try {
    return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(hmacHeader));
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });
  }

  const rawBody = await req.text();
  const hmacHeader = req.headers.get("x-shopify-hmac-sha256");

  if (!verifyHmac(rawBody, hmacHeader, secret)) {
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let payload: { id?: number; name?: string; admin_graphql_api_id?: string; financial_status?: string };
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const orderName = payload.name;
  const orderGid =
    payload.admin_graphql_api_id ?? (payload.id ? `gid://shopify/Order/${payload.id}` : null);

  if (!orderName || !orderGid) {
    return NextResponse.json({ error: "Missing order name or id in payload" }, { status: 400 });
  }

  // Nur für bezahlte Orders generieren
  if (payload.financial_status && payload.financial_status !== "paid") {
    return NextResponse.json({ skipped: true, reason: `financial_status=${payload.financial_status}` });
  }

  const result = await ensureOrderPackQr(orderName, orderGid);
  if (!result.success) {
    // Webhook trotzdem als verarbeitet zurückgeben (sonst würde Shopify retryen) —
    // logge den Fehler stattdessen.
    console.error(`[webhook orders] QR-Generation failed for ${orderName}:`, result.error);
    return NextResponse.json({ ok: false, error: result.error });
  }

  return NextResponse.json({ ok: true, order: orderName });
}
