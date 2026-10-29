// Welche Z-Bons erwartet werden und welche fehlen — server-only.
import type { SupabaseClient } from "@supabase/supabase-js";
import { bremenHolidays } from "@/lib/staff/holidays";
import type { ZBonFehlend, ZBonQuelle } from "@/lib/types";

export interface ZBonEinstellungen {
  pruef_ab: string; // YYYY-MM-DD
  nexi_wochentage: number[]; // 0 = So … 6 = Sa
}

const QUELLEN: ZBonQuelle[] = ["shopify_pos", "nexi"];
const berlinTag = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" });

export function heuteBerlin(): string {
  return berlinTag.format(new Date());
}

export function plusTage(d: string, n: number): string {
  const t = new Date(`${d}T12:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

export function wochentag(d: string): number {
  return new Date(`${d}T12:00:00Z`).getUTCDay();
}

/**
 * Pure Regel je Tag und Kasse:
 * - Shopify POS: erwartet, wenn Shopify an dem Tag Kassenverkäufe hatte. Ist der Tag in Shopify
 *   noch nicht abgerufen, gilt ersatzweise dieselbe Wochentag-Regel wie Nexi.
 * - Nexi (Treatwell): an den eingestellten Öffnungstagen, außer Feiertage in Bremen.
 * Vor pruef_ab und an Tagen mit Ausnahme („geschlossen") wird nichts erwartet.
 */
export function wirdErwartet(
  datum: string,
  quelle: ZBonQuelle,
  ctx: { einst: ZBonEinstellungen; posUmsatz: Map<string, number>; posBekannt: (d: string) => boolean; ausnahmen: Set<string> },
): boolean {
  if (datum < ctx.einst.pruef_ab) return false;
  if (ctx.ausnahmen.has(`${datum}|${quelle}`)) return false;
  const oeffnungstag =
    ctx.einst.nexi_wochentage.includes(wochentag(datum)) && !bremenHolidays(Number(datum.slice(0, 4))).has(datum);
  if (quelle === "shopify_pos" && ctx.posBekannt(datum)) return (ctx.posUmsatz.get(datum) ?? 0) > 0;
  return oeffnungstag;
}

export interface ZBonLage {
  einst: ZBonEinstellungen;
  erwartet: ZBonFehlend[];
  fehlend: ZBonFehlend[];
  posUmsatz: Record<string, number>;
  ausnahmen: Array<{ datum: string; quelle: ZBonQuelle; grund: string }>;
}

/** Erwartete und fehlende Z-Bons im Zeitraum [von, bis] (beide inklusive). */
export async function zbonLage(sb: SupabaseClient, von: string, bis: string): Promise<ZBonLage> {
  const [einstRes, bonsRes, ausRes, posRes, standRes] = await Promise.all([
    sb.from("z_bon_einstellungen").select("pruef_ab, nexi_wochentage").eq("id", 1).single(),
    sb.from("z_bons").select("datum, quelle").is("geloescht_am", null).gte("datum", von).lte("datum", bis),
    sb.from("z_bon_ausnahmen").select("datum, quelle, grund").gte("datum", von).lte("datum", bis),
    sb.from("shopify_pos_tage").select("datum, umsatz").gte("datum", von).lte("datum", bis),
    sb.from("shopify_umsatz_monat").select("monat, stand").gte("monat", von.slice(0, 7)).lte("monat", bis.slice(0, 7)),
  ]);
  for (const r of [einstRes, bonsRes, ausRes, posRes, standRes]) if (r.error) throw new Error(r.error.message);

  const einst = einstRes.data as ZBonEinstellungen;
  const vorhanden = new Set((bonsRes.data ?? []).map((b) => `${b.datum}|${b.quelle}`));
  const ausnahmen = (ausRes.data ?? []) as ZBonLage["ausnahmen"];
  const posUmsatz = new Map((posRes.data ?? []).map((p) => [p.datum as string, Number(p.umsatz)]));
  // Ein Tag gilt als „in Shopify bekannt", wenn der Monat nach Ende dieses Tages abgerufen wurde
  const stand = new Map((standRes.data ?? []).map((s) => [s.monat as string, berlinTag.format(new Date(s.stand))]));
  const posBekannt = (d: string) => {
    const s = stand.get(d.slice(0, 7));
    return !!s && s > d;
  };
  const ctx = { einst, posUmsatz, posBekannt, ausnahmen: new Set(ausnahmen.map((a) => `${a.datum}|${a.quelle}`)) };

  const erwartet: ZBonFehlend[] = [];
  for (let d = von; d <= bis; d = plusTage(d, 1)) {
    for (const quelle of QUELLEN) if (wirdErwartet(d, quelle, ctx)) erwartet.push({ datum: d, quelle });
  }
  return {
    einst,
    erwartet,
    fehlend: erwartet.filter((e) => !vorhanden.has(`${e.datum}|${e.quelle}`)),
    posUmsatz: Object.fromEntries(posUmsatz),
    ausnahmen,
  };
}
