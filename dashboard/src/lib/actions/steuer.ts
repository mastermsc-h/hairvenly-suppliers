"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireFeature } from "@/lib/auth";
import type { SteuerPosten } from "@/lib/types";

const PATH = "/finances/prepayments";

const str = (v: FormDataEntryValue | null): string | null => {
  const s = String(v ?? "").trim();
  return s || null;
};
const num = (v: FormDataEntryValue | null): number => {
  const s = String(v ?? "").trim().replace(/\./g, "").replace(",", ".");
  if (!s) return 0;
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
};

/** Alle Posten eines Jahres, sortiert nach Fälligkeit. */
export async function fetchSteuerPosten(jahr: number): Promise<SteuerPosten[]> {
  await requireFeature("finances");
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("steuer_posten")
    .select("*")
    .eq("jahr", jahr)
    .order("faellig_am", { ascending: true, nullsFirst: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as SteuerPosten[];
}

/** Welche Jahre existieren (für die Jahres-Auswahl). */
export async function fetchSteuerJahre(): Promise<number[]> {
  await requireFeature("finances");
  const supabase = await createClient();
  const { data } = await supabase.from("steuer_posten").select("jahr");
  const set = new Set<number>((data ?? []).map((r: { jahr: number }) => r.jahr));
  return [...set].sort((a, b) => b - a);
}

function fieldsFromForm(formData: FormData) {
  return {
    art: str(formData.get("art")) ?? "sonstige",
    zeitraum: str(formData.get("zeitraum")) ?? "",
    jahr: Number(str(formData.get("jahr")) ?? new Date().getFullYear()),
    richtung: str(formData.get("richtung")) ?? "zahlung",
    soll_betrag: num(formData.get("soll_betrag")),
    faellig_am: str(formData.get("faellig_am")),
    ist_betrag: num(formData.get("ist_betrag")),
    bezahlt_am: str(formData.get("bezahlt_am")),
    bescheid_ref: str(formData.get("bescheid_ref")),
    notiz: str(formData.get("notiz")),
  };
}

export async function createSteuerPosten(_prev: unknown, formData: FormData) {
  await requireFeature("finances");
  const supabase = await createClient();
  const fields = fieldsFromForm(formData);
  if (!fields.zeitraum) return { ok: false, error: "Zeitraum fehlt" };
  const { error } = await supabase.from("steuer_posten").insert(fields);
  if (error) return { ok: false, error: error.message };
  revalidatePath(PATH);
  return { ok: true };
}

export async function updateSteuerPosten(id: string, formData: FormData) {
  await requireFeature("finances");
  const supabase = await createClient();
  const fields = fieldsFromForm(formData);
  const { error } = await supabase.from("steuer_posten").update(fields).eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(PATH);
  return { ok: true };
}

/** Schnell-Aktion: Posten als (voll) bezahlt markieren. */
export async function markSteuerBezahlt(id: string, soll: number, bezahltAm: string) {
  await requireFeature("finances");
  const supabase = await createClient();
  const { error } = await supabase
    .from("steuer_posten")
    .update({ ist_betrag: soll, bezahlt_am: bezahltAm })
    .eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(PATH);
  return { ok: true };
}

/**
 * Ist-Betrag schnell erfassen (aus dem Finanzamt-Abgleich in /finances/overview).
 * Existiert der Posten (id), wird nur das Ist aktualisiert; sonst wird ein neuer
 * Posten mit Soll 0 angelegt (z.B. EUSt, die erst später auftaucht).
 * Stufe 2 (FinTS-Bankabgleich) schreibt später in dieselben Felder.
 */
export async function upsertSteuerIst(opts: {
  id: string | null;
  art: string;
  zeitraum: string;
  jahr: number;
  ist_betrag: number;
}): Promise<{ ok: boolean; error?: string; posten?: SteuerPosten }> {
  await requireFeature("finances");
  const supabase = await createClient();
  const today = new Date().toISOString().slice(0, 10);

  if (opts.id) {
    const { data: row } = await supabase.from("steuer_posten").select("bezahlt_am").eq("id", opts.id).single();
    const patch: { ist_betrag: number; bezahlt_am?: string | null } = { ist_betrag: opts.ist_betrag };
    // bezahlt_am nur setzen, wenn noch keins existiert; bei Ist=0 wieder leeren
    if (opts.ist_betrag > 0 && !row?.bezahlt_am) patch.bezahlt_am = today;
    if (opts.ist_betrag <= 0) patch.bezahlt_am = null;
    const { data, error } = await supabase
      .from("steuer_posten").update(patch).eq("id", opts.id).select("*").single();
    if (error) return { ok: false, error: error.message };
    revalidatePath(PATH);
    revalidatePath("/finances/overview");
    return { ok: true, posten: data as SteuerPosten };
  }

  const { data, error } = await supabase
    .from("steuer_posten")
    .insert({
      art: opts.art,
      zeitraum: opts.zeitraum,
      jahr: opts.jahr,
      richtung: "zahlung",
      soll_betrag: 0,
      ist_betrag: opts.ist_betrag,
      bezahlt_am: opts.ist_betrag > 0 ? today : null,
    })
    .select("*")
    .single();
  if (error) return { ok: false, error: error.message };
  revalidatePath(PATH);
  revalidatePath("/finances/overview");
  return { ok: true, posten: data as SteuerPosten };
}

export async function deleteSteuerPosten(id: string) {
  await requireFeature("finances");
  const supabase = await createClient();
  const { error } = await supabase.from("steuer_posten").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(PATH);
  return { ok: true };
}
