/**
 * Katalog ↔ Shopify per Produkt-ID (Sync + Lese-Index).
 *
 *   syncShopifyProductLinks()  — nächtlich aus /api/cron/refresh (+ Backfill):
 *     lädt alle Shopify-Produkte, verknüpft product_colors per ID
 *     (Zuordnung: lib/shopify-product-match.ts), zieht Titel/Handle/URL und
 *     name_shopify auf den aktuellen Stand, pflegt die Titel-Historie.
 *
 *   loadShopifyTitleIndex()    — Lesepfad: beliebiger (auch veralteter)
 *     Produktname aus Sheets → Produkt-ID.
 *
 * Feature-Flag: SHOPIFY_ID_LINK=off schaltet die ID-Lookups im Lesepfad ab
 * (Rollback ohne Deploy). Der Sync läuft unabhängig davon.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { shopifyGraphQL } from "@/lib/shopify";
import { createServiceClient } from "@/lib/supabase/server";
import {
  linkCatalogColor,
  normTitle,
  handleFromUrl,
  type CatalogColorLite,
  type ShopifyProductLite,
} from "@/lib/shopify-product-match";

export function isShopifyIdLinkEnabled(): boolean {
  return (process.env.SHOPIFY_ID_LINK ?? "on").toLowerCase() !== "off";
}

// ── Shopify lesen ───────────────────────────────────────────────

const PRODUCTS_QUERY = `
  query($after: String) {
    products(first: 100, after: $after) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id title handle status
        collections(first: 15) { nodes { handle } }
        variants(first: 30) { nodes { id title } }
      }
    }
  }`;

type ProductsPage = {
  products: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
    nodes: {
      id: string;
      title: string;
      handle: string;
      status: string;
      collections: { nodes: { handle: string }[] };
      variants: { nodes: { id: string; title: string }[] };
    }[];
  };
};

export async function fetchShopifyProductsLite(): Promise<ShopifyProductLite[]> {
  const out: ShopifyProductLite[] = [];
  let after: string | null = null;
  for (let page = 0; page < 50; page++) {
    const res: { data?: ProductsPage } = await shopifyGraphQL<ProductsPage>(PRODUCTS_QUERY, { after });
    const d = res.data?.products;
    if (!d) break;
    for (const p of d.nodes) {
      out.push({
        id: p.id,
        title: p.title,
        handle: p.handle,
        status: p.status,
        collections: p.collections.nodes.map((c) => c.handle),
        variants: p.variants.nodes.map((v) => ({ id: v.id, title: v.title })),
      });
    }
    if (!d.pageInfo.hasNextPage) break;
    after = d.pageInfo.endCursor;
  }
  return out;
}

// ── Supabase-Helfer ─────────────────────────────────────────────

async function selectAll<T>(
  build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    all.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return all;
}

type ColorRow = {
  id: string;
  name_hairvenly: string;
  name_supplier: string | null;
  name_shopify: string | null;
  shopify_url: string | null;
  shopify_product_id: string | null;
  shopify_variant_id: string | null;
  shopify_title: string | null;
  shopify_handle: string | null;
  shopify_link_source: string | null;
  product_lengths: {
    value: string;
    product_methods: { name: string; suppliers: { name: string } | null } | null;
  } | null;
};

// ── Sync ────────────────────────────────────────────────────────

export interface ShopifyLinkSyncResult {
  ok: boolean;
  products?: number;
  colors?: number;
  linked?: number;
  newlyLinked?: number;
  relinked?: number;
  rowsUpdated?: number;
  titlesUpserted?: number;
  unresolved?: string[];
  error?: string;
}

const STORE_ORIGIN = "https://hairvenly.de";

export async function syncShopifyProductLinks(
  supabase: SupabaseClient,
  opts: { dryRun?: boolean; products?: ShopifyProductLite[] } = {},
): Promise<ShopifyLinkSyncResult> {
  try {
    const products = opts.products ?? (await fetchShopifyProductsLite());
    // Schutz: leere/abgeschnittene Antwort darf keine Verknüpfungen kippen.
    if (products.length < 50) {
      return { ok: false, error: `Shopify lieferte nur ${products.length} Produkte — Sync übersprungen` };
    }
    const byId = new Map(products.map((p) => [p.id, p]));
    const byHandle = new Map(products.map((p) => [p.handle, p]));

    const colors = await selectAll<ColorRow>((from, to) =>
      supabase
        .from("product_colors")
        .select(
          "id, name_hairvenly, name_supplier, name_shopify, shopify_url, shopify_product_id, shopify_variant_id, shopify_title, shopify_handle, shopify_link_source, product_lengths(value, product_methods(name, suppliers(name)))",
        )
        .order("id")
        .range(from, to) as unknown as PromiseLike<{ data: ColorRow[] | null; error: { message: string } | null }>,
    );

    const nowIso = new Date().toISOString();
    const titleRows = new Map<string, { product_id: string; title: string; title_norm: string; last_seen_at: string; source: string }>();
    const addTitle = (productId: string, title: string, source: "shopify" | "catalog") => {
      const title_norm = normTitle(title);
      if (!title_norm) return;
      const key = `${productId}|${title_norm}`;
      if (!titleRows.has(key) || source === "shopify") {
        titleRows.set(key, { product_id: productId, title, title_norm, last_seen_at: nowIso, source });
      }
    };

    const updates: { id: string; patch: Record<string, unknown> }[] = [];
    const unresolved: string[] = [];
    let linked = 0, newlyLinked = 0, relinked = 0;

    for (const c of colors) {
      const pl = c.product_lengths;
      const m = pl?.product_methods;
      if (!pl || !m) continue;

      let productId = c.shopify_product_id;
      let variantId = c.shopify_variant_id;
      let source = c.shopify_link_source;
      const existing = productId ? byId.get(productId) : undefined;

      if (!existing && source !== "manual") {
        // Neu verknüpfen (oder neu, weil das Produkt gelöscht wurde)
        const lite: CatalogColorLite = {
          id: c.id,
          supplierName: m.suppliers?.name ?? "",
          methodName: m.name,
          lengthValue: pl.value,
          nameHairvenly: c.name_hairvenly,
          nameSupplier: c.name_supplier,
          nameShopify: c.name_shopify,
          shopifyUrl: c.shopify_url,
        };
        const r = linkCatalogColor(lite, products, byHandle);
        if (!r) {
          unresolved.push(`${m.suppliers?.name ?? "?"} · ${m.name} · ${pl.value} · ${c.name_hairvenly}`);
          continue;
        }
        if (productId) relinked++; else newlyLinked++;
        productId = r.productId;
        variantId = r.variantId;
        source = r.source;
      }
      const p = productId ? byId.get(productId) : undefined;
      if (!p) {
        unresolved.push(`${m.suppliers?.name ?? "?"} · ${m.name} · ${pl.value} · ${c.name_hairvenly} (manuelle ID nicht in Shopify)`);
        continue;
      }
      linked++;

      // Alten Katalognamen als historischen Titel festhalten, bevor er
      // überschrieben wird — Sheets können ihn noch zeigen.
      if (c.name_shopify && normTitle(c.name_shopify) !== normTitle(p.title)) {
        addTitle(p.id, c.name_shopify, "catalog");
      }

      const origin = (() => {
        try { return c.shopify_url ? new URL(c.shopify_url).origin : STORE_ORIGIN; } catch { return STORE_ORIGIN; }
      })();
      const patch: Record<string, unknown> = {};
      if (c.shopify_product_id !== p.id) patch.shopify_product_id = p.id;
      if ((c.shopify_variant_id ?? null) !== (variantId ?? null)) patch.shopify_variant_id = variantId ?? null;
      if (c.shopify_link_source !== source) patch.shopify_link_source = source;
      if (c.shopify_title !== p.title) patch.shopify_title = p.title;
      if (c.shopify_handle !== p.handle) patch.shopify_handle = p.handle;
      if (c.name_shopify !== p.title) patch.name_shopify = p.title;
      if (handleFromUrl(c.shopify_url) !== p.handle) patch.shopify_url = `${origin}/products/${p.handle}`;
      if (Object.keys(patch).length > 0) {
        patch.shopify_synced_at = nowIso;
        updates.push({ id: c.id, patch });
      }
    }

    for (const p of products) addTitle(p.id, p.title, "shopify");

    if (!opts.dryRun) {
      for (let i = 0; i < updates.length; i += 20) {
        const batch = updates.slice(i, i + 20);
        const res = await Promise.all(
          batch.map((u) => supabase.from("product_colors").update(u.patch).eq("id", u.id)),
        );
        const err = res.find((r) => r.error)?.error;
        if (err) throw new Error(`product_colors update: ${err.message}`);
      }
      // Live-Titel: last_seen_at aktualisieren (first_seen_at bleibt).
      // Katalog-Alttitel: nur einfügen, nie überschreiben.
      const rows = Array.from(titleRows.values());
      const live = rows.filter((r) => r.source === "shopify");
      const legacy = rows.filter((r) => r.source === "catalog");
      for (let i = 0; i < live.length; i += 500) {
        const { error } = await supabase
          .from("shopify_product_titles")
          .upsert(live.slice(i, i + 500), { onConflict: "product_id,title_norm" });
        if (error) throw new Error(`shopify_product_titles: ${error.message}`);
      }
      for (let i = 0; i < legacy.length; i += 500) {
        const { error } = await supabase
          .from("shopify_product_titles")
          .upsert(legacy.slice(i, i + 500), { onConflict: "product_id,title_norm", ignoreDuplicates: true });
        if (error) throw new Error(`shopify_product_titles: ${error.message}`);
      }
    }

    return {
      ok: true,
      products: products.length,
      colors: colors.length,
      linked,
      newlyLinked,
      relinked,
      rowsUpdated: updates.length,
      titlesUpserted: titleRows.size,
      unresolved,
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Lese-Index ──────────────────────────────────────────────────

export interface ShopifyTitleIndex {
  /** Beliebiger Produktname (aktueller ODER früherer Titel) → Produkt-ID. */
  resolve(productName: string | null | undefined): string | null;
  /** Shop-URL / Handle → Produkt-ID. */
  resolveUrl(url: string | null | undefined): string | null;
}

