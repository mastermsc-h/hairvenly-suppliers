"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { requireFeature } from "@/lib/auth";
import { LIQ_DEFAULTS, type LiqEinstellungen } from "@/lib/liquiditaet/rechnung";

const ZAHLEN: Array<[keyof LiqEinstellungen, number, number]> = [
  ["zahlungVorAnkunftTage", 0, 60],
  ["eustSatz", 0, 30],
  ["zollSatz", 0, 30],
  ["frachtProzent", 0, 100],
  ["puffer", 0, 10_000_000],
  ["horizontTage", 14, 365],
];
const OPTIONAL: Array<[keyof LiqEinstellungen, number, number]> = [
  ["fxUsdProEur", 0.5, 2],
  ["ustBasisMonat", -1_000_000, 1_000_000],
  ["nachbestellKgMonat", 0, 10_000],
  ["usdProKg", 0, 100_000],
];
const SCHALTER: Array<keyof LiqEinstellungen> = ["andereLieferantenEinrechnen", "nachbestellungenEinrechnen"];

/** Speichert nur bekannte Felder mit plausiblen Werten (kein fremdes jsonb durchreichen). */
export async function saveLiquiditaetEinstellungen(input: Partial<LiqEinstellungen>): Promise<{ ok: boolean; error?: string }> {
  const profile = await requireFeature("finances");
  if (profile.role === "supplier") return { ok: false, error: "Keine Berechtigung" };
  const out: Record<string, unknown> = {};
  for (const [k, min, max] of ZAHLEN) {
    const v = Number(input[k]);
    out[k] = Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : LIQ_DEFAULTS[k];
  }
  for (const [k, min, max] of OPTIONAL) {
    const raw = input[k];
    const v = raw === null || raw === undefined || (raw as unknown) === "" ? null : Number(raw);
    out[k] = v === null || !Number.isFinite(v) ? null : Math.min(max, Math.max(min, v));
  }
  for (const k of SCHALTER) out[k] = input[k] === true;
  const sb = createServiceClient();
  const { error } = await sb.from("liquiditaet_einstellungen").upsert({ id: 1, daten: out, updated_at: new Date().toISOString() });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/finances/liquiditaet");
  revalidatePath("/orders");
  return { ok: true };
}
