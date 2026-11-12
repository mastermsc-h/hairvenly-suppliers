"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { requireFeature } from "@/lib/auth";
import { LIQ_DEFAULTS, rateSchluessel, ratenVerschiebungenJetzt, rechnungsNummern, zerlegeRateSchluessel, type LiqEinstellungen, type LiqVerschiebung } from "@/lib/liquiditaet/rechnung";
import { ladeEinstellungen, ladeRatenDaten } from "@/lib/liquiditaet/daten";
import { KATEGORIE_BY_KEY } from "@/lib/bank/kategorien";

const ZAHLEN: Array<[keyof LiqEinstellungen, number, number]> = [
  ["zahlungVorAnkunftTage", 0, 60],
  ["eustSatz", 0, 30],
  ["zollSatz", 0, 30],
  ["frachtProzent", 0, 100],
  ["puffer", 0, 10_000_000],
  ["horizontTage", 14, 365],
  ["restNachAnzahlungTage", 1, 180],
  ["manuellRateUsd", 1000, 10_000_000],
  ["manuellFristTage", 0, 365],
  ["manuellAbstandTage", 1, 365],
];
const OPTIONAL: Array<[keyof LiqEinstellungen, number, number]> = [
  ["fxUsdProEur", 0.5, 2],
  ["ustBasisMonat", -1_000_000, 1_000_000],
  ["nachbestellKgMonat", 0, 10_000],
  ["usdProKg", 0, 100_000],
  ["ebruNachbestellKgMonat", 0, 10_000],
  ["ebruUsdProKg", 0, 100_000],
];
const SCHALTER: Array<keyof LiqEinstellungen> = ["andereLieferantenEinrechnen", "nachbestellungenEinrechnen", "ebruNachbestellungenEinrechnen", "paypalEinrechnen", "zollAbbuchungenVerrechnen"];

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
  // Ratenregeln (Ebru …) — wurden bis 12.11.2026 nicht gespeichert, die Felder fielen still auf den Standard zurück
  const zahl = (v: unknown, min: number, max: number, std: number) => (Number.isFinite(Number(v)) && v !== null && v !== "" ? Math.min(max, Math.max(min, Number(v))) : std);
  out.ratenLieferanten = (Array.isArray(input.ratenLieferanten) ? input.ratenLieferanten : LIQ_DEFAULTS.ratenLieferanten)
    .slice(0, 5)
    .filter((r) => r && typeof r.name === "string" && r.name.trim())
    .map((r) => {
      const std = LIQ_DEFAULTS.ratenLieferanten[0];
      const wechselAb = datum(r.wechselAb);
      return {
        name: r.name.trim().slice(0, 40),
        rateUsd: zahl(r.rateUsd, 1000, 10_000_000, std.rateUsd),
        fristTage: zahl(r.fristTage, 0, 365, std.fristTage),
        abstandTage: zahl(r.abstandTage, 1, 365, std.abstandTage),
        bankMuster: String(r.bankMuster ?? "").slice(0, 60),
        wechselAb,
        abstandTageAb: wechselAb ? zahl(r.abstandTageAb, 1, 365, 7) : null,
      };
    });
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

/**
 * Zahltermin verschieben (datum) oder zurück auf den berechneten Termin (datum null).
 * Bestellungen auch als Anzahlung (anzahlungUsd am datum) + Rest (restDatum).
 * Betrifft nur die Planung — Rechnung, Saldo und Ankunftsdatum bleiben, wie sie sind.
 */
export async function setZahlTermin(input: {
  art: "bestellung" | "rate";
  schluessel: string;
  datum: string | null;
  notiz?: string | null;
  anzahlungUsd?: number | null;
  restDatum?: string | null;
}): Promise<{ ok: boolean; error?: string }> {
  const profile = await requireFeature("finances");
  if (profile.role === "supplier") return { ok: false, error: "Keine Berechtigung" };
  const { art, schluessel, datum } = input;
  const istDatum = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
  if ((art !== "bestellung" && art !== "rate") || !schluessel) return { ok: false, error: "Ungültiger Termin" };
  if (datum !== null && !istDatum(datum)) return { ok: false, error: "Ungültiges Datum" };
  const anzahlung = input.anzahlungUsd == null ? null : Number(input.anzahlungUsd);
  if (anzahlung !== null) {
    if (art !== "bestellung") return { ok: false, error: "Anzahlung nur bei Bestellungen" };
    if (!Number.isFinite(anzahlung) || anzahlung <= 0) return { ok: false, error: "Anzahlung muss größer als 0 sein" };
    if (!istDatum(input.restDatum)) return { ok: false, error: "Datum für den Rest fehlt" };
    if (datum && input.restDatum < datum) return { ok: false, error: "Der Rest kann nicht vor der Anzahlung kommen" };
  }
  const sb = createServiceClient();
  if (art === "rate") return setRatenTermin(sb, schluessel, datum, input.notiz ?? null);

  if (datum === null) {
    const { error } = await sb.from("liquiditaet_verschiebung").delete().eq("art", art).eq("schluessel", schluessel);
    if (error) return { ok: false, error: error.message };
  } else {
    let restBasis: number | null = null;
    {
      const { data, error } = await sb.from("orders_with_totals").select("id, remaining_balance").eq("id", schluessel).maybeSingle();
      if (error) return { ok: false, error: error.message };
      if (!data) return { ok: false, error: "Bestellung nicht gefunden" };
      if (anzahlung !== null) {
        const offen = Math.round(Number(data.remaining_balance ?? 0) * 100) / 100;
        // Ist die geplante Anzahlung schon eingegangen, bleibt der Stand beim Planen erhalten,
        // sonst sähe die Vorschau sie wieder als offen an
        const { data: alt } = await sb.from("liquiditaet_verschiebung").select("anzahlung_usd, rest_basis_usd").eq("art", art).eq("schluessel", schluessel).maybeSingle();
        const altBasis = alt?.rest_basis_usd == null ? null : Number(alt.rest_basis_usd);
        const schonBezahlt = alt?.anzahlung_usd != null && Number(alt.anzahlung_usd) === anzahlung && altBasis !== null && offen < altBasis - 0.01;
        if (!schonBezahlt && anzahlung >= offen) return { ok: false, error: "Anzahlung ist so hoch wie der offene Betrag — dann einfach den Termin verschieben" };
        restBasis = schonBezahlt ? altBasis : offen;
      }
    }
    const { error } = await sb.from("liquiditaet_verschiebung").upsert(
      {
        art,
        schluessel,
        datum,
        notiz: input.notiz?.trim().slice(0, 200) || null,
        letzte_zahlung: null,
        anzahlung_usd: anzahlung,
        rest_datum: anzahlung !== null ? input.restDatum : null,
        rest_basis_usd: restBasis,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "art,schluessel" },
    );
    if (error) return { ok: false, error: error.message };
  }
  revalidatePath("/finances/liquiditaet");
  revalidatePath("/orders");
  return { ok: true };
}

