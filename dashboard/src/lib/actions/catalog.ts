"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth";
import type { CatalogMethod, CatalogLength, ProductColor, ProductMethod, ProductLength } from "@/lib/types";

// ── Read (no auth required beyond RLS) ──────────────────────────

/** Load full catalog tree for a supplier: methods → lengths → colors */
export async function loadCatalog(supplierId: string): Promise<CatalogMethod[]> {
  const supabase = await createClient();

  const { data: methods } = await supabase
    .from("product_methods")
    .select("*")
    .eq("supplier_id", supplierId)
    .order("sort_order");

  if (!methods || methods.length === 0) return [];

  const methodIds = methods.map((m) => m.id);

  const { data: lengths } = await supabase
    .from("product_lengths")
    .select("*")
    .in("method_id", methodIds)
    .order("sort_order");

  const lengthIds = (lengths ?? []).map((l) => l.id);

  const { data: colors } = await supabase
    .from("product_colors")
    .select("*")
    .in("length_id", lengthIds.length > 0 ? lengthIds : ["__none__"])
    .order("sort_order");

  // Assemble tree
  const colorsByLength = new Map<string, ProductColor[]>();
  for (const c of colors ?? []) {
    const arr = colorsByLength.get(c.length_id) ?? [];
    arr.push(c as ProductColor);
    colorsByLength.set(c.length_id, arr);
  }

  const lengthsByMethod = new Map<string, CatalogLength[]>();
  for (const l of lengths ?? []) {
    const arr = lengthsByMethod.get(l.method_id) ?? [];
    arr.push({ ...(l as ProductLength), colors: colorsByLength.get(l.id) ?? [] });
    lengthsByMethod.set(l.method_id, arr);
  }

  return methods.map((m) => ({
    ...(m as ProductMethod),
    lengths: lengthsByMethod.get(m.id) ?? [],
  }));
}

/** Load catalog for ALL suppliers at once (for the wizard) */
export async function loadAllCatalogs(): Promise<Record<string, CatalogMethod[]>> {
  const supabase = await createClient();

  const { data: methods } = await supabase
    .from("product_methods")
    .select("*")
    .order("sort_order");

  if (!methods || methods.length === 0) return {};

  const methodIds = methods.map((m) => m.id);

  const { data: lengths } = await supabase
    .from("product_lengths")
    .select("*")
    .in("method_id", methodIds)
    .order("sort_order");

  const lengthIds = (lengths ?? []).map((l) => l.id);

  const { data: colors } = await supabase
    .from("product_colors")
    .select("*")
    .in("length_id", lengthIds.length > 0 ? lengthIds : ["__none__"])
    .order("sort_order");

  // Assemble tree grouped by supplier
  const colorsByLength = new Map<string, ProductColor[]>();
  for (const c of colors ?? []) {
    const arr = colorsByLength.get(c.length_id) ?? [];
    arr.push(c as ProductColor);
    colorsByLength.set(c.length_id, arr);
  }

  const lengthsByMethod = new Map<string, CatalogLength[]>();
  for (const l of lengths ?? []) {
    const arr = lengthsByMethod.get(l.method_id) ?? [];
    arr.push({ ...(l as ProductLength), colors: colorsByLength.get(l.id) ?? [] });
    lengthsByMethod.set(l.method_id, arr);
  }

  const result: Record<string, CatalogMethod[]> = {};
  for (const m of methods) {
    const suppId = m.supplier_id as string;
    if (!result[suppId]) result[suppId] = [];
    result[suppId].push({
      ...(m as ProductMethod),
      lengths: lengthsByMethod.get(m.id) ?? [],
    });
  }

  return result;
}

// ── Mutations (admin only) ──────────────────────────────────────

export async function createMethod(_prev: unknown, formData: FormData) {
  await requireAdmin();
  const supabase = await createClient();

  const supplier_id = formData.get("supplier_id") as string;
  const name = (formData.get("name") as string)?.trim();
  if (!supplier_id || !name) return { error: "Supplier und Name erforderlich" };

  const { error } = await supabase
    .from("product_methods")
    .insert({ supplier_id, name, sort_order: 99 });

  if (error) return { error: error.message };
  revalidatePath("/catalog");
  return { ok: true };
}

export async function updateMethod(id: string, formData: FormData) {
  await requireAdmin();
  const supabase = await createClient();

  const name = (formData.get("name") as string)?.trim();
  const sort_order = parseInt(formData.get("sort_order") as string) || 0;

  const { error } = await supabase
    .from("product_methods")
    .update({ name, sort_order })
    .eq("id", id);

  if (error) return { error: error.message };
  revalidatePath("/catalog");
  return { ok: true };
}

