"use server";

import { createClient } from "@/lib/supabase/server";
import { requireFeature } from "@/lib/auth";

/** Abgehakte Steuertipps: Tipp-Titel → Datum (ISO). */
export async function fetchSteuertippsUmgesetzt(): Promise<Record<string, string>> {
  await requireFeature("finances");
  const supabase = await createClient();
  const { data, error } = await supabase.from("steuertipps_umgesetzt").select("tipp, umgesetzt_am");
  if (error) throw new Error(error.message);
  return Object.fromEntries((data ?? []).map((r: { tipp: string; umgesetzt_am: string }) => [r.tipp, r.umgesetzt_am]));
}

/** Tipp als umgesetzt abhaken (an = true) oder wieder öffnen. */
export async function setSteuertippUmgesetzt(tipp: string, an: boolean): Promise<{ ok: boolean; am?: string; error?: string }> {
  const profile = await requireFeature("finances");
  const supabase = await createClient();
  if (an) {
    const { data, error } = await supabase
      .from("steuertipps_umgesetzt")
      .upsert({ tipp, umgesetzt_am: new Date().toISOString(), umgesetzt_von: profile.id })
      .select("umgesetzt_am")
      .single();
    if (error) return { ok: false, error: error.message };
    return { ok: true, am: data.umgesetzt_am };
  }
  const { error } = await supabase.from("steuertipps_umgesetzt").delete().eq("tipp", tipp);
  return error ? { ok: false, error: error.message } : { ok: true };
}
