// Liquiditätsvorschau — Rohdaten sammeln (server-only, service_role).
// Aufrufer prüfen vorher requireFeature("finances") und role !== "supplier".
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { readVerkaufsanalyse } from "@/lib/stock-sheets";
import { createServiceClient } from "@/lib/supabase/server";
import { KATEGORIE_BY_KEY } from "@/lib/bank/kategorien";
import {
  mitDefaults,
  parseFxKurs,
  parseKontostand,
  plusTage,
  prognose,
  tageZwischen,
  type LiqBestellung,
  type LiqEinstellungen,
  type LiqRohdaten,
  type PrognoseErgebnis,
} from "./rechnung";

type Sb = ReturnType<typeof createServiceClient>;

/**
 * Verkauf Russisch glatt (= Amanda-Ware) laut Verkaufsanalyse, Ø 3 Monate in kg/Monat.
 * 1 h zwischengespeichert — die Bestellliste soll nicht bei jedem Aufruf das Sheet lesen.
 */
const verbrauchGlattKgMonat = unstable_cache(
  async (): Promise<number | null> => {
    try {
      const { rows } = await readVerkaufsanalyse();
      const r = rows.find((x) => x.quality === "Russisch Glatt" && x.isSummary);
      return r && r.avg3mKg > 0 ? Math.round(r.avg3mKg * 10) / 10 : null;
    } catch {
      return null;
    }
  },
  ["liquiditaet-verbrauch-glatt"],
  { revalidate: 3600 }
);

/** Targobank = Gehaltskonto: dessen Ausgaben stecken schon im Übertrag von der Sparkasse. */
const GEHALTSKONTO_BLZ = "30020900";
const istGeschaeftskonto = (iban: string | null) => !!iban && iban.slice(4, 12) !== GEHALTSKONTO_BLZ;
/** Amanda wird an "YW BEAUTY LINK" bezahlt (Rechnungsnummern AMANDAGRM…). */
const istAmandaZahlung = (name: string | null, purpose: string | null) =>
  /yw\s*beauty/i.test(name ?? "") || /AMANDA/i.test(purpose ?? "");
/** Laufende Abgänge: alle Ausgaben außer Wareneinkauf (läuft über die Bestellungen) + Übertrag Gehaltskonto + Privat. */
const istLaufend = (k: string) => (k.startsWith("aus_") && k !== "aus_wareneinkauf") || k === "umbuchung_gehalt" || k === "privat";

interface Tx {
  account_iban: string | null;
  booking_date: string;
  amount: number;
  kategorie: string | null;
  counterparty_name: string | null;
  purpose: string | null;
}

async function selectAll<T>(build: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await build(from, from + 999);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  return out;
}

function heuteBerlin(): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(new Date());
}

function monatsEnde(m: string): string {
  const [y, mo] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10);
}

export async function ladeEinstellungen(sb: Sb = createServiceClient()): Promise<LiqEinstellungen> {
  const { data } = await sb.from("liquiditaet_einstellungen").select("daten").eq("id", 1).maybeSingle();
  return mitDefaults((data?.daten ?? {}) as Partial<LiqEinstellungen>);
}

