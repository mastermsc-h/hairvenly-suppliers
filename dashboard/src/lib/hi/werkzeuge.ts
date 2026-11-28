/**
 * Werkzeuge von "Hi" (Hairvenly Intelligence). Alle nur lesend.
 * - datenbank_*: freie SELECT-Abfragen über hi_abfrage (Rolle hi_reader, schreibgeschützt, ohne Tokens/PINs)
 * - fachliche Auswertungen, die nicht in der Datenbank stehen (Liquiditätsvorschau, Lagerbedarf,
 *   Verkaufsanalyse aus dem Sheet, Shopify-Tagesumsätze live)
 */
import type Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/server";
import { ladePrognose } from "@/lib/liquiditaet/daten";
import { ladeRohZusatz } from "@/lib/liquiditaet/erweitert";
import { SZENARIO_STANDARD, plusTage, prognose, type LiqSzenario } from "@/lib/liquiditaet/rechnung";
import { readVerkaufsanalyse } from "@/lib/stock-sheets";
import { shopifyGraphQL } from "@/lib/shopify";
import { ladeLagerBedarf } from "./lager-bedarf";

const MAX_ZEICHEN = 24_000;

export const WERKZEUGE: Anthropic.Tool[] = [
  {
    name: "datenbank_tabellen",
    description:
      "Zeigt Spalten und Datentypen bestimmter Tabellen der Hairvenly-Datenbank (PostgreSQL, Schema public). Ohne Angabe nur die Liste aller Tabellennamen. Vor einer Abfrage auf eine Tabelle, deren Spalten du nicht sicher kennst, hier mit dem Tabellennamen nachsehen.",
    input_schema: {
      type: "object",
      properties: { tabellen: { type: "array", items: { type: "string" }, description: "Tabellennamen, z.B. [\"sick_days\", \"staff_members\"]" } },
    },
  },
  {
    name: "datenbank_abfrage",
    description:
      "Führt GENAU EINE lesende SQL-Abfrage (SELECT oder WITH … SELECT, PostgreSQL) auf der Hairvenly-Datenbank aus und gibt bis zu 300 Zeilen als JSON zurück. Schreiben ist technisch unmöglich. Rechne Summen, Gruppierungen und Durchschnitte in SQL statt viele Rohzeilen zu holen. Datumsangaben sind meist date bzw. timestamptz (UTC) — für deutsche Tage `(spalte at time zone 'Europe/Berlin')::date`.",
    input_schema: {
      type: "object",
      properties: {
        sql: { type: "string", description: "Die SELECT-Abfrage, ohne Semikolon" },
        zweck: { type: "string", description: "Kurz auf Deutsch, was die Abfrage herausfinden soll (wird dem Nutzer angezeigt)" },
      },
      required: ["sql", "zweck"],
    },
  },
  {
    name: "liquiditaet_vorschau",
    description:
      "Liquiditätsvorschau wie /finances/liquiditaet, gleiche Rechnung wie die Seite: Startstand Sparkasse+PayPal, Ø Einnahmen und laufende Abgänge pro Tag, Tiefpunkt, alle geplanten Zahlungen (Amanda-Bestellungen, Ebru-Raten, Einfuhrabgaben inkl. angekommener Sendungen, deren DHL-Abbuchung noch aussteht, USt/LSt/ESt/GewSt, erwartete ESt-/GewSt-Nachzahlungen je Steuerjahr samt angehobener Vorauszahlungen, Aktionen wie Black Friday/Sales, Nachbestellungen), offene Lieferantenschulden und Hinweise. Zeitraum 14–548 Tage (Standard 90; für Fragen zu 2027/2028 länger wählen). Optional Was-wäre-wenn: nur das Nötigste nachbestellen (Bestellmengen nach Lagerbestand, voller Verbrauch erst wenn der Übervorrat abgebaut ist) und/oder Lieferanten ohne Engpass zahlen (Lieferantenzahlungen erst, wenn das Konto über der Reserve bleibt) — dann kommt auch der Vergleich ohne Szenario mit. Für Fragen zu Geld, Schulden, Zahlungsterminen, ob etwas bezahlbar ist.",
    input_schema: {
      type: "object",
      properties: {
        tage: { type: "number", description: "Vorschau-Zeitraum in Tagen ab heute, 14–548 (Standard 90 = gespeicherte Einstellung)" },
        nur_bis: { type: "string", description: "Optional: nur Zahlungen bis zu diesem Datum (YYYY-MM-DD)" },
        details: { type: "boolean", description: "true = jede einzelne Zahlung und jede Ebru-Rechnung. Standard: Zusammenfassung (Summen je Monat und Art, nur Zahlungen ab 5.000 €)" },
        nur_noetigstes: { type: "boolean", description: "Was-wäre-wenn: Nachbestellungen nur im Mindestbedarf, solange der verkaufbare Bestand (Lager + unterwegs − Ladenhüter) über der Ziel-Reichweite liegt" },
        mindest_amanda_kg_monat: { type: "number", description: "Mindestbedarf glatt/Amanda kg/Monat (Standard 9)" },
        mindest_ebru_kg_monat: { type: "number", description: "Mindestbedarf wellig/Ebru kg/Monat (Standard 24)" },
        ziel_reichweite_monate: { type: "number", description: "Darunter wird wieder nach Verbrauch bestellt (Standard 3)" },
        ladenhueter_glatt_kg: { type: "number", description: "Ladenhüter glatt in kg, zählen nicht als Bestand (Standard 56)" },
        ladenhueter_wellig_kg: { type: "number", description: "Ladenhüter wellig in kg (Standard 52)" },
        amanda_kg_monat: { type: "number", description: "Was-wäre-wenn: Amanda (glatt) so viele kg pro Monat nachbestellen statt Verbrauch — Ergebnis zeigt unter lagerBestand, ob/wann das Lager eng oder leer wird" },
        ebru_kg_monat: { type: "number", description: "Was-wäre-wenn: Ebru (wellig) kg pro Monat statt Verbrauch" },
        lieferanten_ohne_engpass: { type: "boolean", description: "Was-wäre-wenn: Lieferantenzahlungen verschieben/teilen, damit das Konto über der Reserve bleibt" },
        min_teilzahlung_eur: { type: "number", description: "Kleinste Teilzahlung beim Verschieben (Standard 5000)" },
      },
    },
  },
  {
    name: "lager_bedarf",
    description:
      "Lagerbestand, Verkauf und echter Nachbestellbedarf je Produkt für Russisch glatt (Lieferant Amanda) und Usbekisch wellig (Lieferant Ebru): Lager-kg, unterwegs-kg, Verkauf kg/Monat, Reichweite in Monaten, kg je künftiger Bestellung (Bestell-bis-Prinzip: Lieferzeit + Rhythmus + Puffer), Überbestand, Ladenhüter (kein Verkauf in 90 Tagen) und die Produkte, die jetzt nachbestellt werden müssen.",
    input_schema: {
      type: "object",
      properties: {
        basis: { type: "string", enum: ["ø90", "vorsichtig"], description: "ø90 = Verkauf der letzten 90 Tage (Standard), vorsichtig = höherer Wert aus 30 und 90 Tagen" },
        rhythmus_tage: { type: "number", description: "Bestellrhythmus in Tagen, Standard 14" },
        puffer_tage: { type: "number", description: "Sicherheitspuffer in Tagen, Standard 14" },
        details: { type: "boolean", description: "true = alle Produkte zum Nachbestellen und alle Ladenhüter-Beispiele. Standard: die 12 wichtigsten" },
      },
    },
  },
  {
    name: "verkaufsanalyse",
    description: "Verkauf in kg je Kollektion (Tapes, Bondings, Clip-ins …) und Qualität laut Verkaufsanalyse-Sheet: Ø 12 Monate, Ø 3 Monate, letzte 30 Tage, Trend.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "shopify_umsatz_tage",
    description: "Shopify-Bestellungen live je Tag (deutsche Zeit) in einem Zeitraum von höchstens 120 Tagen: Anzahl, Bestellwert brutto, Wert nach Erstattungen/Stornos. Für Fragen zu einzelnen Tagen, Aktionen, Vorjahresvergleichen.",
    input_schema: {
      type: "object",
      properties: { von: { type: "string", description: "YYYY-MM-DD" }, bis: { type: "string", description: "YYYY-MM-DD (einschließlich)" } },
      required: ["von", "bis"],
    },
  },
];

