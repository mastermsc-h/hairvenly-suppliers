// Shopify Admin API client (GraphQL) — server-only

const SHOP_DOMAIN = process.env.SHOPIFY_SHOP_DOMAIN ?? "";
const ACCESS_TOKEN = process.env.SHOPIFY_ACCESS_TOKEN ?? "";
const API_VERSION = "2025-01";

function getGraphQLUrl() {
  return `https://${SHOP_DOMAIN}/admin/api/${API_VERSION}/graphql.json`;
}

// ── GraphQL fetch wrapper ─────────────────────────────────────

interface GraphQLResponse<T = unknown> {
  data?: T;
  errors?: { message: string }[];
  extensions?: { cost?: { throttleStatus?: { currentlyAvailable: number; restoreRate: number } } };
}

export async function shopifyGraphQL<T = unknown>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<GraphQLResponse<T>> {
  if (!SHOP_DOMAIN || !ACCESS_TOKEN) {
    throw new Error("SHOPIFY_SHOP_DOMAIN and SHOPIFY_ACCESS_TOKEN must be set");
  }

  let attempts = 0;
  const maxAttempts = 3;

  while (attempts < maxAttempts) {
    const res = await fetch(getGraphQLUrl(), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": ACCESS_TOKEN,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (res.status === 429) {
      const retryAfter = parseFloat(res.headers.get("Retry-After") ?? "2");
      await new Promise((r) => setTimeout(r, retryAfter * 1000));
      attempts++;
      continue;
    }

    if (!res.ok) {
      throw new Error(`Shopify API ${res.status}: ${await res.text()}`);
    }

    return res.json();
  }

  throw new Error("Shopify API rate limit exceeded after retries");
}

// ── Product search ────────────────────────────────────────────

export interface ShopifyProduct {
  id: string; // GID
  title: string;
  handle: string;
  variants: { edges: { node: ShopifyVariant }[] };
}

export interface ShopifyVariant {
  id: string; // GID
  title: string;
  inventoryPolicy: string;
  inventoryItem: { id: string };
}

export async function searchProductsByTitle(title: string): Promise<ShopifyProduct[]> {
  const query = `
    query searchProducts($q: String!) {
      products(first: 10, query: $q) {
        edges {
          node {
            id
            title
            handle
            variants(first: 50) {
              edges {
                node {
                  id
                  title
                  inventoryPolicy
                  inventoryItem { id }
                }
              }
            }
          }
        }
      }
    }
  `;

  const res = await shopifyGraphQL<{
    products: { edges: { node: ShopifyProduct }[] };
  }>(query, { q: `title:*${title}*` });

  return res.data?.products.edges.map((e) => e.node) ?? [];
}

// ── Metafields ────────────────────────────────────────────────

export async function setProductMetafields(
  productGid: string,
  metafields: { namespace: string; key: string; type: string; value: string }[],
) {
  const query = `
    mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id namespace key value }
        userErrors { field message }
      }
    }
  `;

  const variables = {
    metafields: metafields.map((mf) => ({
      ownerId: productGid,
      namespace: mf.namespace,
      key: mf.key,
      type: mf.type,
      value: mf.value,
    })),
  };

  const res = await shopifyGraphQL<{
    metafieldsSet: { userErrors: { field: string; message: string }[] };
  }>(query, variables);

  const errors = res.data?.metafieldsSet.userErrors ?? [];
  if (errors.length > 0) {
    throw new Error(`Metafield error: ${errors.map((e) => e.message).join(", ")}`);
  }

  return res;
}

// ── Inventory policy ──────────────────────────────────────────

export async function updateVariantInventoryPolicy(
  variantGid: string,
  policy: "CONTINUE" | "DENY",
) {
  const query = `
    mutation updateVariant($input: ProductVariantInput!) {
      productVariantUpdate(input: $input) {
        productVariant { id inventoryPolicy }
        userErrors { field message }
      }
    }
  `;

  const res = await shopifyGraphQL<{
    productVariantUpdate: { userErrors: { field: string; message: string }[] };
  }>(query, { input: { id: variantGid, inventoryPolicy: policy } });

  const errors = res.data?.productVariantUpdate.userErrors ?? [];
  if (errors.length > 0) {
    throw new Error(`Variant update error: ${errors.map((e) => e.message).join(", ")}`);
  }

  return res;
}

// ── Fetch pre-order tagged orders ─────────────────────────────

export interface ShopifyOrder {
  id: string;
  name: string; // e.g. "#1234"
  createdAt: string;
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  customer: { firstName: string | null; lastName: string | null; displayName: string | null; email: string } | null;
  billingAddress?: { firstName: string | null; lastName: string | null; name: string | null } | null;
  shippingAddress?: { firstName: string | null; lastName: string | null; name: string | null } | null;
  lineItems: { edges: { node: { title: string; quantity: number; variant: { title: string } | null } }[] };
}

export async function fetchOrdersByTag(tag: string, limit = 50): Promise<ShopifyOrder[]> {
  const query = `
    query preorders($q: String!, $first: Int!) {
      orders(first: $first, query: $q, sortKey: CREATED_AT, reverse: true) {
        edges {
          node {
            id
            name
            createdAt
            totalPriceSet { shopMoney { amount currencyCode } }
            customer { firstName lastName email }
            lineItems(first: 10) {
              edges {
                node {
                  title
                  quantity
                  variant { title }
                }
              }
            }
          }
        }
      }
    }
  `;

  const res = await shopifyGraphQL<{
    orders: { edges: { node: ShopifyOrder }[] };
  }>(query, { q: `tag:${tag}`, first: limit });

  return res.data?.orders.edges.map((e) => e.node) ?? [];
}

// ── Fetch orders by shipping country (CN23 / customs) ────────

export interface ShopifyCustomsLineItem {
  title: string;
  quantity: number;
  // Per-unit weight — Shopify returns grams via `variant.weight` + `weightUnit`.
  grams: number;
}

