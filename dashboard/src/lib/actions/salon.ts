"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import {
  lookupProductByBarcode,
  adjustShopifyInventoryByBarcode,
  adjustShopifyInventoryByItemId,
  fetchAllSalonVariants,
  type SalonPickableVariant,
} from "@/lib/shopify";
import {
  detectCategory,
  detectPackGrams,
  piecesToGrams,
  type SalonCategory,
} from "@/lib/salon/category";
import { parseLength, parseColor, parseQuality, type SalonQuality } from "@/lib/salon/parse";

export interface SalonProductInfo {
  /** leer wenn Pack keinen Barcode hat (Picker-Flow) */
  barcode: string;
  /** Shopify GID — fuer Lookup ohne Barcode */
  variantId: string | null;
  inventoryItemId: string | null;
  productTitle: string;
  variantTitle: string | null;
  imageUrl: string | null;
  category: SalonCategory;
  categoryLabel: string;
  divisible: boolean;
  gramsPerPiece: number | null;
  packGrams: number;
  lengthCm: number | null;
  color: string | null;
  quality: SalonQuality;
}

/** Erzeugt SalonProductInfo aus einer Shopify-Variante (vom Picker oder Barcode-Lookup). */
function variantToInfo(opts: {
  barcode: string;
  variantId: string | null;
  inventoryItemId: string | null;
  productTitle: string;
  variantTitle: string | null;
  imageUrl: string | null;
  collectionTitles: string[];
}): SalonProductInfo {
  const cat = detectCategory({
    productTitle: opts.productTitle,
    variantTitle: opts.variantTitle,
    collectionTitles: opts.collectionTitles,
  });
  const packGrams = detectPackGrams({
    productTitle: opts.productTitle,
    variantTitle: opts.variantTitle,
  });
  const lengthCm = parseLength({
    productTitle: opts.productTitle,
    variantTitle: opts.variantTitle,
  });
  const color = parseColor({
    productTitle: opts.productTitle,
    variantTitle: opts.variantTitle,
  });
  const quality = parseQuality({
    productTitle: opts.productTitle,
    variantTitle: opts.variantTitle,
    collectionTitles: opts.collectionTitles,
  });
  return {
    barcode: opts.barcode,
    variantId: opts.variantId,
    inventoryItemId: opts.inventoryItemId,
    productTitle: opts.productTitle,
    variantTitle: opts.variantTitle,
    imageUrl: opts.imageUrl,
    category: cat.category,
    categoryLabel: cat.label,
    divisible: cat.divisible,
    gramsPerPiece: cat.gramsPerPiece,
    packGrams,
    lengthCm,
    color,
    quality,
  };
}

/**
 * Barcode -> Produktinfo (mit Kategorie-Erkennung).
 * Wird sowohl im Entnehmen- als auch im Rueckgeben-Flow benutzt.
 */
