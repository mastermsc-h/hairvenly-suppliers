// Freestyle-Einnahmen (Laden + Salon) — reine Logik ohne DB, getestet in scripts/smoke/salon-einnahmen.spec.mjs.

export type Bereich = "verkauf" | "salon";
export const BEREICH_LABEL: Record<Bereich, string> = { verkauf: "Verkauf", salon: "Salon" };

export interface EinnahmeArt {
  id: string;
  name: string;
  bereich: Bereich;
  sortierung: number;
  aktiv: boolean;
}

export interface EinnahmeZeile {
  id: string;
  employeeId: string;
  employeeName: string;
  artName: string;
  bereich: Bereich;
  betrag: number;
  /** ISO (UTC) */
  zeitpunkt: string;
  notiz: string | null;
  storniertAm: string | null;
  storniertVon: "mitarbeiter" | "admin" | null;
}

/** Wie weit zurück Mitarbeiter ein Datum setzen dürfen (vergessene Einträge). */
export const MAX_TAGE_ZURUECK = 31;
/** Admin am Rechner darf auch ältere Einträge nachtragen/korrigieren. */
export const ADMIN_MAX_TAGE_ZURUECK = 3660;

const TZ = "Europe/Berlin";
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Kalendertag in Bremen (YYYY-MM-DD). */
export function berlinDatum(d: Date | string): string {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: TZ }).format(typeof d === "string" ? new Date(d) : d);
}

/** Uhrzeit in Bremen (HH:mm). */
export function berlinZeit(d: Date | string): string {
  return new Intl.DateTimeFormat("de-DE", { timeZone: TZ, hour: "2-digit", minute: "2-digit" }).format(typeof d === "string" ? new Date(d) : d);
}

/** Bremer Ortszeit als Wert für <input type="datetime-local"> (YYYY-MM-DDTHH:mm). */
export function berlinLokal(d: Date | string): string {
  return `${berlinDatum(d)}T${berlinZeit(d)}`;
}

/** Abstand Bremen − UTC in Minuten zu einem Zeitpunkt (Sommer 120, Winter 60). */
function offsetMinuten(utcMs: number): number {
  const p = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).formatToParts(new Date(utcMs));
  const g = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return (Date.UTC(g("year"), g("month") - 1, g("day"), g("hour"), g("minute")) - Math.floor(utcMs / 60000) * 60000) / 60000;
}

/** "2026-11-05T14:30" (Bremer Ortszeit) → ISO in UTC; null bei ungültiger Eingabe. */
export function berlinLokalZuIso(lokal: string): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(lokal);
  if (!m) return null;
  const alsUtc = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  if (Number.isNaN(alsUtc)) return null;
  // Zweimal korrigieren, damit auch Zeiten direkt an der Zeitumstellung stimmen
  let t = alsUtc - offsetMinuten(alsUtc) * 60000;
  t = alsUtc - offsetMinuten(t) * 60000;
  return new Date(t).toISOString();
}

/** "12,50" / "1.234,5" / "12.5" → 12.5; null wenn kein gültiger Betrag. */
export function parseBetrag(text: string): number | null {
  let s = text.trim().replace(/\s|€/g, "");
  if (!s) return null;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/** Prüft eine Eingabe (Gerät oder Admin); gibt die Fehlermeldung zurück oder null. */
export function pruefeEinnahme(
  e: { betrag: number | null; zeitpunktIso: string | null; notiz: string | null },
  jetzt: Date,
  maxTageZurueck: number = MAX_TAGE_ZURUECK,
): string | null {
  if (e.betrag == null || e.betrag <= 0) return "Bitte einen Betrag eingeben";
  if (e.betrag >= 100000) return "Betrag zu hoch";
  if (!e.zeitpunktIso) return "Datum/Uhrzeit ungültig";
  const t = new Date(e.zeitpunktIso).getTime();
  if (t > jetzt.getTime() + 5 * 60000) return "Datum/Uhrzeit liegt in der Zukunft";
  if (t < jetzt.getTime() - maxTageZurueck * 86400000) return `Höchstens ${maxTageZurueck} Tage zurück`;
  if (e.notiz && e.notiz.length > 500) return "Notiz zu lang (max. 500 Zeichen)";
  return null;
}

/** Mitarbeiter dürfen nur eigene, heute erfasste Einträge stornieren. */
export function darfMitarbeiterStornieren(z: { employeeId: string; storniertAm: string | null; erfasstAm: string }, employeeId: string, jetzt: Date): boolean {
  return z.employeeId === employeeId && !z.storniertAm && berlinDatum(z.erfasstAm) === berlinDatum(jetzt);
}

export interface Summen {
  gesamt: number;
  verkauf: number;
  salon: number;
  anzahl: number;
}
export interface MitarbeiterSumme extends Summen {
  employeeId: string;
  name: string;
}
export interface TagSumme extends Summen {
  datum: string;
  proMitarbeiter: Record<string, number>;
}

const leer = (): Summen => ({ gesamt: 0, verkauf: 0, salon: 0, anzahl: 0 });
function addiere(s: Summen, z: EinnahmeZeile) {
  s.gesamt = r2(s.gesamt + z.betrag);
  s[z.bereich] = r2(s[z.bereich] + z.betrag);
  s.anzahl += 1;
}

/** Summen gesamt, je Mitarbeiter (absteigend) und je Bremer Kalendertag (neueste zuerst). Stornierte zählen nicht. */
export function summiere(zeilen: EinnahmeZeile[]): { summe: Summen; proMitarbeiter: MitarbeiterSumme[]; proTag: TagSumme[] } {
  const summe = leer();
  const ma = new Map<string, MitarbeiterSumme>();
  const tage = new Map<string, TagSumme>();
  for (const z of zeilen) {
    if (z.storniertAm) continue;
    addiere(summe, z);
    const m = ma.get(z.employeeId) ?? { ...leer(), employeeId: z.employeeId, name: z.employeeName };
    addiere(m, z);
    ma.set(z.employeeId, m);
    const d = berlinDatum(z.zeitpunkt);
    const t = tage.get(d) ?? { ...leer(), datum: d, proMitarbeiter: {} };
    addiere(t, z);
    t.proMitarbeiter[z.employeeId] = r2((t.proMitarbeiter[z.employeeId] ?? 0) + z.betrag);
    tage.set(d, t);
  }
  return {
    summe,
    proMitarbeiter: [...ma.values()].sort((a, b) => b.gesamt - a.gesamt || a.name.localeCompare(b.name)),
    proTag: [...tage.values()].sort((a, b) => b.datum.localeCompare(a.datum)),
  };
}
