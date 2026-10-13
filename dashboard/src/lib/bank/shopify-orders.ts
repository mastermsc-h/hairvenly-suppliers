// Shopify-Zugriffe für den Zahlungsabgleich — server-only.
import { shopifyGraphQL, addOrderTags } from "@/lib/shopify";
import type { ClosedOrderInfo, OpenOrder } from "./matcher";

export const BANK_MATCH_TAG = "Bank-Abgleich";

interface OrderNode {
  id: string;
  name: string;
  createdAt: string;
  cancelledAt: string | null;
  displayFinancialStatus: string | null;
  paymentGatewayNames: string[];
  totalOutstandingSet: { shopMoney: { amount: string; currencyCode: string } };
  billingAddress: { name: string | null } | null;
  shippingAddress: { name: string | null } | null;
}

const ORDER_FIELDS = `
  id name createdAt cancelledAt displayFinancialStatus paymentGatewayNames
  totalOutstandingSet { shopMoney { amount currencyCode } }
  billingAddress { name }
  shippingAddress { name }
`;

type OpenOrdersPage = {
  orders: { edges: { node: OrderNode }[]; pageInfo: { hasNextPage: boolean; endCursor: string | null } };
};

const OPEN_STATUSES = new Set(["PENDING", "PARTIALLY_PAID", "AUTHORIZED"]);