/**
 * Termin einer beliebigen Rate setzen/entfernen. Alle Verschiebungen des Lieferanten werden dabei auf
 * die heutige Ratennummer und die letzte Bankzahlung umgeschrieben (bezahlte fallen weg), damit keine
 * zwei Einträge auf dieselbe Rate zeigen.
 */
async function setRatenTermin(
  sb: ReturnType<typeof createServiceClient>,
  schluessel: string,
  datum: string | null,
  notiz: string | null,
): Promise<{ ok: boolean; error?: string }> {
  const { lieferant, nr } = zerlegeRateSchluessel(schluessel);
  const daten = await ladeRatenDaten(sb, await ladeEinstellungen(sb));
  if (!daten.ratenPositionen.some((x) => x.lieferant === lieferant)) return { ok: false, error: "Kein offener Ratenplan für diesen Lieferanten" };
  const letzte = daten.letzteZahlung[lieferant] ?? null;
  const { data: rows, error: e1 } = await sb.from("liquiditaet_verschiebung").select("schluessel, datum, notiz, letzte_zahlung").eq("art", "rate");
  if (e1) return { ok: false, error: e1.message };
  const eigene = ((rows ?? []) as Array<{ schluessel: string; datum: string; notiz: string | null; letzte_zahlung: string | null }>).filter(
    (r) => zerlegeRateSchluessel(r.schluessel).lieferant === lieferant,
  );
  const alt: Record<string, LiqVerschiebung> = Object.fromEntries(eigene.map((r) => [r.schluessel, { datum: r.datum, notiz: r.notiz, basisZahlung: r.letzte_zahlung }]));
  const jetzt = ratenVerschiebungenJetzt(alt, lieferant, daten.ratenZahlTage[lieferant], letzte);
  jetzt.delete(nr);
  const jetztIso = new Date().toISOString();
  const zeile = (k: number, d: string, n: string | null) => ({ art: "rate", schluessel: rateSchluessel(lieferant, k), datum: d, notiz: n, letzte_zahlung: letzte, updated_at: jetztIso });
  const neu = [...jetzt].map(([k, v]) => zeile(k, v.datum, v.notiz));
  if (datum) neu.push(zeile(nr, datum, notiz?.trim().slice(0, 200) || null));
  if (eigene.length) {
    const { error } = await sb.from("liquiditaet_verschiebung").delete().eq("art", "rate").in("schluessel", eigene.map((r) => r.schluessel));
    if (error) return { ok: false, error: error.message };
  }
  if (neu.length) {
    const { error } = await sb.from("liquiditaet_verschiebung").insert(neu);
    if (error) return { ok: false, error: error.message };
  }
  revalidatePath("/finances/liquiditaet");
  revalidatePath("/orders");
  return { ok: true };
}

/**
 * DHL-/Zoll-Rechnungsnummer(n) einer Bestellung, z.B. "ZIT8150777" (mehrere mit Komma).
 * Steht die Nummer im Verwendungszweck einer Abbuchung, gelten die Einfuhrabgaben als bezahlt.
 */
export async function setEinfuhrRechnung(orderId: string, text: string | null): Promise<{ ok: boolean; error?: string }> {
  const profile = await requireFeature("finances");
  if (profile.role === "supplier") return { ok: false, error: "Keine Berechtigung" };
  const wert = (text ?? "").replace(/\s+/g, " ").trim().slice(0, 300) || null;
  if (wert && !rechnungsNummern(wert).length) return { ok: false, error: "Keine gültige Rechnungsnummer (mind. 5 Zeichen, z.B. ZIT8150777)" };
  const sb = createServiceClient();
  const { data, error } = await sb.from("orders").update({ einfuhr_rechnung: wert }).eq("id", orderId).select("id");
  if (error) return { ok: false, error: error.message };
  if (!data?.length) return { ok: false, error: "Bestellung nicht gefunden" };
  revalidatePath("/finances/liquiditaet");
  revalidatePath(`/orders/${orderId}`);
  return { ok: true };
}
