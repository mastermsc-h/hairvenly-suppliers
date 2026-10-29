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

type Geld = { shopMoney: { amount: string } };
const betrag = (g: Geld | null | undefined) => Number(g?.shopMoney.amount) || 0;

/** Alle Seiten einer Bestell-Suche durchgehen; false = Deadline gerissen (Monat dann nicht speichern). */
async function jedeBestellung<N>(
  felder: string,
  q: string,
  deadlineMs: number | undefined,
  fn: (node: N) => void,
): Promise<boolean> {
  const query = `query($q: String!, $after: String) {
    orders(first: 250, after: $after, query: $q) {
      pageInfo { hasNextPage endCursor }
      edges { node { ${felder} } }
    }
  }`;
  type Res = { orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; edges: Array<{ node: N }> } };
  let after: string | null = null;
  for (let page = 0; page < 400; page++) {
    if (deadlineMs && Date.now() > deadlineMs) return false;
    const res: { data?: Res } = await shopifyGraphQL<Res>(query, { q, after });
    const orders: Res["orders"] | undefined = res.data?.orders;
    if (!orders) throw new Error("Shopify: keine Bestelldaten");
    for (const { node } of orders.edges) fn(node);
    if (!orders.pageInfo.hasNextPage) return true;
    after = orders.pageInfo.endCursor;
  }
  return true;
}

/**
 * Umsatz eines Monats (deutsche Zeit) wie in Shopify-Analytics:
 * - brutto: Bestellsummen (inkl. USt + Versand, nach Rabatten) der im Monat angelegten Bestellungen,
 *   ohne Tests. Stornierte Bestellungen zählen nur mit dem Betrag, der tatsächlich erstattet wurde —
 *   dieser Betrag taucht als Erstattung wieder auf und gleicht sich aus; unbezahlt stornierte
 *   Bestellungen zählen gar nicht.
 * - erstattet: alle Erstattungen, die im Monat gebucht wurden — auch auf ältere Bestellungen.
 *   Wie Shopify-Analytics und wie die USt (§ 17 UStG: Berichtigung im Monat der Erstattung).
 *   Vergangene Monate bleiben dadurch stabil.
 */
export async function holeShopifyUmsatzMonat(monat: string, deadlineMs?: number): Promise<ShopifyUmsatzMonat | null> {
  const von = `${monat}-01T00:00:00${berlinOffset(`${monat}-01`)}`;
  const bisTag = `${naechsterMonat(monat)}-01`;
  const bis = `${bisTag}T00:00:00${berlinOffset(bisTag)}`;
  const vonMs = Date.parse(von), bisMs = Date.parse(bis);

  let brutto = 0, erstattet = 0, bestellungen = 0;
  const kanaele: Record<string, number> = {};
  type Bestellung = { cancelledAt: string | null; test: boolean; sourceName: string | null; totalPriceSet: Geld; totalRefundedSet: Geld };
  const ok1 = await jedeBestellung<Bestellung>(
    "cancelledAt test sourceName totalPriceSet { shopMoney { amount } } totalRefundedSet { shopMoney { amount } }",
    `created_at:>='${von}' created_at:<'${bis}'`,
    deadlineMs,
    (n) => {
      if (n.test) return;
      const b = n.cancelledAt ? betrag(n.totalRefundedSet) : betrag(n.totalPriceSet);
      if (!n.cancelledAt) bestellungen++;
      if (b === 0) return;
      brutto += b;
      const k = KANAL[n.sourceName ?? ""] ?? "Sonstige";
      kanaele[k] = Math.round(((kanaele[k] ?? 0) + b) * 100) / 100;
    },
  );
  if (!ok1) return null;

  // Erstattungen nach Buchungsdatum: jede Erstattung im Monat ändert die Bestellung → updated_at >= von
  type MitErstattung = { test: boolean; refunds: Array<{ createdAt: string; totalRefundedSet: Geld }> };
  const ok2 = await jedeBestellung<MitErstattung>(
    "test refunds { createdAt totalRefundedSet { shopMoney { amount } } }",
    `updated_at:>='${von}' (financial_status:refunded OR financial_status:partially_refunded)`,
    deadlineMs,
    (n) => {
      if (n.test) return;
      for (const r of n.refunds) {
        const t = Date.parse(r.createdAt);
        if (t >= vonMs && t < bisMs) erstattet += betrag(r.totalRefundedSet);
      }
    },
  );
  if (!ok2) return null;

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
