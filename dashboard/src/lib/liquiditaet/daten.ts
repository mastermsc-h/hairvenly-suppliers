// Liquiditätsvorschau — Rohdaten sammeln (server-only, service_role).
// Aufrufer prüfen vorher requireFeature("finances") und role !== "supplier".
import { cache } from "react";
import { unstable_cache } from "next/cache";
import { readVerkaufsanalyse } from "@/lib/stock-sheets";
import { createServiceClient } from "@/lib/supabase/server";
import { KATEGORIE_BY_KEY } from "@/lib/bank/kategorien";
import {
  einfuhrZahlungen,
  offeneZollBuchungen,
  zahlungenOhneAbbuchung,
  rechnungsNummern,
  type EinfuhrZahlung,
  kontoVerlauf,
  mitDefaults,
  parseFxKurs,
  parseKontostand,
  plusTage,
  WARE_DA,
  prognose,
  tageZwischen,
  type LiqBestellung,
  type LiqEinfuhrPosten,
  type LiqEinstellungen,
  type LiqManuellePosition,
  type LiqRohdaten,
  type LiqVerschiebungen,
  type PrognoseErgebnis,
  type VerlaufTag,
  type ZahlGruppe,
  ratenRegelFuer,
  ratenplan,
} from "./rechnung";
import { debtBucket } from "@/lib/order-debt";
import type { OrderStatus } from "@/lib/types";

type Sb = ReturnType<typeof createServiceClient>;

/**
 * Verkauf Russisch glatt (= Amanda-Ware) laut Verkaufsanalyse, Ø 3 Monate in kg/Monat.
 * 1 h zwischengespeichert — die Bestellliste soll nicht bei jedem Aufruf das Sheet lesen.
 */
