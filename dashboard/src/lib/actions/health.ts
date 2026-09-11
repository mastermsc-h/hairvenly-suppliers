"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";

export interface HealthSnapshot {
  id: string;
  treatwell_eur: number;
  shopify_eur: number;
  targobank_eur: number;
  debt_eur: number;
  stock_kg_russian: number | null;
  stock_kg_uzbek: number | null;
  score: number | null;
  note: string | null;
  created_at: string;
}

/**
 * Kennzahl-Formel (User-Definition):
 *   score = lager_kg + (konten_summe_eur / 1000) − (schulden_eur / 1000)
 * Beispiel: 440 kg + 200.000 € − 300.000 € → 440 + 200 − 300 = 340
 */
export async function computeScore(
  stockKg: number,
  treatwell: number,
  shopify: number,
  targobank: number,
  debt: number,
): Promise<number> {
  const moneyK = (treatwell + shopify + targobank) / 1000;
  const debtK = debt / 1000;
  return Math.round((stockKg + moneyK - debtK) * 10) / 10;
}

/**
 * Speichert einen neuen Snapshot (append-only → Historie). Der beim
 * Speichern gültige Live-Lagerstand + Score werden mit eingefroren.
 */
export async function saveHealthSnapshot(formData: FormData): Promise<{ ok?: boolean; error?: string }> {
  const profile = await requireProfile();
  if (!profile.is_admin) return { error: "Nur Admins" };
  const supabase = await createClient();

  const num = (key: string): number => {
    const raw = String(formData.get(key) ?? "").trim().replace(",", ".");
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  };

  const treatwell = num("treatwell_eur");
  const shopify = num("shopify_eur");
  const targobank = num("targobank_eur");
  const debt = num("debt_eur");
  const note = String(formData.get("note") ?? "").trim() || null;

  // Live-kg beim Speichern einfrieren (best effort — Sheet kann leer sein)
  let ruKg: number | null = null;
  let uzKg: number | null = null;
  let score: number | null = null;
  try {
    const { getTotalStockKg } = await import("@/lib/stock-sheets");
    const stock = await getTotalStockKg();
    ruKg = stock.russianKg;
    uzKg = stock.uzbekKg;
    score = await computeScore(stock.totalKg, treatwell, shopify, targobank, debt);
  } catch (e) {
    console.warn("[saveHealthSnapshot] kg nicht lesbar:", e);
  }

  const { error } = await supabase.from("company_health_snapshots").insert({
    treatwell_eur: treatwell,
    shopify_eur: shopify,
    targobank_eur: targobank,
    debt_eur: debt,
    stock_kg_russian: ruKg,
    stock_kg_uzbek: uzKg,
    score,
    note,
    created_by: profile.id,
  });
  if (error) return { error: error.message };

  revalidatePath("/health");
  return { ok: true };
}
