/**
 * Bewertung "Kritischer Bestand" nach Reichweite statt fester Gramm-Grenze.
 * Rein (keine Server-Imports) → läuft identisch auf Server und im Browser.
 *
 * Status (Priorität von oben nach unten):
 *   unbekannt   – kein Verkaufsrang/keine Verkaufszahlen gefunden
 *   ladenhueter – 0 Verkauf in 30 und 90 Tagen
 *   akut        – Lager + unterwegs reicht nicht bis zur nächstmöglichen Lieferung
 *   luecke      – Lager ist leer, bevor die erste Bestellung ankommt
 *   knapp       – Lager + unterwegs reicht weniger als 1,5× Lieferzeit
 *   ok          – reicht
 */
import type { AlertProduct } from "./stock-sheets";

export const LEAD_TIME_DAYS: Record<"wellig" | "glatt", number> = {
  glatt: 42, // Amanda 6 Wochen
  wellig: 56, // Eyfel/China 8 Wochen
};

/** Alte Sheet-Schwelle. Gilt nur noch als Fallback, wenn Verkaufszahlen fehlen. */
export const LOW_STOCK_G = 600;

const KNAPP_FACTOR = 1.5;

export type CritStatus = "akut" | "luecke" | "knapp" | "ok" | "ladenhueter" | "unbekannt";

export interface StockAssessment {
  status: CritStatus;
  /** g/Tag, Maximum aus 30T- und 90T-Tempo (steigende Nachfrage wird früher erkannt). */
  daily: number | null;
  /** Tage, die das Lager allein reicht. */
  range: number | null;
  /** Tage, die Lager + unterwegs reicht. */
  rangeWithOrder: number | null;
  leadTime: number;
  /** Tage bis zur frühesten Ankunft (überfällig → 0). null = keine Bestellung/kein Datum. */
  daysToEta: number | null;
  /** Tage ohne Ware zwischen "Lager leer" und "Bestellung kommt" (nur bei Lücke > 0). */
  gapDays: number | null;
}

/** "ca. Ankunft: 29.05.2026" / "ETA bis: 24.11.2026" / "2026-11-24" → Datum (UTC-Mitternacht). */
export function parseAnkunftDate(s: string | null | undefined): number | null {
  if (!s) return null;
  let m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
  if (m) return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  m = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
  if (m) return Date.UTC(+m[3], +m[2] - 1, +m[1]);
  return null;
}

/** todayIso: YYYY-MM-DD. Wird vom Server mitgegeben, damit Browser und Server dasselbe "heute" nutzen. */
export function assessStock(d: AlertProduct, todayIso: string): StockAssessment {
  const leadTime = LEAD_TIME_DAYS[d.sheetKey];
  const base = { leadTime, daily: null, range: null, rangeWithOrder: null, daysToEta: null, gapDays: null };
  if (d.verkauft90d === undefined && d.verkauft30d === undefined) return { ...base, status: "unbekannt" };

  const daily = Math.max((d.verkauft30d ?? 0) / 30, (d.verkauft90d ?? 0) / 90);
  if (daily <= 0) return { ...base, status: "ladenhueter" };

  const range = Math.round(d.lagerG / daily);
  const rangeWithOrder = Math.round((d.lagerG + Math.max(0, d.unterwegsG)) / daily);

  let daysToEta: number | null = null;
  if (d.unterwegsG > 0) {
    const today = parseAnkunftDate(todayIso) ?? Date.now();
    const etas = d.perOrder
      .filter((o) => o.menge > 0)
      .map((o) => parseAnkunftDate(o.ankunft))
      .filter((t): t is number => t !== null);
    if (etas.length > 0) daysToEta = Math.max(0, Math.round((Math.min(...etas) - today) / 864e5));
  }
  const gap = daysToEta !== null ? daysToEta - range : 0;
  const gapDays = gap > 0 ? gap : null;

  const status: CritStatus =
    rangeWithOrder < leadTime ? "akut"
    : gapDays !== null ? "luecke"
    : rangeWithOrder < leadTime * KNAPP_FACTOR ? "knapp"
    : "ok";
  return { leadTime, daily, range, rangeWithOrder, daysToEta, gapDays, status };
}

/** Gehört auf die Standardansicht "Handlungsbedarf". */
export function needsAction(d: Pick<AlertProduct, "lagerG">, a: StockAssessment): boolean {
  if (a.status === "akut" || a.status === "luecke" || a.status === "knapp") return true;
  // Ohne Verkaufszahlen keine Reichweite → altes Kriterium, damit nichts verloren geht.
  return a.status === "unbekannt" && d.lagerG > 0 && d.lagerG < LOW_STOCK_G;
}

export const CRIT_STATUS_ORDER: Record<CritStatus, number> = {
  akut: 0, luecke: 1, knapp: 2, unbekannt: 3, ok: 4, ladenhueter: 5,
};
