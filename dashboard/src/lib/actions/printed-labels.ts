"use server";

import { createClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";

export interface PrintedLabelsRow {
  barcode: string;
  productTitle: string;
  collection?: string | null;
  quantity: number;
}

export interface PrintedLabelsSummary {
  totalPrinted: number;
  lastPrintedAt: string | null;
}

/**
 * Speichert eine Bulk-Aufnahme von gedruckten Etiketten.
 * Wird aufgerufen wenn der User im Modal auf "Drucken" klickt.
 */
export async function recordPrintedLabels(
  rows: PrintedLabelsRow[],
): Promise<{ success: boolean; error?: string }> {
  const profile = await requireProfile();
  if (!profile.is_admin) return { success: false, error: "Forbidden" };
  if (rows.length === 0) return { success: true };

  const supabase = await createClient();
  const inserts = rows
    .filter((r) => r.quantity > 0 && r.barcode)
    .map((r) => ({
      barcode: r.barcode,
      product_title: r.productTitle,
      collection: r.collection ?? null,
      quantity: r.quantity,
      printed_by: profile.id,
    }));
  if (inserts.length === 0) return { success: true };

  const { error } = await supabase.from("printed_labels").insert(inserts);
  if (error) return { success: false, error: error.message };
  return { success: true };
}

/**
 * Setzt den 'Bisher gedruckt'-Counter für einen Barcode auf 0 zurück
 * (löscht alle Einträge in printed_labels für diesen Barcode).
 */
export async function resetPrintedForBarcode(
  barcode: string,
): Promise<{ success: boolean; error?: string }> {
  const profile = await requireProfile();
  if (!profile.is_admin) return { success: false, error: "Forbidden" };
  if (!barcode) return { success: false, error: "Kein Barcode" };

  const supabase = await createClient();
  const { error } = await supabase.from("printed_labels").delete().eq("barcode", barcode);
  if (error) return { success: false, error: error.message };
  return { success: true };
}

/**
 * Holt das Aggregat aller bisher gedruckten Etiketten pro Barcode.
 * Returns Map<barcode, { totalPrinted, lastPrintedAt }>.
 */
export async function getPrintedSummary(): Promise<Record<string, PrintedLabelsSummary>> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("v_printed_labels_summary")
    .select("barcode, total_printed, last_printed_at");
  if (error || !data) return {};

  const map: Record<string, PrintedLabelsSummary> = {};
  for (const row of data as { barcode: string; total_printed: number; last_printed_at: string | null }[]) {
    map[row.barcode] = {
      totalPrinted: row.total_printed,
      lastPrintedAt: row.last_printed_at,
    };
  }
  return map;
}