/** Kurztext für die Oberfläche, während ein Werkzeug läuft. */
export function werkzeugLabel(name: string, input: unknown): string {
  const i = (input ?? {}) as Record<string, unknown>;
  switch (name) {
    case "datenbank_abfrage":
      return typeof i.zweck === "string" && i.zweck ? i.zweck : "Durchsucht die Datenbank";
    case "datenbank_tabellen":
      return Array.isArray(i.tabellen) && i.tabellen.length ? `Liest den Aufbau von ${i.tabellen.join(", ")}` : "Verschafft sich einen Überblick über die Daten";
    case "liquiditaet_vorschau": {
      const was = [i.nur_noetigstes ? "nur das Nötigste" : "", i.lieferanten_ohne_engpass ? "Lieferanten ohne Engpass" : ""].filter(Boolean).join(" + ");
      return `Rechnet die Liquiditätsvorschau${typeof i.tage === "number" ? ` (${Math.round(i.tage)} Tage)` : ""}${was ? ` — was wäre wenn: ${was}` : ""}`;
    }
    case "lager_bedarf":
      return "Prüft Lager, Verkauf und Bedarf je Produkt";
    case "verkaufsanalyse":
      return "Liest die Verkaufsanalyse";
    case "shopify_umsatz_tage":
      return `Holt Shopify-Umsätze ${String(i.von ?? "")} bis ${String(i.bis ?? "")}`;
    default:
      return name;
  }
}

