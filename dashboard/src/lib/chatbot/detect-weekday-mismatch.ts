/**
 * Wochentag passt nicht zum Datum (importfrei, Smoke-Test transpiliert direkt).
 *
 * BUG 24.11.2026: „Black Friday startet am 27. November … also ab Mittwoch
 * geht's los" — der 27.11.2026 ist ein Freitag. LLMs rechnen Wochentage
 * unzuverlässig aus. Sibling: dasselbe bei Lieferterminen („kommt Dienstag,
 * 06.11." usw.).
 *
 * Regel: Ein ausgeschriebener Wochentag, in dessen Nähe (±90 Zeichen) Daten
 * stehen, muss zu MINDESTENS einem dieser Daten passen. Wochentags-Spannen
 * („Montag bis Freitag", „Mo–Fr") werden ignoriert (Öffnungszeiten).
 */

const WEEKDAYS = ["sonntag", "montag", "dienstag", "mittwoch", "donnerstag", "freitag", "samstag"];
const MONTHS = ["januar", "februar", "märz", "april", "mai", "juni", "juli", "august", "september", "oktober", "november", "dezember"];
const WINDOW = 90;

interface FoundDate { at: number; weekday: number }

function resolveYear(day: number, month: number, year: number | null, todayIso: string): number {
  if (year !== null) return year < 100 ? 2000 + year : year;
  const [ty, tm, td] = todayIso.split("-").map(Number);
  const today = Date.UTC(ty, tm - 1, td);
  const thisYear = Date.UTC(ty, month - 1, day);
  // mehr als 60 Tage in der Vergangenheit → vermutlich nächstes Jahr gemeint
  return thisYear < today - 60 * 86_400_000 ? ty + 1 : ty;
}

function findDates(text: string, todayIso: string): FoundDate[] {
  const out: FoundDate[] = [];
  const push = (at: number, d: number, m: number, y: number | null) => {
    if (d < 1 || d > 31 || m < 1 || m > 12) return;
    const year = resolveYear(d, m, y, todayIso);
    const dt = new Date(Date.UTC(year, m - 1, d));
    if (dt.getUTCMonth() !== m - 1) return; // 31.11. o.ä.
    out.push({ at, weekday: dt.getUTCDay() });
  };
  for (const m of text.matchAll(/\b(\d{1,2})\.\s?(\d{1,2})\.(?:\s?(\d{4}|\d{2})\b)?/g)) {
    push(m.index ?? 0, Number(m[1]), Number(m[2]), m[3] ? Number(m[3]) : null);
  }
  const monthRe = new RegExp(`\\b(\\d{1,2})\\.\\s*(${MONTHS.join("|")})(?:\\s+(\\d{4}))?`, "gi");
  for (const m of text.matchAll(monthRe)) {
    push(m.index ?? 0, Number(m[1]), MONTHS.indexOf(m[2].toLowerCase()) + 1, m[3] ? Number(m[3]) : null);
  }
  return out;
}

export interface WeekdayCheck { suspicious: boolean; reason?: string; snippet?: string }

export function detectWeekdayMismatch(text: string, todayIso: string): WeekdayCheck {
  const dates = findDates(text, todayIso);
  if (dates.length === 0) return { suspicious: false };
  const wdRe = new RegExp(`\\b(${WEEKDAYS.join("|")})s?\\b`, "gi");
  for (const m of text.matchAll(wdRe)) {
    const at = m.index ?? 0;
    const around = text.slice(Math.max(0, at - 25), at + m[0].length + 25);
    // Spannen/Öffnungszeiten ignorieren: „Montag bis Freitag", „Montag–Freitag", „montags"
    if (new RegExp(`${m[0]}\\s*(bis|–|-)\\s*[a-zä]+tag|[a-zä]+tag\\s*(bis|–|-)\\s*${m[0]}`, "i").test(around)) continue;
    if (/s$/i.test(m[0]) && WEEKDAYS.includes(m[0].slice(0, -1).toLowerCase())) continue;
    const near = dates.filter((d) => Math.abs(d.at - at) <= WINDOW);
    if (near.length === 0) continue;
    const wd = WEEKDAYS.indexOf(m[1].toLowerCase());
    if (!near.some((d) => d.weekday === wd)) {
      return {
        suspicious: true,
        reason: `„${m[1]}" passt zu keinem Datum in der Nähe`,
        snippet: text.slice(Math.max(0, at - 60), at + 30).replace(/\s+/g, " ").trim(),
      };
    }
  }
  return { suspicious: false };
}
