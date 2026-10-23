"use server";

import { revalidatePath } from "next/cache";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { requireFeature } from "@/lib/auth";
import { KATEGORIE_BY_KEY, type KategorieRegel, type SteuerSplit } from "@/lib/bank/kategorien";
import { resetKategorie, runKategorisierung, setKategorieManuell } from "@/lib/bank/kategorien-engine";

export interface KontoUmsatz {
  id: string;
  account_iban: string | null;
  booking_date: string;
  amount: number;
  counterparty_name: string | null;
  counterparty_iban: string | null;
  purpose: string | null;
  posting_text: string | null;
  kategorie: string | null;
  kategorie_quelle: "auto" | "regel" | "manuell" | null;
  kategorie_regel_id: string | null;
  steuer_split: SteuerSplit[];
}

export interface RegelRow extends KategorieRegel {
  notiz: string | null;
}

type Result = { ok: boolean; error?: string };

function revalidateFinanzen() {
  revalidatePath("/finances/bank");
  revalidatePath("/finances/overview");
  revalidatePath("/finances/prepayments");
}

/** Alle Umsätze eines Jahres (seitenweise, Supabase liefert max. 1000 pro Abfrage) + Regeln. */
export async function fetchKontoumsaetze(
  jahr: number,
  alleZeitraeume = false
): Promise<{ umsaetze: KontoUmsatz[]; regeln: RegelRow[]; letzterAbruf: string | null }> {
  await requireFeature("finances");
  const supabase = await createClient();
  const umsaetze: KontoUmsatz[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("bank_transactions")
      .select("id, account_iban, booking_date, amount, counterparty_name, counterparty_iban, purpose, posting_text, kategorie, kategorie_quelle, kategorie_regel_id, steuer_split")
      .gte("booking_date", alleZeitraeume ? "1900-01-01" : `${jahr}-01-01`)
      .lte("booking_date", alleZeitraeume ? "2999-12-31" : `${jahr}-12-31`)
      .order("booking_date", { ascending: false })
      .order("id", { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    umsaetze.push(...((data ?? []) as KontoUmsatz[]).map((u) => ({ ...u, amount: Number(u.amount), steuer_split: u.steuer_split ?? [] })));
    if (!data || data.length < 1000) break;
  }
  const [{ data: regeln }, { data: state }] = await Promise.all([
    supabase.from("bank_kategorie_regeln").select("id, prioritaet, feld, muster, richtung, kategorie, notiz").order("prioritaet").order("muster"),
    supabase.from("bank_sync_state").select("last_success_at").eq("id", 1).maybeSingle(),
  ]);
  return { umsaetze, regeln: (regeln ?? []) as RegelRow[], letzterAbruf: state?.last_success_at ?? null };
}

/**
 * Suche über ALLE Kontoumsätze (alle Konten, alle Zeiträume): Name, Zweck, IBAN, Betrag
 * ("449,90"), Bestellnummer, Datum ("19.10."). SQL-Funktion bank_suche (Migration 0131).
 */
export async function sucheKontoumsaetze(
  q: string,
  zeitraum?: { von: string; bis: string } | null
): Promise<{ ok: boolean; error?: string; umsaetze: KontoUmsatz[] }> {
  await requireFeature("finances");
  const query = String(q ?? "").trim().slice(0, 200);
  if (query.length < 2) return { ok: true, umsaetze: [] };
  const supabase = await createClient();
  const datum = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);
  const { data, error } = await supabase.rpc("bank_suche", {
    q: query,
    nur_eingaenge: false,
    lim: 300,
    von: datum(zeitraum?.von),
    bis: datum(zeitraum?.bis),
  });
  if (error) return { ok: false, error: error.message, umsaetze: [] };
  return {
    ok: true,
    umsaetze: ((data ?? []) as KontoUmsatz[]).map((u) => ({ ...u, amount: Number(u.amount), steuer_split: u.steuer_split ?? [] })),
  };
}

/** Kategorie für einzelne Umsätze von Hand setzen. */
export async function setKategorieAction(ids: string[], kategorie: string): Promise<Result> {
  await requireFeature("finances");
  if (!KATEGORIE_BY_KEY[kategorie]) return { ok: false, error: "Unbekannte Kategorie" };
  if (!ids.length || ids.length > 500) return { ok: false, error: "Ungültige Auswahl" };
  try {
    await setKategorieManuell(ids, kategorie);
    revalidateFinanzen();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Manuelle Kategorie zurücknehmen → wieder automatisch. */
export async function resetKategorieAction(id: string): Promise<Result> {
  await requireFeature("finances");
  try {
    await resetKategorie(id);
    revalidateFinanzen();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/**
 * Regel anlegen ("für alle von dieser Gegenpartei merken") und alle nicht
 * manuell gesetzten Umsätze neu kategorisieren. Gleiche Regel → Kategorie wird ersetzt.
 */
export async function saveRegelAction(input: {
  feld: KategorieRegel["feld"];
  muster: string;
  richtung: KategorieRegel["richtung"];
  kategorie: string;
}): Promise<Result & { geaendert?: number }> {
  await requireFeature("finances");
  const muster = input.muster.trim();
  if (muster.length < 2) return { ok: false, error: "Muster zu kurz" };
  if (!KATEGORIE_BY_KEY[input.kategorie]) return { ok: false, error: "Unbekannte Kategorie" };
  if (!["counterparty_name", "counterparty_iban", "purpose", "posting_text"].includes(input.feld)) return { ok: false, error: "Ungültiges Feld" };
  if (!["ein", "aus", "alle"].includes(input.richtung)) return { ok: false, error: "Ungültige Richtung" };
  const sb = createServiceClient();
  const { error } = await sb
    .from("bank_kategorie_regeln")
    .upsert(
      { prioritaet: 15, feld: input.feld, muster, richtung: input.richtung, kategorie: input.kategorie, notiz: "im Dashboard angelegt" },
      { onConflict: "feld,muster,richtung" }
    );
  if (error) return { ok: false, error: error.message };
  try {
    const r = await runKategorisierung({ scope: "alle", sb });
    revalidateFinanzen();
    return { ok: true, geaendert: r.geaendert };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function deleteRegelAction(id: string): Promise<Result> {
  await requireFeature("finances");
  const sb = createServiceClient();
  const { error } = await sb.from("bank_kategorie_regeln").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  try {
    await runKategorisierung({ scope: "alle", sb });
    revalidateFinanzen();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}

/** Alles nach den aktuellen Regeln neu einordnen (manuelle Zuordnungen bleiben). */
export async function rekategorisierenAction(): Promise<Result & { geaendert?: number }> {
  await requireFeature("finances");
  try {
    const r = await runKategorisierung({ scope: "alle" });
    revalidateFinanzen();
    return { ok: true, geaendert: r.geaendert };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