function toOpenOrder(n: OrderNode): OpenOrder {
  return {
    gid: n.id,
    name: n.name,
    number: n.name.replace(/^#/, "").replace(/^0+/, ""),
    createdAt: n.createdAt,
    outstanding: Number(n.totalOutstandingSet.shopMoney.amount) || 0,
    customerNames: [n.billingAddress?.name, n.shippingAddress?.name].filter((x): x is string => !!x),
    gateways: n.paymentGatewayNames ?? [],
  };
}

/**
 * Offene (unbezahlte / teilbezahlte) Bestellungen der letzten 120 Tage —
 * egal ob schon versendet. Nur EUR-Bestellungen mit offenem Betrag > 0.
 */
export async function fetchOpenOrdersForMatching(daysBack = 120): Promise<OpenOrder[]> {
  const since = new Date(Date.now() - daysBack * 86400000).toISOString().slice(0, 10);
  const q = `status:open AND (financial_status:pending OR financial_status:partially_paid OR financial_status:authorized) AND created_at:>=${since}`;
  const query = `
    query bankOpenOrders($q: String!, $after: String) {
      orders(first: 250, query: $q, sortKey: CREATED_AT, reverse: true, after: $after) {
        edges { node { ${ORDER_FIELDS} } }
        pageInfo { hasNextPage endCursor }
      }
    }
  `;
  const out: OpenOrder[] = [];
  let after: string | null = null;
  for (let page = 0; page < 4; page++) {
    const res: { data?: OpenOrdersPage } = await shopifyGraphQL<OpenOrdersPage>(query, { q, after });
    const orders: OpenOrdersPage["orders"] | undefined = res.data?.orders;
    if (!orders) break;
    for (const e of orders.edges) {
      const n = e.node;
      if (n.cancelledAt) continue;
      if (!OPEN_STATUSES.has(n.displayFinancialStatus ?? "")) continue;
      if (n.totalOutstandingSet.shopMoney.currencyCode !== "EUR") continue;
      const o = toOpenOrder(n);
      if (o.outstanding > 0) out.push(o);
    }
    if (!orders.pageInfo.hasNextPage) break;
    after = orders.pageInfo.endCursor;
  }
  return out;
}

/** Status von Bestellungen per Nummer (für "bereits bezahlt / storniert"-Hinweise). */
export async function lookupClosedOrders(numbers: string[]): Promise<Record<string, ClosedOrderInfo>> {
  const uniq = [...new Set(numbers)].slice(0, 30);
  if (uniq.length === 0) return {};
  const q = uniq.map((n) => `name:#${n}`).join(" OR ");
  const query = `query bankLookup($q: String!) { orders(first: 50, query: $q) { edges { node { ${ORDER_FIELDS} } } } }`;
  const res = await shopifyGraphQL<{ orders: { edges: { node: OrderNode }[] } }>(query, { q });
  const map: Record<string, ClosedOrderInfo> = {};
  for (const e of res.data?.orders.edges ?? []) {
    const n = e.node;
    const num = n.name.replace(/^#/, "").replace(/^0+/, "");
    if (!uniq.includes(num)) continue;
    const fin = n.displayFinancialStatus ?? "";
    if (n.cancelledAt) map[num] = { name: n.name, state: "cancelled", detail: fin };
    else if (OPEN_STATUSES.has(fin)) continue; // doch offen (z.B. älter als 120 Tage) — kein "closed"
    else if (fin === "PAID") map[num] = { name: n.name, state: "paid", detail: fin };
    else map[num] = { name: n.name, state: "other", detail: fin };
  }
  return map;
}

/** Eine Bestellung per Nummer — für manuelle Zuordnung. */
export async function fetchOrderByNumber(number: string): Promise<(OpenOrder & { financialStatus: string; cancelled: boolean }) | null> {
  const clean = number.trim().replace(/^#/, "");
  if (!/^\d{3,8}$/.test(clean)) return null;
  const query = `query bankByName($q: String!) { orders(first: 5, query: $q) { edges { node { ${ORDER_FIELDS} } } } }`;
  const res = await shopifyGraphQL<{ orders: { edges: { node: OrderNode }[] } }>(query, { q: `name:#${clean}` });
  const n = (res.data?.orders.edges ?? []).map((e) => e.node).find((x) => x.name.replace(/^#/, "") === clean);
  if (!n) return null;
  return { ...toOpenOrder(n), financialStatus: n.displayFinancialStatus ?? "", cancelled: !!n.cancelledAt };
}

async function fetchOrderState(gid: string): Promise<OrderNode | null> {
  const query = `query bankOrder($id: ID!) { order(id: $id) { ${ORDER_FIELDS} } }`;
  const res = await shopifyGraphQL<{ order: OrderNode | null }>(query, { id: gid });
  return res.data?.order ?? null;
}

async function appendBankNote(gid: string, text: string): Promise<void> {
  const fetchQ = `query order($id: ID!) { order(id: $id) { id note } }`;
  const cur = await shopifyGraphQL<{ order: { note: string | null } | null }>(fetchQ, { id: gid });
  const ts = new Date().toLocaleString("de-DE", {
    timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
  });
  const entry = `[Hairvenly Bank-Abgleich, ${ts}]\n${text.trim()}`;
  const note = cur.data?.order?.note ? `${cur.data.order.note}\n\n${entry}` : entry;
  await shopifyGraphQL(
    `mutation orderUpdate($input: OrderInput!) { orderUpdate(input: $input) { order { id } userErrors { field message } } }`,
    { input: { id: gid, note } },
  );
}

export interface MarkPaidResult {
  ok: boolean;
  alreadyPaid?: boolean;
  error?: string;
  name?: string;
  outstanding?: number;
}

/**
 * Markiert eine Bestellung als bezahlt — mit Live-Recheck direkt davor.
 *
 * expectedOutstanding gesetzt (Automatik): offener Betrag muss noch exakt
 * stimmen, sonst Abbruch → Mensch prüft. Ohne (manuell bestätigt): nur
 * "offen & nicht storniert" wird verlangt.
 */
export async function markOrderPaidVerified(
  gid: string,
  opts: { expectedOutstanding?: number; note: string },
): Promise<MarkPaidResult> {
  const cur = await fetchOrderState(gid);
  if (!cur) return { ok: false, error: "Bestellung nicht gefunden" };
  const name = cur.name;
  const outstanding = Number(cur.totalOutstandingSet.shopMoney.amount) || 0;
  if (cur.cancelledAt) return { ok: false, name, outstanding, error: `${name} ist storniert` };
  const fin = cur.displayFinancialStatus ?? "";
  if (fin === "PAID") return { ok: false, alreadyPaid: true, name, outstanding, error: `${name} ist bereits bezahlt` };
  if (!OPEN_STATUSES.has(fin)) return { ok: false, name, outstanding, error: `${name}: Zahlungsstatus ${fin}` };
  if (opts.expectedOutstanding !== undefined && Math.round(outstanding * 100) !== Math.round(opts.expectedOutstanding * 100)) {
    return { ok: false, name, outstanding, error: `${name}: offener Betrag hat sich geändert (jetzt ${outstanding.toFixed(2)} €)` };
  }

  const res = await shopifyGraphQL<{
    orderMarkAsPaid: { order: { id: string; displayFinancialStatus: string } | null; userErrors: { message: string }[] };
  }>(
    `mutation markPaid($input: OrderMarkAsPaidInput!) {
       orderMarkAsPaid(input: $input) { order { id displayFinancialStatus } userErrors { field message } }
     }`,
    { input: { id: gid } },
  );
  const errs = res.data?.orderMarkAsPaid.userErrors ?? [];
  if (errs.length > 0) return { ok: false, name, outstanding, error: errs.map((e) => e.message).join("; ") };

  // Nachvollziehbarkeit in Shopify — Fehler hier dürfen die Zahlung nicht kippen.
  await Promise.allSettled([addOrderTags(gid, [BANK_MATCH_TAG]), appendBankNote(gid, opts.note)]);
  return { ok: true, name, outstanding };
}
