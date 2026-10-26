"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireFeature } from "@/lib/auth";
import { syncShopifyUmsatz } from "@/lib/shopify-umsatz";
import type { FinanzInput, FinanzMitarbeiter, FinanzMonatsdaten, ShopifyUmsatzMonat } from "@/lib/types";

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

const toUmsatz = (r: Record<string, unknown>): ShopifyUmsatzMonat => ({
  monat: String(r.monat),
  brutto: n(r.brutto),
  erstattet: n(r.erstattet),
  netto: n(r.netto),
  bestellungen: n(r.bestellungen),
  kanaele: (r.kanaele ?? {}) as Record<string, number>,
  stand: String(r.stand),
});

/** Shopify-Umsätze eines Jahres (täglich per Cron /api/cron/shopify-umsatz aktualisiert). */
export async function fetchShopifyUmsatzJahr(jahr: number): Promise<ShopifyUmsatzMonat[]> {
  await requireFeature("finances");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("shopify_umsatz_monat")
    .select("*")
    .gte("monat", `${jahr}-01`)
    .lte("monat", `${jahr}-12`)
    .order("monat", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []).map(toUmsatz);
}

/** Einen Monat sofort neu aus Shopify holen (Button „Aktualisieren"). */
export async function aktualisiereShopifyUmsatz(
  jahr: number,
  monat: number,
): Promise<{ ok: true; umsatz: ShopifyUmsatzMonat } | { ok: false; error: string }> {
  await requireFeature("finances");
  if (!Number.isInteger(jahr) || !Number.isInteger(monat) || monat < 1 || monat > 12) {
    return { ok: false, error: "Ungültiger Monat" };
  }
  const key = `${jahr}-${String(monat).padStart(2, "0")}`;
  try {
    const sb = createServiceClient();
    const res = await syncShopifyUmsatz([key], Date.now() + 50_000, sb);
    if (!res.erledigt.length) return { ok: false, error: "Shopify hat zu lange gebraucht — bitte nochmal versuchen" };
    const { data, error } = await sb.from("shopify_umsatz_monat").select("*").eq("monat", key).single();
    if (error) return { ok: false, error: error.message };
    revalidatePath(PATH);
    return { ok: true, umsatz: toUmsatz(data) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Aktuelle Brutto-Gehälter aller aktiven Mitarbeiter aus dem Mitarbeiter-Bereich
 * (staff_members + staff_salary_changes, neuester wirksamer Eintrag = aktuell).
 * Gehälter sind strikt Admin-only (role === "admin") — wie im Staff-Bereich.
 */
export async function fetchStaffGehaelter(): Promise<FinanzMitarbeiter[]> {
  const profile = await requireFeature("finances");
  if (profile.role !== "admin") return [];
  const svc = createServiceClient();

  const { data: members, error } = await svc
    .from("staff_members")
    .select("id, name, is_trainee")
    .eq("active", true)
    .order("name", { ascending: true });
  if (error) throw new Error(error.message);

  const { data: salaries, error: err2 } = await svc
    .from("staff_salary_changes")
    .select("staff_id, amount, effective_date")
    .order("effective_date", { ascending: false });
  if (err2) throw new Error(err2.message);

  const today = new Date().toISOString().slice(0, 10);
  const current = new Map<string, number>();
  for (const s of salaries ?? []) {
    if (current.has(s.staff_id)) continue;
    // Einträge sind absteigend sortiert: erster mit effective_date <= heute gewinnt
    if (s.effective_date && s.effective_date > today) continue;
    current.set(s.staff_id, Number(s.amount) || 0);
  }
  // Mitarbeiter, deren einziger Eintrag in der Zukunft liegt: neuesten nehmen statt 0
  for (const s of salaries ?? []) {
    if (!current.has(s.staff_id)) current.set(s.staff_id, Number(s.amount) || 0);
  }

  return (members ?? []).map((m) => ({
    name: m.is_trainee ? `${m.name} (Azubi)` : m.name,
    brutto: current.get(m.id) ?? 0,
  }));
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
    shopManuell: input.shopManuell === true,
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
