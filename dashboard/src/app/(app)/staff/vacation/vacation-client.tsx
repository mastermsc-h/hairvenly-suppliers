"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Save, Check, XCircle, AlertTriangle, Download, CalendarDays, Trash2 } from "lucide-react";
import { TEAMS, teamMeta } from "@/lib/staff/teams";
import { countWorkdays, vacationBalance } from "@/lib/staff/holidays";
import {
  createVacationRequest,
  decideVacation,
  deleteVacation,
} from "@/lib/actions/staff";
import type { StaffMember, VacationRequest } from "@/lib/types";

const inputCls =
  "mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900 outline-none";
const labelCls = "text-xs font-medium text-neutral-600 uppercase tracking-wide";
const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

export default function VacationClient({
  members,
  requests,
  today,
}: {
  members: StaffMember[];
  requests: VacationRequest[];
  today: string;
}) {
  const router = useRouter();
  const currentYear = Number(today.slice(0, 4));
  const [year, setYear] = useState(currentYear);
  const [teamFilter, setTeamFilter] = useState<string>("all");
  const [adding, setAdding] = useState(false);

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

  // Team-Überlappungswarnung: ≥2 aus einem Team heute gleichzeitig abwesend.
  const overlapWarnings = TEAMS.map((t) => ({
    team: t,
    names: absentToday.filter((m) => m.team === t.value).map((m) => m.name),
  })).filter((w) => w.names.length >= 2);

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
        <button onClick={() => exportCsv(rows, year)} className="flex items-center gap-2 rounded-lg border border-neutral-300 px-3 py-2 text-sm hover:bg-neutral-50">
          <Download size={15} /> CSV-Export
        </button>
        <button onClick={() => setAdding((a) => !a)} className="bg-neutral-900 text-white rounded-lg px-4 py-2 text-sm font-medium flex items-center gap-2">
          <Plus size={16} /> Urlaubsantrag
        </button>
      </div>

      {/* Heute abwesend + Überlappungswarnung */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
          <div className="flex items-center gap-2 text-sm font-medium text-neutral-700 mb-2">
            <CalendarDays size={16} /> Heute abwesend
          </div>
          {absentToday.length === 0 ? (
            <p className="text-sm text-neutral-500">Heute ist niemand im Urlaub.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {absentToday.map((m) => (
                <span key={m.id} className={`text-xs px-2 py-1 rounded-full ${teamMeta(m.team).chip}`}>
                  {m.name}
                </span>
              ))}
            </div>
          )}
        </div>
        <div className={`rounded-2xl border p-4 shadow-sm ${overlapWarnings.length ? "bg-amber-50 border-amber-300" : "bg-white border-neutral-200"}`}>
          <div className="flex items-center gap-2 text-sm font-medium text-neutral-700 mb-2">
            <AlertTriangle size={16} className={overlapWarnings.length ? "text-amber-600" : "text-neutral-400"} /> Team-Überlappung heute
          </div>
          {overlapWarnings.length === 0 ? (
            <p className="text-sm text-neutral-500">Keine kritischen Überschneidungen.</p>
          ) : (
            <ul className="text-sm text-amber-800 space-y-1">
              {overlapWarnings.map((w) => (
                <li key={w.team.value}>
                  <b>{w.team.label}:</b> {w.names.join(", ")} ({w.names.length} gleichzeitig)
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {adding && (
        <RequestForm
          members={members}
          onDone={() => { setAdding(false); router.refresh(); }}
          onCancel={() => setAdding(false)}
        />
      )}

      {/* Saldo-Übersicht */}
      <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50">
            <tr>
              <th className="text-left px-4 py-2 text-xs uppercase text-neutral-500">Mitarbeiter</th>
              <th className="text-left px-4 py-2 text-xs uppercase text-neutral-500">Team</th>
              <th className="text-right px-4 py-2 text-xs uppercase text-neutral-500">Anspruch</th>
              <th className="text-right px-4 py-2 text-xs uppercase text-neutral-500">Übertrag</th>
              <th className="text-right px-4 py-2 text-xs uppercase text-neutral-500">Verbraucht</th>
              <th className="text-right px-4 py-2 text-xs uppercase text-neutral-500">Geplant</th>
              <th className="text-right px-4 py-2 text-xs uppercase text-neutral-500">Verfügbar</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={7} className="px-4 py-8 text-center text-neutral-500">Keine Mitarbeiter — lege sie unter „Mitarbeiter" an.</td></tr>
            )}
            {rows.map((r) => (
              <tr key={r.member.id} className="border-t border-neutral-100">
                <td className="px-4 py-3 font-medium">{r.member.name}</td>
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

      {/* Timeline */}
      <Timeline members={visibleMembers} requests={requests} year={year} today={today} />

      {/* Anträge mit Workflow */}
      <RequestTable members={members} requests={requests} year={year} onChange={() => router.refresh()} />
    </div>
  );
}

function Timeline({ members, requests, year, today }: { members: StaffMember[]; requests: VacationRequest[]; year: number; today: string }) {
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
      <div className="text-sm font-medium text-neutral-700 mb-3">Timeline {year} — wer ist wann weg</div>
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
    </div>
  );
}

function RequestForm({ members, onDone, onCancel }: { members: StaffMember[]; onDone: () => void; onCancel: () => void }) {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [override, setOverride] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startT] = useTransition();

  const autoDays = start && end && end >= start ? countWorkdays(start, end) : null;

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
          <select name="staff_id" required className={inputCls}>
            <option value="">— wählen —</option>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
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
      </div>
      {error && <div className="text-rose-600 text-sm">{error}</div>}
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className="text-sm text-neutral-600">Abbrechen</button>
        <button type="submit" disabled={pending} className="bg-neutral-900 text-white rounded-lg px-4 py-2 text-sm font-medium flex items-center gap-2">
          <Save size={14} /> {pending ? "..." : "Antrag anlegen"}
        </button>
      </div>
    </form>
  );
}

function RequestTable({ members, requests, year, onChange }: { members: StaffMember[]; requests: VacationRequest[]; year: number; onChange: () => void }) {
  const name = (id: string) => members.find((m) => m.id === id)?.name ?? "—";
  const list = requests.filter((r) => r.start_date.slice(0, 4) === String(year));

  return (
    <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-x-auto">
      <div className="px-4 py-3 text-sm font-medium text-neutral-700 border-b border-neutral-100">Anträge {year}</div>
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
  const head = ["Mitarbeiter", "Team", "Jahr", "Anspruch", "Uebertrag", "Verbraucht", "Geplant", "Verfuegbar"];
  const lines = rows.map((r) => [
    r.member.name,
    teamMeta(r.member.team).label,
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
