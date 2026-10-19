"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { requireFeature } from "@/lib/auth";
import { LIQ_DEFAULTS, type LiqEinstellungen } from "@/lib/liquiditaet/rechnung";
import { KATEGORIE_BY_KEY } from "@/lib/bank/kategorien";

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
  const a = input.aktion;
  const datum = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  out.aktion =
    a && typeof a === "object" && datum(a.von) && datum(a.bis)
      ? {
          aktiv: a.aktiv === true,
          label: String(a.label ?? "Aktion").slice(0, 40),
          von: datum(a.von),
          bis: datum(a.bis),
          mehrumsatzBrutto: Math.min(10_000_000, Math.max(0, Number(a.mehrumsatzBrutto) || 0)),
          profil: (Array.isArray(a.profil) ? a.profil : []).slice(0, 62).map((x) => Math.max(0, Number(x) || 0)),
          verzugTage: Math.min(30, Math.max(0, Math.round(Number(a.verzugTage) || 0))),
          auszahlungProzent: Math.min(100, Math.max(50, Number(a.auszahlungProzent) || 100)),
          quelle: String(a.quelle ?? "").slice(0, 120),
        }
      : null;
  out.ausgeblendeteKategorien = Array.isArray(input.ausgeblendeteKategorien)
    ? [...new Set(input.ausgeblendeteKategorien.filter((k) => typeof k === "string" && KATEGORIE_BY_KEY[k]))]
    : [];
  const sb = createServiceClient();
  const { error } = await sb.from("liquiditaet_einstellungen").upsert({ id: 1, daten: out, updated_at: new Date().toISOString() });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/finances/liquiditaet");
  revalidatePath("/orders");
  return { ok: true };
}