const verbrauchKgMonat = unstable_cache(
  async (): Promise<{ glatt: number | null; wellig: number | null }> => {
    try {
      const { rows } = await readVerkaufsanalyse();
      const kg = (q: string) => {
        const r = rows.find((x) => x.quality === q && x.isSummary);
        return r && r.avg3mKg > 0 ? Math.round(r.avg3mKg * 10) / 10 : null;
      };
      return { glatt: kg("Russisch Glatt"), wellig: kg("Usbekisch Wellig") };
    } catch {
      return { glatt: null, wellig: null };
    }
  },
  ["liquiditaet-verbrauch-glatt-wellig"],
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

  const [alleTx, posten, { data: orders }, { data: amanda }, verbrauch, { data: salden }, { data: amandaAnkuenfte }, { data: einfuhrNr }] = await Promise.all([
    selectAll<Tx>((from, to) =>
      sb.from("bank_transactions")
        .select("account_iban, booking_date, amount, kategorie, counterparty_name, purpose")
        .gte("booking_date", seit)
        .order("booking_date", { ascending: true })
        .order("id", { ascending: true })
        .range(from, to)
    ),
    selectAll<{ art: string; zeitraum: string; richtung: string; ist_betrag: number; soll_betrag: number; soll_schaetzung: boolean; faellig_am: string | null }>((from, to) =>
      sb.from("steuer_posten").select("art, zeitraum, richtung, ist_betrag, soll_betrag, soll_schaetzung, faellig_am").gte("jahr", Number(heute.slice(0, 4)) - 1).range(from, to)
    ),
    sb.from("orders_with_totals")
      .select("id, label, status, eta, invoice_total, remaining_balance, import_vat, weight_kg")
      .eq("supplier_id", amandaId)
      .not("status", "in", "(cancelled,hidden,manual,draft)"),
    sb.from("orders")
      .select("order_date, invoice_total, weight_kg")
      .eq("supplier_id", amandaId)
      .gte("order_date", plusTage(heute, -180))
      .not("status", "in", "(hidden,manual)")
      .gt("weight_kg", 1),
    verbrauchKgMonat(),
    sb.from("bank_salden").select("account_iban, saldo, stand, abgerufen_am"),
    // Amanda-Ankünfte der letzten 13 Monate (für den Amanda-Anteil an der historischen EUSt)
    sb.from("orders")
      .select("eta, invoice_total")
      .eq("supplier_id", amandaId)
      .not("status", "in", "(cancelled,hidden,manual,draft)")
      .gte("eta", plusTage(heute, -400))
      .lt("eta", heute),
    // DHL-/Zoll-Rechnungsnummern (nicht in orders_with_totals)
    sb.from("orders").select("id, einfuhr_rechnung").not("einfuhr_rechnung", "is", null),
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
  // Alle Monats-Voranmeldungen der letzten 12 Monate mit vollständigen Kontodaten (2025 war quartalsweise)
  const ustHistorie = ustPosten
    .filter((p) => p.zeitraum >= datenAb.slice(0, 7) && p.zeitraum >= plusTage(heute, -366).slice(0, 7))
    .map((p) => ({ monat: p.zeitraum, ust: istSigned(p), eust: eustBezahlt[p.zeitraum] ?? 0 }));
  const amandaImportUsd: Record<string, number> = {};
  for (const o of (amandaAnkuenfte ?? []) as Array<{ eta: string | null; invoice_total: number | null }>) {
    if (!o.eta || !(Number(o.invoice_total) > 0)) continue;
    amandaImportUsd[o.eta.slice(0, 7)] = (amandaImportUsd[o.eta.slice(0, 7)] ?? 0) + Number(o.invoice_total);
  }
  const lst = erledigt.filter((p) => p.art === "lst_anmeldung" && /^\d{4}-\d{2}$/.test(p.zeitraum)).sort((a, b) => a.zeitraum.localeCompare(b.zeitraum));
  // "Q4 2025" sortiert als Text HINTER "Q3 2026" → chronologischer Schlüssel nötig
  const zeitKey = (z: string) => {
    const q = z.match(/^Q([1-4]) (\d{4})$/);
    return q ? `${q[2]}-${String(Number(q[1]) * 3).padStart(2, "0")}` : z;
  };
  const letzte = (art: string) => {
    const r = erledigt.filter((p) => p.art === art).sort((a, b) => zeitKey(a.zeitraum).localeCompare(zeitKey(b.zeitraum))).at(-1);
    return r ? istSigned(r) : null;
  };

  // ── Bestellungen ──
  const nrVon = new Map(((einfuhrNr ?? []) as Array<{ id: string; einfuhr_rechnung: string | null }>).map((o) => [o.id, o.einfuhr_rechnung]));
  const ezVon = einfuhrZahlungen(
    [...nrVon].map(([id, rechnung]) => ({ id, rechnung })),
    alleTx.map((t) => ({ datum: t.booking_date, betrag: Number(t.amount), zweck: t.purpose })),
  );
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
      einfuhrRechnung: nrVon.get(String(o.id)) ?? null,
      einfuhrZahlung: ezVon.get(String(o.id)) ?? null,
    }))
    // Angekommen/eingelagert + bezahlt = erledigt; unbezahlte Ware bleibt eine offene Schuld.
    // Mit Rechnungsnummer bleibt sie, bis die Abgaben abgebucht sind (Umsätze reichen 200 Tage zurück,
    // ältere Ankünfte gelten deshalb als erledigt).
    .filter((b) => {
      if (!(WARE_DA.includes(b.status) && b.restUsd <= 0.01)) return true;
      const ez = b.einfuhrZahlung;
      return !!ez && ez.gefunden.length < ez.rechnungen.length && !!b.eta && b.eta.slice(0, 10) >= plusTage(heute, -60);
    })
    .sort((a, b) => (a.eta ?? "").localeCompare(b.eta ?? ""));

  // ── Ratenzahlung: Ebru komplett, sonst nur manuelle Positionen ──
  const [{ ratenPositionen, letzteZahlung, ratenZahlTage, ratenKommendUsd, lieferungen, ebruNachbestellung }, verschiebungen] = await Promise.all([
    ladeRatenDaten(sb, await ladeEinstellungen(sb)),
    ladeVerschiebungen(sb),
  ]);
  // Ebru-Lieferungen: Einfuhrabgaben bis zur Ankunft bzw. bis die eingetragene Rechnung abgebucht ist
  const einfuhrAndere: LiqEinfuhrPosten[] = lieferungen
    .map((b) => ({ ...b, einfuhrRechnung: nrVon.get(b.id) ?? null, einfuhrZahlung: ezVon.get(b.id) ?? null }))
    .filter((b) => {
      if (!WARE_DA.includes(b.status)) return true;
      const ez = b.einfuhrZahlung;
      return !!ez && ez.gefunden.length < ez.rechnungen.length && !!b.eta && b.eta >= plusTage(heute, -60);
    })
    .sort((a, b) => (a.eta ?? "").localeCompare(b.eta ?? ""));

  // ── Versandtag verschickter Ware (Statusverlauf) + Verzoller-Abbuchungen ohne zugeordnete Bestellung ──
  const unterwegsIds = [...bestellungen, ...einfuhrAndere].filter((b) => b.status === "shipped" || b.status === "in_customs").map((b) => b.id);
  if (unterwegsIds.length) {
    const { data: ev } = await sb
      .from("order_events")
      .select("order_id, created_at, meta")
      .eq("event_type", "status_change")
      .in("order_id", unterwegsIds)
      .order("created_at", { ascending: true });
    // Erster Wechsel auf "versendet" bzw. "beim Zoll" (deutsche Zeit)
    const versandAm = new Map<string, string>();
    for (const x of (ev ?? []) as Array<{ order_id: string; created_at: string; meta: { to?: string } | null }>) {
      if (versandAm.has(x.order_id) || !["shipped", "in_customs"].includes(x.meta?.to ?? "")) continue;
      versandAm.set(x.order_id, new Date(x.created_at).toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" }));
    }
    for (const b of [...bestellungen, ...einfuhrAndere]) b.versandAm = versandAm.get(b.id) ?? null;
  }
  const zollBuchungen = offeneZollBuchungen(
    alleTx
      .filter((t) => t.booking_date >= plusTage(heute, -60))
      .map((t) => ({ datum: t.booking_date, betrag: Number(t.amount), zweck: t.purpose, gegenpartei: t.counterparty_name, kategorie: t.kategorie })),
    [...nrVon.values()],
  );

  // ── Eingetragene Lieferanten-Zahlungen, die noch nicht auf dem Konto stehen (Amanda + Ratenlieferanten) ──
  const { data: zahlRows } = await sb
    .from("payments")
    .select("id, order_id, amount, paid_at, method, orders!inner(label, supplier_id, suppliers(name))")
    .gte("paid_at", plusTage(heute, -10));
  const ratenNamen = (await ladeEinstellungen(sb)).ratenLieferanten.map((r) => r.name.toLowerCase()).filter(Boolean);
  const zahlungenUnterwegs = zahlungenOhneAbbuchung(
    ((zahlRows ?? []) as unknown as Array<{ id: string; order_id: string; amount: number; paid_at: string; method: string | null; orders: { label: string | null; supplier_id: string; suppliers: { name: string } | null } }>)
      // Nur Überweisungen vom Geschäftskonto — PayPal/bar/Karte erscheinen nie als Auslandsüberweisung
      .filter((z) => !/paypal|bar\b|cash|wise|karte|kredit/i.test(z.method ?? ""))
      .map((z) => {
        const lieferant = z.orders.suppliers?.name ?? "";
        const art = z.orders.supplier_id === amandaId ? "amanda" : ratenNamen.some((n) => lieferant.toLowerCase().includes(n)) ? "raten" : null;
        return { id: z.id, orderId: z.order_id, label: String(z.orders.label ?? ""), lieferant, datum: String(z.paid_at).slice(0, 10), usd: Number(z.amount), art };
      })
      .filter((z): z is typeof z & { art: "amanda" | "raten" } => z.art !== null),
    alleTx.map((t) => ({ datum: t.booking_date, betrag: Number(t.amount), zweck: t.purpose, kategorie: t.kategorie })),
    heute,
  );

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
    bankSalden: ((salden ?? []) as Array<{ account_iban: string; saldo: number; stand: string; abgerufen_am: string }>).map((b) => ({
      iban: b.account_iban,
      saldo: Number(b.saldo),
      stand: b.stand,
      abgerufenAm: b.abgerufen_am,
    })),
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
    ratenPositionen,
    letzteZahlung,
    ratenZahlTage,
    ratenKommendUsd,
    einfuhrAndere,
    // Nachbestellen nach Verbrauch (User 12.11.2026): Ebru-Ware = Usbekisch wellig
    ebruNachbestellung: ebruNachbestellung && { ...ebruNachbestellung, kgVerbrauchMonat: verbrauch.wellig },
    zollBuchungen,
    zahlungenUnterwegs,
    verschiebungen,
    steuern: {
      ustHistorie,
      ustErledigtBis: ustPosten.at(-1)?.zeitraum ?? null,
      eustBezahlt,
      lstLetzte: lst.slice(-3).map((p) => istSigned(p)),
      lstErledigtBis: lst.at(-1)?.zeitraum ?? null,
      estLetzte: letzte("est_vz"),
      gewstLetzte: letzte("gewst_vz"),
      quartaleErledigt: erledigt.filter((p) => p.art === "est_vz" || p.art === "gewst_vz").map((p) => `${p.art}|${p.zeitraum}`),
      amandaImportUsd,
      // Eingetragenes Soll offener Posten (noch kein Ist) — z.B. USt-VA vom Steuerberater
      sollGeschaetzt: posten
        .filter((p) => Number(p.ist_betrag) === 0 && Number(p.soll_betrag) > 0 && p.soll_schaetzung)
        .map((p) => `${p.art}|${p.zeitraum}`),
      sollFaellig: Object.fromEntries(
        posten
          .filter((p) => Number(p.ist_betrag) === 0 && Number(p.soll_betrag) > 0 && p.faellig_am)
          .map((p) => [`${p.art}|${p.zeitraum}`, String(p.faellig_am).slice(0, 10)])
      ),
      sollOffen: Object.fromEntries(
        posten
          .filter((p) => Number(p.ist_betrag) === 0 && Number(p.soll_betrag) > 0)
          .map((p) => [`${p.art}|${p.zeitraum}`, (p.richtung === "erstattung" ? -1 : 1) * Number(p.soll_betrag)])
      ),
    },
    nachbestellung: {
      kgProMonatAuto: Math.round((kg90 / 3) * 10) / 10,
      kgVerbrauchMonat: verbrauch.glatt,
      usdProKgAuto: kgPreis > 0 ? Math.round(mitPreis.reduce((s, h) => s + Number(h.invoice_total), 0) / kgPreis) : 0,
      leadWochen,
    },
  };
}