export interface ShopifyCustomsOrder {
  id: string; // GID (gid://shopify/Order/<numeric>)
  numericId: string; // numeric id only (for URLs)
  name: string; // "#1234"
  createdAt: string;
  displayFulfillmentStatus: string;
  displayFinancialStatus: string;
  shippingAddress: {
    name: string | null;
    firstName: string | null;
    lastName: string | null;
    address1: string | null;
    address2: string | null;
    zip: string | null;
    city: string | null;
    country: string | null;
    countryCode: string | null;
  } | null;
  subtotalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  lineItems: ShopifyCustomsLineItem[];
  totalQuantity: number;
  totalNetGrams: number;
}

interface CustomsOrderNode {
  id: string;
  name: string;
  createdAt: string;
  displayFulfillmentStatus: string;
  displayFinancialStatus: string;
  shippingAddress: {
    name: string | null;
    firstName: string | null;
    lastName: string | null;
    address1: string | null;
    address2: string | null;
    zip: string | null;
    city: string | null;
    country: string | null;
    countryCode: string | null;
  } | null;
  subtotalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  totalPriceSet: { shopMoney: { amount: string; currencyCode: string } };
  lineItems: {
    edges: {
      node: {
        title: string;
        quantity: number;
        variant: {
          inventoryItem: {
            measurement: {
              weight: { value: number; unit: string } | null;
            } | null;
          } | null;
        } | null;
      };
    }[];
  };
}

function gramsFromVariant(weight: number | null, unit: string | null): number {
  if (!weight || !unit) return 0;
  switch (unit.toUpperCase()) {
    case "GRAMS":
    case "G":
      return weight;
    case "KILOGRAMS":
    case "KG":
      return weight * 1000;
    case "POUNDS":
    case "LB":
      return weight * 453.592;
    case "OUNCES":
    case "OZ":
      return weight * 28.3495;
    default:
      return weight;
  }
}

function mapCustomsOrder(node: CustomsOrderNode): ShopifyCustomsOrder {
  const lineItems: ShopifyCustomsLineItem[] = node.lineItems.edges.map((e) => {
    const w = e.node.variant?.inventoryItem?.measurement?.weight ?? null;
    return {
      title: e.node.title,
      quantity: e.node.quantity,
      grams: gramsFromVariant(w?.value ?? null, w?.unit ?? null),
    };
  });
  const totalQuantity = lineItems.reduce((s, li) => s + li.quantity, 0);
  const totalNetGrams = lineItems.reduce((s, li) => s + li.grams * li.quantity, 0);
  const numericId = node.id.split("/").pop() ?? node.id;
  return {
    id: node.id,
    numericId,
    name: node.name,
    createdAt: node.createdAt,
    displayFulfillmentStatus: node.displayFulfillmentStatus,
    displayFinancialStatus: node.displayFinancialStatus,
    shippingAddress: node.shippingAddress,
    subtotalPriceSet: node.subtotalPriceSet,
    totalPriceSet: node.totalPriceSet,
    lineItems,
    totalQuantity,
    totalNetGrams,
  };
}

const CUSTOMS_ORDER_FIELDS = `
  id
  name
  createdAt
  displayFulfillmentStatus
  displayFinancialStatus
  shippingAddress {
    name firstName lastName address1 address2 zip city country countryCode
  }
  subtotalPriceSet { shopMoney { amount currencyCode } }
  totalPriceSet { shopMoney { amount currencyCode } }
  lineItems(first: 50) {
    edges { node {
      title
      quantity
      variant {
        inventoryItem {
          measurement { weight { value unit } }
        }
      }
    } }
  }
`;

export interface FetchOrdersByCountryDiagnostics {
  totalFetched: number;
  countryBreakdown: Record<string, number>;
  sampleAddresses: { orderName: string; countryCode: string | null; country: string | null; city: string | null }[];
  rawQuery?: string;
  graphqlErrors?: string[];
  pagesFetched?: number;
  firstPageEdgeCount?: number;
}

/**
 * Fetch recent orders shipping to a specific country (ISO-2 code, e.g. "CH").
 * Shopify's order search doesn't reliably support shipping-country filters,
 * so we fetch by date window and filter client-side. Paginates up to `maxPages`.
 */
export async function fetchOrdersByCountry(
  countryCode: string,
  daysBack = 180,
  maxPages = 20,
  diagnostics?: FetchOrdersByCountryDiagnostics,
): Promise<ShopifyCustomsOrder[]> {
  const since = new Date();
  since.setDate(since.getDate() - daysBack);
  const sinceStr = since.toISOString().slice(0, 10);

  const query = `
    query customsOrders($q: String!, $first: Int!, $after: String) {
      orders(first: $first, after: $after, query: $q, sortKey: CREATED_AT, reverse: true) {
        pageInfo { hasNextPage endCursor }
        edges { node { ${CUSTOMS_ORDER_FIELDS} } }
      }
    }
  `;

  const q = `created_at:>=${sinceStr}`;
  const target = countryCode.toUpperCase();
  const results: ShopifyCustomsOrder[] = [];
  let cursor: string | null = null;
  if (diagnostics) {
    diagnostics.rawQuery = q;
    diagnostics.pagesFetched = 0;
  }

  type CustomsResp = {
    orders: {
      pageInfo: { hasNextPage: boolean; endCursor: string };
      edges: { node: CustomsOrderNode }[];
    };
  };

  for (let page = 0; page < maxPages; page++) {
    const res: GraphQLResponse<CustomsResp> = await shopifyGraphQL<CustomsResp>(
      query,
      { q, first: 100, after: cursor },
    );

    const edges = res.data?.orders.edges ?? [];
    if (diagnostics) {
      diagnostics.pagesFetched = (diagnostics.pagesFetched ?? 0) + 1;
      if (page === 0) diagnostics.firstPageEdgeCount = edges.length;
      if (res.errors && res.errors.length > 0) {
        diagnostics.graphqlErrors = [
          ...(diagnostics.graphqlErrors ?? []),
          ...res.errors.map((e) => e.message),
        ];
      }
    }
    for (const e of edges) {
      const mapped = mapCustomsOrder(e.node);
      if (diagnostics) {
        diagnostics.totalFetched++;
        const cc = mapped.shippingAddress?.countryCode ?? "(none)";
        diagnostics.countryBreakdown[cc] = (diagnostics.countryBreakdown[cc] ?? 0) + 1;
        if (diagnostics.sampleAddresses.length < 10) {
          diagnostics.sampleAddresses.push({
            orderName: mapped.name,
            countryCode: mapped.shippingAddress?.countryCode ?? null,
            country: mapped.shippingAddress?.country ?? null,
            city: mapped.shippingAddress?.city ?? null,
          });
        }
      }
      const cc = mapped.shippingAddress?.countryCode?.toUpperCase();
      const cn = mapped.shippingAddress?.country?.toLowerCase();
      // Match both ISO code ("CH") and full country name ("Switzerland"/"Schweiz")
      if (cc === target || cn === "switzerland" || cn === "schweiz" || cn === "suisse") {
        results.push(mapped);
      }
    }

    if (!res.data?.orders.pageInfo.hasNextPage) break;
    cursor = res.data.orders.pageInfo.endCursor;
  }

  return results;
}