const kuerzen = (wert: unknown): string => {
  const s = JSON.stringify(wert);
  return s.length > MAX_ZEICHEN ? `${s.slice(0, MAX_ZEICHEN)} … [gekürzt — Abfrage enger fassen oder in SQL zusammenfassen]` : s;
};

async function abfrage(sql: string): Promise<unknown> {
  const sb = createServiceClient();
  const { data, error } = await sb.rpc("hi_abfrage", { sql });
  if (error) throw new Error(error.message);
  return data;
}

const datum = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

async function shopifyTage(von: string, bis: string) {
  type Node = { createdAt: string; cancelledAt: string | null; test: boolean; totalPriceSet: { shopMoney: { amount: string } }; currentTotalPriceSet: { shopMoney: { amount: string } } };
  type Res = { orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; edges: Array<{ node: Node }> } };
  const tag = new Map<string, { bestellungen: number; bestellwert: number; nachErstattung: number }>();
  // UTC-Grenzen großzügig, die Zuordnung zum deutschen Tag passiert unten
  const q = `created_at:>='${von}T00:00:00+02:00' created_at:<'${bis}T23:59:59+01:00'`;
  let after: string | null = null;
  for (let s = 0; s < 120; s++) {
    const res: { data?: Res } = await shopifyGraphQL<Res>(
      `query($q: String!, $after: String) { orders(first: 250, after: $after, query: $q) { pageInfo { hasNextPage endCursor } edges { node { createdAt cancelledAt test totalPriceSet { shopMoney { amount } } currentTotalPriceSet { shopMoney { amount } } } } } }`,
      { q, after },
    );
    const o = res.data?.orders;
    if (!o) throw new Error("Shopify: keine Bestelldaten");
    for (const { node } of o.edges) {
      if (node.test) continue;
      const d = new Date(node.createdAt).toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
      if (d < von || d > bis) continue;
      const t = tag.get(d) ?? { bestellungen: 0, bestellwert: 0, nachErstattung: 0 };
      if (!node.cancelledAt) {
        t.bestellungen++;
        t.bestellwert += Number(node.totalPriceSet.shopMoney.amount) || 0;
        t.nachErstattung += Number(node.currentTotalPriceSet.shopMoney.amount) || 0;
      }
      tag.set(d, t);
    }
    if (!o.pageInfo.hasNextPage) break;
    after = o.pageInfo.endCursor;
  }
  const tage = [...tag.entries()].sort().map(([d, t]) => ({ tag: d, bestellungen: t.bestellungen, bestellwert: Math.round(t.bestellwert), nachErstattung: Math.round(t.nachErstattung) }));
  return { tage, summe: { bestellungen: tage.reduce((s, t) => s + t.bestellungen, 0), bestellwert: tage.reduce((s, t) => s + t.bestellwert, 0), nachErstattung: tage.reduce((s, t) => s + t.nachErstattung, 0) } };
}

