"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Plus, Save, Check, XCircle, AlertTriangle, Download, CalendarDays, Trash2,
  Cake, GraduationCap, ChevronLeft, ChevronRight, ChevronDown, CalendarRange, Ban, X, Pencil,
} from "lucide-react";
import { TEAMS, teamMeta } from "@/lib/staff/teams";
import { countWorkdays, vacationBalance, bremenHolidays } from "@/lib/staff/holidays";
import {
  maxOnVacation, teamOnDay, teamConflicts, upcomingBirthdays, blackoutsForDay, UNLIMITED,
} from "@/lib/staff/capacity";
import {
  createVacationRequest, updateVacationRequest, decideVacation, deleteVacation, addBlackout, deleteBlackout,
} from "@/lib/actions/staff";
import type { StaffMember, VacationRequest, TeamSetting, VacationBlackout } from "@/lib/types";
import { Card, CardHead } from "../staff-ui";

const inputCls =
  "mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900 outline-none";
const labelCls = "text-xs font-medium text-neutral-600 uppercase tracking-wide";
const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const MONTHS_LONG = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];
const WEEKDAYS = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

function pad(n: number) { return n < 10 ? `0${n}` : `${n}`; }

export default function VacationClient({
  members,
  requests,
  settings,
  blackouts,
  isAdmin,
  today,
}: {
  members: StaffMember[];
  requests: VacationRequest[];
  settings: TeamSetting[];
  blackouts: VacationBlackout[];
  isAdmin: boolean;
  today: string;
}) {
  const router = useRouter();
  const currentYear = Number(today.slice(0, 4));
  const [year, setYear] = useState(currentYear);
  const [teamFilter, setTeamFilter] = useState<string>("all");
  const [adding, setAdding] = useState(false);
  const [showYear, setShowYear] = useState(false);
  const [showSaldo, setShowSaldo] = useState(false);
  const [saldoFull, setSaldoFull] = useState(false);

  const byMember = useMemo(() => {
    const map = new Map<string, VacationRequest[]>();
    for (const r of requests) {
      const arr = map.get(r.staff_id) ?? [];
      arr.push(r);
      map.set(r.staff_id, arr);
    }
    return map;
  }, [requests]);

  const visibleMembers = members.filter((m) => teamFilter === "all" || m.team === teamFilter);

  const rows = visibleMembers.map((m) => {
    const reqs = byMember.get(m.id) ?? [];
    const bal = vacationBalance(reqs, {
      year,
      annualDays: m.annual_vacation_days,
      carryoverDays: m.carryover_days,
      carryoverExpiresOn: m.carryover_expires_on,
      today,
    });
    return { member: m, ...bal };
  });

  // "Wer ist heute abwesend" — genehmigte Anträge, die heute laufen.
  const absentToday = requests
    .filter((r) => r.status === "approved" && r.start_date <= today && r.end_date >= today)
    .map((r) => members.find((m) => m.id === r.staff_id))
    .filter(Boolean) as StaffMember[];

  // Heutige Überschreitung der Team-Kapazität (Mindestbesetzung verletzt).
  const overCapToday = TEAMS.map((t) => {
    const cap = maxOnVacation(settings, t.value);
    const names = absentToday.filter((m) => m.team === t.value).map((m) => m.name);
    return { team: t, cap, names };
  }).filter((w) => w.cap < UNLIMITED && w.names.length > w.cap);

  // Konflikte über das ganze (gewählte) Jahr.
  const conflicts = useMemo(
    () => teamConflicts(members, requests, settings, year),
    [members, requests, settings, year],
  );

  const birthdays = useMemo(() => upcomingBirthdays(members, today, 30), [members, today]);

  return (
    <div className="space-y-6">
      {/* Kontroll-Leiste */}
      <div className="flex flex-wrap items-center gap-3">
        <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="rounded-lg border border-neutral-300 px-3 py-2 text-sm">
          {[currentYear - 1, currentYear, currentYear + 1].map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} className="rounded-lg border border-neutral-300 px-3 py-2 text-sm">
          <option value="all">Alle Teams</option>
          {TEAMS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <div className="flex-1" />
        {isAdmin && (
          <>
            <button onClick={() => exportCsv(rows, year)} className="flex items-center gap-2 rounded-lg border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50">
              <Download size={15} /> CSV-Export
            </button>
            <button onClick={() => setAdding((a) => !a)} className="bg-neutral-900 text-white rounded-lg px-4 py-2 text-sm font-medium flex items-center gap-2">
              <Plus size={16} /> Urlaub eintragen
            </button>
          </>
        )}
      </div>

      {/* Widgets: heute abwesend · Geburtstage */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Card>
          <CardHead icon={<CalendarDays size={14} />} title="Heute abwesend" tint="sky" />
          <div className="p-4">
            {absentToday.length === 0 ? (
              <p className="text-sm text-neutral-500">Heute ist niemand im Urlaub.</p>
            ) : (
              <div className="flex flex-wrap gap-2">
                {absentToday.map((m) => (
                  <span key={m.id} className={`inline-flex items-center gap-1 text-xs px-2 py-1 rounded-full ${teamMeta(m.team).chip}`}>
                    {m.name}{m.is_trainee && <GraduationCap size={11} />}
                  </span>
                ))}
              </div>
            )}
          </div>
        </Card>
        <BirthdaysWidget birthdays={birthdays} />
      </div>

      {/* Kapazitäts-Warnungen (nur Admin) */}
      {isAdmin && (overCapToday.length > 0 || conflicts.length > 0) && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 space-y-2">
          <div className="flex items-center gap-2 text-sm font-medium text-amber-800">
            <AlertTriangle size={16} className="text-amber-600" /> Team-Besetzung — Überschneidungen
          </div>
          {overCapToday.map((w) => (
            <div key={`today-${w.team.value}`} className="text-sm text-amber-800">
              <b>Heute · {w.team.label}:</b> {w.names.join(", ")} ({w.names.length} im Urlaub, erlaubt max. {w.cap})
            </div>
          ))}
          {conflicts.map((c, i) => (
            <div key={`conf-${i}`} className="text-sm text-amber-800">
              <b>{teamMeta(c.team).label}</b> {c.from} – {c.to}: bis zu {c.peak} gleichzeitig (erlaubt max. {c.max}) — {c.names.join(", ")}
            </div>
          ))}
        </div>
      )}

      {adding && (
        <RequestForm
          members={members}
          requests={requests}
          settings={settings}
          blackouts={blackouts}
          isAdmin={isAdmin}
          onDone={() => { setAdding(false); router.refresh(); }}
          onCancel={() => setAdding(false)}
        />
      )}

      {/* Saldo-Übersicht (Mitarbeiterliste) — nur Admin (kumulierte Stände) */}
      {isAdmin && (
      <div className="bg-white rounded-2xl border border-neutral-200/80 shadow-sm overflow-hidden">
      <button onClick={() => setShowSaldo((s) => !s)} className="w-full flex items-center justify-between gap-3 px-4 md:px-5 py-3 bg-gradient-to-b from-neutral-50 to-white border-b border-neutral-100">
        <span className="flex items-center gap-2.5">
          <span className="h-7 w-7 rounded-lg grid place-items-center bg-emerald-100 text-emerald-600"><CalendarDays size={14} /></span>
          <span className="text-sm font-semibold text-neutral-800">Mitarbeiter — Urlaubsstände <span className="text-neutral-400 font-normal">({rows.length})</span></span>
        </span>
        <ChevronDown size={15} className={`text-neutral-400 transition-transform ${showSaldo ? "rotate-180" : ""}`} />
      </button>
      {showSaldo && (<>
        <div className="flex items-center justify-end gap-3 px-4 py-2 text-xs border-b border-neutral-100 bg-neutral-50/40">
          <button onClick={() => setSaldoFull((f) => !f)} className="text-neutral-600 hover:text-neutral-900 font-medium">
            {saldoFull ? "Kompakt (scrollbar)" : "Alle anzeigen"}
          </button>
          {!saldoFull && <span className="text-neutral-400">· Rand unten ziehen zum Vergrößern ↕</span>}
        </div>
        <div className={saldoFull ? "overflow-x-auto" : "overflow-x-auto scroll-always resize-y h-[44vh] min-h-[160px]"}>
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 border-b border-neutral-200 sticky top-0 z-10">
            <tr>
              <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Mitarbeiter</th>
              <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Team</th>
              <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Anspruch</th>
              <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Übertrag</th>
              <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Verbraucht</th>
              <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Geplant</th>
              <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Verfügbar</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-neutral-500">Keine Mitarbeiter — lege sie unter „Mitarbeiter" an.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.member.id} className="border-t border-neutral-100 hover:bg-neutral-50/50 transition-colors">
                <td className="px-4 py-3 font-medium">
                  <span className="inline-flex items-center gap-1.5">
                    {r.member.name}
                    {r.member.is_trainee && (
                      <span className="inline-flex items-center gap-0.5 text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                        <GraduationCap size={10} /> Azubi
                      </span>
                    )}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${teamMeta(r.member.team).chip}`}>{teamMeta(r.member.team).label}</span>
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{r.member.annual_vacation_days}</td>
                <td className="px-4 py-3 text-right tabular-nums">
                  {r.carryover > 0 ? (
                    <span className={r.carryoverExpiringSoon ? "text-amber-700 font-medium" : ""}>
                      {r.carryover}
                      {r.carryoverExpiringSoon && r.member.carryover_expires_on && (
                        <span className="block text-[10px]">verfällt {r.member.carryover_expires_on}</span>
                      )}
                    </span>
                  ) : "—"}
                </td>
                <td className="px-4 py-3 text-right tabular-nums">{r.used}</td>
                <td className="px-4 py-3 text-right tabular-nums text-neutral-500">{r.planned}</td>
                <td className="px-4 py-3 text-right">
                  <span className={`inline-block min-w-[2.5rem] text-base font-bold tabular-nums px-2 py-0.5 rounded-lg ${
                    r.available <= 0 ? "bg-rose-100 text-rose-700" : r.available <= 5 ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"
                  }`}>
                    {r.available}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </>)}
      </div>
      )}

      {/* Team-Kapazitätskalender */}
      <CapacityCalendar members={members} requests={requests} settings={settings} blackouts={blackouts} isAdmin={isAdmin} year={year} today={today} onChange={() => router.refresh()} />

      {/* Kritische Zeiträume / Sperrzeiten verwalten — nur Admin */}
      {isAdmin && <BlackoutConfig blackouts={blackouts} onChange={() => router.refresh()} />}

      {/* Jahresraster-Planner (ausklappbare Alternative) */}
      <div>
        <button
          onClick={() => setShowYear((s) => !s)}
          className="flex items-center gap-2 text-sm font-medium text-neutral-700 rounded-lg border border-neutral-300 bg-white px-3 py-2 hover:bg-neutral-50"
        >
          <CalendarRange size={16} />
          Jahresansicht (Raster) {showYear ? "ausblenden" : "anzeigen"}
          <ChevronDown size={15} className={`transition-transform ${showYear ? "rotate-180" : ""}`} />
        </button>
        {showYear && (
          <div className="mt-3">
            <YearPlanner members={members} requests={requests} settings={settings} blackouts={blackouts} year={year} today={today} />
          </div>
        )}
      </div>

      {/* Timeline */}
      <Timeline members={visibleMembers} requests={requests} year={year} today={today} />

      {/* Anträge mit Workflow — nur Admin */}
      {isAdmin && <RequestTable members={members} requests={requests} year={year} onChange={() => router.refresh()} />}
    </div>
  );
}

function BirthdaysWidget({ birthdays }: { birthdays: ReturnType<typeof upcomingBirthdays> }) {
  return (
    <Card>
      <CardHead icon={<Cake size={14} />} title="Anstehende Geburtstage" tint="fuchsia" />
      <div className="p-4">
        {birthdays.length === 0 ? (
          <p className="text-sm text-neutral-500">Keine Geburtstage in den nächsten 30 Tagen.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {birthdays.slice(0, 6).map((b) => (
              <li key={b.member.id} className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${teamMeta(b.member.team).chip}`}>{teamMeta(b.member.team).label}</span>
                  {b.member.name}
                </span>
                <span className="text-neutral-500 text-xs whitespace-nowrap">
                  {b.date.slice(8, 10)}.{b.date.slice(5, 7)}. · {b.inDays === 0 ? "heute 🎉" : `in ${b.inDays} T`} · wird {b.turning}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function CapacityCalendar({
  members, requests, settings, blackouts, isAdmin, year, today, onChange,
}: {
  members: StaffMember[];
  requests: VacationRequest[];
  settings: TeamSetting[];
  blackouts: VacationBlackout[];
  isAdmin: boolean;
  year: number;
  today: string;
  onChange: () => void;
}) {
  const [team, setTeam] = useState<string>("all");
  const [open, setOpen] = useState(true);
  const [quickDay, setQuickDay] = useState<string | null>(null);
  const [month, setMonth] = useState<number>(() => {
    const m = Number(today.slice(5, 7)) - 1;
    return today.startsWith(String(year)) ? m : 0;
  });

  const all = team === "all";
  const cap = all ? UNLIMITED : maxOnVacation(settings, team);
  const holidays = useMemo(() => bremenHolidays(year), [year]);
  const teamMembers = useMemo(() => (all ? members : members.filter((m) => m.team === team)), [members, team, all]);
  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const teamIds = useMemo(() => new Set(teamMembers.map((m) => m.id)), [teamMembers]);
  function entriesOnDay(day: string) {
    if (!all) return teamOnDay(teamMembers, requests, team, day);
    return requests
      .filter((r) => r.status !== "rejected" && teamIds.has(r.staff_id) && r.start_date <= day && r.end_date >= day)
      .map((r) => ({ memberId: r.staff_id, name: memberById.get(r.staff_id)!.name, pending: r.status === "submitted" }));
  }

  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const firstDow = (new Date(Date.UTC(year, month, 1)).getUTCDay() + 6) % 7; // Mo=0
  const cells: (number | null)[] = [
    ...Array(firstDow).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ];

  function prev() { if (month === 0) setMonth(11); else setMonth(month - 1); }
  function next() { if (month === 11) setMonth(0); else setMonth(month + 1); }

  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <button onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 text-sm font-medium text-neutral-700">
          <CalendarDays size={16} /> Abwesenheits-Kalender (Monat)
          <ChevronDown size={15} className={`text-neutral-400 transition-transform ${open ? "rotate-180" : ""}`} />
        </button>
        {open && (
          <div className="flex items-center gap-2">
            <select value={team} onChange={(e) => setTeam(e.target.value)} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm">
              <option value="all">Alle Teams</option>
              {TEAMS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            <button onClick={prev} className="p-1.5 rounded-lg border border-neutral-300 hover:bg-neutral-50"><ChevronLeft size={16} /></button>
            <span className="text-sm font-medium w-28 text-center">{MONTHS_LONG[month]} {year}</span>
            <button onClick={next} className="p-1.5 rounded-lg border border-neutral-300 hover:bg-neutral-50"><ChevronRight size={16} /></button>
          </div>
        )}
      </div>

      {open && (<>
      <div className="text-xs text-neutral-500 mb-2">
        {all
          ? "Alle Teams — Abwesenheiten gesamt. Für freie Slots/Mindestbesetzung ein Team wählen."
          : cap >= UNLIMITED
          ? "Keine Begrenzung gesetzt — unter „Mitarbeiter → Team-Besetzung“ konfigurierbar."
          : <>Max. <b>{cap}</b> gleichzeitig im Urlaub · grün = frei, gelb = voll, rot = überbucht</>}
        {" · "}<span className="text-rose-600">roter Rand oben = kritischer Zeitraum</span>
      </div>

      <div className="grid grid-cols-7 gap-1">
        {WEEKDAYS.map((w) => (
          <div key={w} className="text-[10px] font-medium uppercase tracking-wide text-neutral-400 text-center py-0.5">{w}</div>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <div key={`e${i}`} />;
          const day = `${year}-${pad(month + 1)}-${pad(d)}`;
          const dow = (firstDow + (d - 1)) % 7;
          const weekend = dow >= 5;
          const isHoliday = holidays.has(day);
          const blk = blackoutsForDay(day, blackouts, all ? null : team);
          const critical = blk.length > 0;
          const entries = entriesOnDay(day);
          const onVac = entries.length;
          const over = cap < UNLIMITED && onVac > cap;
          const full = cap < UNLIMITED && onVac === cap;
          const free = cap < UNLIMITED ? cap - onVac : null;
          const bdays = teamMembers.filter((m) => m.birth_date && m.birth_date.slice(5) === `${pad(month + 1)}-${pad(d)}`);
          const isToday = day === today;

          let bg = "bg-white border-neutral-200/70";
          if (over) bg = "bg-rose-50 border-rose-300";
          else if (full) bg = "bg-amber-50 border-amber-300";
          else if (onVac > 0) bg = "bg-emerald-50/50 border-emerald-200/70";
          else if (critical) bg = "bg-rose-50/60 border-rose-200/70";
          else if (weekend || isHoliday) bg = "bg-neutral-50 border-neutral-200/60";

          const critBorder = critical ? "border-t-[3px] border-t-rose-400" : "";
          const critTitle = critical ? `Kritischer Zeitraum: ${blk.map((b) => b.label).join(", ")}` : undefined;

          return (
            <div key={day} title={critTitle ? critTitle + " · Klick: Urlaub eintragen" : "Klick: Urlaub eintragen"} onClick={() => setQuickDay(day)} className={`min-h-[52px] rounded-lg border p-1 text-[10px] cursor-pointer transition-shadow hover:shadow-sm hover:border-neutral-400 ${bg} ${critBorder} ${isToday ? "ring-2 ring-neutral-900 ring-offset-1" : ""}`}>
              <div className="flex items-center justify-between">
                <span className={`grid place-items-center h-4 w-4 rounded-full text-[10px] font-semibold ${isToday ? "bg-neutral-900 text-white" : weekend || isHoliday ? "text-neutral-400" : "text-neutral-600"}`}>{d}</span>
                {free !== null && (
                  <span className={`text-[8px] px-1 py-0.5 rounded-full font-medium ${over ? "bg-rose-200 text-rose-800" : free === 0 ? "bg-amber-200 text-amber-800" : "bg-emerald-200 text-emerald-800"}`}>
                    {over ? "voll!" : `${free} frei`}
                  </span>
                )}
              </div>
              <div className="mt-0.5 space-y-0.5">
                {critical && onVac === 0 && (
                  <div className="text-[9px] text-rose-500 flex items-center gap-0.5"><Ban size={9} /> Sperrzeit</div>
                )}
                {bdays.map((m) => (
                  <div key={`b${m.id}`} className="text-fuchsia-600 truncate" title={`Geburtstag: ${m.name}`}>🎂 {m.name.split(" ")[0]}</div>
                ))}
                {entries.map((e) => {
                  const tm = memberById.get(e.memberId);
                  return (
                    <div key={e.memberId} title={e.name + (e.pending ? " (beantragt)" : "")}
                      className={`truncate rounded px-1 py-0.5 text-[10px] ${tm ? teamMeta(tm.team).chip : "bg-neutral-100 text-neutral-700"} ${e.pending ? "opacity-60 italic" : ""}`}>
                      {e.name.split(" ")[0]}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      </>)}
      {quickDay && (
        <DayQuickEntry
          day={quickDay}
          members={members}
          requests={requests}
          blackouts={blackouts}
          isAdmin={isAdmin}
          onClose={() => setQuickDay(null)}
          onRefresh={onChange}
        />
      )}
    </div>
  );
}

function fmtDayLong(day: string): string {
  const [y, m, d] = day.split("-");
  return `${d}.${m}.${y}`;
}

function QuickReqRow({ req, member, isAdmin, onRefresh }: { req: VacationRequest; member: StaffMember; isAdmin: boolean; onRefresh: () => void }) {
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    start(async () => {
      const res = await updateVacationRequest(req.id, fd);
      if (res?.error) { setError(res.error); return; }
      setEditing(false);
      onRefresh();
    });
  }

  if (editing && isAdmin) {
    return (
      <form onSubmit={save} className="rounded-lg border border-neutral-200 bg-neutral-50 p-2 space-y-2">
        <div className="text-xs font-medium text-neutral-700">{member.name}</div>
        <div className="grid grid-cols-2 gap-2">
          <input name="start_date" type="date" required defaultValue={req.start_date} className="rounded border border-neutral-300 px-2 py-1 text-sm" />
          <input name="end_date" type="date" required defaultValue={req.end_date} className="rounded border border-neutral-300 px-2 py-1 text-sm" />
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input name="days_override" type="number" step="0.5" min="0" placeholder="Tage auto" defaultValue={req.days} className="rounded border border-neutral-300 px-2 py-1 text-sm" />
          <select name="paid" defaultValue={String(req.paid)} className="rounded border border-neutral-300 px-2 py-1 text-sm">
            <option value="true">Bezahlt</option>
            <option value="false">Unbezahlt</option>
          </select>
        </div>
        <input name="note" defaultValue={req.note ?? ""} placeholder="Notiz" className="w-full rounded border border-neutral-300 px-2 py-1 text-sm" />
        {error && <div className="text-rose-600 text-[11px]">{error}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => setEditing(false)} className="text-xs text-neutral-500">Abbrechen</button>
          <button type="submit" disabled={pending} className="text-xs font-medium text-neutral-900"><Save size={13} className="inline" /> Speichern</button>
        </div>
      </form>
    );
  }

  return (
    <div className="flex items-center justify-between gap-2 rounded-lg border border-neutral-100 px-2 py-1.5">
      <div className="min-w-0">
        <span className={`text-xs px-2 py-0.5 rounded-full ${teamMeta(member.team).chip}`}>{member.name}</span>
        <span className="text-[11px] text-neutral-500 ml-1.5">{req.start_date}–{req.end_date} · {req.days}T{req.paid ? "" : " · unbez."}</span>
        <span className="ml-1.5">{vacStatusBadgeMini(req.status)}</span>
      </div>
      {isAdmin && (
        <div className="flex items-center gap-1.5 shrink-0">
          {req.status === "submitted" && (
            <>
              <button disabled={pending} onClick={() => start(async () => { await decideVacation(req.id, "approved"); onRefresh(); })} className="text-emerald-700 hover:text-emerald-800" title="Genehmigen"><Check size={15} /></button>
              <button disabled={pending} onClick={() => start(async () => { await decideVacation(req.id, "rejected"); onRefresh(); })} className="text-rose-600 hover:text-rose-700" title="Ablehnen"><XCircle size={15} /></button>
            </>
          )}
          <button onClick={() => setEditing(true)} className="text-neutral-400 hover:text-neutral-700" title="Bearbeiten"><Pencil size={14} /></button>
          <button disabled={pending} onClick={() => { if (confirm("Eintrag löschen?")) start(async () => { await deleteVacation(req.id); onRefresh(); }); }} className="text-neutral-400 hover:text-rose-600" title="Löschen"><Trash2 size={14} /></button>
        </div>
      )}
    </div>
  );
}

function vacStatusBadgeMini(status: string) {
  const map: Record<string, string> = { submitted: "bg-sky-100 text-sky-800", approved: "bg-emerald-100 text-emerald-800", rejected: "bg-rose-100 text-rose-800" };
  const label: Record<string, string> = { submitted: "offen", approved: "ok", rejected: "abgel." };
  return <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${map[status]}`}>{label[status]}</span>;
}

function DayQuickEntry({
  day, members, requests, blackouts, isAdmin, onClose, onRefresh,
}: {
  day: string;
  members: StaffMember[];
  requests: VacationRequest[];
  blackouts: VacationBlackout[];
  isAdmin: boolean;
  onClose: () => void;
  onRefresh: () => void;
}) {
  const [start, setStart] = useState(day);
  const [end, setEnd] = useState(day);
  const [error, setError] = useState<string | null>(null);
  const [pending, startT] = useTransition();
  const autoDays = start && end && end >= start ? countWorkdays(start, end) : null;

  const byId = new Map(members.map((m) => [m.id, m]));
  const onThisDay = requests
    .filter((r) => r.status !== "rejected" && r.start_date <= day && r.end_date >= day)
    .map((r) => ({ r, m: byId.get(r.staff_id) }))
    .filter((x) => x.m) as { r: VacationRequest; m: StaffMember }[];
  const blk = blackoutsForDay(day, blackouts, null);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    startT(async () => {
      const res = await createVacationRequest(null, fd);
      if (res?.error) { setError(res.error); return; }
      onRefresh();
      onClose();
    });
  }

  return (
    <div className="fixed inset-0 z-50 bg-black/30 flex items-start sm:items-center justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md my-8" onClick={(e) => e.stopPropagation()}>
        <CardHead
          icon={<CalendarDays size={14} />}
          title={fmtDayLong(day)}
          sub={isAdmin ? "Urlaub eintragen / bearbeiten" : "Wer ist an dem Tag im Urlaub"}
          tint="sky"
          right={<button onClick={onClose} className="text-neutral-400 hover:text-neutral-700"><X size={18} /></button>}
        />
        <div className="p-4 space-y-3">
          {blk.length > 0 && (
            <div className="flex items-center gap-2 text-xs text-rose-800 bg-rose-50 border border-rose-300 rounded-lg px-2.5 py-1.5">
              <Ban size={13} /> Kritischer Zeitraum: {blk.map((b) => b.label).join(", ")}
            </div>
          )}

          <div>
            <div className="text-[10px] uppercase tracking-wide text-neutral-400 mb-1">An diesem Tag im Urlaub</div>
            {onThisDay.length === 0 ? (
              <p className="text-sm text-neutral-500">Niemand.</p>
            ) : (
              <div className="space-y-1.5">
                {onThisDay.map(({ r, m }) => (
                  <QuickReqRow key={r.id} req={r} member={m} isAdmin={isAdmin} onRefresh={onRefresh} />
                ))}
              </div>
            )}
          </div>

          {isAdmin && (<>
          <div className="text-[10px] uppercase tracking-wide text-neutral-400 pt-1">Neuen Urlaub eintragen</div>
          <form onSubmit={submit} className="space-y-2 border-t border-neutral-100 pt-2">
            <div>
              <label className={labelCls}>Mitarbeiter</label>
              <select name="staff_id" required className={inputCls}>
                <option value="">— wählen —</option>
                {members.map((m) => <option key={m.id} value={m.id}>{m.name}{m.is_trainee ? " (Azubi)" : ""}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelCls}>Von</label>
                <input name="start_date" type="date" required value={start} onChange={(e) => setStart(e.target.value)} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Bis</label>
                <input name="end_date" type="date" required value={end} onChange={(e) => setEnd(e.target.value)} className={inputCls} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className={labelCls}>Tage {autoDays !== null && <span className="normal-case text-neutral-400">(auto {autoDays})</span>}</label>
                <input name="days_override" type="number" step="0.5" min="0" placeholder={autoDays !== null ? String(autoDays) : "auto"} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Art</label>
                <select name="paid" defaultValue="true" className={inputCls}>
                  <option value="true">Bezahlt</option>
                  <option value="false">Unbezahlt</option>
                </select>
              </div>
            </div>
            {isAdmin && (
              <div>
                <label className={labelCls}>Eintragen als</label>
                <select name="status" defaultValue="approved" className={inputCls}>
                  <option value="approved">Genehmigt (direkt)</option>
                  <option value="submitted">Antrag (offen)</option>
                </select>
              </div>
            )}
            <div>
              <label className={labelCls}>Notiz (optional)</label>
              <input name="note" className={inputCls} />
            </div>
            {error && <div className="text-rose-600 text-sm">{error}</div>}
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={onClose} className="text-sm text-neutral-600">Abbrechen</button>
              <button type="submit" disabled={pending} className="bg-neutral-900 text-white rounded-lg px-4 py-2 text-sm font-medium flex items-center gap-2">
                <Save size={14} /> {pending ? "..." : isAdmin ? "Eintragen" : "Antrag"}
              </button>
            </div>
          </form>
          </>)}
        </div>
      </div>
    </div>
  );
}

function YearPlanner({
  members, requests, settings, blackouts, year, today,
}: {
  members: StaffMember[];
  requests: VacationRequest[];
  settings: TeamSetting[];
  blackouts: VacationBlackout[];
  year: number;
  today: string;
}) {
  const [team, setTeam] = useState<string>("all");
  const visible = team === "all" ? members : members.filter((m) => m.team === team);
  const idToMember = useMemo(() => new Map(visible.map((m) => [m.id, m])), [visible]);
  const holidays = useMemo(() => bremenHolidays(year), [year]);
  const cap = team === "all" ? UNLIMITED : maxOnVacation(settings, team);
  const dayCols = Array.from({ length: 31 }, (_, i) => i + 1);

  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
        <div className="flex items-center gap-2 text-sm font-medium text-neutral-700">
          <CalendarRange size={16} /> Jahresplaner {year}
        </div>
        <select value={team} onChange={(e) => setTeam(e.target.value)} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm">
          <option value="all">Alle Teams</option>
          {TEAMS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
      </div>

      <div className="overflow-x-auto">
        <table className="border-separate border-spacing-0.5 text-[10px]">
          <thead>
            <tr>
              <th className="sticky left-0 bg-white z-10 text-left pr-2 font-medium text-neutral-500 w-10">Monat</th>
              {dayCols.map((d) => (
                <th key={d} className="w-5 text-center font-normal text-neutral-400">{d}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MONTHS.map((moLabel, mi) => {
              const daysInMonth = new Date(Date.UTC(year, mi + 1, 0)).getUTCDate();
              return (
                <tr key={mi}>
                  <td className="sticky left-0 bg-white z-10 pr-2 font-medium text-neutral-600">{moLabel}</td>
                  {dayCols.map((d) => {
                    if (d > daysInMonth) return <td key={d} className="w-5 h-5" />;
                    const day = `${year}-${pad(mi + 1)}-${pad(d)}`;
                    const dow = new Date(Date.UTC(year, mi, d)).getUTCDay();
                    const weekend = dow === 0 || dow === 6;
                    const holiday = holidays.has(day);
                    const entries = requests
                      .filter((r) => r.status !== "rejected" && idToMember.has(r.staff_id) && r.start_date <= day && r.end_date >= day)
                      .map((r) => ({ m: idToMember.get(r.staff_id)!, pending: r.status === "submitted" }));
                    const bdays = visible.filter((m) => m.birth_date && m.birth_date.slice(5) === `${pad(mi + 1)}-${pad(d)}`);
                    const isToday = day === today;
                    const over = cap < UNLIMITED && entries.length > cap;
                    const blk = blackoutsForDay(day, blackouts, team === "all" ? null : team);
                    const critical = blk.length > 0;

                    let bg = "bg-white";
                    let border = "border border-neutral-100";
                    if (entries.length > 0) {
                      bg = team === "all" ? "bg-neutral-700" : teamMeta(team).bar;
                      border = "border border-transparent";
                      if (entries.some((e) => e.pending) && entries.every((e) => e.pending)) bg += " opacity-50";
                    } else if (critical) {
                      bg = "bg-rose-100";
                    } else if (holiday) {
                      bg = "bg-rose-50";
                    } else if (weekend) {
                      bg = "bg-neutral-100";
                    }
                    const title = [
                      day,
                      holiday ? "Feiertag" : "",
                      critical ? "Kritischer Zeitraum: " + blk.map((b) => b.label).join(", ") : "",
                      entries.length ? "Urlaub: " + entries.map((e) => e.m.name + (e.pending ? " (offen)" : "")).join(", ") : "",
                      bdays.length ? "🎂 " + bdays.map((m) => m.name).join(", ") : "",
                    ].filter(Boolean).join(" · ");

                    return (
                      <td key={d} className="p-0">
                        <div
                          title={title}
                          className={`w-5 h-5 rounded-sm flex items-center justify-center ${bg} ${over ? "ring-1 ring-rose-500" : border} ${critical ? "border-t-2 border-t-rose-500" : ""} ${isToday ? "outline outline-1 outline-neutral-900" : ""} ${bdays.length ? "border-b-2 border-b-fuchsia-400" : ""}`}
                        >
                          {entries.length > 1 && <span className="text-white font-semibold leading-none">{entries.length}</span>}
                        </div>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-3 flex flex-wrap gap-3 text-[10px] text-neutral-500">
        <span className="inline-flex items-center gap-1"><span className={`w-3 h-3 rounded-sm ${team === "all" ? "bg-neutral-700" : teamMeta(team).bar}`} /> Urlaub</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-neutral-700 opacity-50" /> nur beantragt</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-neutral-100" /> Wochenende</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-rose-50 border border-neutral-200" /> Feiertag (Bremen)</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-rose-100 border-t-2 border-t-rose-500" /> kritischer Zeitraum</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm bg-white border-b-2 border-b-fuchsia-400" /> Geburtstag</span>
        <span className="inline-flex items-center gap-1"><span className="w-3 h-3 rounded-sm ring-1 ring-rose-500" /> über Kapazität</span>
        <span>· Zahl = Anzahl gleichzeitig · Maus über Tag = Namen</span>
      </div>
    </div>
  );
}

function Timeline({ members, requests, year, today }: { members: StaffMember[]; requests: VacationRequest[]; year: number; today: string }) {
  const [open, setOpen] = useState(false);
  const yearStart = Date.UTC(year, 0, 1);
  const yearLen = (Date.UTC(year + 1, 0, 1) - yearStart) / 86400000;
  const pct = (dateStr: string) => {
    const t = Date.parse(dateStr + "T00:00:00Z");
    return Math.max(0, Math.min(100, ((t - yearStart) / 86400000 / yearLen) * 100));
  };
  const todayPct = today.startsWith(String(year)) ? pct(today) : null;

  const withReqs = members
    .map((m) => ({ m, reqs: requests.filter((r) => r.staff_id === m.id && r.status !== "rejected" && r.start_date.slice(0, 4) <= String(year) && r.end_date.slice(0, 4) >= String(year)) }))
    .filter((x) => x.reqs.length > 0);

  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between text-sm font-medium text-neutral-700 mb-3">
        <span>Timeline {year} — wer ist wann weg</span>
        <ChevronDown size={15} className={`text-neutral-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (<>
      <div className="flex text-[10px] text-neutral-400 mb-1 pl-28">
        {MONTHS.map((mo) => <div key={mo} className="flex-1">{mo}</div>)}
      </div>
      {withReqs.length === 0 ? (
        <p className="text-sm text-neutral-500">Keine Urlaube in {year}.</p>
      ) : (
        <div className="space-y-1.5">
          {withReqs.map(({ m, reqs }) => (
            <div key={m.id} className="flex items-center gap-2">
              <div className="w-28 shrink-0 text-xs truncate" title={m.name}>{m.name}</div>
              <div className="relative flex-1 h-5 rounded bg-neutral-100 overflow-hidden">
                {todayPct !== null && (
                  <div className="absolute top-0 bottom-0 w-px bg-neutral-400/70" style={{ left: `${todayPct}%` }} />
                )}
                {reqs.map((r) => {
                  const left = pct(r.start_date < `${year}-01-01` ? `${year}-01-01` : r.start_date);
                  const right = pct(r.end_date > `${year}-12-31` ? `${year}-12-31` : r.end_date);
                  return (
                    <div
                      key={r.id}
                      title={`${r.start_date} – ${r.end_date} (${r.days} Tage${r.paid ? "" : ", unbezahlt"}${r.status === "submitted" ? ", offen" : ""})`}
                      className={`absolute top-0.5 bottom-0.5 rounded ${teamMeta(m.team).bar} ${r.status === "submitted" ? "opacity-50 border border-dashed border-white" : ""}`}
                      style={{ left: `${left}%`, width: `${Math.max(0.8, right - left)}%` }}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="mt-3 text-[10px] text-neutral-400">Volle Balken = genehmigt · blasse Balken = beantragt (offen)</div>
      </>)}
    </div>
  );
}

function RequestForm({
  members, requests, settings, blackouts, isAdmin, onDone, onCancel,
}: {
  members: StaffMember[];
  requests: VacationRequest[];
  settings: TeamSetting[];
  blackouts: VacationBlackout[];
  isAdmin: boolean;
  onDone: () => void;
  onCancel: () => void;
}) {
  const [staffId, setStaffId] = useState("");
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [override, setOverride] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startT] = useTransition();

  const autoDays = start && end && end >= start ? countWorkdays(start, end) : null;

  // Live-Warnung: fällt der Antrag in einen kritischen Zeitraum?
  const blackoutWarning = useMemo(() => {
    const m = members.find((x) => x.id === staffId);
    if (!start || !end || end < start) return null;
    const hits = new Set<string>();
    for (let t = Date.parse(start); t <= Date.parse(end); t += 86400000) {
      const day = new Date(t).toISOString().slice(0, 10);
      blackoutsForDay(day, blackouts, m ? m.team : null).forEach((b) => hits.add(b.label));
    }
    return hits.size ? [...hits] : null;
  }, [staffId, start, end, members, blackouts]);

  // Live-Warnung: würde dieser Antrag die Team-Kapazität überschreiten?
  const capWarning = useMemo(() => {
    const m = members.find((x) => x.id === staffId);
    if (!m || !start || !end || end < start) return null;
    const cap = maxOnVacation(settings, m.team);
    if (cap >= UNLIMITED) return null;
    const teamMembers = members.filter((x) => x.team === m.team);
    let peak = 0;
    for (let t = Date.parse(start); t <= Date.parse(end); t += 86400000) {
      const day = new Date(t).toISOString().slice(0, 10);
      // bereits geplante Urlauber des Teams an dem Tag (ohne diesen Mitarbeiter) + dieser neue Antrag
      const existing = teamOnDay(teamMembers, requests, m.team, day).filter((e) => e.memberId !== m.id);
      peak = Math.max(peak, existing.length + 1);
    }
    return peak > cap ? { team: m.team, peak, cap } : null;
  }, [staffId, start, end, members, requests, settings]);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    startT(async () => {
      const res = await createVacationRequest(null, fd);
      if (res?.error) { setError(res.error); return; }
      onDone();
    });
  }

  return (
    <form onSubmit={submit} className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className={labelCls}>Mitarbeiter</label>
          <select name="staff_id" required value={staffId} onChange={(e) => setStaffId(e.target.value)} className={inputCls}>
            <option value="">— wählen —</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}{m.is_trainee ? " (Azubi)" : ""}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Von</label>
          <input name="start_date" type="date" required value={start} onChange={(e) => setStart(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Bis</label>
          <input name="end_date" type="date" required value={end} onChange={(e) => setEnd(e.target.value)} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Tage {autoDays !== null && <span className="text-neutral-400 normal-case">(autom. {autoDays} Werktage)</span>}</label>
          <input name="days_override" type="number" step="0.5" min="0" value={override} onChange={(e) => setOverride(e.target.value)} placeholder={autoDays !== null ? String(autoDays) : "auto"} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Art</label>
          <select name="paid" defaultValue="true" className={inputCls}>
            <option value="true">Bezahlt</option>
            <option value="false">Unbezahlt</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>Notiz (optional)</label>
          <input name="note" className={inputCls} />
        </div>
        {isAdmin && (
          <div>
            <label className={labelCls}>Eintragen als</label>
            <select name="status" defaultValue="approved" className={inputCls}>
              <option value="approved">Genehmigt (direkt im Kalender)</option>
              <option value="submitted">Antrag (offen, später genehmigen)</option>
            </select>
          </div>
        )}
      </div>
      {capWarning && (
        <div className="flex items-center gap-2 text-sm text-amber-800 bg-amber-50 border border-amber-300 rounded-lg px-3 py-2">
          <AlertTriangle size={15} className="text-amber-600 shrink-0" />
          Achtung: In diesem Zeitraum wären im Team <b>{teamMeta(capWarning.team).label}</b> bis zu {capWarning.peak} gleichzeitig im Urlaub (erlaubt max. {capWarning.cap}). Antrag ist trotzdem möglich.
        </div>
      )}
      {blackoutWarning && (
        <div className="flex items-center gap-2 text-sm text-rose-800 bg-rose-50 border border-rose-300 rounded-lg px-3 py-2">
          <Ban size={15} className="text-rose-600 shrink-0" />
          Achtung: Der Zeitraum fällt in einen <b>kritischen Zeitraum</b> ({blackoutWarning.join(", ")}), in dem möglichst kein Urlaub genommen werden soll. Antrag ist trotzdem möglich.
        </div>
      )}
      {error && <div className="text-rose-600 text-sm">{error}</div>}
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className="text-sm text-neutral-600">Abbrechen</button>
        <button type="submit" disabled={pending} className="bg-neutral-900 text-white rounded-lg px-4 py-2 text-sm font-medium flex items-center gap-2">
          <Save size={14} /> {pending ? "..." : isAdmin ? "Urlaub eintragen" : "Antrag anlegen"}
        </button>
      </div>
    </form>
  );
}

function RequestTable({ members, requests, year, onChange }: { members: StaffMember[]; requests: VacationRequest[]; year: number; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const name = (id: string) => members.find((m) => m.id === id)?.name ?? "—";
  const list = requests.filter((r) => r.start_date.slice(0, 4) === String(year));
  const openCount = list.filter((r) => r.status === "submitted").length;

  return (
    <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-x-auto">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between px-4 py-3 text-sm font-medium text-neutral-700 border-b border-neutral-100">
        <span>Anträge {year} {openCount > 0 && <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-sky-100 text-sky-800">{openCount} offen</span>}</span>
        <ChevronDown size={15} className={`text-neutral-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
      <table className="w-full text-sm">
        <thead className="bg-neutral-50">
          <tr>
            <th className="text-left px-4 py-2 text-xs uppercase text-neutral-500">Mitarbeiter</th>
            <th className="text-left px-4 py-2 text-xs uppercase text-neutral-500">Zeitraum</th>
            <th className="text-right px-4 py-2 text-xs uppercase text-neutral-500">Tage</th>
            <th className="text-left px-4 py-2 text-xs uppercase text-neutral-500">Art</th>
            <th className="text-left px-4 py-2 text-xs uppercase text-neutral-500">Eingereicht</th>
            <th className="text-left px-4 py-2 text-xs uppercase text-neutral-500">Status / Entschieden</th>
            <th className="text-right px-4 py-2 text-xs uppercase text-neutral-500">Aktion</th>
          </tr>
        </thead>
        <tbody>
          {list.length === 0 && (
            <tr><td colSpan={7} className="px-4 py-8 text-center text-neutral-500">Keine Anträge in {year}.</td></tr>
          )}
          {list.map((r) => (
            <tr key={r.id} className="border-t border-neutral-100">
              <td className="px-4 py-3 font-medium">{name(r.staff_id)}</td>
              <td className="px-4 py-3 whitespace-nowrap">{r.start_date} – {r.end_date}</td>
              <td className="px-4 py-3 text-right tabular-nums">{r.days}</td>
              <td className="px-4 py-3">{r.paid ? "Bezahlt" : <span className="text-amber-700">Unbezahlt</span>}</td>
              <td className="px-4 py-3 text-neutral-500 whitespace-nowrap">{r.submitted_at?.slice(0, 10)}</td>
              <td className="px-4 py-3">
                <StatusBadge status={r.status} />
                {r.decided_at && <span className="block text-[10px] text-neutral-400">am {r.decided_at.slice(0, 10)}</span>}
              </td>
              <td className="px-4 py-3 text-right whitespace-nowrap">
                <RowActions request={r} onChange={onChange} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, string> = {
    submitted: "bg-sky-100 text-sky-800",
    approved: "bg-emerald-100 text-emerald-800",
    rejected: "bg-rose-100 text-rose-800",
  };
  const label: Record<string, string> = { submitted: "Offen", approved: "Genehmigt", rejected: "Abgelehnt" };
  return <span className={`text-xs px-2 py-0.5 rounded-full ${map[status]}`}>{label[status]}</span>;
}

function RowActions({ request, onChange }: { request: VacationRequest; onChange: () => void }) {
  const [pending, start] = useTransition();
  return (
    <span className="inline-flex items-center gap-2">
      {request.status === "submitted" && (
        <>
          <button disabled={pending} onClick={() => start(async () => { await decideVacation(request.id, "approved"); onChange(); })} className="text-emerald-700 hover:text-emerald-800" title="Genehmigen">
            <Check size={16} />
          </button>
          <button disabled={pending} onClick={() => start(async () => { await decideVacation(request.id, "rejected"); onChange(); })} className="text-rose-600 hover:text-rose-700" title="Ablehnen">
            <XCircle size={16} />
          </button>
        </>
      )}
      <button disabled={pending} onClick={() => { if (confirm("Antrag löschen?")) start(async () => { await deleteVacation(request.id); onChange(); }); }} className="text-neutral-400 hover:text-rose-600" title="Löschen">
        <Trash2 size={15} />
      </button>
    </span>
  );
}

function exportCsv(rows: { member: StaffMember; used: number; planned: number; available: number; carryover: number }[], year: number) {
  const head = ["Mitarbeiter", "Team", "Azubi", "Jahr", "Anspruch", "Uebertrag", "Verbraucht", "Geplant", "Verfuegbar"];
  const lines = rows.map((r) => [
    r.member.name,
    teamMeta(r.member.team).label,
    r.member.is_trainee ? "ja" : "nein",
    year,
    r.member.annual_vacation_days,
    r.carryover,
    r.used,
    r.planned,
    r.available,
  ].join(";"));
  const csv = [head.join(";"), ...lines].join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `urlaubsstaende_${year}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

function mdLabel(md: string): string {
  // "MM-DD" → "DD.MM."
  const [m, d] = md.split("-");
  return `${d}.${m}.`;
}

function BlackoutConfig({ blackouts, onChange }: { blackouts: VacationBlackout[]; onChange: () => void }) {
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const fd = new FormData(form);
    start(async () => {
      const res = await addBlackout(null, fd);
      if (res?.error) { setError(res.error); return; }
      form.reset();
      setAdding(false);
      onChange();
    });
  }

  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm">
      <button onClick={() => setOpen((o) => !o)} className="w-full flex items-center justify-between text-sm font-medium text-neutral-700">
        <span className="flex items-center gap-2"><Ban size={16} className="text-rose-500" /> Kritische Zeiträume (kein Urlaub erwünscht) · {blackouts.length}</span>
        <ChevronDown size={15} className={`text-neutral-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <div className="mt-3 space-y-3">
          {blackouts.length === 0 ? (
            <p className="text-sm text-neutral-500">Noch keine kritischen Zeiträume angelegt.</p>
          ) : (
            <ul className="space-y-1">
              {blackouts.map((b) => (
                <li key={b.id} className="flex items-center justify-between text-sm border border-rose-100 bg-rose-50/50 rounded-lg px-3 py-2">
                  <span>
                    <span className="inline-flex items-center gap-1 text-rose-700 font-medium"><Ban size={13} /> {b.label}</span>
                    <span className="text-neutral-500"> · {mdLabel(b.start_md)} – {mdLabel(b.end_md)} (jedes Jahr)</span>
                    <span className="ml-1 text-xs text-neutral-400">{b.team ? teamMeta(b.team).label : "alle Teams"}</span>
                    {b.note && <span className="block text-[11px] text-neutral-400">{b.note}</span>}
                  </span>
                  <button
                    onClick={() => { if (confirm("Zeitraum löschen?")) start(async () => { await deleteBlackout(b.id); onChange(); }); }}
                    className="text-neutral-300 hover:text-rose-600"
                    title="Löschen"
                  >
                    <Trash2 size={14} />
                  </button>
                </li>
              ))}
            </ul>
          )}

          {adding ? (
            <form onSubmit={submit} className="grid grid-cols-1 md:grid-cols-5 gap-2 items-end border-t border-neutral-100 pt-3">
              <label className="block md:col-span-2">
                <span className="text-[10px] uppercase text-neutral-500">Bezeichnung</span>
                <input name="label" required placeholder="z.B. Weihnachtsgeschäft" className="block w-full rounded border border-neutral-300 px-2 py-1 text-sm" />
              </label>
              <label className="block">
                <span className="text-[10px] uppercase text-neutral-500">Von (Jahr egal)</span>
                <input name="start_date" type="date" required className="block w-full rounded border border-neutral-300 px-2 py-1 text-sm" />
              </label>
              <label className="block">
                <span className="text-[10px] uppercase text-neutral-500">Bis (Jahr egal)</span>
                <input name="end_date" type="date" required className="block w-full rounded border border-neutral-300 px-2 py-1 text-sm" />
              </label>
              <label className="block">
                <span className="text-[10px] uppercase text-neutral-500">Team</span>
                <select name="team" defaultValue="all" className="block w-full rounded border border-neutral-300 px-2 py-1 text-sm">
                  <option value="all">Alle Teams</option>
                  {TEAMS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </label>
              <label className="block md:col-span-4">
                <span className="text-[10px] uppercase text-neutral-500">Notiz (optional)</span>
                <input name="note" className="block w-full rounded border border-neutral-300 px-2 py-1 text-sm" />
              </label>
              <div className="flex items-center gap-2">
                <button type="submit" disabled={pending} className="rounded-lg bg-neutral-900 text-white px-3 py-1.5 text-xs font-medium">
                  {pending ? "..." : "Speichern"}
                </button>
                <button type="button" onClick={() => setAdding(false)} className="text-xs text-neutral-500">Abbrechen</button>
              </div>
              {error && <span className="text-rose-600 text-[10px] md:col-span-5">{error}</span>}
            </form>
          ) : (
            <button onClick={() => setAdding(true)} className="flex items-center gap-1 text-sm text-neutral-700 hover:text-neutral-900">
              <Plus size={15} /> Zeitraum hinzufügen
            </button>
          )}
          <p className="text-[10px] text-neutral-400">
            Das Datum wird ohne Jahr gespeichert — der Zeitraum gilt automatisch in jedem Jahr.
          </p>
        </div>
      )}
    </div>
  );
}
