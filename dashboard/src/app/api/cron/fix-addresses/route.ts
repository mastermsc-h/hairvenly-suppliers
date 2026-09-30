import { NextResponse } from "next/server";
import { shopifyGraphQL } from "@/lib/shopify";
import { normalizeGermanStreet } from "@/lib/address-normalize";

/**
 * Cron: normalisiert Versandadressen offener Shopify-Bestellungen.
 *
 * Kunden tippen oft "Schwebelstr.22" (ohne Leerzeichen vor der Hausnummer) —
 * die DHL-App meldet dann "Adresse nicht leitcodierbar / Hausnummer fehlt"
 * und blockiert die Label-Erstellung. Dieser Job fügt das Leerzeichen
 * automatisch ein, bevor jemand packt.
 *
 * Läuft täglich (Vercel Cron) + kann manuell aufgerufen werden.
 * Scope: unfulfilled Bestellungen der letzten 14 Tage, nur DE-Adressen.
 */
export const dynamic = "force-dynamic";

interface OrderNode {
  id: string;
  name: string;
  shippingAddress: {
    firstName: string | null;
    lastName: string | null;
    company: string | null;
    address1: string | null;
    address2: string | null;
    city: string | null;
    zip: string | null;
    provinceCode: string | null;
    countryCode: string | null;
    phone: string | null;
  } | null;
}

export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization") ?? "";
  const expected = process.env.CRON_SECRET;
  if (expected && authHeader !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const since = new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10);

  const res = await shopifyGraphQL<{
    orders: { edges: { node: OrderNode }[] };
  }>(
    `query($q: String!) {
      orders(first: 100, query: $q) {
        edges { node {
          id name
          shippingAddress {
            firstName lastName company address1 address2 city zip provinceCode countryCode phone
          }
        } }
      }
    }`,
    { q: `fulfillment_status:unfulfilled created_at:>=${since}` },
  );

  const orders = res.data?.orders.edges.map((e) => e.node) ?? [];
  const fixed: { name: string; from: string; to: string }[] = [];
  const failed: { name: string; error: string }[] = [];

  for (const o of orders) {
    const a = o.shippingAddress;
    if (!a?.address1) continue;
    // Nur DE — Leitcodierung ist ein DHL-Deutschland-Thema; bei anderen
    // Ländern lassen wir Adress-Formate bewusst unangetastet.
    if (a.countryCode !== "DE") continue;

    const corrected = normalizeGermanStreet(a.address1);
    if (!corrected) continue;

    const upd = await shopifyGraphQL<{
      orderUpdate: {
        order: { id: string } | null;
        userErrors: { field: string[]; message: string }[];
      };
    }>(
      `mutation($input: OrderInput!) {
        orderUpdate(input: $input) {
          order { id }
          userErrors { field message }
        }
      }`,
      {
        input: {
          id: o.id,
          shippingAddress: {
            firstName: a.firstName,
            lastName: a.lastName,
            company: a.company,
            address1: corrected,
            address2: a.address2,
            city: a.city,
            zip: a.zip,
            provinceCode: a.provinceCode,
            countryCode: a.countryCode,
            phone: a.phone,
          },
        },
      },
    );

    const errs = upd.data?.orderUpdate?.userErrors ?? [];
    if (errs.length > 0 || !upd.data?.orderUpdate?.order) {
      failed.push({ name: o.name, error: errs.map((e) => e.message).join("; ") || "kein order zurück" });
    } else {
      fixed.push({ name: o.name, from: a.address1, to: corrected });
      console.log(`[fix-addresses] ${o.name}: "${a.address1}" → "${corrected}"`);
    }
  }

  return NextResponse.json({
    ok: failed.length === 0,
    scanned: orders.length,
    fixed,
    failed,
  });
}