export async function lookupSalonProduct(
  barcode: string,
): Promise<{ ok: true; product: SalonProductInfo } | { ok: false; error: string }> {
  const clean = barcode.trim();
  if (!clean) return { ok: false, error: "Kein Barcode" };
  try {
    // 1) Direkter Barcode-Lookup (gibt Variant- aber keine InventoryItem-Info zurueck)
    const matches = await lookupProductByBarcode(clean);
    if (!matches || matches.length === 0) {
      return { ok: false, error: "Barcode nicht in Shopify gefunden" };
    }
    const m = matches[0];
    // 2) Inventory-Item ueber den Picker-Cache nachziehen, damit auch der
    // Adjust spaeter in einem Call laeuft (kein zweiter Roundtrip)
    let inventoryItemId: string | null = null;
    try {
      const all = await fetchAllSalonVariants();
      const v = all.find((x) => x.variantId === m.variantId);
      inventoryItemId = v?.inventoryItemId ?? null;
    } catch {
      // ignorieren — Adjust faellt eh auf Barcode-Lookup zurueck
    }
    return {
      ok: true,
      product: variantToInfo({
        barcode: clean,
        variantId: m.variantId,
        inventoryItemId,
        productTitle: m.productTitle,
        variantTitle: m.variantTitle,
        imageUrl: m.imageUrl,
        collectionTitles: m.collectionTitles,
      }),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Lookup-Fehler" };
  }
}

/** Lookup per Variant-ID (Picker-Flow ohne Barcode). */
export async function lookupSalonProductByVariantId(
  variantId: string,
): Promise<{ ok: true; product: SalonProductInfo } | { ok: false; error: string }> {
  try {
    const all = await fetchAllSalonVariants();
    const v = all.find((x) => x.variantId === variantId);
    if (!v) return { ok: false, error: "Variante nicht gefunden" };
    return {
      ok: true,
      product: variantToInfo({
        barcode: v.barcode ?? "",
        variantId: v.variantId,
        inventoryItemId: v.inventoryItemId,
        productTitle: v.productTitle,
        variantTitle: v.variantTitle,
        imageUrl: v.imageUrl,
        collectionTitles: v.collectionTitles,
      }),
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Lookup-Fehler" };
  }
}

// ── Picker-Liste ────────────────────────────────────────────────

export interface SalonPickableProduct extends SalonProductInfo {
  // alle Felder von SalonProductInfo + nichts extra
  hasBarcode: boolean;
}

/**
 * Liefert alle Salon-pickbaren Produkte (Tape/Mini-Tape/Bonding/Tresse/Clip-In)
 * — gefiltert auf relevante Kategorien, mit Barcode optional.
 */
export async function listSalonPickableProducts(): Promise<{
  ok: true;
  products: SalonPickableProduct[];
} | { ok: false; error: string }> {
  try {
    const all: SalonPickableVariant[] = await fetchAllSalonVariants();
    const out: SalonPickableProduct[] = [];
    for (const v of all) {
      const info = variantToInfo({
        barcode: v.barcode ?? "",
        variantId: v.variantId,
        inventoryItemId: v.inventoryItemId,
        productTitle: v.productTitle,
        variantTitle: v.variantTitle,
        imageUrl: v.imageUrl,
        collectionTitles: v.collectionTitles,
      });
      // ALLE Varianten zeigen — auch unkategorisierte unter "Sonstiges".
      // Damit gibt es keine 'unsichtbaren' Shopify-Produkte fuer den Friseur.
      out.push({ ...info, hasBarcode: !!v.barcode });
    }
    // Sortierung: Kategorie -> Laenge -> Farbe -> Titel
    const catOrder: Record<string, number> = { tape: 0, mini_tape: 1, bonding: 2, tresse: 3, clip: 4, other: 5 };
    out.sort((a, b) => {
      const c = (catOrder[a.category] ?? 9) - (catOrder[b.category] ?? 9);
      if (c !== 0) return c;
      const la = a.lengthCm ?? 999;
      const lb = b.lengthCm ?? 999;
      if (la !== lb) return la - lb;
      return (a.color ?? "").localeCompare(b.color ?? "");
    });
    return { ok: true, products: out };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Fehler" };
  }
}

// ── Entnehmen ──────────────────────────────────────────────────

export async function recordEntnahme(input: {
  /** entweder barcode ODER variantId muss gesetzt sein */
  barcode?: string | null;
  variantId?: string | null;
  pin: string;
}): Promise<{ ok: true; id: string; employeeName: string } | { ok: false; error: string }> {
  const svc = createServiceClient();

  // Mitarbeiter per PIN finden
  const { data: emp, error: empErr } = await svc
    .from("salon_employees")
    .select("id, name")
    .eq("pin", input.pin)
    .eq("active", true)
    .maybeSingle();
  if (empErr) return { ok: false, error: empErr.message };
  if (!emp) return { ok: false, error: "PIN nicht erkannt" };

  // Produkt-Info via Barcode oder VariantId
  let lookup;
  if (input.barcode && input.barcode.trim()) {
    lookup = await lookupSalonProduct(input.barcode);
  } else if (input.variantId) {
    lookup = await lookupSalonProductByVariantId(input.variantId);
  } else {
    return { ok: false, error: "Barcode oder Produkt-Auswahl fehlt" };
  }
  if (!lookup.ok) return { ok: false, error: lookup.error };
  const p = lookup.product;

  const { data: row, error } = await svc
    .from("salon_entnahmen")
    .insert({
      employee_id: emp.id,
      barcode: p.barcode || null,
      variant_id: p.variantId,
      inventory_item_id: p.inventoryItemId,
      product_title: p.productTitle,
      variant_title: p.variantTitle,
      pack_grams: p.packGrams,
      category: p.category,
      length_cm: p.lengthCm,
      color: p.color,
      quality: p.quality,
      status: "open",
    })
    .select("id")
    .single();
  if (error || !row) return { ok: false, error: error?.message ?? "Insert fehlgeschlagen" };

  // Shopify-Bestand -1 (per InventoryItemId wenn vorhanden, sonst Barcode-Fallback)
  let adj;
  if (p.inventoryItemId) {
    adj = await adjustShopifyInventoryByItemId(p.inventoryItemId, -1, "other");
  } else if (p.barcode) {
    adj = await adjustShopifyInventoryByBarcode(p.barcode, -1, "other");
  } else {
    adj = { ok: false, error: "Weder InventoryItem noch Barcode bekannt" } as const;
  }
  if (!adj.ok) {
    await svc
      .from("salon_entnahmen")
      .update({ note: `Shopify-Adjust fehlgeschlagen: ${adj.error}` })
      .eq("id", row.id);
  }

  revalidatePath("/salon-admin");
  return { ok: true, id: row.id, employeeName: emp.name };
}

// ── Zurueckgeben ───────────────────────────────────────────────

/**
 * Findet die juengste offene Entnahme mit gleichem Barcode (Auto-Match).
 * Bei mehreren wird die aelteste offene zurueckgegeben (FIFO).
 */
export async function findOpenEntnahmenByBarcode(
  barcode: string,
): Promise<
  | { ok: true; entries: { id: string; employeeName: string; takenAt: string }[] }
  | { ok: false; error: string }
> {
  const svc = createServiceClient();
  const { data, error } = await svc
    .from("salon_entnahmen")
    .select("id, taken_at, salon_employees(name)")
    .eq("barcode", barcode.trim())
    .eq("status", "open")
    .order("taken_at", { ascending: true });
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    entries: (data ?? []).map((r) => ({
      id: r.id as string,
      employeeName:
        (r.salon_employees as unknown as { name: string } | null)?.name ?? "?",
      takenAt: r.taken_at as string,
    })),
  };
}

export async function findOpenEntnahmenByVariantId(
  variantId: string,
): Promise<
  | { ok: true; entries: { id: string; employeeName: string; takenAt: string }[] }
  | { ok: false; error: string }
> {
  const svc = createServiceClient();
  const { data, error } = await svc
    .from("salon_entnahmen")
    .select("id, taken_at, salon_employees(name)")
    .eq("variant_id", variantId)
    .eq("status", "open")
    .order("taken_at", { ascending: true });
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    entries: (data ?? []).map((r) => ({
      id: r.id as string,
      employeeName:
        (r.salon_employees as unknown as { name: string } | null)?.name ?? "?",
      takenAt: r.taken_at as string,
    })),
  };
}

