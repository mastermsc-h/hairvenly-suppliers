"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { requireProfile } from "@/lib/auth";
import { speichereHealthSnapshot, type HealthDetails } from "@/lib/health";

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
  details: HealthDetails | null;
  auto: boolean;
  created_at: string;
}

/**
 * Speichert einen neuen Verlaufs-Eintrag. Konten, Lieferanten-Schulden und Steuern kommen
 * automatisch (lib/health); manuell sind nur die Ergänzungen + Notiz. Die Ergänzungen gelten
 * ab jetzt auch für die täglichen Auto-Einträge.
 */
export async function saveHealthSnapshot(formData: FormData): Promise<{ ok?: boolean; error?: string }> {
  const profile = await requireProfile();
  if (!profile.is_admin) return { error: "Nur Admins" };

  const num = (key: string): number => {
    const raw = String(formData.get(key) ?? "").trim().replace(",", ".");
    const n = Number(raw);
    return Number.isFinite(n) ? n : 0;
  };

  const res = await speichereHealthSnapshot(createServiceClient(), {
    auto: false,
    note: String(formData.get("note") ?? "").trim() || null,
    createdBy: profile.id,
    ergaenzungen: {
      weitere_schulden_eur: num("weitere_schulden_eur"),
      steuer_rueckstellung_eur: num("steuer_rueckstellung_eur"),
    },
  });
  if (!res.ok) return { error: res.error };

  revalidatePath("/health");
  return { ok: true };
}