/**
 * Offene Rechnungen mit Ratenzahlung + letzte echte Zahlung je Lieferant.
 * Ebru (Regel in den Einstellungen): alle offenen Rechnungen mit echter Schuld; andere Lieferanten:
 * nur manuelle Positionen. Ware in Produktion hat noch keine Rechnung → nicht im Plan.
 */
export async function ladeRatenDaten(
  sb: Sb,
  einstellungen: LiqEinstellungen,
): Promise<{
  ratenPositionen: LiqManuellePosition[];
  letzteZahlung: Record<string, string>;
  /** Zahltage laut Bank je Lieferant, neueste zuerst (für das Vorrücken verschobener Raten). */
  ratenZahlTage: Record<string, string[]>;
  ratenKommendUsd: Record<string, number>;
  lieferungen: Array<Omit<LiqEinfuhrPosten, "einfuhrRechnung" | "einfuhrZahlung">>;
  ebruNachbestellung: LiqRohdaten["ebruNachbestellung"];
}> {
  const heute = heuteBerlin();
  const [{ data: offeneRows }, { data: alleSup }, { data: lieferRows }] = await Promise.all([
    sb.from("orders_with_totals")
      .select("id, label, status, tracking_number, order_date, created_at, eta, remaining_balance, supplier_id")
      .not("status", "in", "(draft,cancelled,hidden)")
      .gt("remaining_balance", 0.01),
    sb.from("suppliers").select("id, name, default_lead_weeks"),
    // Lieferungen der letzten 12 Monate: Einfuhrabgaben + Bestellrhythmus/Preis für die Nachbestell-Schätzung
    sb.from("orders_with_totals")
      .select("id, label, status, order_date, eta, invoice_effective, invoice_is_estimated, import_vat, weight_kg, supplier_id")
      .not("status", "in", "(draft,cancelled,manual)")
      .gte("order_date", plusTage(heute, -365)),
  ]);
  const supName = new Map((alleSup ?? []).map((x) => [x.id as string, String(x.name)]));
  const istRaten = (name: string) => einstellungen.ratenLieferanten.some((r) => r.name && name.toLowerCase().includes(r.name.toLowerCase()));
  const ratenPositionen: LiqManuellePosition[] = [];
  const ratenKommendUsd: Record<string, number> = {};
  for (const m of (offeneRows ?? []) as Array<Record<string, unknown>>) {
    const lieferantName = supName.get(m.supplier_id as string) ?? "Lieferant";
    const hatRegel = istRaten(lieferantName);
    const bucket = debtBucket({ status: m.status as OrderStatus });
    const eta = m.eta ? String(m.eta).slice(0, 10) : null;
    // Ware in Produktion: Rechnung kommt beim Versand (≈ Ankunft − X Tage) → geschätzt hinten in die Raten
    if (hatRegel && bucket === "upcoming" && !eta) {
      ratenKommendUsd[lieferantName] = (ratenKommendUsd[lieferantName] ?? 0) + Number(m.remaining_balance ?? 0);
      continue;
    }
    const geschaetzt = hatRegel && bucket === "upcoming";
    if (!(m.status === "manual" || (hatRegel && bucket === "due") || geschaetzt)) continue;
    ratenPositionen.push({
      id: String(m.id),
      label: String(m.label ?? ""),
      lieferant: lieferantName,
      datum: geschaetzt ? plusTage(eta as string, -einstellungen.zahlungVorAnkunftTage) : String(m.order_date ?? String(m.created_at).slice(0, 10)),
      restUsd: Number(m.remaining_balance ?? 0),
      ...(geschaetzt ? { geschaetzt: true } : {}),
    });
  }

  type Lief = { id: string; label: string | null; status: string; order_date: string | null; eta: string | null; invoice_effective: number | null; invoice_is_estimated: boolean | null; import_vat: number | null; weight_kg: number | null; supplier_id: string };
  const ratenLief = ((lieferRows ?? []) as Lief[]).filter((o) => istRaten(supName.get(o.supplier_id) ?? ""));
  const lieferungen = ratenLief
    .filter((o) => o.status !== "hidden" && Number(o.invoice_effective ?? 0) > 0)
    .map((o) => ({
      id: o.id,
      label: String(o.label ?? ""),
      lieferant: supName.get(o.supplier_id) ?? "Lieferant",
      status: o.status,
      eta: o.eta ? String(o.eta).slice(0, 10) : null,
      warenUsd: Number(o.invoice_effective),
      importVatEur: o.import_vat == null ? null : Number(o.import_vat),
      geschaetzt: debtBucket({ status: o.status as OrderStatus }) === "upcoming",
    }));
  // Rhythmus: Bestellungen (auch ausgeblendete, die in Sammelrechnungen aufgegangen sind) der letzten
  // 6 Monate — 6 statt 3 Monate, damit der Black-Friday-Vorrat die Schätzung nicht aufbläht
  const erste = einstellungen.ratenLieferanten[0];
  const ebruSup = erste ? (alleSup ?? []).find((x) => String(x.name).toLowerCase().includes(erste.name.toLowerCase())) : undefined;
  let ebruNachbestellung: LiqRohdaten["ebruNachbestellung"] = null;
  if (ebruSup) {
    const eigene = ratenLief.filter((o) => o.supplier_id === ebruSup.id && Number(o.weight_kg ?? 0) > 0);
    const kg180 = eigene.filter((o) => (o.order_date ?? "") >= plusTage(heute, -182)).reduce((s, o) => s + Number(o.weight_kg), 0);
    const mitPreis = eigene.filter((o) => o.status !== "hidden" && Number(o.invoice_effective ?? 0) > 0);
    const kgPreis = mitPreis.reduce((s, o) => s + Number(o.weight_kg), 0);
    ebruNachbestellung = {
      lieferant: String(ebruSup.name),
      kgProMonatAuto: Math.round((kg180 / 6) * 10) / 10,
      usdProKgAuto: kgPreis > 0 ? Math.round(mitPreis.reduce((s, o) => s + Number(o.invoice_effective), 0) / kgPreis) : 0,
      leadWochen: Number(ebruSup.default_lead_weeks ?? 8),
    };
  }
  // Letzte echte Zahlung je Lieferant: jüngste Abbuchung an den Empfänger laut Kontoumsätzen
  const letzteZahlung: Record<string, string> = {};
  const ratenZahlTage: Record<string, string[]> = {};
  await Promise.all(
    [...new Set(ratenPositionen.map((x) => x.lieferant))].map(async (lieferantName) => {
      const muster = ratenRegelFuer(lieferantName, einstellungen).bankMuster.trim();
      if (!muster) return;
      const { data } = await sb
        .from("bank_transactions")
        .select("booking_date")
        .lt("amount", 0)
        .ilike("counterparty_name", `%${muster}%`)
        .order("booking_date", { ascending: false })
        .limit(60);
      const tage = [...new Set(((data ?? []) as Array<{ booking_date: string }>).map((x) => String(x.booking_date).slice(0, 10)))];
      if (tage.length) {
        letzteZahlung[lieferantName] = tage[0];
        ratenZahlTage[lieferantName] = tage;
      }
    }),
  );
  return { ratenPositionen, letzteZahlung, ratenZahlTage, ratenKommendUsd, lieferungen, ebruNachbestellung };
}