/** Fetch one order by numeric id (for PDF generation). */
export async function fetchOrderForCustoms(numericId: string): Promise<ShopifyCustomsOrder | null> {
  const gid = `gid://shopify/Order/${numericId}`;
  const query = `
    query customsOrder($id: ID!) {
      order(id: $id) { ${CUSTOMS_ORDER_FIELDS} }
    }
  `;
  const res = await shopifyGraphQL<{ order: CustomsOrderNode | null }>(query, { id: gid });
  if (!res.data?.order) return null;
  return mapCustomsOrder(res.data.order);
}

// ── Fetch returns from Shopify Returns API ───────────────────

export interface ShopifyReturn {
  id: string;
  name: string;
  status: string;
  order: { id: string; name: string } | null;
  returnLineItems: {
    edges: {
      node: {
        quantity: number;
        returnReason: string | null;
        fulfillmentLineItem: {
          lineItem: {
            title: string;
            variant: { title: string } | null;
            originalUnitPriceSet?: { shopMoney: { amount: string } } | null;
            product?: { collections?: { edges: { node: { title: string; handle: string } }[] } } | null;
          };
        } | null;
      };
    }[];
  };
  totalReturnLineItems: { count: number };
}

export interface ShopifyRefund {
  id: string;
  createdAt: string;
  totalRefundedSet: { shopMoney: { amount: string; currencyCode: string } };
  refundLineItems: {
    edges: {
      node: {
        quantity: number;
        subtotalSet?: { shopMoney: { amount: string; currencyCode: string } } | null;
        priceSet?: { shopMoney: { amount: string; currencyCode: string } } | null;
        totalTaxSet?: { shopMoney: { amount: string; currencyCode: string } } | null;
        lineItem: {
          title: string;
          variant: { title: string } | null;
          product?: { collections?: { edges: { node: { title: string; handle: string } }[] } } | null;
        };
      };
    }[];
  };
}

export async function fetchReturns(limit = 50): Promise<ShopifyReturn[]> {
  const query = `
    query fetchReturns($first: Int!) {
      returns(first: $first, sortKey: CREATED_AT, reverse: true) {
        edges {
          node {
            id
            name
            status
            order { id name }
            returnLineItems(first: 50) {
              edges {
                node {
                  quantity
                  returnReason
                  fulfillmentLineItem {
                    lineItem {
                      title
                      variant { title }
                      originalUnitPriceSet { shopMoney { amount } }
                      product {
                        collections(first: 10) {
                          edges { node { title handle } }
                        }
                      }
                    }
                  }
                }
              }
            }
            totalReturnLineItems { count }
          }
        }
      }
    }
  `;

  const res = await shopifyGraphQL<{
    returns: { edges: { node: ShopifyReturn }[] };
  }>(query, { first: limit });

  return res.data?.returns.edges.map((e) => e.node) ?? [];
}