/** Bestellplan „nur das Nötigste“ für Hi: ohne Einzelmengen nur die Eckdaten (sonst zu lang). */
function bedarfKurz(b: ReturnType<typeof prognose>["bedarf"], details: boolean) {
  if (!b) return null;
  const kurz = (q: NonNullable<typeof b.glatt>) => {
    const vor = q.mengen.filter((m) => !q.umstieg || m.datum < q.umstieg);
    return {
      lagerKg: q.lagerKg, unterwegsKg: q.unterwegsKg, ladenhueterKg: q.ladenhueterKg, verkaufbarKg: q.verkaufbarKg,
      verbrauchKgMonat: q.verbrauchKgMonat, mindestKgMonat: q.mindestKgMonat, zielKg: q.zielKg,
      reichweiteMonate: q.verbrauchKgMonat > 0 ? Math.round((q.verkaufbarKg / q.verbrauchKgMonat) * 10) / 10 : null,
      wiederVollAbBestellung: q.umstieg,
      kgBisDahin: Math.round(vor.reduce((s, m) => s + m.kg, 0)),
      ...(details ? { mengen: q.mengen } : {}),
    };
  };
  return { glatt: b.glatt ? kurz(b.glatt) : null, wellig: b.wellig ? kurz(b.wellig) : null };
}

type LiqOptionen = { tage?: number; nurBis?: string; details?: boolean; szenario?: Partial<LiqSzenario> | null; kgMonat?: { amanda?: number; ebru?: number } };