const EMPTY_INDEX: ShopifyTitleIndex = { resolve: () => null, resolveUrl: () => null };

/**
 * Baut den Namens-/Handle-Index. Mehrdeutige Titel (gleicher normalisierter
 * Titel bei mehreren Produkten) werden verworfen → Fallback auf den alten
 * Namenspfad statt Raten. Liest über den Service-Client (reine Produktdaten),
 * damit auch Chatbot-Kontexte ohne Login-Session den Index bekommen.
 * Fehler → leerer Index (= exakt altes Verhalten).
 */
export async function loadShopifyTitleIndex(): Promise<ShopifyTitleIndex> {
  if (!isShopifyIdLinkEnabled()) return EMPTY_INDEX;
  try {
    const svc = createServiceClient();
    const [titles, colors] = await Promise.all([
      selectAll<{ product_id: string; title_norm: string }>((from, to) =>
        svc.from("shopify_product_titles").select("product_id, title_norm").order("product_id").range(from, to),
      ),
      selectAll<{ shopify_product_id: string; shopify_handle: string | null; shopify_title: string | null; name_shopify: string | null }>(
        (from, to) =>
          svc
            .from("product_colors")
            .select("shopify_product_id, shopify_handle, shopify_title, name_shopify")
            .not("shopify_product_id", "is", null)
            .order("id")
            .range(from, to),
      ),
    ]);

    const byTitle = new Map<string, string | null>(); // null = mehrdeutig
    const add = (norm: string, id: string) => {
      if (!norm) return;
      const cur = byTitle.get(norm);
      if (cur === undefined) byTitle.set(norm, id);
      else if (cur !== id) byTitle.set(norm, null);
    };
    for (const t of titles) add(t.title_norm, t.product_id);
    const byHandle = new Map<string, string>();
    for (const c of colors) {
      if (c.shopify_title) add(normTitle(c.shopify_title), c.shopify_product_id);
      if (c.name_shopify) add(normTitle(c.name_shopify), c.shopify_product_id);
      if (c.shopify_handle) byHandle.set(c.shopify_handle, c.shopify_product_id);
    }

    return {
      resolve(name) {
        if (!name) return null;
        return byTitle.get(normTitle(name)) ?? null;
      },
      resolveUrl(url) {
        const h = handleFromUrl(url ?? null);
        return h ? byHandle.get(h) ?? null : null;
      },
    };
  } catch (e) {
    console.warn("[shopify-product-link] Index nicht ladbar, Fallback auf Namenspfad:", e);
    return EMPTY_INDEX;
  }
}