export async function recordRueckgabeFull(
  entnahmeId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const svc = createServiceClient();

  const { data: ent, error: getErr } = await svc
    .from("salon_entnahmen")
    .select("id, pack_grams, status, barcode, inventory_item_id")
    .eq("id", entnahmeId)
    .single();
  if (getErr || !ent) return { ok: false, error: getErr?.message ?? "Entnahme nicht gefunden" };
  if (ent.status !== "open") return { ok: false, error: "Entnahme bereits geschlossen" };

  const { error } = await svc
    .from("salon_entnahmen")
    .update({
      status: "returned_full",
      closed_at: new Date().toISOString(),
      used_grams: 0,
      rest_grams: ent.pack_grams,
      rest_pieces: null,
    })
    .eq("id", entnahmeId);
  if (error) return { ok: false, error: error.message };

  // Shopify-Bestand +1 nur bei vollstaendiger Rueckgabe
  let adj;
  if (ent.inventory_item_id) {
    adj = await adjustShopifyInventoryByItemId(ent.inventory_item_id, +1, "restock");
  } else if (ent.barcode) {
    adj = await adjustShopifyInventoryByBarcode(ent.barcode, +1, "restock");
  } else {
    adj = { ok: false, error: "Weder InventoryItem noch Barcode gespeichert" } as const;
  }
  if (!adj.ok) {
    await svc
      .from("salon_entnahmen")
      .update({ note: `Shopify-Adjust (+1) fehlgeschlagen: ${adj.error}` })
      .eq("id", entnahmeId);
  }

  revalidatePath("/salon-admin");
  return { ok: true };
}