async function liquiditaet({ tage, nurBis, details = false, szenario, kgMonat }: LiqOptionen) {
  // Gleiche Daten wie die Seite: Rohdaten + Steuer-Hochrechnung + Lagerbestand
  const [{ roh: rohBasis, einstellungen: gespeichert }, zusatz] = await Promise.all([ladePrognose(), ladeRohZusatz()]);
  const roh = { ...rohBasis, ...zusatz };
  const einstellungen = {
    ...gespeichert,
    ...(tage ? { horizontTage: Math.round(tage) } : {}),
    ...(kgMonat?.amanda !== undefined ? { nachbestellKgMonat: kgMonat.amanda } : {}),
    ...(kgMonat?.ebru !== undefined ? { ebruNachbestellKgMonat: kgMonat.ebru } : {}),
  };
  const kgGeaendert = kgMonat?.amanda !== undefined || kgMonat?.ebru !== undefined;
  const sz: LiqSzenario | null = szenario && (szenario.nurNoetigstes || szenario.glaetten) ? { ...SZENARIO_STANDARD, ...szenario } : null;
  const p = prognose(roh, einstellungen, sz);
  const ohne = sz ? prognose(roh, einstellungen) : kgGeaendert ? prognose(roh, { ...gespeichert, ...(tage ? { horizontTage: Math.round(tage) } : {}) }) : null;
  const bis = nurBis ?? p.tage.at(-1)?.datum ?? p.start;
  const nah = plusTage(p.start, 120);
  const ratenPos = roh.ratenPositionen ?? [];
  return {
    zeitraum: { von: p.start, bis: p.tage.at(-1)?.datum ?? p.start, tage: einstellungen.horizontTage },
    ...(sz
      ? {
          wasWaereWenn: {
            nurNoetigstes: sz.nurNoetigstes ? { mindestKgMonat: { amanda: sz.amandaKgMonat, ebru: sz.ebruKgMonat }, zielReichweiteMonate: sz.zielMonate, ladenhueterKg: { glatt: sz.ladenhueterGlattKg, wellig: sz.ladenhueterWelligKg }, bestellplan: bedarfKurz(p.bedarf, details) } : null,
            lieferantenOhneEngpass: sz.glaetten ? { minTeilzahlungEur: sz.minTeilEur, ergebnis: p.glaettung } : null,
            hinweis: "Nur Was-wäre-wenn — nicht gespeichert; die Ampel an den Bestellungen rechnet ohne.",
            ohneSzenario: ohne ? { tiefpunkt: ohne.tiefpunkt, standAmEnde: Math.round(ohne.tage.at(-1)?.saldo ?? 0) } : null,
          },
        }
      : {}),
    ...(kgGeaendert && ohne ? { kgMonatWasWaereWenn: { amanda: kgMonat?.amanda ?? null, ebru: kgMonat?.ebru ?? null, ohneAenderung: { tiefpunkt: ohne.tiefpunkt, standAmEnde: Math.round(ohne.tage.at(-1)?.saldo ?? 0) }, hinweis: "Nur Was-wäre-wenn — nicht gespeichert." } } : {}),
    // Lager je Qualität mit den Nachbestellungen dieser Rechnung: engpassAb = Bestand unter Lieferzeit + Rhythmus (Nachschub käme zu spät), leerAb = 0 kg
    lagerBestand: Object.fromEntries(
      (["glatt", "wellig"] as const).map((q) => {
        const l = p.lager[q];
        return [q, l ? { verkaufbarKg: l.verkaufbarKg, verbrauchKgMonat: l.verbrauchKgMonat, bestelltKgMonat: l.bestellKgMonat, mindestKg: l.mindestKg, engpassAb: l.engpassAb, leerAb: l.leerAb, endeKg: l.endeKg, ...(details ? { punkte: l.punkte } : {}) } : null];
      }),
    ),
    steuerHochrechnung: roh.steuerPrognose ?? null,
    lagerKg: roh.lagerKg ?? null,
    start: p.start,
    startstand: p.startSaldoGesamt,
    paypal: p.paypal,
    wechselkursUsdProEur: p.fx,
    einnahmenProTag: p.einnahmenProTag,
    laufendeAbgaengeProTag: p.laufendProTag,
    laufendeAbgaengeBasis: details ? roh.basis : { monate: roh.basis.monate, tage: roh.basis.tage, laufend: roh.basis.laufend },
    flauteNachAktionSumme: p.nachlaufSumme,
    tiefpunkt: p.tiefpunkt,
    standAmEnde: Math.round(p.tage.at(-1)?.saldo ?? 0),
    // Lange Zeiträume: wöchentlich würde zu lang → ab 120 Tagen alle 14 Tage
    standJeWoche: p.tage.filter((_, i) => i % (p.tage.length > 120 ? 14 : 7) === 0).map((t) => `${t.datum}: ${Math.round(t.saldo)}`).join(" | "),
    // Lange Zeiträume sprengen sonst das Antwort-Limit: einzeln nur die nächsten 120 Tage (ab 5.000 €)
    // und danach große Einzelzahlungen ab 25.000 € — der Rest steckt in den Monatssummen.
    zahlungen: p.ereignisse
      .filter((x) => x.datum <= bis && (details || Math.abs(x.betrag) >= (x.datum <= nah ? 5000 : 25_000)))
      .slice(0, details ? 300 : 80)
      .map((x) => ({ datum: x.datum, art: x.art, betragEur: Math.round(x.betrag), text: x.label, ...(x.schaetzung ? { schaetzung: true } : {}), ...(x.unterwegs ? { nochNichtAufKonto: true } : {}) })),
    ...(details ? {} : { zahlungenHinweis: `Einzeln: bis ${nah} ab 5.000 €, danach ab 25.000 € — alles andere in summenJeMonat (details=true für jede Zahlung)` }),
    summenJeMonat: p.ereignisse.filter((x) => x.datum <= bis).reduce<Record<string, Record<string, number>>>((acc, x) => {
      const m = (acc[x.datum.slice(0, 7)] ??= {});
      m[x.art] = Math.round((m[x.art] ?? 0) + x.betrag);
      return acc;
    }, {}),
    schulden: {
      amandaOffenEur: Math.round(p.bestellungen.filter((b) => !b.bezahlt).reduce((s, b) => s + b.betragEur, 0)),
      ebruRatenOffenUsd: Math.round(ratenPos.reduce((s, x) => s + Math.max(0, x.restUsd), 0)),
      davonWareInProduktionUsd: Math.round(ratenPos.filter((x) => x.geschaetzt).reduce((s, x) => s + Math.max(0, x.restUsd), 0)),
      ...(details ? { ebruRechnungen: ratenPos.map((x) => ({ text: x.label, datum: x.datum, restUsd: Math.round(x.restUsd), geschaetzt: !!x.geschaetzt })) } : { ebruRechnungenAnzahl: ratenPos.length }),
    },
    amandaBestellungen: p.bestellungen.map((b) => ({ text: b.label, status: b.status, ankunft: b.eta, offenEur: Math.round(b.betragEur), bezahlt: b.bezahlt, zahltag: b.zahlDatum, einfuhr: b.einfuhr ? { datum: b.einfuhr.datum, eur: Math.round(b.einfuhr.eust + b.einfuhr.zoll) } : null })),
    annahmen: {
      ebruRaten: einstellungen.ratenLieferanten,
      nachbestellungen: { amanda: einstellungen.nachbestellungenEinrechnen, ebru: einstellungen.ebruNachbestellungenEinrechnen, abstandTage: einstellungen.nachbestellAbstandTage, amandaKgMonat: p.nachbestellKgMonat, ebruKgMonat: p.ebruNachbestellKgMonat },
      aktion: einstellungen.aktion,
      weitereAktionen: einstellungen.weitereAktionen,
      steuerNachzahlungen: einstellungen.steuerNachzahlungen,
      reserve: einstellungen.puffer,
      ausgeblendeteKategorien: einstellungen.ausgeblendeteKategorien,
    },
    hinweise: p.hinweise,
  };
}

