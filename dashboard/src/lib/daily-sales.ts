/**
 * Tagesverkäufe pro Shopify-Variante → Tabelle shopify_variant_daily_sales.
 * Ab `sinceIso` (Berliner Kalendertag) werden die Tage komplett neu
 * geschrieben, damit nachträgliche Bestellbearbeitungen/Stornos greifen.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { shopifyGraphQL } from "./shopify";

const ORDERS_QUERY = `
  query($after: String, $q: String) {
    orders(first: 100, after: $after, query: $q, sortKey: CREATED_AT) {
      pageInfo { hasNextPage endCursor }
      nodes {
        createdAt cancelledAt test
        lineItems(first: 80) { nodes { currentQuantity variant { id title } product { id handle } } }
      }
    }
  }`;

type OrdersPage = {
  orders: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: {
      createdAt: string;
      cancelledAt: string | null;
      test: boolean;
      lineItems: {
        nodes: {
          currentQuantity: number;
          variant: { id: string; title: string } | null;
          product: { id: string; handle: string } | null;
        }[];
      };
    }[];
  };
};

const berlinDay = (iso: string) =>
  new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date(iso));

export async function syncVariantDailySales(
  supabase: SupabaseClient,
  sinceIso: string,
  deadlineMs?: number,
): Promise<{ orders: number; rows: number; complete: boolean }> {
  const totals = new Map<string, { day: string; variant_id: string; product_id: string | null; handle: string | null; variant_title: string | null; units: number }>();
  // Puffer von einem Tag nach vorn: Berliner Mitternacht liegt vor UTC-Mitternacht
  const queryFrom = new Date(Date.parse(sinceIso) - 864e5).toISOString().slice(0, 10);
  let after: string | null = null;
  let orders = 0;
  let complete = false;
  for (let page = 0; page < 200; page++) {
    if (deadlineMs && Date.now() > deadlineMs) break;
    const res: { data?: OrdersPage } = await shopifyGraphQL<OrdersPage>(
      ORDERS_QUERY,
      { after, q: `created_at:>=${queryFrom}` },
      { allowPartialErrors: true },
    );
    const d = res.data?.orders;
    if (!d) break;
    for (const o of d.nodes) {
      if (o.cancelledAt || o.test) continue;
      const day = berlinDay(o.createdAt);
      if (day < sinceIso) continue;
      orders++;
      for (const li of o.lineItems.nodes) {
        if (!li.variant?.id || !li.currentQuantity) continue;
        const key = `${day}|${li.variant.id}`;
        const e = totals.get(key);
        if (e) e.units += li.currentQuantity;
        else
          totals.set(key, {
            day,
            variant_id: li.variant.id,
            product_id: li.product?.id ?? null,
            handle: li.product?.handle ?? null,
            variant_title: li.variant.title ?? null,
            units: li.currentQuantity,
          });
      }
    }
    if (!d.pageInfo.hasNextPage) {
      complete = true;
      break;
    }
    after = d.pageInfo.endCursor;
  }
  // Nur bei vollständigem Lauf ersetzen — ein abgebrochener Lauf darf keine Tage leeren
  if (!complete) return { orders, rows: 0, complete };

  const rows = [...totals.values()].map((r) => ({ ...r, updated_at: new Date().toISOString() }));
  const del = await supabase.from("shopify_variant_daily_sales").delete().gte("day", sinceIso);
  if (del.error) throw new Error(`daily-sales delete: ${del.error.message}`);
  for (let i = 0; i < rows.length; i += 500) {
    const ins = await supabase.from("shopify_variant_daily_sales").insert(rows.slice(i, i + 500));
    if (ins.error) throw new Error(`daily-sales insert: ${ins.error.message}`);
  }
  return { orders, rows: rows.length, complete };
}