export async function fetchOrdersWithRefunds(sinceDate: string, toDate?: string): Promise<{
  order: ShopifyOrder;
  refunds: ShopifyRefund[];
}[]> {
  const query = `
    query ordersWithRefunds($q: String!, $first: Int!, $after: String) {
      orders(first: $first, after: $after, query: $q, sortKey: UPDATED_AT, reverse: true) {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            id
            name
            createdAt
            updatedAt
            totalPriceSet { shopMoney { amount currencyCode } }
            customer { firstName lastName displayName email }
            billingAddress { firstName lastName name }
            shippingAddress { firstName lastName name }
            lineItems(first: 10) {
              edges {
                node {
                  title
                  quantity
                  variant { title }
                }
              }
            }
            refunds {
              id
              createdAt
              totalRefundedSet { shopMoney { amount currencyCode } }
              refundLineItems(first: 50) {
                edges {
                  node {
                    quantity
                    subtotalSet { shopMoney { amount currencyCode } }
                    priceSet { shopMoney { amount currencyCode } }
                    totalTaxSet { shopMoney { amount currencyCode } }
                    lineItem {
                      title
                      variant { title }
                      product {
                        collections(first: 10) {
                          edges { node { title handle } }
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  // Filter only by refund status — we'll filter by refund date client-side.
  // This catches refunds on OLD orders that got returned in the target period.
  // Use updated_at:>= with a wide buffer to bound pagination.
  const bufferFrom = new Date(sinceDate);
  bufferFrom.setDate(bufferFrom.getDate() - 1); // small buffer
  const q = `financial_status:refunded OR financial_status:partially_refunded`;

  type RefundOrderNode = ShopifyOrder & { updatedAt: string; refunds: ShopifyRefund[] };
  type RefundOrdersResponse = {
    orders: {
      pageInfo: { hasNextPage: boolean; endCursor: string };
      edges: { node: RefundOrderNode }[];
    };
  };

  const all: { order: ShopifyOrder; refunds: ShopifyRefund[] }[] = [];
  let cursor: string | null = null;
  // Paginate exhaustively — do NOT stop based on order.updatedAt because Shopify
  // doesn't always update the order's timestamp when a refund is added.
  // That previously caused refunds on old orders to be missed entirely.
  const maxPages = 300; // safety cap: up to 15,000 refunded orders

  const toDateEnd = toDate ? `${toDate}T23:59:59Z` : null;

  for (let page = 0; page < maxPages; page++) {
    const vars: Record<string, unknown> = { q, first: 50, after: cursor };
    const res: GraphQLResponse<RefundOrdersResponse> = await shopifyGraphQL<RefundOrdersResponse>(query, vars);

    const edges = res.data?.orders.edges ?? [];

    for (const e of edges) {
      const node = e.node;
      // Filter refunds by actual refund date (client-side)
      const matchingRefunds = (node.refunds ?? []).filter((r) => {
        if (!r.createdAt) return false;
        if (r.createdAt < sinceDate) return false;
        if (toDateEnd && r.createdAt > toDateEnd) return false;
        return true;
      });

      if (matchingRefunds.length > 0) {
        all.push({ order: node, refunds: matchingRefunds });
      }
    }

    if (!res.data?.orders.pageInfo.hasNextPage || edges.length === 0) break;
    cursor = res.data.orders.pageInfo.endCursor;
  }

  return all;
}

// ── Collection helper ─────────────────────────────────────────

// Collections to ignore when picking the most specific one for a product.
const IGNORED_COLLECTIONS = new Set([
  "alle produkte", "alle", "best seller", "bestseller", "best selling products",
  "sale", "new", "neu", "newest", "newest products", "neuste produkte",
  "angebote", "home", "startseite", "all", "homepage",
  "unassigned",
]);

// PREFERRED: the specific sub-collections we show in analytics. When a product
// belongs to multiple collections, we always pick one of these if available,
// so returns and sales end up in the same bucket. Matched case-insensitively.
const PREFERRED_COLLECTIONS = new Set([
  // Russisch Glatt — specific ones
  "standard tapes russisch",
  "russische tapes (glatt)",
  "mini tapes glatt",
  "russische bondings (glatt)",
  "russische classic tressen (glatt)",
  "russische genius tressen (glatt)",
  "russische invisible tressen (glatt)",
  "russische invisible tressen / butterfly weft",
  "clip in extensions echthaar",
  // Usbekisch Wellig — specific with length
  "tapes wellig 45cm",
  "tapes wellig 55cm",
  "tapes wellig 65cm",
  "tapes wellig 85cm",
  "bondings wellig 65cm",
  "bondings wellig 85cm",
  "usbekische classic tressen (wellig)",
  "usbekische genius tressen (wellig)",
  // Ponytails + Zubehör
  "ponytail extensions",
  "ponytail extensions kaufen",
  "accessoires",
  "extensions zubehör",
]);

// Overarching parent collections that should be deprioritized because they
// double-count (e.g. "Usbekische Tapes (Wellig)" covers 45/55/65/85cm).
const PARENT_COLLECTIONS = new Set([
  "usbekische tapes (wellig)",
  "russische tapes (glatt)",         // parent when child "standard tapes russisch" exists
  "usbekische bondings (wellig)",
  "bondings",
  "tressen extensions",
  "usbekische tressen (wellig)",
  "russische tressen (glatt)",       // parent of genius/classic/invisible
]);

export function pickPrimaryCollection(
  collections: { title: string; handle: string }[] | undefined,
): { title: string; handle: string } | null {
  if (!collections || collections.length === 0) return null;

  const normalize = (c: { title: string; handle: string }) => c.title.toLowerCase().trim();

  // 1. Filter out truly irrelevant collections
  const eligible = collections.filter((c) => !IGNORED_COLLECTIONS.has(normalize(c)));
  if (eligible.length === 0) return collections[0];

  // 2. Prefer anything in the allow-list first
  const preferred = eligible.find((c) => PREFERRED_COLLECTIONS.has(normalize(c)));
  if (preferred) return preferred;

  // 3. Fallback: prefer non-parent collections over parents
  const nonParent = eligible.find((c) => !PARENT_COLLECTIONS.has(normalize(c)));
  return nonParent ?? eligible[0];
}

/**
 * Refine a collection using the product title when the Shopify-assigned
 * collection is a parent ("Usbekische Bondings (Wellig)") or a grouping
 * ("Best Selling Products") that doesn't match our specific categories.
 * Returns the specific Hairvenly collection name or the original if no refinement fits.
 */
export function refineCollection(
  collectionTitle: string | null | undefined,
  productTitle: string | null | undefined,
): string | null {
  const coll = (collectionTitle ?? "").toLowerCase().trim();
  const up = (productTitle ?? "").toUpperCase();
  if (!up) return collectionTitle ?? null;

  // helpers
  const hasLen = (n: number) => new RegExp(`\\b${n}\\s*CM\\b`).test(up);
  const isMini = /MINI\s*TAPE/.test(up);
  const isRussisch = /RUSSISCH|\bGLATT\b|\bRU\s+GLATT\b|STANDARD\s+RUSS/.test(up);
  const isUsbekisch = /USBEKISCH|\bWELLIG|\bUS\s+WELLIG/.test(up);

  // Parent "Usbekische Bondings (Wellig)" → split by length
  if (coll === "usbekische bondings (wellig)") {
    if (hasLen(65)) return "Bondings wellig 65cm";
    if (hasLen(85)) return "Bondings wellig 85cm";
    return "Usbekische Bondings (Wellig)"; // keep parent if no length
  }

  // Parent "Usbekische Tapes (Wellig)" → split by length
  if (coll === "usbekische tapes (wellig)") {
    if (hasLen(45)) return "Tapes Wellig 45cm";
    if (hasLen(55)) return "Tapes Wellig 55cm";
    if (hasLen(65)) return "Tapes Wellig 65cm";
    if (hasLen(85)) return "Tapes Wellig 85cm";
    return "Usbekische Tapes (Wellig)";
  }

  // Parent "Russische Tressen (Glatt)" → split by variant
  if (coll === "russische tressen (glatt)") {
    if (/GENIUS/.test(up)) return "Russische Genius Tressen (Glatt)";
    if (/INVISIBLE/.test(up)) return "Russische Invisible Tressen (Glatt)";
    if (/CLASSIC/.test(up)) return "Russische Classic Tressen (Glatt)";
    return "Russische Tressen (Glatt)";
  }
  if (coll === "usbekische tressen (wellig)") {
    if (/GENIUS/.test(up)) return "Usbekische Genius Tressen (Wellig)";
    if (/CLASSIC/.test(up)) return "Usbekische Classic Tressen (Wellig)";
    return "Usbekische Tressen (Wellig)";
  }

  // "Tressen Extensions" (global parent)
  if (coll === "tressen extensions") {
    if (isRussisch) {
      if (/GENIUS/.test(up)) return "Russische Genius Tressen (Glatt)";
      if (/INVISIBLE/.test(up)) return "Russische Invisible Tressen (Glatt)";
      if (/CLASSIC/.test(up)) return "Russische Classic Tressen (Glatt)";
    } else if (isUsbekisch) {
      if (/GENIUS/.test(up)) return "Usbekische Genius Tressen (Wellig)";
      if (/CLASSIC/.test(up)) return "Usbekische Classic Tressen (Wellig)";
    }
    return null; // drop if unknown
  }

  // "Best Selling Products", "Unassigned", "Haarpflegeprodukte" → figure out from title
  if (coll === "best selling products" || coll === "unassigned" || coll === "haarpflegeprodukte" || coll === "") {
    // Care / Zubehör
    if (/KLEBER|REMOVER|BÜRSTE|BUERSTE|SHAMPOO|CONDITIONER|FARBRING|SPRAY|TREATMENT|MASK|PFLEGE/.test(up)) {
      return "Extensions Zubehör";
    }
    // Russian products
    if (isRussisch) {
      if (isMini) return "Mini Tapes Glatt";
      if (/STANDARD.*TAPE|TAPE.*STANDARD|\bTAPE\b/.test(up) && !/MINI/.test(up)) return "Standard Tapes Russisch";
      if (/BONDING/.test(up)) return "Russische Bondings (Glatt)";
      if (/GENIUS.*TRESS|TRESS.*GENIUS/.test(up)) return "Russische Genius Tressen (Glatt)";
      if (/INVISIBLE/.test(up)) return "Russische Invisible Tressen (Glatt)";
      if (/CLASSIC/.test(up)) return "Russische Classic Tressen (Glatt)";
      if (/TRESS|WEFT/.test(up)) return "Russische Genius Tressen (Glatt)"; // default tressen
      if (/CLIP/.test(up)) return "Clip In Extensions Echthaar";
    }
    // Usbekisch products
    if (isUsbekisch || /\bUS\s+/.test(up)) {
      if (/\bTAPE/.test(up) && !/MINI/.test(up)) {
        if (hasLen(45)) return "Tapes Wellig 45cm";
        if (hasLen(55)) return "Tapes Wellig 55cm";
        if (hasLen(65)) return "Tapes Wellig 65cm";
        if (hasLen(85)) return "Tapes Wellig 85cm";
      }
      if (/BONDING/.test(up)) {
        if (hasLen(65)) return "Bondings wellig 65cm";
        if (hasLen(85)) return "Bondings wellig 85cm";
      }
      if (/GENIUS/.test(up)) return "Usbekische Genius Tressen (Wellig)";
      if (/CLASSIC/.test(up)) return "Usbekische Classic Tressen (Wellig)";
    }
    if (/PONYTAIL/.test(up)) return "Ponytail Extensions";
    if (/CLIP/.test(up)) return "Clip In Extensions Echthaar";
    return null; // couldn't determine
  }

  // Otherwise return the original collection title
  return collectionTitle ?? null;
}

// ── Fetch monthly sales per collection ────────────────────────

export async function fetchMonthlyCollectionSales(
  monthsOrFromDate: number | string = 12,
  toDate?: string,
): Promise<{
  month: string;
  collection: string;
  revenue: number;
  orderCount: number;
  itemCount: number;
}[]> {
  let startStr: string;
  if (typeof monthsOrFromDate === "string") {
    // Explicit from-date provided
    startStr = monthsOrFromDate;
  } else {
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth() - monthsOrFromDate, 1);
    startStr = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, "0")}-01`;
  }
  // Clamp optional upper bound for query filter
  const endFilter = toDate ? ` created_at:<=${toDate}` : "";

  const query = `
    query monthlyCollectionSales($q: String!, $first: Int!, $after: String) {
      orders(first: $first, after: $after, query: $q, sortKey: CREATED_AT, reverse: true) {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            id
            createdAt
            cancelledAt
            lineItems(first: 50) {
              edges {
                node {
                  title
                  quantity
                  originalTotalSet { shopMoney { amount } }
                  taxLines { priceSet { shopMoney { amount } } }
                  product {
                    title
                    collections(first: 10) {
                      edges { node { title handle } }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  type SalesResponse = {
    orders: {
      pageInfo: { hasNextPage: boolean; endCursor: string };
      edges: {
        node: {
          id: string;
          createdAt: string;
          cancelledAt: string | null;
          lineItems: {
            edges: {
              node: {
                title: string;
                quantity: number;
                originalTotalSet: { shopMoney: { amount: string } };
                taxLines: { priceSet: { shopMoney: { amount: string } } }[];
                product: { title?: string; collections: { edges: { node: { title: string; handle: string } }[] } } | null;
              };
            }[];
          };
        };
      }[];
    };
  };

  // aggregate: month -> collection -> stats
  const agg = new Map<string, Map<string, { revenue: number; orders: Set<string>; items: number }>>();
  let cursor: string | null = null;
  // 300 pages × 100 orders = up to 30,000 orders. Enough for >2 years of traffic.
  const maxPages = 300;

  for (let page = 0; page < maxPages; page++) {
    const vars: Record<string, unknown> = {
      q: `created_at:>=${startStr}${endFilter}`,
      first: 100,
      after: cursor,
    };
    const res: GraphQLResponse<SalesResponse> = await shopifyGraphQL<SalesResponse>(query, vars);
    const edges = res.data?.orders.edges ?? [];
    if (edges.length === 0) break;

    for (const e of edges) {
      const order = e.node;
      // Skip cancelled orders — Shopify's gross_sales excludes them.
      if (order.cancelledAt) continue;
      const month = order.createdAt.slice(0, 7) + "-01";
      const monthMap = agg.get(month) ?? new Map();

      for (const liEdge of order.lineItems.edges) {
        const li = liEdge.node;
        const collections = li.product?.collections?.edges?.map((c) => c.node);
        const primary = pickPrimaryCollection(collections);
        // Refine based on product title so parent/"Best Selling" items land in
        // their specific sub-collection (e.g. "Bondings wellig 65cm").
        const productTitle = li.product?.title || li.title || "";
        const refined = refineCollection(primary?.title ?? null, productTitle);
        const collName = refined ?? primary?.title ?? "Unassigned";

        const grossWithTax = parseFloat(li.originalTotalSet?.shopMoney?.amount ?? "0") || 0;
        // Subtract taxes from gross to match Shopify's "Gross Sales" metric (net of tax)
        const tax = (li.taxLines ?? []).reduce(
          (sum, tl) => sum + (parseFloat(tl.priceSet?.shopMoney?.amount ?? "0") || 0),
          0,
        );
        const amount = Math.max(0, grossWithTax - tax);
        const qty = li.quantity ?? 0;

        const entry = monthMap.get(collName) ?? { revenue: 0, orders: new Set<string>(), items: 0 };
        entry.revenue += amount;
        entry.orders.add(order.id);
        entry.items += qty;
        monthMap.set(collName, entry);
      }
      agg.set(month, monthMap);
    }

    if (!res.data?.orders.pageInfo.hasNextPage) break;
    cursor = res.data.orders.pageInfo.endCursor;
  }

  const result: { month: string; collection: string; revenue: number; orderCount: number; itemCount: number }[] = [];
  for (const [month, colls] of agg) {
    for (const [collection, stats] of colls) {
      result.push({
        month,
        collection,
        revenue: stats.revenue,
        orderCount: stats.orders.size,
        itemCount: stats.items,
      });
    }
  }
  return result;
}

// ── Fetch monthly revenue totals ───────────────────────────────

export async function fetchMonthlyRevenue(
  monthsOrFromDate: number | string = 12,
  toDate?: string,
): Promise<{ month: string; revenue: number; orderCount: number }[]> {
  let startStr: string;
  if (typeof monthsOrFromDate === "string") {
    startStr = monthsOrFromDate;
  } else {
    const now = new Date();
    const startDate = new Date(now.getFullYear(), now.getMonth() - monthsOrFromDate, 1);
    startStr = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, "0")}-01`;
  }
  const endFilter = toDate ? ` created_at:<=${toDate}` : "";

  const query = `
    query monthlyRevenue($q: String!, $first: Int!, $after: String) {
      orders(first: $first, after: $after, query: $q, sortKey: CREATED_AT, reverse: true) {
        pageInfo { hasNextPage endCursor }
        edges {
          node {
            createdAt
            cancelledAt
            totalPriceSet { shopMoney { amount } }
          }
        }
      }
    }
  `;

  type MonthlyResponse = {
    orders: {
      pageInfo: { hasNextPage: boolean; endCursor: string };
      edges: {
        node: {
          createdAt: string;
          cancelledAt: string | null;
          totalPriceSet: { shopMoney: { amount: string } };
        };
      }[];
    };
  };

  const monthly = new Map<string, { revenue: number; orderCount: number }>();
  let cursor: string | null = null;
  const maxPages = 150; // up to 37500 orders per call

  for (let page = 0; page < maxPages; page++) {
    const vars: Record<string, unknown> = {
      q: `created_at:>=${startStr}${endFilter}`,
      first: 250,
      after: cursor,
    };
    const res = await shopifyGraphQL<MonthlyResponse>(query, vars);
    const edges = res.data?.orders.edges ?? [];

    for (const e of edges) {
      if (e.node.cancelledAt) continue;
      const month = e.node.createdAt.slice(0, 7); // "YYYY-MM"
      const amount = parseFloat(e.node.totalPriceSet.shopMoney.amount) || 0;
      const existing = monthly.get(month) ?? { revenue: 0, orderCount: 0 };
      existing.revenue += amount;
      existing.orderCount += 1;
      monthly.set(month, existing);
    }

    if (!res.data?.orders.pageInfo.hasNextPage || edges.length === 0) break;
    cursor = res.data.orders.pageInfo.endCursor;
  }

  return Array.from(monthly.entries())
    .map(([month, v]) => ({ month: `${month}-01`, revenue: v.revenue, orderCount: v.orderCount }))
    .sort((a, b) => a.month.localeCompare(b.month));
}