/** Führt ein Werkzeug aus; Fehler kommen als Text zurück (is_error), damit Hi reagieren kann. */
export async function fuehreAus(name: string, input: unknown): Promise<{ inhalt: string; fehler: boolean }> {
  try {
    switch (name) {
      case "datenbank_tabellen": {
        const { tabellen } = z.object({ tabellen: z.array(z.string().regex(/^[a-z0-9_]+$/)).max(30).optional() }).parse(input ?? {});
        if (!tabellen?.length) {
          const namen = (await abfrage(
            "select string_agg(table_name, ', ' order by table_name) as tabellen from information_schema.tables where table_schema = 'public' and table_name not like '\\_backup%'",
          )) as Array<{ tabellen: string }>;
          return { inhalt: namen[0]?.tabellen ?? "", fehler: false };
        }
        const sql = `select c.table_name as tabelle, string_agg(c.column_name || ' ' || c.data_type, ', ' order by c.ordinal_position) as spalten
          from information_schema.columns c where c.table_schema = 'public' and c.table_name in (${tabellen.map((t) => `'${t}'`).join(",")}) group by c.table_name order by c.table_name`;
        return { inhalt: kuerzen(await abfrage(sql)), fehler: false };
      }
      case "datenbank_abfrage": {
        const { sql } = z.object({ sql: z.string().min(1).max(8000), zweck: z.string().optional() }).parse(input);
        return { inhalt: kuerzen(await abfrage(sql)), fehler: false };
      }
      case "liquiditaet_vorschau": {
        const i = z
          .object({
            tage: z.number().min(14).max(548).optional(),
            nur_bis: datum.optional(),
            details: z.boolean().optional(),
            nur_noetigstes: z.boolean().optional(),
            mindest_amanda_kg_monat: z.number().min(0).max(1000).optional(),
            mindest_ebru_kg_monat: z.number().min(0).max(1000).optional(),
            ziel_reichweite_monate: z.number().min(0).max(24).optional(),
            ladenhueter_glatt_kg: z.number().min(0).max(5000).optional(),
            ladenhueter_wellig_kg: z.number().min(0).max(5000).optional(),
            lieferanten_ohne_engpass: z.boolean().optional(),
            amanda_kg_monat: z.number().min(0).max(1000).optional(),
            ebru_kg_monat: z.number().min(0).max(1000).optional(),
            min_teilzahlung_eur: z.number().min(100).max(1_000_000).optional(),
          })
          .parse(input ?? {});
        const szenario: Partial<LiqSzenario> = {
          nurNoetigstes: !!i.nur_noetigstes,
          glaetten: !!i.lieferanten_ohne_engpass,
          ...(i.mindest_amanda_kg_monat !== undefined ? { amandaKgMonat: i.mindest_amanda_kg_monat } : {}),
          ...(i.mindest_ebru_kg_monat !== undefined ? { ebruKgMonat: i.mindest_ebru_kg_monat } : {}),
          ...(i.ziel_reichweite_monate !== undefined ? { zielMonate: i.ziel_reichweite_monate } : {}),
          ...(i.ladenhueter_glatt_kg !== undefined ? { ladenhueterGlattKg: i.ladenhueter_glatt_kg } : {}),
          ...(i.ladenhueter_wellig_kg !== undefined ? { ladenhueterWelligKg: i.ladenhueter_wellig_kg } : {}),
          ...(i.min_teilzahlung_eur !== undefined ? { minTeilEur: i.min_teilzahlung_eur } : {}),
        };
        return { inhalt: kuerzen(await liquiditaet({ tage: i.tage, nurBis: i.nur_bis, details: i.details, szenario, kgMonat: { amanda: i.amanda_kg_monat, ebru: i.ebru_kg_monat } })), fehler: false };
      }
      case "lager_bedarf": {
        const i = z.object({ basis: z.enum(["ø90", "vorsichtig"]).optional(), rhythmus_tage: z.number().min(1).max(90).optional(), puffer_tage: z.number().min(0).max(120).optional(), details: z.boolean().optional() }).parse(input ?? {});
        const bedarf = await ladeLagerBedarf({ basis: i.basis, rhythmusTage: i.rhythmus_tage, pufferTage: i.puffer_tage });
        const kurz = i.details
          ? bedarf
          : bedarf.map((q) => ({
              ...q,
              ladenhueter: { ...q.ladenhueter, beispiele: q.ladenhueter.beispiele.slice(0, 6).map((x) => `${x.produkt} ${x.lagerG} g`) },
              jetztNachbestellen: q.jetztNachbestellen.slice(0, 12).map((x) => `${x.produkt}: ${x.mengeG} g (Lager ${x.lagerG}, unterwegs ${x.unterwegsG}, verkauft 30T ${x.verkauftG30}/90T ${x.verkauftG90})`),
              jetztNachbestellenAnzahl: q.jetztNachbestellen.length,
            }));
        return { inhalt: kuerzen(kurz), fehler: false };
      }
      case "verkaufsanalyse": {
        const { rows, lastUpdated } = await readVerkaufsanalyse();
        const zeilen = rows
          .filter((r) => r.collection && !/^Trend/i.test(r.collection))
          .map((r) => `${r.quality} · ${r.collection}: Ø12M ${r.avg12mKg} kg, Ø3M ${r.avg3mKg} kg, 30T ${r.d30Kg} kg${r.trend ? `, Trend ${r.trend}` : ""}`);
        return { inhalt: kuerzen({ stand: lastUpdated, kgProMonat: zeilen }), fehler: false };
      }
      case "shopify_umsatz_tage": {
        const { von, bis } = z.object({ von: datum, bis: datum }).parse(input);
        const tage = (Date.parse(bis) - Date.parse(von)) / 864e5;
        if (tage < 0 || tage > 120) return { inhalt: "Zeitraum muss zwischen 1 und 120 Tagen liegen.", fehler: true };
        return { inhalt: kuerzen(await shopifyTage(von, bis)), fehler: false };
      }
      default:
        return { inhalt: `Unbekanntes Werkzeug: ${name}`, fehler: true };
    }
  } catch (e) {
    const text = e instanceof z.ZodError ? `Ungültige Eingabe: ${e.issues.map((x) => `${x.path.join(".")}: ${x.message}`).join("; ")}` : e instanceof Error ? e.message : String(e);
    return { inhalt: `Fehler: ${text}`, fehler: true };
  }
}