/** Von Hand verschobene Zahltermine (Tabelle liquiditaet_verschiebung). */
export async function ladeVerschiebungen(sb: Sb): Promise<LiqVerschiebungen> {
  const { data, error } = await sb.from("liquiditaet_verschiebung").select("art, schluessel, datum, notiz, letzte_zahlung, anzahlung_usd, rest_datum, rest_basis_usd");
  if (error) throw new Error(error.message);
  const out: LiqVerschiebungen = { bestellungen: {}, raten: {} };
  type Zeile = { art: string; schluessel: string; datum: string; notiz: string | null; letzte_zahlung: string | null; anzahlung_usd: number | null; rest_datum: string | null; rest_basis_usd: number | null };
  for (const v of (data ?? []) as Zeile[]) {
    const eintrag = {
      datum: v.datum,
      notiz: v.notiz,
      basisZahlung: v.letzte_zahlung,
      anzahlungUsd: v.anzahlung_usd == null ? null : Number(v.anzahlung_usd),
      restDatum: v.rest_datum,
      restBasisUsd: v.rest_basis_usd == null ? null : Number(v.rest_basis_usd),
    };
    if (v.art === "bestellung") out.bestellungen[v.schluessel] = eintrag;
    else out.raten[v.schluessel] = eintrag;
  }
  return out;
}

