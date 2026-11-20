// Gewerbekunden (server-only): maßgeblich sind die Shopify-Tags „B2B“ oder „B“.
// Die Liste kommt live aus Shopify (Namen werden nicht in unserer Datenbank gespeichert),
// Bestellungen und Umsätze aus kunden_bestellungen.
import { cache } from "react";
import { shopifyGraphQL } from "@/lib/shopify";

export const GEWERBE_TAGS = ["b2b", "b"];
export const istGewerbeTag = (tags: string[] | undefined) => (tags ?? []).some((t) => GEWERBE_TAGS.includes(t.trim().toLowerCase()));

export interface ShopifyKunde {
  id: number;
  name: string;
  email: string | null;
  firma: string | null;
  ort: string | null;
  tags: string[];
  seit: string;
}

type Knoten = {
  id: string; displayName: string; email: string | null; tags: string[]; createdAt: string;
  defaultAddress: { company: string | null; city: string | null; zip: string | null } | null;
};
const FELDER = "id displayName email tags createdAt defaultAddress { company city zip }";

const zuKunde = (n: Knoten): ShopifyKunde => ({
  id: Number(n.id.split("/").pop()),
  name: n.displayName?.trim() || "Ohne Namen",
  email: n.email,
  firma: n.defaultAddress?.company?.trim() || null,
  ort: [n.defaultAddress?.zip, n.defaultAddress?.city].filter(Boolean).join(" ") || null,
  tags: n.tags,
  seit: n.createdAt,
});

/** Alle als Gewerbe markierten Kunden aus Shopify (einmal pro Request). */
export const ladeGewerbeMarkiert = cache(async (): Promise<ShopifyKunde[]> => {
  const out: ShopifyKunde[] = [];
  let after: string | null = null;
  for (let i = 0; i < 40; i++) {
    const r: { data?: { customers: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: Knoten[] } }; errors?: unknown } =
      await shopifyGraphQL(`query($a: String) { customers(first: 250, after: $a, query: "tag:B2B OR tag:B") { pageInfo { hasNextPage endCursor } nodes { ${FELDER} } } }`, { a: after });
    if (!r.data) throw new Error(`Shopify: ${JSON.stringify(r.errors ?? "keine Daten").slice(0, 160)}`);
    // Shopify sucht unscharf → nur echte Gewerbe-Tags übernehmen
    out.push(...r.data.customers.nodes.filter((n) => istGewerbeTag(n.tags)).map(zuKunde));
    if (!r.data.customers.pageInfo.hasNextPage) break;
    after = r.data.customers.pageInfo.endCursor;
  }
  return out;
});

/** Shopify-Angaben zu einzelnen Kunden (für Verdachtsfälle), in Paketen zu 100. */
export async function ladeShopifyKunden(ids: number[]): Promise<Map<number, ShopifyKunde>> {
  const map = new Map<number, ShopifyKunde>();
  for (let i = 0; i < ids.length; i += 100) {
    const teil = ids.slice(i, i + 100).map((id) => `gid://shopify/Customer/${id}`);
    const r: { data?: { nodes: Array<Knoten | null> } } = await shopifyGraphQL(`query($ids: [ID!]!) { nodes(ids: $ids) { ... on Customer { ${FELDER} } } }`, { ids: teil });
    for (const n of r.data?.nodes ?? []) if (n?.id) map.set(Number(n.id.split("/").pop()), zuKunde(n));
  }
  return map;
}