// ── Order Metafield Setter (für Pack-QR) ──────────────────────

/**
 * Setzt ein Metafield auf einer Order. Owner-ID = Order-GID.
 * Wird genutzt um QR-SVG inline im Lieferschein-Liquid einzubinden.
 */
export async function setOrderMetafield(
  orderGid: string,
  namespace: string,
  key: string,
  type: string,
  value: string,
): Promise<void> {
  const query = `
    mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
      metafieldsSet(metafields: $metafields) {
        metafields { id namespace key }
        userErrors { field message }
      }
    }
  `;
  const res = await shopifyGraphQL<{
    metafieldsSet: { userErrors: { field: string[]; message: string }[] };
  }>(query, {
    metafields: [{ ownerId: orderGid, namespace, key, type, value }],
  });
  const errors = res.data?.metafieldsSet.userErrors ?? [];
  if (errors.length > 0) {
    throw new Error(`Order metafield set failed: ${errors.map((e) => e.message).join(", ")}`);
  }
}

// ── Pack-Verifikations-System: Order-Fetching für /pack ───────

export interface PackOrderLineItem {
  title: string;                  // Produkt-Titel
  variantTitle: string | null;    // Variant-Titel (z.B. "25 (10 Tapes)")
  quantity: number;
  barcode: string | null;         // EAN aus variant.barcode
  variantId: string | null;       // GID der Variante (für Fulfillment)
  inventoryItemId: string | null; // für spätere Inventory-Updates
  imageUrl: string | null;
  fulfillmentOrderLineItemId: string | null; // GID — wird beim Fulfill benötigt
  collectionHandles: string[];    // Shopify-Collections des Produkts (für Auto-Skip Foto-Pflicht)
}

