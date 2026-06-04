// Team-Kapazität: wie viele dürfen gleichzeitig in den Urlaub, wo überlappt es,
// und wie viele freie Urlaubs-Slots hat ein Team an einem Tag.
// Reine Funktionen (kein Date.now — "today" wird hereingereicht).

import type { StaffMember, VacationRequest, TeamSetting, VacationBlackout } from "@/lib/types";

export const UNLIMITED = 99;

/** Liegt "MM-DD" im (ggf. über den Jahreswechsel laufenden) Bereich? */
function mdInRange(md: string, startMd: string, endMd: string): boolean {
  return startMd <= endMd
    ? md >= startMd && md <= endMd
    : md >= startMd || md <= endMd; // Wrap (z.B. 12-20 .. 01-05)
}

/** Kritische Zeiträume (Sperrzeiten), die an einem Tag für ein Team gelten. */
export function blackoutsForDay(
  day: string,
  blackouts: VacationBlackout[],
  team: string | null,
): VacationBlackout[] {
  const md = day.slice(5); // "MM-DD"
  return blackouts.filter(
    (b) => mdInRange(md, b.start_md, b.end_md) && (b.team == null || team == null || b.team === team),
  );
}

/** Max. gleichzeitig im Urlaub für ein Team (Default UNLIMITED). */
export function maxOnVacation(settings: TeamSetting[], team: string): number {
  return settings.find((s) => s.team === team)?.max_on_vacation ?? UNLIMITED;
}

/** Belegt der Antrag diesen Tag? (offen oder genehmigt zählen, abgelehnt nicht.) */
function occupies(r: VacationRequest, day: string): boolean {
  return r.status !== "rejected" && r.start_date <= day && r.end_date >= day;
}

export interface OnDayEntry {
  memberId: string;
  name: string;
  pending: boolean; // beantragt, noch nicht genehmigt
}

/** Wer aus dem Team ist an einem bestimmten Tag im Urlaub. */
export function teamOnDay(
  members: StaffMember[],
  requests: VacationRequest[],
  team: string,
  day: string,
): OnDayEntry[] {
  const teamMembers = members.filter((m) => m.team === team);
  const byId = new Map(teamMembers.map((m) => [m.id, m]));
  return requests
    .filter((r) => byId.has(r.staff_id) && occupies(r, day))
    .map((r) => ({
      memberId: r.staff_id,
      name: byId.get(r.staff_id)!.name,
      pending: r.status === "submitted",
    }));
}

export interface Conflict {
  team: string;
  from: string;
  to: string;
  peak: number; // maximale gleichzeitige Abwesenheit im Zeitraum
  max: number;  // erlaubtes Maximum
  names: string[];
}

function ymd(t: number): string {
  const d = new Date(t);
  const p = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
}

/**
 * Findet alle Zeiträume, in denen ein Team das erlaubte Maximum gleichzeitiger
 * Urlauber überschreitet (über das ganze Jahr), und gruppiert sie zu Bereichen.
 */
export function teamConflicts(
  members: StaffMember[],
  requests: VacationRequest[],
  settings: TeamSetting[],
  year: number,
): Conflict[] {
  const teams = [...new Set(members.map((m) => m.team))];
  const out: Conflict[] = [];
  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year, 11, 31);

  for (const team of teams) {
    const max = maxOnVacation(settings, team);
    if (max >= UNLIMITED) continue; // nicht konfiguriert → keine Warnung

    let cur: { from: string; to: string; peak: number; names: Set<string> } | null = null;
    for (let t = start; t <= end; t += 86400000) {
      const day = ymd(t);
      const entries = teamOnDay(members, requests, team, day);
      if (entries.length > max) {
        if (!cur) cur = { from: day, to: day, peak: 0, names: new Set() };
        cur.to = day;
        cur.peak = Math.max(cur.peak, entries.length);
        entries.forEach((e) => cur!.names.add(e.name));
      } else if (cur) {
        out.push({ team, from: cur.from, to: cur.to, peak: cur.peak, max, names: [...cur.names] });
        cur = null;
      }
    }
    if (cur) out.push({ team, from: cur.from, to: cur.to, peak: cur.peak, max, names: [...cur.names] });
  }
  return out;
}

export interface Probation {
  end: string;       // Ablaufdatum (Eintritt + 6 Monate)
  daysLeft: number;  // verbleibende Tage (negativ wenn vorbei)
  over: boolean;     // bereits abgelaufen
}

/** Probezeit-Ablauf = Eintrittsdatum + 6 Monate. `today` wird hereingereicht. */
export function probation(employmentStart: string | null, today: string): Probation | null {
  if (!employmentStart) return null;
  const [y, m, d] = employmentStart.split("-").map(Number);
  // 6 Monate addieren (Date normalisiert Monatsüberlauf automatisch).
  const endDate = new Date(Date.UTC(y, m - 1 + 6, d));
  const end = ymd(endDate.getTime());
  const [ty, tm, td] = today.split("-").map(Number);
  const daysLeft = Math.round((endDate.getTime() - Date.UTC(ty, tm - 1, td)) / 86400000);
  return { end, daysLeft, over: daysLeft < 0 };
}

export interface UpcomingBirthday {
  member: StaffMember;
  date: string;   // nächstes Vorkommen "YYYY-MM-DD"
  inDays: number;
  turning: number; // Alter, das erreicht wird
}

/** Geburtstage in den nächsten `withinDays` Tagen ab `today`. */
export function upcomingBirthdays(
  members: StaffMember[],
  today: string,
  withinDays = 60,
): UpcomingBirthday[] {
  const [ty, tm, td] = today.split("-").map(Number);
  const base = Date.UTC(ty, tm - 1, td);
  const res: UpcomingBirthday[] = [];

  for (const m of members) {
    if (!m.birth_date) continue;
    const [by, bm, bd] = m.birth_date.split("-").map(Number);
    let yr = ty;
    let next = Date.UTC(yr, bm - 1, bd);
    if (next < base) {
      yr += 1;
      next = Date.UTC(yr, bm - 1, bd);
    }
    const inDays = Math.round((next - base) / 86400000);
    if (inDays > withinDays) continue;
    res.push({ member: m, date: ymd(next), inDays, turning: yr - by });
  }
  return res.sort((a, b) => a.inDays - b.inDays);
}
