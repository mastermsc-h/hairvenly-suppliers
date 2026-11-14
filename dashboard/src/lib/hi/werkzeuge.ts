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
      "Liquiditätsvorschau der nächsten ~90 Tage (wie /finances/liquiditaet): Startstand Sparkasse+PayPal, Ø Einnahmen und laufende Abgänge pro Tag, Tiefpunkt, alle geplanten Zahlungen (Amanda-Bestellungen, Ebru-Raten, Einfuhrabgaben, Steuern, Black-Friday-Mehrumsatz, Nachbestellungen), offene Lieferantenschulden und Hinweise. Für Fragen zu Geld, Schulden, Zahlungsterminen, ob etwas bezahlbar ist.",
    input_schema: {
      type: "object",
      properties: {
        nur_bis: { type: "string", description: "Optional: nur Zahlungen bis zu diesem Datum (YYYY-MM-DD)" },
        details: { type: "boolean", description: "true = jede einzelne Zahlung und jede Ebru-Rechnung. Standard: Zusammenfassung (Summen je Monat und Art, nur Zahlungen ab 5.000 €)" },
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
    case "liquiditaet_vorschau":
      return "Rechnet die Liquiditätsvorschau";
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

async function liquiditaet(nurBis?: string, details = false) {
  const { roh, einstellungen, ergebnis: p } = await ladePrognose();
  const bis = nurBis ?? p.tage.at(-1)?.datum ?? p.start;
  const ratenPos = roh.ratenPositionen ?? [];
  return {
    start: p.start,
    startstand: p.startSaldoGesamt,
    paypal: p.paypal,
    wechselkursUsdProEur: p.fx,
    einnahmenProTag: p.einnahmenProTag,
    laufendeAbgaengeProTag: p.laufendProTag,
    laufendeAbgaengeBasis: details ? roh.basis : { monate: roh.basis.monate, tage: roh.basis.tage, laufend: roh.basis.laufend },
    flauteNachAktionSumme: p.nachlaufSumme,
    tiefpunkt: p.tiefpunkt,
    standJeWoche: p.tage.filter((_, i) => i % 7 === 0).map((t) => `${t.datum}: ${Math.round(t.saldo)}`).join(" | "),
    zahlungen: p.ereignisse
      .filter((x) => x.datum <= bis && (details || Math.abs(x.betrag) >= 5000))
      .slice(0, details ? 200 : 60)
      .map((x) => ({ datum: x.datum, art: x.art, betragEur: Math.round(x.betrag), text: x.label, ...(x.schaetzung ? { schaetzung: true } : {}), ...(x.unterwegs ? { nochNichtAufKonto: true } : {}) })),
    summenJeMonatUndArt: Object.entries(
      p.ereignisse.filter((x) => x.datum <= bis).reduce<Record<string, number>>((acc, x) => {
        const k = `${x.datum.slice(0, 7)} ${x.art}`;
        acc[k] = Math.round((acc[k] ?? 0) + x.betrag);
        return acc;
      }, {}),
    ).map(([k, eur]) => ({ monatArt: k, eur })),
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
        const { nur_bis, details } = z.object({ nur_bis: datum.optional(), details: z.boolean().optional() }).parse(input ?? {});
        return { inhalt: kuerzen(await liquiditaet(nur_bis, details)), fehler: false };
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