export interface PackOrder {
  id: string;                     // GID
  numericId: string;              // numeric only
  name: string;                   // "#22264"
  numberClean: string;            // "22264"
  createdAt: string;
  displayFinancialStatus: string;
  displayFulfillmentStatus: string;
  customerName: string | null;
  customerEmail: string | null;
  shippingAddress: {
    name: string | null;
    address1: string | null;
    zip: string | null;
    city: string | null;
    country: string | null;
  } | null;
  lineItems: PackOrderLineItem[];
  totalQuantity: number;
  fulfillmentOrders: { id: string; status: string }[]; // für Auto-Fulfill
  hasPackQr: boolean;             // ob custom.pack_qr_svg metafield bereits gesetzt ist
}

interface PackOrderNode {
  id: string;
  name: string;
  createdAt: string;
  displayFinancialStatus: string;
  displayFulfillmentStatus: string;
  email: string | null;
  shippingAddress: {
    name: string | null;
    firstName: string | null;
    lastName: string | null;
    address1: string | null;
    zip: string | null;
    city: string | null;
    country: string | null;
  } | null;
  lineItems: {
    edges: {
      node: {
        title: string;
        quantity: number;
        image: { url: string } | null;
        variant: {
          id: string;
          title: string | null;
          barcode: string | null;
          image: { url: string } | null;
          inventoryItem: { id: string } | null;
          product: {
            featuredImage: { url: string } | null;
            collections: { edges: { node: { handle: string } }[] };
          } | null;
        } | null;
      };
    }[];
  };
  packQrMetafield: { value: string } | null;
}

