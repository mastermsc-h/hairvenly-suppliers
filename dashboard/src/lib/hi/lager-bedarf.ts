/**
 * Bedarf je Produkt: Was muss in den nächsten Bestellungen wirklich nachbestellt werden?
 * Bestell-bis-Prinzip: Lager + unterwegs soll bis zur übernächsten Lieferung reichen
 * (Lieferzeit + Bestellrhythmus + Puffer). Ladenhüter (kein Verkauf) und Produkte mit
 * genug Vorrat bekommen nichts. Basis: Inventar-Tabs, Topseller (Verkauf 30/90 Tage) und
 * die Bestellungen "unterwegs" aus dem Sheet — wie /stock/critical.
 */
import { enrichAlertsWithTier, readDashboardAlerts, readInventorySheet, readTopseller, type AlertProduct } from "@/lib/stock-sheets";
import { fetchOrderIdByName } from "@/lib/order-name-map";
import { filterArchivedFromStock } from "@/lib/filter-archived-orders";
import { LEAD_TIME_DAYS } from "@/lib/stock-criticality";

const norm = (s: string) => s.replace(/\s+/g, " ").trim().toUpperCase();
const keyOf = (c: string, p: string, v: string | number | null) => `${norm(c)}|${norm(p.replace(/\s*\[\d+g\]\s*$/, ""))}|${v ?? ""}`;

export interface BedarfOptionen {
  /** Bestellrhythmus in Tagen (Standard 14). */
  rhythmusTage?: number;
  /** Sicherheitspuffer in Tagen (Standard 14). */
  pufferTage?: number;
  /** "ø90" = Verkauf der letzten 90 Tage, "vorsichtig" = höherer Wert aus 30 und 90 Tagen. */
  basis?: "ø90" | "vorsichtig";
  /** Anzahl künftiger Bestellungen, die simuliert werden (Standard 8). */
  bestellungen?: number;
}

export interface QualitaetBedarf {
  qualitaet: "Russisch glatt (Amanda)" | "Usbekisch wellig (Ebru)";
  produkte: number;
  lagerKg: number;
  unterwegsKg: number;
  verkaufKgMonat: number;
  reichweiteMonate: number | null;
  /** kg je künftiger Bestellung (erste in 2 Tagen, dann im Rhythmus). */
  bestellungenKg: number[];
  ueberbestandKg: number;
  ladenhueter: { anzahl: number; kg: number; beispiele: Array<{ produkt: string; lagerG: number }> };
  jetztNachbestellen: Array<{ produkt: string; lagerG: number; unterwegsG: number; verkauftG30: number; verkauftG90: number; mengeG: number }>;
}

/** Alle Produkte beider Inventar-Tabs (auch ausverkaufte), angereichert um Verkauf und Bestellungen. */
async function ladeProdukte(): Promise<AlertProduct[]> {
  const [alerts, wellig, glatt, { sections: topseller }, orderIdByName] = await Promise.all([
    readDashboardAlerts(),
    readInventorySheet("Usbekisch - WELLIG"),
    readInventorySheet("Russisch - GLATT"),
    readTopseller(),
    fetchOrderIdByName(),
  ]);
  const ausSheet = new Map<string, AlertProduct>();
  for (const a of alerts.unterwegs) ausSheet.set(keyOf(a.collection, a.product, a.variant), a);
  for (const a of alerts.kritisch) ausSheet.set(keyOf(a.collection, a.product, a.variant), a);
  const alle = new Map<string, AlertProduct>();
  for (const [rows, tab] of [[wellig.rows, "wellig"], [glatt.rows, "glatt"]] as const) {
    for (const r of rows) {
      if (!r.product || r.product === "Produkt") continue;
      const clip = /CLIP[\s-]?IN/i.test(r.collection);
      const variant = clip ? String(r.unitWeight) : null;
      const key = keyOf(r.collection, r.product, variant);
      if (alle.has(key)) continue;
      const s = ausSheet.get(key);
      alle.set(
        key,
        s
          ? { ...s, lagerG: Math.max(0, r.totalWeight) }
          : { collection: r.collection, product: clip ? `${r.product}  [${r.unitWeight}g]` : r.product, variant, lagerG: Math.max(0, r.totalWeight), sheetKey: clip ? "glatt" : tab, unterwegsG: 0, perOrder: [] },
      );
    }
  }
  for (const [k, a] of ausSheet) if (!alle.has(k)) alle.set(k, a);
  return filterArchivedFromStock(enrichAlertsWithTier([...alle.values()], topseller), orderIdByName);
}