export async function deleteMethod(id: string) {
  await requireAdmin();
  const supabase = await createClient();

  const { error } = await supabase.from("product_methods").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/catalog");
  return { ok: true };
}

export async function createLength(_prev: unknown, formData: FormData) {
  await requireAdmin();
  const supabase = await createClient();

  const method_id = formData.get("method_id") as string;
  const value = (formData.get("value") as string)?.trim();
  const unit = (formData.get("unit") as string)?.trim() || "g";
  if (!method_id || !value) return { error: "Method und Wert erforderlich" };

  const { error } = await supabase
    .from("product_lengths")
    .insert({ method_id, value, unit, sort_order: 99 });

  if (error) return { error: error.message };
  revalidatePath("/catalog");
  return { ok: true };
}

export async function deleteLength(id: string) {
  await requireAdmin();
  const supabase = await createClient();

  const { error } = await supabase.from("product_lengths").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/catalog");
  return { ok: true };
}

export async function createColor(_prev: unknown, formData: FormData) {
  await requireAdmin();
  const supabase = await createClient();

  const length_id = formData.get("length_id") as string;
  const name_hairvenly = (formData.get("name_hairvenly") as string)?.trim();
  const name_supplier = (formData.get("name_supplier") as string)?.trim() || null;
  const name_shopify = (formData.get("name_shopify") as string)?.trim() || null;
  if (!length_id || !name_hairvenly) return { error: "Length und Hairvenly-Name erforderlich" };

  const { error } = await supabase
    .from("product_colors")
    .insert({ length_id, name_hairvenly, name_supplier, name_shopify, sort_order: 99 });

  if (error) return { error: error.message };
  revalidatePath("/catalog");
  return { ok: true };
}

export async function updateColor(id: string, formData: FormData) {
  await requireAdmin();
  const supabase = await createClient();

  const name_hairvenly = (formData.get("name_hairvenly") as string)?.trim();
  const name_supplier = (formData.get("name_supplier") as string)?.trim() || null;
  const name_shopify = (formData.get("name_shopify") as string)?.trim() || null;

  const { error } = await supabase
    .from("product_colors")
    .update({ name_hairvenly, name_supplier, name_shopify })
    .eq("id", id);

  if (error) return { error: error.message };
  revalidatePath("/catalog");
  return { ok: true };
}

export async function deleteColor(id: string) {
  await requireAdmin();
  const supabase = await createClient();

  const { error } = await supabase.from("product_colors").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/catalog");
  return { ok: true };
}

// ── Full Catalog Sync (Order Sheets + Shopify) ──────────────────