export async function recordRueckgabePartial(input: {
  entnahmeId: string;
  restPieces: number;
}): Promise<{ ok: true; restGrams: number; usedGrams: number } | { ok: false; error: string }> {
  const svc = createServiceClient();

  const { data: ent, error: getErr } = await svc
    .from("salon_entnahmen")
    .select("id, pack_grams, status, category, product_title, variant_title")
    .eq("id", input.entnahmeId)
    .single();
  if (getErr || !ent) return { ok: false, error: getErr?.message ?? "Entnahme nicht gefunden" };
  if (ent.status !== "open") return { ok: false, error: "Entnahme bereits geschlossen" };

  const restGrams = piecesToGrams(ent.category as SalonCategory, input.restPieces);
  if (restGrams == null) return { ok: false, error: "Kategorie nicht anbrechbar" };
  if (restGrams >= ent.pack_grams) {
    return { ok: false, error: `Rest (${restGrams}g) >= Pack (${ent.pack_grams}g)` };
  }
  const usedGrams = ent.pack_grams - restGrams;

  const { error: updErr } = await svc
    .from("salon_entnahmen")
    .update({
      status: "returned_partial",
      closed_at: new Date().toISOString(),
      used_grams: usedGrams,
      rest_grams: restGrams,
      rest_pieces: input.restPieces,
    })
    .eq("id", input.entnahmeId);
  if (updErr) return { ok: false, error: updErr.message };

  // Loose-Stock erhoehen
  const variantKey = ent.variant_title ?? null;
  let q = svc
    .from("salon_loose_stock")
    .select("id, total_grams")
    .eq("category", ent.category)
    .eq("product_title", ent.product_title);
  q = variantKey === null ? q.is("variant_title", null) : q.eq("variant_title", variantKey);
  const { data: existing } = await q.maybeSingle();

  if (existing) {
    await svc
      .from("salon_loose_stock")
      .update({
        total_grams: (existing.total_grams ?? 0) + Math.round(restGrams),
        updated_at: new Date().toISOString(),
      })
      .eq("id", existing.id);
  } else {
    await svc.from("salon_loose_stock").insert({
      category: ent.category,
      product_title: ent.product_title,
      variant_title: variantKey,
      total_grams: Math.round(restGrams),
      pack_target_grams: 25,
    });
  }

  revalidatePath("/salon-admin");
  return { ok: true, restGrams, usedGrams };
}

// ── Mitarbeiter-Verwaltung (Admin) ─────────────────────────────

export async function createSalonEmployee(input: {
  name: string;
  pin: string;
  color?: string;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  await requireProfile();
  if (!/^\d{4,6}$/.test(input.pin)) return { ok: false, error: "PIN: 4-6 Ziffern" };
  if (!input.name.trim()) return { ok: false, error: "Name fehlt" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("salon_employees")
    .insert({ name: input.name.trim(), pin: input.pin, color: input.color ?? null, active: true })
    .select("id")
    .single();
  if (error || !data) return { ok: false, error: error?.message ?? "Insert fehlgeschlagen" };
  revalidatePath("/salon-admin/mitarbeiter");
  return { ok: true, id: data.id };
}

export async function setSalonEmployeeActive(input: {
  id: string;
  active: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireProfile();
  const supabase = await createClient();
  const { error } = await supabase
    .from("salon_employees")
    .update({ active: input.active })
    .eq("id", input.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/salon-admin/mitarbeiter");
  return { ok: true };
}

export async function updateSalonEmployee(input: {
  id: string;
  name: string;
  pin: string;
  color?: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireProfile();
  if (!/^\d{4,6}$/.test(input.pin)) return { ok: false, error: "PIN: 4-6 Ziffern" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("salon_employees")
    .update({ name: input.name.trim(), pin: input.pin, color: input.color ?? null })
    .eq("id", input.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/salon-admin/mitarbeiter");
  return { ok: true };
}

// ── Geraete-Pairing ────────────────────────────────────────────
export async function pairDeviceWithToken(token: string): Promise<{ ok: boolean; error?: string }> {
  const expected = process.env.SALON_PAIRING_TOKEN;
  if (!expected) return { ok: false, error: "SALON_PAIRING_TOKEN nicht gesetzt" };
  if (token !== expected) return { ok: false, error: "Falscher Pairing-Code" };
  const { pairSalonDevice } = await import("@/lib/salon/auth");
  await pairSalonDevice();
  return { ok: true };
}