export async function ladeLagerBedarf(opt: BedarfOptionen = {}): Promise<QualitaetBedarf[]> {
  const rhythmus = opt.rhythmusTage ?? 14;
  const puffer = opt.pufferTage ?? 14;
  const anzahl = Math.min(12, Math.max(1, opt.bestellungen ?? 8));
  const produkte = await ladeProdukte();
  const r1 = (n: number) => Math.round(n * 10) / 10;

  return (["glatt", "wellig"] as const).map((q) => {
    const its = produkte.filter((d) => d.sheetKey === q);
    const lieferzeit = LEAD_TIME_DAYS[q];
    const bestellungen = Array(anzahl).fill(0) as number[];
    let ueber = 0;
    const tot: Array<{ produkt: string; lagerG: number }> = [];
    const jetzt: QualitaetBedarf["jetztNachbestellen"] = [];
    for (const d of its) {
      const v30 = d.verkauft30d ?? 0;
      const v90 = d.verkauft90d ?? 0;
      if (d.verkauft30d === undefined && d.verkauft90d === undefined) continue;
      const tag = opt.basis === "vorsichtig" ? Math.max(v30 / 30, v90 / 90) : v90 / 90;
      const position0 = d.lagerG + Math.max(0, d.unterwegsG);
      if (tag <= 0) {
        if (d.lagerG > 0) tot.push({ produkt: `${d.collection} · ${d.product}`, lagerG: Math.round(d.lagerG) });
        continue;
      }
      const ziel = tag * (lieferzeit + rhythmus + puffer);
      if (position0 > ziel) ueber += position0 - ziel;
      let position = position0;
      for (let k = 0; k < anzahl; k++) {
        position -= tag * (k === 0 ? 2 : rhythmus);
        const menge = Math.max(0, ziel - position);
        bestellungen[k] += menge;
        position += menge;
        if (k === 0 && menge > 0) {
          jetzt.push({ produkt: `${d.collection} · ${d.product}`, lagerG: Math.round(d.lagerG), unterwegsG: Math.round(Math.max(0, d.unterwegsG)), verkauftG30: v30, verkauftG90: v90, mengeG: Math.round(menge) });
        }
      }
    }
    const lagerKg = its.reduce((s, d) => s + d.lagerG, 0) / 1000;
    const unterwegsKg = its.reduce((s, d) => s + Math.max(0, d.unterwegsG), 0) / 1000;
    const verkaufMonat = its.reduce((s, d) => s + (d.verkauft90d ?? 0), 0) / 1000 / 3;
    tot.sort((a, b) => b.lagerG - a.lagerG);
    jetzt.sort((a, b) => b.mengeG - a.mengeG);
    return {
      qualitaet: q === "glatt" ? "Russisch glatt (Amanda)" : "Usbekisch wellig (Ebru)",
      produkte: its.length,
      lagerKg: r1(lagerKg),
      unterwegsKg: r1(unterwegsKg),
      verkaufKgMonat: r1(verkaufMonat),
      reichweiteMonate: verkaufMonat > 0 ? r1((lagerKg + unterwegsKg) / verkaufMonat) : null,
      bestellungenKg: bestellungen.map((g) => r1(g / 1000)),
      ueberbestandKg: Math.round(ueber / 1000),
      ladenhueter: { anzahl: tot.length, kg: r1(tot.reduce((s, x) => s + x.lagerG, 0) / 1000), beispiele: tot.slice(0, 15) },
      jetztNachbestellen: jetzt.slice(0, 40),
    };
  });
}
