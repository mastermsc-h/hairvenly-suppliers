// Werktags- und Feiertagslogik für das Mitarbeiter-Management.
// Bundesland: Bremen (HB). Reine Funktionen, keine externen Dependencies.
//
// Datumsstrings durchgängig im Format "YYYY-MM-DD" (lokale Kalendertage,
// keine Zeitzonen-Fallstricke — wir rechnen rein auf Y/M/D).

/** Oster-Sonntag (gregorianisch) nach der anonymen Gauß-Methode. */
function easterSunday(year: number): { month: number; day: number } {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31); // 3=März, 4=April
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { month, day };
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}

function iso(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Tag relativ zu Ostersonntag als ISO-String (offset in Tagen). */
function easterOffset(year: number, offset: number): string {
  const e = easterSunday(year);
  // In UTC rechnen, damit kein DST-Sprung die Tagesdifferenz verfälscht.
  const base = Date.UTC(year, e.month - 1, e.day);
  const d = new Date(base + offset * 86400000);
  return iso(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate());
}

/**
 * Gesetzliche Feiertage in Bremen für ein Jahr, als Set von "YYYY-MM-DD".
 * Bremen: Neujahr, Karfreitag, Ostermontag, Tag der Arbeit, Christi
 * Himmelfahrt, Pfingstmontag, Tag der Deutschen Einheit, Reformationstag
 * (seit 2018), 1. + 2. Weihnachtstag.
 */
export function bremenHolidays(year: number): Set<string> {
  const days = [
    iso(year, 1, 1),              // Neujahr
    easterOffset(year, -2),       // Karfreitag
    easterOffset(year, 1),        // Ostermontag
    iso(year, 5, 1),              // Tag der Arbeit
    easterOffset(year, 39),       // Christi Himmelfahrt
    easterOffset(year, 50),       // Pfingstmontag
    iso(year, 10, 3),             // Tag der Deutschen Einheit
    iso(year, 10, 31),            // Reformationstag (Bremen seit 2018)
    iso(year, 12, 25),            // 1. Weihnachtstag
    iso(year, 12, 26),            // 2. Weihnachtstag
  ];
  return new Set(days);
}

// Holiday-Cache pro Jahr (countWorkdays wird oft aufgerufen).
const holidayCache = new Map<number, Set<string>>();
function holidaysFor(year: number): Set<string> {
  let s = holidayCache.get(year);
  if (!s) {
    s = bremenHolidays(year);
    holidayCache.set(year, s);
  }
  return s;
}

/** Parst "YYYY-MM-DD" in ein UTC-Date (für sichere Tagesiteration). */
function parseISO(s: string): Date {
  const [y, m, d] = s.slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/**
 * Zählt Werktage (Mo–Fr) im Zeitraum [start, end] inklusive, abzüglich der
 * gesetzlichen Feiertage in Bremen. Spannt Jahresgrenzen korrekt (Feiertage
 * werden pro Kalenderjahr des jeweiligen Tages bestimmt).
 * Gibt 0 zurück, wenn end < start.
 */
export function countWorkdays(start: string, end: string): number {
  const s = parseISO(start);
  const e = parseISO(end);
  if (e.getTime() < s.getTime()) return 0;

  let count = 0;
  for (let t = s.getTime(); t <= e.getTime(); t += 86400000) {
    const d = new Date(t);
    const dow = d.getUTCDay(); // 0=So, 6=Sa
    if (dow === 0 || dow === 6) continue;
    const yyyy = d.getUTCFullYear();
    const key = iso(yyyy, d.getUTCMonth() + 1, d.getUTCDate());
    if (holidaysFor(yyyy).has(key)) continue;
    count++;
  }
  return count;
}

/** Kalendertage im Zeitraum [start, end] inklusive (für Krankheitstage). */
export function countCalendarDays(start: string, end: string): number {
  const s = parseISO(start);
  const e = parseISO(end);
  if (e.getTime() < s.getTime()) return 0;
  return Math.round((e.getTime() - s.getTime()) / 86400000) + 1;
}

// ─── Aggregation pro Mitarbeiter ──────────────────────────────────

export interface VacationLike {
  start_date: string;
  status: "submitted" | "approved" | "rejected";
  days: number;
}

export interface VacationBalance {
  /** Genehmigte Tage im Jahr (= "verbraucht"). */
  used: number;
  /** Eingereichte, noch nicht entschiedene Tage (= "geplant"). */
  planned: number;
  /** Anspruch + (noch gültiger) Übertrag − verbraucht − geplant. */
  available: number;
  /** Gültiger Übertrag aus Vorjahr (0 wenn verfallen). */
  carryover: number;
  /** Übertrag verfällt bald (innerhalb der nächsten 31 Tage) und ist noch > 0. */
  carryoverExpiringSoon: boolean;
}

/**
 * Berechnet den Urlaubssaldo eines Mitarbeiters für ein Jahr.
 * - "verbraucht" = Summe genehmigter Anträge des Jahres
 * - "geplant"    = Summe eingereichter (noch offener) Anträge des Jahres
 * - Übertrag zählt nur, solange `carryoverExpiresOn` >= `today` ist.
 */
export function vacationBalance(
  requests: VacationLike[],
  opts: {
    year: number;
    annualDays: number;
    carryoverDays: number;
    carryoverExpiresOn?: string | null;
    today: string; // "YYYY-MM-DD" — vom Aufrufer reingereicht (kein Date.now hier)
  },
): VacationBalance {
  const inYear = requests.filter((r) => Number(r.start_date.slice(0, 4)) === opts.year);
  const used = inYear
    .filter((r) => r.status === "approved")
    .reduce((s, r) => s + Number(r.days || 0), 0);
  const planned = inYear
    .filter((r) => r.status === "submitted")
    .reduce((s, r) => s + Number(r.days || 0), 0);

  let carryover = Number(opts.carryoverDays || 0);
  let carryoverExpiringSoon = false;
  if (opts.carryoverExpiresOn) {
    const expired = opts.carryoverExpiresOn < opts.today;
    if (expired) {
      carryover = 0;
    } else if (carryover > 0) {
      // Verfällt innerhalb von 31 Tagen?
      const exp = parseISO(opts.carryoverExpiresOn).getTime();
      const now = parseISO(opts.today).getTime();
      carryoverExpiringSoon = exp - now <= 31 * 86400000;
    }
  }

  const available = Number(opts.annualDays || 0) + carryover - used - planned;
  return { used, planned, available, carryover, carryoverExpiringSoon };
}