export async function syncCatalogFromSheets(supplierId: string): Promise<{
  methodsCreated?: number;
  lengthsCreated?: number;
  colorsCreated?: number;
  hairvenlyMatched?: number;
  total?: number;
  error?: string;
}> {
  await requireAdmin();
  const supabase = await createClient();

  const { data: supplier } = await supabase.from("suppliers").select("name").eq("id", supplierId).single();
  if (!supplier) return { error: "Lieferant nicht gefunden" };

  const lower = supplier.name.toLowerCase();
  const isAmanda = lower.includes("amanda");
  const isEyfel = lower.includes("eyfel") || lower.includes("ebru");
  if (!isAmanda && !isEyfel) return { error: `Kein Sheet für "${supplier.name}" konfiguriert` };

  // 1) Read Shopify products — THIS IS THE SOURCE OF TRUTH
  const { importShopifyNames, COLLECTION_TO_METHOD } = await import("@/lib/google-sheets");
  const shopifyTabName = isAmanda ? "Russisch - GLATT" : "Usbekisch - WELLIG";
  const shopifyResult = await importShopifyNames(shopifyTabName);
  if ("error" in shopifyResult) return { error: shopifyResult.error };
  const shopifyProducts = shopifyResult.products;

  // 2) Read Hairvenly color codes from order sheets — for lookup only
  const orderSheetId = isAmanda
    ? process.env.GOOGLE_SHEET_AMANDA!
    : process.env.GOOGLE_SHEET_CHINA!;

  const { importColorsFromOrderSheets } = await import("@/lib/google-sheets");
  const orderResult = await importColorsFromOrderSheets(orderSheetId, isAmanda);
  // Build lookup: method → Set of hairvenly color names
  const hairvenlyLookup = new Map<string, Set<string>>();
  if (!("error" in orderResult)) {
    for (const c of orderResult.colors) {
      const key = c.method.toLowerCase();
      if (!hairvenlyLookup.has(key)) hairvenlyLookup.set(key, new Set());
      hairvenlyLookup.get(key)!.add(c.colorName);
    }
  }

  // 3) For each Shopify product: ensure method + length exist, then create/update color
  let methodsCreated = 0, lengthsCreated = 0, colorsCreated = 0, hairvenlyMatched = 0;
  const seen = new Set<string>(); // Avoid processing duplicates

  for (const product of shopifyProducts) {
    const methodName = COLLECTION_TO_METHOD[product.collection.toLowerCase()];
    if (!methodName) continue;

    // Extract length from collection
    const collLower = product.collection.toLowerCase();
    let targetLength: string | null = null;
    const lengthMatch = collLower.match(/(\d+)\s*cm/);
    if (lengthMatch) targetLength = lengthMatch[1] + "cm";
    if (methodName === "Clip-ins" && product.variant) targetLength = product.variant + "g";
    if (!targetLength) {
      // Default length for methods without explicit length (e.g. "Ponytail")
      targetLength = isAmanda ? "60cm" : "65cm";
    }

    const dedupeKey = `${methodName}|${targetLength}|${product.shopifyName}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);

    // Ensure method exists
    let { data: existingMethod } = await supabase
      .from("product_methods")
      .select("id")
      .eq("supplier_id", supplierId)
      .eq("name", methodName)
      .single();

    if (!existingMethod) {
      const { data: newMethod } = await supabase
        .from("product_methods")
        .insert({ supplier_id: supplierId, name: methodName, sort_order: 99 })
        .select("id")
        .single();
      existingMethod = newMethod;
      if (newMethod) methodsCreated++;
    }
    if (!existingMethod) continue;

    // Ensure length exists
    let { data: existingLength } = await supabase
      .from("product_lengths")
      .select("id")
      .eq("method_id", existingMethod.id)
      .eq("value", targetLength)
      .single();

    if (!existingLength) {
      const { data: newLength } = await supabase
        .from("product_lengths")
        .insert({ method_id: existingMethod.id, value: targetLength, unit: "g", sort_order: 99 })
        .select("id")
        .single();
      existingLength = newLength;
      if (newLength) lengthsCreated++;
    }
    if (!existingLength) continue;

    // Try to find matching Hairvenly color code from order sheets
    const shopifyColor = product.colorName.toLowerCase();
    // Also check all method variations (e.g. "Classic Weft" might be "Classic Tressen" in orders)
    const methodVariations = [methodName.toLowerCase()];
    if (methodName === "Classic Weft") methodVariations.push("classic tressen", "classic weft");
    if (methodName === "Classic Tressen") methodVariations.push("classic weft", "classic tressen");

    let allMethodColors = new Set<string>();
    for (const mv of methodVariations) {
      const colors = hairvenlyLookup.get(mv);
      if (colors) for (const c of colors) allMethodColors.add(c);
    }
    // Also add colors from ALL methods as fallback (color codes like "1A" are universal)
    const allColors = new Set<string>();
    for (const colorSet of hairvenlyLookup.values()) {
      for (const c of colorSet) allColors.add(c);
    }

    let bestHairvenlyName = ""; // Empty = needs manual assignment
    let matched = false;

    // 1) Exact match in same method
    for (const hvColor of allMethodColors) {
      const hvLower = hvColor.toLowerCase();
      if (hvLower === shopifyColor) {
        bestHairvenlyName = hvColor;
        hairvenlyMatched++;
        matched = true;
        break;
      }
    }
    // 2) Starts-with match in same method
    if (!matched) {
      for (const hvColor of allMethodColors) {
        const hvLower = hvColor.toLowerCase();
        if (shopifyColor.startsWith(hvLower + " ") || shopifyColor.startsWith(hvLower + "-") || hvLower.startsWith(shopifyColor)) {
          bestHairvenlyName = hvColor;
          hairvenlyMatched++;
          matched = true;
          break;
        }
      }
    }
    // 3) Exact match across all methods
    if (!matched) {
      for (const hvColor of allColors) {
        const hvLower = hvColor.toLowerCase();
        if (hvLower === shopifyColor) {
          bestHairvenlyName = hvColor;
          hairvenlyMatched++;
          matched = true;
          break;
        }
      }
    }
    // 4) Starts-with across all methods (longest match first to prefer "Pearl White" over "Pearl")
    if (!matched) {
      const sorted = [...allColors].sort((a, b) => b.length - a.length);
      for (const hvColor of sorted) {
        const hvLower = hvColor.toLowerCase();
        if (hvLower.length >= 2 && (shopifyColor.startsWith(hvLower + " ") || shopifyColor.startsWith(hvLower + "-") || shopifyColor === hvLower)) {
          bestHairvenlyName = hvColor;
          hairvenlyMatched++;
          matched = true;
          break;
        }
      }
    }
    // 5) If still no match, try to extract a short color name from Shopify name
    if (!bestHairvenlyName) {
      // Take first word(s) that look like a color code (before descriptive words)
      const raw = product.shopifyName.replace(/^#/, "").trim();
      // Pattern: Color codes are usually short (1-3 words, often uppercase/numbers)
      // Stop at common descriptive words
      const stopWords = ["SCHWARZE", "DUNKEL", "HELL", "KÜHLE", "BRAUN", "BLOND", "GOLD", "SAMT", "MOKKA", "ASCH", "REHBRAUN", "HONIG", "SAND", "PLATINBLOND", "KUPFER", "KIRSCHE", "US ", "WELLIGE", "RUSSISCHE", "STANDARD", "MINI ", "TAPE ", "BONDING", "INVISIBLE", "CLASSIC", "GENIUS", "CLIP ", "TRESSEN", "WEFT ", "EXTENSIONS"];
      let shortName = raw;
      for (const sw of stopWords) {
        const idx = raw.toUpperCase().indexOf(sw);
        if (idx > 0 && idx < shortName.length) {
          shortName = raw.substring(0, idx).trim();
        }
      }
      // Remove trailing special chars
      shortName = shortName.replace(/[♡\-–,\s]+$/, "").trim();
      bestHairvenlyName = shortName || product.colorName;
    }

    // Check if this Shopify product already exists (by shopify name)
    const { data: byShopify } = await supabase
      .from("product_colors")
      .select("id")
      .eq("length_id", existingLength.id)
      .eq("name_shopify", product.shopifyName)
      .limit(1)
      .single();

    if (byShopify) continue; // Already exists with this Shopify name

    // Check if a matching hairvenly name exists (to update it with shopify name)
    if (bestHairvenlyName) {
      const { data: byHairvenly } = await supabase
        .from("product_colors")
        .select("id, name_shopify")
        .eq("length_id", existingLength.id)
        .ilike("name_hairvenly", bestHairvenlyName)
        .limit(1)
        .single();

      if (byHairvenly) {
        if (!byHairvenly.name_shopify) {
          await supabase.from("product_colors").update({ name_shopify: product.shopifyName }).eq("id", byHairvenly.id);
        }
        continue;
      }
    }

    // No match — create new entry. Use shopify name as unique hairvenly fallback if needed
    let insertName = bestHairvenlyName || product.colorName;
    const { error: insertErr } = await supabase.from("product_colors").insert({
      length_id: existingLength.id,
      name_hairvenly: insertName,
      name_shopify: product.shopifyName,
      sort_order: 99,
    });

    if (insertErr && insertErr.code === "23505") {
      // Unique constraint on name_hairvenly — try with shopify suffix
      insertName = `${insertName} (${product.collection.split(" ")[0]})`;
      await supabase.from("product_colors").insert({
        length_id: existingLength.id,
        name_hairvenly: insertName,
        name_shopify: product.shopifyName,
        sort_order: 99,
      });
    }
    colorsCreated++;
  }

  revalidatePath("/catalog");
  return {
    methodsCreated,
    lengthsCreated,
    colorsCreated,
    hairvenlyMatched,
    total: shopifyProducts.length,
  };
}

// ── Shopify Name Import (legacy) ────────────────────────────────

export async function importShopifyNamesForSupplier(supplierId: string): Promise<{
  matched?: number;
  created?: number;
  total?: number;
  unmatched?: string[];
  error?: string;
}> {
  await requireAdmin();
  const supabase = await createClient();

  // Get supplier name to determine which tab to read
  const { data: supplier } = await supabase.from("suppliers").select("name").eq("id", supplierId).single();
  if (!supplier) return { error: "Lieferant nicht gefunden" };

  const lower = supplier.name.toLowerCase();
  let tabName: string;
  if (lower.includes("amanda")) {
    tabName = "Russisch - GLATT";
  } else if (lower.includes("eyfel") || lower.includes("ebru")) {
    tabName = "Usbekisch - WELLIG";
  } else {
    return { error: `Kein Shopify-Sheet für "${supplier.name}" konfiguriert` };
  }

  const { importShopifyNames, COLLECTION_TO_METHOD } = await import("@/lib/google-sheets");
  const result = await importShopifyNames(tabName);
  if ("error" in result) return { error: result.error };

  // Load current catalog for this supplier
  const catalog = await loadCatalog(supplierId);
  if (catalog.length === 0) return { error: "Kein Katalog für diesen Lieferanten" };

  let matched = 0;
  let created = 0;
  const unmatched: string[] = [];
  const updates: { colorId: string; shopifyName: string }[] = [];
  const seen = new Set<string>(); // Prevent duplicate updates

  for (const product of result.products) {
    // Map collection → catalog method
    const methodName = COLLECTION_TO_METHOD[product.collection.toLowerCase()];
    if (!methodName) continue;

    // Extract length from collection name (e.g. "Tapes Wellig 45cm" → "45cm")
    const collLower = product.collection.toLowerCase();
    let targetLength: string | null = null;
    const lengthMatch = collLower.match(/(\d+)\s*cm/);
    if (lengthMatch) {
      targetLength = lengthMatch[1] + "cm";
    }
    // For Clip-ins, use the variant as length (e.g. "100" → "100g")
    if (methodName === "Clip-ins" && product.variant) {
      targetLength = product.variant + "g";
    }

    // Find the method in catalog
    const catalogMethod = catalog.find((m) => m.name.toLowerCase() === methodName.toLowerCase());
    if (!catalogMethod) continue;

    // Find matching length — if we know the target length, only look there
    const candidateLengths = targetLength
      ? catalogMethod.lengths.filter((l) => l.value.toLowerCase() === targetLength!.toLowerCase())
      : catalogMethod.lengths;

    if (candidateLengths.length === 0) continue;

    // Find matching color by name_hairvenly within the correct length
    let found = false;
    for (const length of candidateLengths) {
      for (const color of length.colors) {
        const nh = color.name_hairvenly.toLowerCase();
        const cn = product.colorName.toLowerCase();
        if (nh === cn || cn.startsWith(nh) || nh.startsWith(cn)) {
          const key = `${color.id}-${product.shopifyName}`;
          if (!seen.has(key)) {
            seen.add(key);
            if (color.name_shopify !== product.shopifyName) {
              updates.push({ colorId: color.id, shopifyName: product.shopifyName });
            }
            matched++;
          }
          found = true;
          break;
        }
      }
      if (found) break;
    }

    if (!found) {
      // AUTO-CREATE: Add as new color entry in the correct method+length
      const targetLengthObj = candidateLengths[0]; // Use first matching length
      if (targetLengthObj) {
        // Check if this shopify name was already added (avoid duplicates)
        const alreadyExists = targetLengthObj.colors.some(
          (c) => c.name_shopify === product.shopifyName
        );
        if (!alreadyExists) {
          const { error: insertErr } = await supabase.from("product_colors").insert({
            length_id: targetLengthObj.id,
            name_hairvenly: product.colorName, // Best guess from extracted color
            name_shopify: product.shopifyName,
            sort_order: 99,
          });
          if (!insertErr) {
            created++;
          } else {
            // Might fail on unique constraint if name_hairvenly already exists
            // In that case, update the existing entry's shopify name
            const existing = targetLengthObj.colors.find(
              (c) => c.name_hairvenly.toLowerCase() === product.colorName.toLowerCase()
            );
            if (existing && !existing.name_shopify) {
              await supabase.from("product_colors")
                .update({ name_shopify: product.shopifyName })
                .eq("id", existing.id);
              matched++;
            } else {
              const entry = `${product.shopifyName} (${product.collection})`;
              if (!unmatched.includes(entry)) unmatched.push(entry);
            }
          }
        }
      } else {
        const entry = `${product.shopifyName} (${product.collection})`;
        if (!unmatched.includes(entry)) unmatched.push(entry);
      }
    }
  }

  // Apply updates for matched colors
  for (const update of updates) {
    await supabase
      .from("product_colors")
      .update({ name_shopify: update.shopifyName })
      .eq("id", update.colorId);
  }

  revalidatePath("/catalog");
  return { matched, created, total: result.products.length, unmatched };
}
