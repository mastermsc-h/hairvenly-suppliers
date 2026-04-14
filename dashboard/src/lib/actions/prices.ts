"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import type {
  SupplierPriceList,
  PriceLengthGroup,
  PriceColorCategory,
  PriceEntry,
  PriceProductMapping,
  PriceListFull,
  ProductColor,
} from "@/lib/types";

// ── Read ──────────────────────────────────────────────────────────

export async function loadPriceLists(): Promise<PriceListFull[]> {
  const supabase = await createClient();

  // 1. All price lists with supplier name
  const { data: lists } = await supabase
    .from("supplier_price_lists")
    .select("*, suppliers(name)")
    .order("created_at");

  if (!lists || lists.length === 0) return [];

  const listIds = lists.map((l) => l.id);

  // 2. Length groups
  const { data: lengthGroups } = await supabase
    .from("price_length_groups")
    .select("*")
    .in("price_list_id", listIds)
    .order("sort_order");

  // 3. Color categories
  const { data: categories } = await supabase
    .from("price_color_categories")
    .select("*")
    .in("price_list_id", listIds)
    .order("sort_order");

  // 4. Price entries
  const lgIds = (lengthGroups ?? []).map((lg) => lg.id);
  const { data: entries } = await supabase
    .from("price_entries")
    .select("*")
    .in("length_group_id", lgIds.length > 0 ? lgIds : ["__none__"]);

  // 5. Product mappings with color details
  const catIds = (categories ?? []).map((c) => c.id);
  const { data: mappings } = await supabase
    .from("price_product_mappings")
    .select("*, product_colors(*, product_lengths(value, product_methods(name)))")
    .in("color_category_id", catIds.length > 0 ? catIds : ["__none__"]);

  // Build lookup maps
  const catMap = new Map<string, PriceColorCategory>();
  for (const c of categories ?? []) catMap.set(c.id, c as PriceColorCategory);

  const mappingsByCat = new Map<string, typeof mappings>();
  for (const m of mappings ?? []) {
    const arr = mappingsByCat.get(m.color_category_id) ?? [];
    arr.push(m);
    mappingsByCat.set(m.color_category_id, arr);
  }

  const entriesByLg = new Map<string, typeof entries>();
  for (const e of entries ?? []) {
    const arr = entriesByLg.get(e.length_group_id) ?? [];
    arr.push(e);
    entriesByLg.set(e.length_group_id, arr);
  }

  const lgByList = new Map<string, (typeof lengthGroups)>();
  for (const lg of lengthGroups ?? []) {
    const arr = lgByList.get(lg.price_list_id) ?? [];
    arr.push(lg);
    lgByList.set(lg.price_list_id, arr);
  }

  // Assemble full tree
  return lists.map((list) => {
    const supplierName =
      (list.suppliers as { name: string } | null)?.name ?? "Unbekannt";
    const lgs = lgByList.get(list.id) ?? [];

    return {
      id: list.id,
      supplier_id: list.supplier_id,
      name: list.name,
      methods: list.methods as SupplierPriceList["methods"],
      created_at: list.created_at,
      updated_at: list.updated_at,
      supplier_name: supplierName,
      length_groups: lgs.map((lg) => {
        const lgEntries = entriesByLg.get(lg.id) ?? [];
        return {
          ...(lg as PriceLengthGroup),
          entries: lgEntries
            .map((e) => {
              const cat = catMap.get(e.color_category_id);
              if (!cat) return null;
              const catMappings = mappingsByCat.get(cat.id) ?? [];
              return {
                ...(e as PriceEntry),
                category: cat,
                mapped_products: catMappings.map((m) => {
                  const pc = m.product_colors as unknown as ProductColor & {
                    product_lengths: { value: string; product_methods: { name: string } };
                  };
                  return {
                    id: m.id,
                    color_category_id: m.color_category_id,
                    product_color_id: m.product_color_id,
                    color: {
                      id: pc.id,
                      length_id: pc.length_id,
                      name_hairvenly: pc.name_hairvenly,
                      name_supplier: pc.name_supplier,
                      name_shopify: pc.name_shopify,
                      sort_order: pc.sort_order,
                      updated_at: pc.updated_at,
                    } as ProductColor,
                    method_name: pc.product_lengths?.product_methods?.name ?? "",
                    length_value: pc.product_lengths?.value ?? "",
                  };
                }),
              };
            })
            .filter(Boolean)
            .sort((a, b) => (a!.category.sort_order ?? 0) - (b!.category.sort_order ?? 0)) as PriceListFull["length_groups"][number]["entries"],
        };
      }),
    };
  });
}

// ── Write (admin only) ────────────────────────────────────────────

export async function updatePriceEntry(
  entryId: string,
  prices: Record<string, number>,
) {
  await requireAdmin();
  const supabase = await createClient();

  const { error } = await supabase
    .from("price_entries")
    .update({ prices })
    .eq("id", entryId);

  if (error) throw new Error(error.message);
  revalidatePath("/prices");
}

export async function updateSellingPrices(
  lengthGroupId: string,
  sellingPrices: Record<string, { brutto: number; netto: number; gewerbe: number }>,
) {
  await requireAdmin();
  const supabase = await createClient();

  const { error } = await supabase
    .from("price_length_groups")
    .update({ selling_prices: sellingPrices })
    .eq("id", lengthGroupId);

  if (error) throw new Error(error.message);
  revalidatePath("/prices");
}

export async function mapProductToCategory(
  colorCategoryId: string,
  productColorId: string,
) {
  await requireAdmin();
  const supabase = await createClient();

  const { error } = await supabase
    .from("price_product_mappings")
    .upsert(
      { color_category_id: colorCategoryId, product_color_id: productColorId },
      { onConflict: "product_color_id" },
    );

  if (error) throw new Error(error.message);
  revalidatePath("/prices");
}

export async function unmapProduct(mappingId: string) {
  await requireAdmin();
  const supabase = await createClient();

  const { error } = await supabase
    .from("price_product_mappings")
    .delete()
    .eq("id", mappingId);

  if (error) throw new Error(error.message);
  revalidatePath("/prices");
}

/** Load all Eyfel catalog colors for the mapping dropdown */
export async function loadSupplierColors(supplierId: string) {
  const supabase = await createClient();

  const { data } = await supabase
    .from("product_colors")
    .select("id, name_hairvenly, name_shopify, product_lengths(value, product_methods(name, supplier_id))")
    .order("name_hairvenly");

  if (!data) return [];

  // Filter to supplier and flatten
  return data
    .filter((c) => {
      const pl = c.product_lengths as unknown as { product_methods: { supplier_id: string } };
      return pl?.product_methods?.supplier_id === supplierId;
    })
    .map((c) => {
      const pl = c.product_lengths as unknown as { value: string; product_methods: { name: string } };
      return {
        id: c.id,
        name_hairvenly: c.name_hairvenly,
        name_shopify: c.name_shopify,
        method_name: pl?.product_methods?.name ?? "",
        length_value: pl?.value ?? "",
      };
    });
}
