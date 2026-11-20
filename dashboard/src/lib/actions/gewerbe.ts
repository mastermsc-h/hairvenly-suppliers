"use server";

import { requireFeature } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";

/** Notiz zu einem Gewerbekunden speichern (leer = löschen). */
export async function speichereGewerbeNotiz(customerId: number, notiz: string): Promise<{ ok: true; am: string; von: string | null } | { ok: false; error: string }> {
  const profile = await requireFeature("finances");
  if (!Number.isSafeInteger(customerId) || customerId <= 0) return { ok: false, error: "Ungültiger Kunde" };
  const text = (notiz ?? "").slice(0, 2000).trim();
  const sb = createServiceClient();
  const am = new Date().toISOString();
  const { error } = text
    ? await sb.from("gewerbe_notizen").upsert({ customer_id: customerId, notiz: text, geaendert_von: profile.id, geaendert_am: am }, { onConflict: "customer_id" })
    : await sb.from("gewerbe_notizen").delete().eq("customer_id", customerId);
  return error ? { ok: false, error: error.message } : { ok: true, am, von: profile.display_name ?? profile.username ?? null };
}