export async function ladeRohdaten(sb: Sb = createServiceClient()): Promise<LiqRohdaten> {
  const heute = heuteBerlin();
  const seit = plusTage(heute, -200);

  const { data: lieferant } = await sb.from("suppliers").select("id, default_lead_weeks").eq("name", "Amanda").maybeSingle();
  const amandaId = lieferant?.id ?? "00000000-0000-0000-0000-000000000000";

  const [alleTx, posten, { data: orders }, { data: amanda }, kgVerbrauchMonat] = await Promise.all([
    selectAll<Tx>((from, to) =>
      sb.from("bank_transactions")
        .select("account_iban, booking_date, amount, kategorie, counterparty_name, purpose")
        .gte("booking_date", seit)
        .order("booking_date", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to)
    ),
    selectAll<{ art: string; zeitraum: string; richtung: string; ist_betrag: number; soll_betrag: number }>((from, to) =>
      sb.from("steuer_posten").select("art, zeitraum, richtung, ist_betrag, soll_betrag").gte("jahr", Number(heute.slice(0, 4)) - 1).range(from, to)
    ),
    sb.from("orders_with_totals")
      .select("id, label, status, eta, invoice_total, remaining_balance, import_vat, weight_kg")
      .eq("supplier_id", amandaId)
      .not("status", "in", "(stocked,cancelled,draft)"),
    sb.from("orders")
      .select("order_date, invoice_total, weight_kg")
      .eq("supplier_id", amandaId)
      .gte("order_date", plusTage(heute, -180))
      .gt("weight_kg", 1),
    verbrauchGlattKgMonat(),
  ]);

  const tx = alleTx.map((t) => ({ ...t, amount: Number(t.amount) })).filter((t) => istGeschaeftskonto(t.account_iban));

  // ── Kontostand je Konto: letzter Monatsabschluss + Buchungen danach ──
  const konten: LiqRohdaten["konten"] = [];
  let saldoStand = seit;
  for (const iban of [...new Set(tx.map((t) => t.account_iban as string))]) {
    const kt = tx.filter((t) => t.account_iban === iban);
    let anker: { am: string; betrag: number } | null = null;
    for (const t of kt) {
      const k = parseKontostand(t.purpose);
      if (k && (!anker || k.am > anker.am)) anker = k;
    }
    if (!anker) continue;
    const a = anker;
    const saldo = a.betrag + kt.filter((t) => t.booking_date > a.am).reduce((s, t) => s + t.amount, 0);
    konten.push({ iban, saldo: Math.round(saldo * 100) / 100, anker: a.am });
    const last = kt.at(-1)?.booking_date ?? a.am;
    if (last > saldoStand) saldoStand = last;
  }
  const startSaldo = Math.round(konten.reduce((s, k) => s + k.saldo, 0) * 100) / 100;

  // ── Basiszeitraum: letzte bis zu 3 volle Kalendermonate mit vollständigen Daten ──
  const datenAb = tx[0]?.booking_date ?? heute;
  const aktMonat = heute.slice(0, 7);
  const monate: string[] = [];
  for (let m = aktMonat, i = 0; i < 12 && monate.length < 3; i++) {
    const [y, mo] = m.split("-").map(Number);
    m = mo === 1 ? `${y - 1}-12` : `${y}-${String(mo - 1).padStart(2, "0")}`;
    if (`${m}-01` < datenAb) break;
    monate.unshift(m);
  }
  let basisVon: string, basisBis: string;
  if (monate.length) {
    basisVon = `${monate[0]}-01`;
    basisBis = monatsEnde(monate.at(-1) as string);
  } else {
    basisBis = saldoStand;
    basisVon = plusTage(saldoStand, -29);
  }
  const imBasis = tx.filter((t) => t.booking_date >= basisVon && t.booking_date <= basisBis);
  const gruppe = (k: string | null) => KATEGORIE_BY_KEY[k ?? "unklar"]?.gruppe;
  const laufendMap = new Map<string, number>();
  let einnahmen = 0;
  let andereLieferanten = 0;
  for (const t of imBasis) {
    const k = t.kategorie ?? "unklar";
    if (gruppe(k) === "einnahmen") einnahmen += t.amount;
    else if (istLaufend(k)) laufendMap.set(k, (laufendMap.get(k) ?? 0) + t.amount);
    else if (k === "aus_wareneinkauf" && !istAmandaZahlung(t.counterparty_name, t.purpose)) andereLieferanten += t.amount;
  }
  const monatsWerte = [...monate, aktMonat].map((m) => {
    const bis = m === aktMonat ? saldoStand : monatsEnde(m);
    const von = `${m}-01` < datenAb ? datenAb : `${m}-01`;
    return {
      monat: m,
      einnahmen: Math.round(tx.filter((t) => t.booking_date >= von && t.booking_date <= bis && gruppe(t.kategorie) === "einnahmen").reduce((s, t) => s + t.amount, 0)),
      tage: Math.max(1, tageZwischen(von, bis) + 1),
    };
  });

  // ── Wechselkurs: letzte Auslandsüberweisung ──
  let fxAuto: LiqRohdaten["fxAuto"] = null;
  for (const t of tx) {
    const k = parseFxKurs(t.purpose);
    if (k) fxAuto = { kurs: k, datum: t.booking_date };
  }

  // ── Steuern ──
  const eustBezahlt: Record<string, number> = {};
  for (const t of tx) if (t.kategorie === "st_eust") eustBezahlt[t.booking_date.slice(0, 7)] = (eustBezahlt[t.booking_date.slice(0, 7)] ?? 0) - t.amount;
  const istSigned = (p: { richtung: string; ist_betrag: number }) => (p.richtung === "erstattung" ? -1 : 1) * Number(p.ist_betrag || 0);
  const erledigt = posten.filter((p) => Number(p.ist_betrag) !== 0);
  const ustPosten = erledigt.filter((p) => p.art === "ust_va" && /^\d{4}-\d{2}$/.test(p.zeitraum)).sort((a, b) => a.zeitraum.localeCompare(b.zeitraum));
  const ustHistorie = ustPosten
    .filter((p) => p.zeitraum >= datenAb.slice(0, 7))
    .slice(-3)
    .map((p) => ({ monat: p.zeitraum, ust: istSigned(p), eust: eustBezahlt[p.zeitraum] ?? 0 }));
  const lst = erledigt.filter((p) => p.art === "lst_anmeldung" && /^\d{4}-\d{2}$/.test(p.zeitraum)).sort((a, b) => a.zeitraum.localeCompare(b.zeitraum));
  const letzte = (art: string) => {
    const r = erledigt.filter((p) => p.art === art).sort((a, b) => a.zeitraum.localeCompare(b.zeitraum)).at(-1);
    return r ? istSigned(r) : null;
  };

  // ── Bestellungen ──
  const bestellungen: LiqBestellung[] = ((orders ?? []) as Array<Record<string, unknown>>)
    .map((o) => ({
      id: String(o.id),
      label: String(o.label ?? ""),
      status: String(o.status),
      eta: (o.eta as string | null) ?? null,
      invoiceUsd: o.invoice_total == null ? null : Number(o.invoice_total),
      restUsd: Math.max(0, Number(o.remaining_balance ?? 0)),
      importVatEur: o.import_vat == null ? null : Number(o.import_vat),
      kg: o.weight_kg == null ? null : Number(o.weight_kg),
    }))
    // Angekommen + bezahlt = erledigt
    .filter((b) => !(b.status === "delivered" && b.restUsd <= 0.01))
    .sort((a, b) => (a.eta ?? "").localeCompare(b.eta ?? ""));

  // ── Nachbestellung (Schätzung aus dem eigenen Bestellrhythmus) ──
  const hist = (amanda ?? []) as Array<{ order_date: string | null; invoice_total: number | null; weight_kg: number | null }>;
  const kg90 = hist.filter((h) => (h.order_date ?? "") >= plusTage(heute, -90)).reduce((s, h) => s + Number(h.weight_kg ?? 0), 0);
  const mitPreis = hist.filter((h) => Number(h.invoice_total) > 0);
  const kgPreis = mitPreis.reduce((s, h) => s + Number(h.weight_kg ?? 0), 0);
  const leadWochen = Number(lieferant?.default_lead_weeks ?? 6);

  return {
    heute,
    startSaldo,
    saldoStand,
    konten,
    basis: {
      monate,
      tage: tageZwischen(basisVon, basisBis) + 1,
      einnahmen: Math.round(einnahmen * 100) / 100,
      laufend: [...laufendMap.entries()].map(([kategorie, summe]) => ({ kategorie, summe: Math.round(summe * 100) / 100 })).sort((a, b) => a.summe - b.summe),
      andereLieferanten: Math.round(andereLieferanten * 100) / 100,
      monatsWerte,
    },
    fxAuto,
    bestellungen,
    steuern: {
      ustHistorie,
      ustErledigtBis: ustPosten.at(-1)?.zeitraum ?? null,
      eustBezahlt,
      lstLetzte: lst.slice(-3).map((p) => istSigned(p)),
      lstErledigtBis: lst.at(-1)?.zeitraum ?? null,
      estLetzte: letzte("est_vz"),
      gewstLetzte: letzte("gewst_vz"),
      quartaleErledigt: erledigt.filter((p) => p.art === "est_vz" || p.art === "gewst_vz").map((p) => `${p.art}|${p.zeitraum}`),
    },
    nachbestellung: {
      kgProMonatAuto: Math.round((kg90 / 3) * 10) / 10,
      kgVerbrauchMonat,
      usdProKgAuto: kgPreis > 0 ? Math.round(mitPreis.reduce((s, h) => s + Number(h.invoice_total), 0) / kgPreis) : 0,
      leadWochen,
    },
  };
}

/** Einmal pro Request (Bestellliste + Detailseite rufen es ggf. mehrfach). */
export const ladePrognose = cache(async (): Promise<{ roh: LiqRohdaten; einstellungen: LiqEinstellungen; ergebnis: PrognoseErgebnis }> => {
  const sb = createServiceClient();
  const [roh, einstellungen] = await Promise.all([ladeRohdaten(sb), ladeEinstellungen(sb)]);
  return { roh, einstellungen, ergebnis: prognose(roh, einstellungen) };
});