/** Geplante Ratentermine je Bestellung (für "nächste Rate" in Übersicht/Bestellliste). */
export const ladeRatenTermine = cache(async (): Promise<Record<string, string[]>> => {
  const sb = createServiceClient();
  const e = await ladeEinstellungen(sb);
  const [{ ratenPositionen, letzteZahlung, ratenZahlTage }, verschiebungen] = await Promise.all([ladeRatenDaten(sb, e), ladeVerschiebungen(sb)]);
  const termine: Record<string, string[]> = {};
  for (const r of ratenplan(ratenPositionen, letzteZahlung, e, heuteBerlin(), verschiebungen.raten, ratenZahlTage)) {
    for (const p of r.positionen) (termine[p.id] ??= []).push(r.datum);
  }
  return termine;
});

/**
 * Echter Kontostand je Tag für das Diagramm — nur die Liquiditätsseite braucht ihn,
 * deshalb nicht in ladeRohdaten (das läuft auch bei jeder Bestellliste).
 */
export async function ladeKontoVerlauf(sb: Sb, roh: Pick<LiqRohdaten, "konten" | "heute">, e: LiqEinstellungen): Promise<VerlaufTag[]> {
  const ibans = roh.konten.map((k) => k.iban);
  if (!ibans.length) return [];
  const ratenMuster = e.ratenLieferanten.map((r) => r.bankMuster.trim().toLowerCase()).filter(Boolean);
  // Gleiche Gruppen wie die Termine der Vorschau, damit Vergangenheit und Plan zusammenpassen
  const gruppeVon = (t: Pick<Tx, "amount" | "kategorie" | "counterparty_name" | "purpose">): ZahlGruppe | null => {
    const k = t.kategorie ?? "";
    if (k === "st_eust") return "einfuhr";
    if (k.startsWith("st_")) return "steuern";
    if (t.amount >= 0) return null;
    if (istAmandaZahlung(t.counterparty_name, t.purpose)) return "amanda";
    const name = (t.counterparty_name ?? "").toLowerCase();
    return ratenMuster.some((m) => name.includes(m)) ? "ebru" : null;
  };
  // Amanda/Ebru: Rechnungsnummer aus dem Verwendungszweck ist aussagekräftiger als der Empfänger
  const nameVon = (t: Pick<Tx, "kategorie" | "counterparty_name" | "purpose">, gruppe: ZahlGruppe | null) => {
    const basis = t.counterparty_name?.trim() || KATEGORIE_BY_KEY[t.kategorie ?? "unklar"]?.label || "Buchung";
    const nr = gruppe === "amanda" || gruppe === "ebru" ? (t.purpose ?? "").match(/AMANDAGRM[\w-]+|EHL\d{6,}/i)?.[0] : null;
    if (gruppe === "amanda") return nr ? `Amanda · ${nr}` : "Amanda";
    if (gruppe === "ebru") return nr ? `Ebru · ${nr}` : `Ebru · ${basis}`;
    return basis;
  };
  const tx = await selectAll<Pick<Tx, "account_iban" | "booking_date" | "amount" | "kategorie" | "counterparty_name" | "purpose">>((from, to) =>
    sb.from("bank_transactions")
      .select("account_iban, booking_date, amount, kategorie, counterparty_name, purpose")
      .in("account_iban", ibans)
      .order("booking_date", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to)
  );
  return kontoVerlauf(
    tx.map((t) => {
      const betrag = Number(t.amount);
      const gruppe = gruppeVon({ ...t, amount: betrag });
      return {
        iban: t.account_iban as string,
        datum: t.booking_date,
        betrag,
        name: gruppe ? nameVon(t, gruppe) : t.counterparty_name?.trim() || KATEGORIE_BY_KEY[t.kategorie ?? "unklar"]?.label || "Buchung",
        intern: t.kategorie === "umbuchung",
        gruppe,
      };
    }),
    roh.konten,
    roh.heute,
  );
}

