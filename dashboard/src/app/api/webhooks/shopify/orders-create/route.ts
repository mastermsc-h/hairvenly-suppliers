import { NextResponse } from "next/server";
import crypto from "crypto";
import { shopifyGraphQL } from "@/lib/shopify";
import { normalizeGermanStreet } from "@/lib/address-normalize";

/**
 * Shopify-Webhook orders/create + orders/updated — On-the-fly Adress-Fix.
 *
 * BEIDE Topics zeigen auf diesen Endpoint:
 * - orders/create: normale Bestellungen sofort bei Eingang
 * - orders/updated: deckt den Draft-Order-Fall ab (dort ist die Adresse beim
 *   create-Event noch nicht an der Order — sie kommt erst mit dem Draft-Merge,
 *   der ein updated-Event feuert; Bug #27414, 30.09.2026) UND nachträgliche
 *   Adressänderungen durch Kunde/Support.
 * Idempotent: saubere Adresse → "clean" ohne Mutation; unser eigenes
 * orderUpdate triggert zwar ein weiteres updated-Event, das endet aber
 * sofort in "clean" — keine Schleife.
 *
 * Sicherheits-Design:
 * - HMAC-Verifikation gegen SHOPIFY_WEBHOOK_SECRET (Pflicht).
 * - Aus dem Payload wird NUR die numerische Order-ID gelesen; alle Daten
 *   werden frisch über die Admin-API geladen (kein Payload-Trust).
 * - Der tägliche Cron /api/cron/fix-addresses bleibt als Fallback-Netz,
 *   falls ein Webhook-Event verloren geht.
 */
export const dynamic = "force-dynamic";

/**
 * Shopify nutzt je nach Registrierungsweg unterschiedliche Signier-Secrets:
 * - Admin-UI-Webhooks (Einstellungen → Benachrichtigungen): das dort
 *   angezeigte Signing-Secret → bei uns SHOPIFY_WEBHOOK_SECRET
 * - Per-API registrierte Webhooks (unsere orders/create-Subscription):
 *   der "API secret key" der Custom App → bei uns SHOPIFY_API_SECRET
 * Wir prüfen gegen ALLE konfigurierten Secrets — ein Treffer genügt.
 */
function verifyHmac(rawBody: string, hmacHeader: string | null): boolean {
  if (!hmacHeader) return false;
  const secrets = [process.env.SHOPIFY_API_SECRET, process.env.SHOPIFY_WEBHOOK_SECRET].filter(
    (s): s is string => !!s,
  );
  for (const secret of secrets) {
    const digest = crypto.createHmac("sha256", secret).update(rawBody, "utf8").digest("base64");
    try {
      if (crypto.timingSafeEqual(Buffer.from(digest), Buffer.from(hmacHeader))) return true;
    } catch {
      // Längen-Mismatch etc. — nächstes Secret probieren
    }
  }
  return false;
}

export async function POST(request: Request) {
  const rawBody = await request.text();
  const hmac = request.headers.get("x-shopify-hmac-sha256");

  if (!verifyHmac(rawBody, hmac)) {
    // Diagnose-Log ohne Secret-Leak: hilft zu erkennen ob Shopify mit einem
    // anderen Secret signiert (App-Secret vs. Admin-UI-Notification-Secret).
    console.warn("[orders-create] HMAC-Verifikation fehlgeschlagen — Secret prüfen (SHOPIFY_WEBHOOK_SECRET)");
    return NextResponse.json({ error: "invalid hmac" }, { status: 401 });
  }

  let orderId: number | null = null;
  try {
    const payload = JSON.parse(rawBody) as { id?: number };
    orderId = typeof payload.id === "number" ? payload.id : null;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  if (!orderId) return NextResponse.json({ error: "no order id" }, { status: 400 });

  // Order frisch laden (kein Payload-Trust) — kurze Verzögerung ist ok,
  // Shopify erwartet nur ein zeitnahes 200.
  const gid = `gid://shopify/Order/${orderId}`;
  const res = await shopifyGraphQL<{
    order: {
      id: string;
      name: string;
      shippingAddress: {
        firstName: string | null; lastName: string | null; company: string | null;
        address1: string | null; address2: string | null; city: string | null;
        zip: string | null; provinceCode: string | null; countryCode: string | null;
        phone: string | null;
      } | null;
    } | null;
  }>(
    `query($id: ID!) {
      order(id: $id) {
        id name
        shippingAddress { firstName lastName company address1 address2 city zip provinceCode countryCode phone }
      }
    }`,
    { id: gid },
  );

  const order = res.data?.order;
  const a = order?.shippingAddress;
  if (!order || !a?.address1 || a.countryCode !== "DE") {
    return NextResponse.json({ ok: true, action: "skip" });
  }

  const corrected = normalizeGermanStreet(a.address1);
  if (!corrected) {
    return NextResponse.json({ ok: true, action: "clean" });
  }

  const upd = await shopifyGraphQL<{
    orderUpdate: { order: { id: string } | null; userErrors: { message: string }[] };
  }>(
    `mutation($input: OrderInput!) {
      orderUpdate(input: $input) { order { id } userErrors { message } }
    }`,
    {
      input: {
        id: order.id,
        shippingAddress: {
          firstName: a.firstName, lastName: a.lastName, company: a.company,
          address1: corrected, address2: a.address2, city: a.city, zip: a.zip,
          provinceCode: a.provinceCode, countryCode: a.countryCode, phone: a.phone,
        },
      },
    },
  );

  const errs = upd.data?.orderUpdate?.userErrors ?? [];
  if (errs.length > 0) {
    console.error(`[orders-create] ${order.name}: Update fehlgeschlagen: ${errs.map((e) => e.message).join("; ")}`);
    return NextResponse.json({ ok: false, error: errs.map((e) => e.message).join("; ") });
  }

  console.log(`[orders-create] ${order.name}: Adresse korrigiert "${a.address1}" → "${corrected}"`);
  return NextResponse.json({ ok: true, action: "fixed", from: a.address1, to: corrected });
}
