// Shopify-Umsatz je Kalendermonat (Europe/Berlin) — server-only.
import { shopifyGraphQL } from "@/lib/shopify";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/server";
import type { ShopifyUmsatzMonat } from "@/lib/types";

const KANAL: Record<string, string> = { web: "Online-Shop", pos: "Kasse (POS)", shopify_draft_order: "Entwurf/Rechnung" };

/** UTC-Offset von Europe/Berlin an einem Datum, z.B. "+02:00". */
function berlinOffset(iso: string): string {
  const part = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Berlin", timeZoneName: "shortOffset" })
    .formatToParts(new Date(`${iso}T12:00:00Z`))
    .find((p) => p.type === "timeZoneName")?.value ?? "GMT+1";
  const m = part.match(/GMT([+-])(\d{1,2})/);
  return m ? `${m[1]}${m[2].padStart(2, "0")}:00` : "+01:00";
}

function naechsterMonat(monat: string): string {
  const [y, m] = monat.split("-").map(Number);
  return m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
}

/**
 * Summiert alle Bestellungen, die im Monat (deutsche Zeit) angelegt wurden — ohne Stornos und
 * Testbestellungen. Erstattungen werden dem Monat der Bestellung zugerechnet (Shopify-Feld
 * totalRefundedSet), nicht dem Erstattungsdatum.
 */
export async function holeShopifyUmsatzMonat(monat: string, deadlineMs?: number): Promise<ShopifyUmsatzMonat | null> {
  const von = `${monat}-01`;
  const bis = `${naechsterMonat(monat)}-01`;
  const q = `created_at:>='${von}T00:00:00${berlinOffset(von)}' created_at:<'${bis}T00:00:00${berlinOffset(bis)}'`;
  const query = `query($q: String!, $after: String) {
    orders(first: 250, after: $after, query: $q, sortKey: CREATED_AT) {
      pageInfo { hasNextPage endCursor }
      edges { node { cancelledAt test sourceName totalPriceSet { shopMoney { amount } } totalRefundedSet { shopMoney { amount } } } }
    }
  }`;
  type Res = {
    orders: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      edges: Array<{ node: { cancelledAt: string | null; test: boolean; sourceName: string | null; totalPriceSet: { shopMoney: { amount: string } }; totalRefundedSet: { shopMoney: { amount: string } } } }>;
    };
  };
  let brutto = 0, erstattet = 0, bestellungen = 0;
  const kanaele: Record<string, number> = {};
  let after: string | null = null;
  for (let page = 0; page < 200; page++) {
    // Unvollständige Monate nie speichern — lieber beim nächsten Lauf erneut
    if (deadlineMs && Date.now() > deadlineMs) return null;
    const res: { data?: Res } = await shopifyGraphQL<Res>(query, { q, after });
    const orders: Res["orders"] | undefined = res.data?.orders;
    if (!orders) throw new Error("Shopify: keine Bestelldaten");
    for (const { node } of orders.edges) {
      if (node.cancelledAt || node.test) continue;
      const b = Number(node.totalPriceSet.shopMoney.amount) || 0;
      brutto += b;
      erstattet += Number(node.totalRefundedSet.shopMoney.amount) || 0;
      bestellungen++;
      const k = KANAL[node.sourceName ?? ""] ?? "Sonstige";
      kanaele[k] = Math.round(((kanaele[k] ?? 0) + b) * 100) / 100;
    }
    if (!orders.pageInfo.hasNextPage) break;
    after = orders.pageInfo.endCursor;
  }
  const r2 = (n: number) => Math.round(n * 100) / 100;
  return { monat, brutto: r2(brutto), erstattet: r2(erstattet), netto: r2(brutto - erstattet), bestellungen, kanaele, stand: new Date().toISOString() };
}

/**
 * Holt + speichert die Monate (in Reihenfolge) bis zur Deadline; Rückgabe = erledigte Monate.
 * Schreibt auch shopify_monthly_revenue (Nenner der Retourenquote) — ein Abruf, beide Tabellen.
 */
export async function syncShopifyUmsatz(
  monate: string[],
  deadlineMs: number,
  sb: SupabaseClient = createServiceClient(),
): Promise<{ erledigt: string[]; offen: string[] }> {
  const erledigt: string[] = [];
  for (const monat of monate) {
    if (Date.now() > deadlineMs) break;
    const row = await holeShopifyUmsatzMonat(monat, deadlineMs);
    if (!row) break;
    const { error } = await sb.from("shopify_umsatz_monat").upsert(row, { onConflict: "monat" });
    if (error) throw new Error(error.message);
    const { error: e2 } = await sb.from("shopify_monthly_revenue").upsert(
      { month: `${monat}-01`, gross_revenue: row.brutto, order_count: row.bestellungen, synced_at: row.stand },
      { onConflict: "month" },
    );
    if (e2) throw new Error(e2.message);
    erledigt.push(monat);
  }
  return { erledigt, offen: monate.filter((m) => !erledigt.includes(m)) };
}

/** Aktueller + Vormonat (deutsche Zeit) — die ändern sich noch (neue Bestellungen, Erstattungen). */
export function laufendeMonate(): string[] {
  const heute = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date()).slice(0, 7);
  const [y, m] = heute.split("-").map(Number);
  const vor = m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
  return [heute, vor];
}