/** Einmal pro Request (Bestellliste + Detailseite rufen es ggf. mehrfach). */
export const ladePrognose = cache(async (): Promise<{ roh: LiqRohdaten; einstellungen: LiqEinstellungen; ergebnis: PrognoseErgebnis }> => {
  const sb = createServiceClient();
  const [roh, einstellungen] = await Promise.all([ladeRohdaten(sb), ladeEinstellungen(sb)]);
  return { roh, einstellungen, ergebnis: prognose(roh, einstellungen) };
});

/** DHL-/Zoll-Rechnungsnummer einer Bestellung + Abgleich mit dem Konto (für die Bestellseite). */
export async function ladeEinfuhrRechnung(orderId: string, sb: Sb = createServiceClient()): Promise<{ rechnung: string | null; zahlung: EinfuhrZahlung | null }> {
  const { data } = await sb.from("orders").select("einfuhr_rechnung").eq("id", orderId).maybeSingle();
  const rechnung = (data?.einfuhr_rechnung as string | null | undefined) ?? null;
  const nr = rechnungsNummern(rechnung);
  if (!nr.length) return { rechnung, zahlung: null };
  // Nummern bestehen nur aus A-Z/0-9 → sicher im or()-Filter
  const { data: tx, error } = await sb
    .from("bank_transactions")
    .select("booking_date, amount, purpose")
    .lt("amount", 0)
    .or(nr.map((n) => `purpose.ilike.%${n}%`).join(","));
  if (error) throw new Error(error.message);
  const buchungen = (tx ?? []).map((t) => ({ datum: t.booking_date as string, betrag: Number(t.amount), zweck: t.purpose as string | null }));
  return { rechnung, zahlung: einfuhrZahlungen([{ id: orderId, rechnung }], buchungen).get(orderId) ?? null };
}
