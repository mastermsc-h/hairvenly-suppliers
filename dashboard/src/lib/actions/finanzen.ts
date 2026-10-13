"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireFeature } from "@/lib/auth";
import type { FinanzInput, FinanzMonatsdaten } from "@/lib/types";

const PATH = "/finances/overview";

/** Alle gespeicherten Monate eines Jahres. */
export async function fetchFinanzJahr(jahr: number): Promise<FinanzMonatsdaten[]> {
  await requireFeature("finances");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("finanz_monatsdaten")
    .select("*")
    .eq("jahr", jahr)
    .order("monat", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as FinanzMonatsdaten[];
}

const n = (v: unknown): number => {
  const x = typeof v === "number" ? v : Number(v);
  return Number.isFinite(x) ? x : 0;
};
const s = (v: unknown): string => String(v ?? "").slice(0, 200);

/** Eingaben serverseitig auf das erwartete Shape zwingen (kein fremdes jsonb durchreichen). */
function sanitize(input: FinanzInput): FinanzInput {
  return {
    salonBrutto: n(input.salonBrutto),
    salonMaterialRate: n(input.salonMaterialRate),
    shopBrutto: n(input.shopBrutto),
    shopMaterialRate: n(input.shopMaterialRate),
    shopFeeRate: n(input.shopFeeRate),
    ustRate: n(input.ustRate),
    employees: (Array.isArray(input.employees) ? input.employees : [])
      .slice(0, 200)
      .map((e) => ({ name: s(e?.name), brutto: n(e?.brutto) })),
    agRate: n(input.agRate),
    shopifyPlan: n(input.shopifyPlan),
    shopifyPos: n(input.shopifyPos),
    shopifyApps: n(input.shopifyApps),
    shippingCount: n(input.shippingCount),
    shippingPrice: n(input.shippingPrice),
    otherExpenses: (Array.isArray(input.otherExpenses) ? input.otherExpenses : [])
      .slice(0, 200)
      .map((e) => ({ label: s(e?.label), netto: n(e?.netto), ustRate: n(e?.ustRate) })),
    gewstHebesatz: n(input.gewstHebesatz),
    gewstFreibetrag: n(input.gewstFreibetrag),
  };
}

/** Monat speichern (Upsert auf jahr+monat). */
export async function saveFinanzMonat(jahr: number, monat: number, daten: FinanzInput) {
  await requireFeature("finances");
  if (!Number.isInteger(jahr) || jahr < 2000 || jahr > 2100) return { ok: false, error: "Ungültiges Jahr" };
  if (!Number.isInteger(monat) || monat < 1 || monat > 12) return { ok: false, error: "Ungültiger Monat" };
  const supabase = await createClient();
  const { error } = await supabase
    .from("finanz_monatsdaten")
    .upsert({ jahr, monat, daten: sanitize(daten) }, { onConflict: "jahr,monat" });
  if (error) return { ok: false, error: error.message };
  revalidatePath(PATH);
  return { ok: true };
}

/** Gespeicherten Monat löschen (zurück auf "keine Daten"). */
export async function deleteFinanzMonat(jahr: number, monat: number) {
  await requireFeature("finances");
  const supabase = await createClient();
  const { error } = await supabase
    .from("finanz_monatsdaten")
    .delete()
    .eq("jahr", jahr)
    .eq("monat", monat);
  if (error) return { ok: false, error: error.message };
  revalidatePath(PATH);
  return { ok: true };
}