// Hinweis: customer + fulfillmentOrders fields requirieren read_customers und
// read_*_fulfillment_orders scopes. Ohne diese liefert die GraphQL-API ACCESS_DENIED
// → Query failed komplett. Daher hier weggelassen.
// Customer-Name ziehen wir aus shippingAddress.name als Fallback.
// Auto-Fulfill in fulfillOrderInShopify holt fulfillmentOrders separat wenn nötig.
const PACK_ORDER_FIELDS = `
  id
  name
  createdAt
  displayFinancialStatus
  displayFulfillmentStatus
  email
  shippingAddress { name firstName lastName address1 zip city country }
  lineItems(first: 50) {
    edges { node {
      title
      quantity
      image { url }
      variant {
        id
        title
        barcode
        image { url }
        inventoryItem { id }
        product {
          featuredImage { url }
          collections(first: 25) { edges { node { handle } } }
        }
      }
    } }
  }
  packQrMetafield: metafield(namespace: "custom", key: "pack_qr_svg") { value }
`;

function mapPackOrder(node: PackOrderNode): PackOrder {
  const numericId = node.id.split("/").pop() ?? node.id;
  const numberClean = node.name.replace(/^#/, "");

  const lineItems: PackOrderLineItem[] = node.lineItems.edges.map((e) => {
    const v = e.node.variant;
    const imageUrl =
      e.node.image?.url ?? v?.image?.url ?? v?.product?.featuredImage?.url ?? null;
    return {
      title: e.node.title,
      variantTitle: v?.title ?? null,
      quantity: e.node.quantity,
      barcode: v?.barcode ?? null,
      variantId: v?.id ?? null,
      inventoryItemId: v?.inventoryItem?.id ?? null,
      imageUrl,
      fulfillmentOrderLineItemId: null, // wird separat geholt für Auto-Fulfill
      collectionHandles: v?.product?.collections.edges.map((c) => c.node.handle) ?? [],
    };
  });

  // Customer-Name aus shippingAddress (read_customers scope nicht verfügbar)
  const sa = node.shippingAddress;
  const customerName =
    sa?.name ??
    [sa?.firstName, sa?.lastName].filter(Boolean).join(" ").trim() ??
    null;

  return {
    id: node.id,
    numericId,
    name: node.name,
    numberClean,
    createdAt: node.createdAt,
    displayFinancialStatus: node.displayFinancialStatus,
    displayFulfillmentStatus: node.displayFulfillmentStatus,
    customerName: customerName || null,
    customerEmail: node.email ?? null,
    shippingAddress: node.shippingAddress
      ? {
          name: node.shippingAddress.name,
          address1: node.shippingAddress.address1,
          zip: node.shippingAddress.zip,
          city: node.shippingAddress.city,
          country: node.shippingAddress.country,
        }
      : null,
    lineItems,
    totalQuantity: lineItems.reduce((s, li) => s + li.quantity, 0),
    fulfillmentOrders: [], // werden separat geholt im Auto-Fulfill Workflow
    hasPackQr: !!(node.packQrMetafield && node.packQrMetafield.value && node.packQrMetafield.value.length > 0),
  };
}

/**
 * Fetch unfulfilled, paid orders — these need to be packed.
 * Sorted oldest-first (FIFO) so the oldest orders are packed first.
 */
export async function fetchUnfulfilledPaidOrders(limit = 100): Promise<PackOrder[]> {
  const query = `
    query packQueue($q: String!, $first: Int!) {
      orders(first: $first, query: $q, sortKey: CREATED_AT, reverse: false) {
        edges { node { ${PACK_ORDER_FIELDS} } }
      }
    }
  `;
  const q = "financial_status:paid AND fulfillment_status:unfulfilled";
  const res = await shopifyGraphQL<{ orders: { edges: { node: PackOrderNode }[] } }>(
    query,
    { q, first: limit },
  );
  return res.data?.orders.edges.map((e) => mapPackOrder(e.node)) ?? [];
}

/**
 * Fetch alle bezahlten Orders der letzten N Tage — egal ob fulfilled oder nicht.
 * Wird genutzt für QR-Backfill (auch alte/fulfilled orders sollen QR im Lieferschein haben).
 */
export async function fetchRecentPaidOrders(daysBack = 30, limit = 250): Promise<PackOrder[]> {
  const since = new Date();
  since.setDate(since.getDate() - daysBack);
  const sinceStr = since.toISOString().slice(0, 10);
  const query = `
    query recentPaid($q: String!, $first: Int!) {
      orders(first: $first, query: $q, sortKey: CREATED_AT, reverse: true) {
        edges { node { ${PACK_ORDER_FIELDS} } }
      }
    }
  `;
  const q = `financial_status:paid AND created_at:>=${sinceStr}`;
  const res = await shopifyGraphQL<{ orders: { edges: { node: PackOrderNode }[] } }>(
    query,
    { q, first: limit },
  );
  return res.data?.orders.edges.map((e) => mapPackOrder(e.node)) ?? [];
}

/** Fetch one order by name (e.g. "#22264" or "22264") for Pack-Modus. */
export async function fetchOrderForPack(orderName: string): Promise<PackOrder | null> {
  const clean = orderName.replace(/^#/, "");
  const query = `
    query packOrder($q: String!) {
      orders(first: 1, query: $q) {
        edges { node { ${PACK_ORDER_FIELDS} } }
      }
    }
  `;
  const res = await shopifyGraphQL<{ orders: { edges: { node: PackOrderNode }[] } }>(
    query,
    { q: `name:#${clean}` },
  );
  const node = res.data?.orders.edges[0]?.node;
  return node ? mapPackOrder(node) : null;
}

// ── Auto-Fulfillment nach Pack-Verifikation ──────────────────

/**
 * Markiert eine Order als ausgeführt (fulfilled) in Shopify.
 * Nutzt fulfillmentCreate (GraphQL) — fulfillt alle offenen Mengen aller
 * fulfillmentOrders der Order in einem Rutsch.
 */
export async function fulfillOrderInShopify(
  fulfillmentOrderIds: string[],
  notifyCustomer = true,
): Promise<{ success: boolean; fulfillmentId?: string; errors?: string[] }> {
  const query = `
    mutation fulfillmentCreate($fulfillment: FulfillmentInput!) {
      fulfillmentCreate(fulfillment: $fulfillment) {
        fulfillment { id status }
        userErrors { field message }
      }
    }
  `;
  const variables = {
    fulfillment: {
      lineItemsByFulfillmentOrder: fulfillmentOrderIds.map((id) => ({ fulfillmentOrderId: id })),
      notifyCustomer,
    },
  };
  const res = await shopifyGraphQL<{
    fulfillmentCreate: {
      fulfillment: { id: string; status: string } | null;
      userErrors: { field: string[] | null; message: string }[];
    };
  }>(query, variables);

  const errors = res.data?.fulfillmentCreate.userErrors ?? [];
  if (errors.length > 0) {
    return { success: false, errors: errors.map((e) => e.message) };
  }
  return {
    success: true,
    fulfillmentId: res.data?.fulfillmentCreate.fulfillment?.id,
  };
}

// ── Ensure metafield definitions exist ────────────────────────

export async function ensureMetafieldDefinitions() {
  const definitions = [
    { namespace: "custom", key: "restock_date", type: "date", name: "Restock Date", description: "Expected restock date for pre-order products" },
    { namespace: "custom", key: "preorder_enabled", type: "boolean", name: "Pre-order Enabled", description: "Whether pre-ordering is enabled for this product" },
  ];

  for (const def of definitions) {
    const query = `
      mutation createDef($definition: MetafieldDefinitionInput!) {
        metafieldDefinitionCreate(definition: $definition) {
          createdDefinition { id }
          userErrors { field message }
        }
      }
    `;

    const res = await shopifyGraphQL<{
      metafieldDefinitionCreate: { userErrors: { field: string; message: string }[] };
    }>(query, {
      definition: {
        name: def.name,
        namespace: def.namespace,
        key: def.key,
        type: def.type,
        description: def.description,
        ownerType: "PRODUCT",
      },
    });

    // Ignore "already exists" errors
    const errors = (res.data?.metafieldDefinitionCreate.userErrors ?? []).filter(
      (e) => !e.message.includes("already exists") && !e.message.includes("already been taken"),
    );
    if (errors.length > 0) {
      console.warn(`Metafield definition ${def.key}:`, errors);
    }
  }
}
