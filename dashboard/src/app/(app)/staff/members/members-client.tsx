"use client";

import { useState, useTransition, useMemo } from "react";
import { useRouter } from "next/navigation";
import {
  Plus, Save, X, GraduationCap, Users2, Euro, ShieldAlert, Trash2,
  ChevronDown, TrendingUp, Lock, CalendarDays, Check, XCircle, Ban,
} from "lucide-react";
import { TEAMS, teamMeta } from "@/lib/staff/teams";
import { maxOnVacation, teamOnDay, blackoutsForDay, UNLIMITED, probation } from "@/lib/staff/capacity";
import { countWorkdays, vacationBalance } from "@/lib/staff/holidays";
import {
  createStaffMember,
  updateStaffMember,
  deleteStaffMember,
  updateTeamSetting,
  addSalaryChange,
  deleteSalaryChange,
  addWarning,
  deleteWarning,
  createVacationRequest,
  decideVacation,
  deleteVacation,
} from "@/lib/actions/staff";
import type {
  StaffMember, TeamSetting, SalaryChange, StaffWarning, VacationRequest, VacationBlackout,
} from "@/lib/types";

const inputCls =
  "mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900 outline-none";
const labelCls = "text-xs font-medium text-neutral-600 uppercase tracking-wide";

function fmtBirthday(d: string | null): string {
  if (!d) return "—";
  const [, m, day] = d.split("-");
  return `${day}.${m}.`;
}

function fmtEur(n: number): string {
  return n.toLocaleString("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
}

export default function MembersClient({
  members,
  settings,
  blackouts,
  requestsByMember,
  isAdmin,
  today,
  salaryByMember,
  warningsByMember,
}: {
  members: StaffMember[];
  settings: TeamSetting[];
  blackouts: VacationBlackout[];
  requestsByMember: Record<string, VacationRequest[]>;
  isAdmin: boolean;
  today: string;
  salaryByMember: Record<string, SalaryChange[]>;
  warningsByMember: Record<string, StaffWarning[]>;
}) {
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const router = useRouter();

  return (
    <div className="space-y-6">
      {/* Team-Besetzung */}
      <TeamSettingsCard members={members} settings={settings} onChange={() => router.refresh()} />

      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-neutral-700">Stammdaten</h2>
        <button
          onClick={() => setAdding((a) => !a)}
          className="bg-neutral-900 text-white rounded-lg px-4 py-2 text-sm font-medium flex items-center gap-2"
        >
          <Plus size={16} /> Neuer Mitarbeiter
        </button>
      </div>

      {adding && (
        <MemberForm
          isAdmin={isAdmin}
          onDone={() => { setAdding(false); router.refresh(); }}
          onCancel={() => setAdding(false)}
        />
      )}

      <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50">
            <tr>
              <Th>Name</Th>
              <Th>Team</Th>
              <Th>Geburtstag</Th>
              <Th right>Jahresurlaub</Th>
              <Th right>Übertrag</Th>
              <Th>Verfall Übertrag</Th>
              <Th>Eintritt</Th>
              <Th>Status</Th>
              <Th right>Aktion</Th>
            </tr>
          </thead>
          <tbody>
            {members.length === 0 && (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-neutral-500">
                  Noch keine Mitarbeiter angelegt
                </td>
              </tr>
            )}
            {members.map((m) =>
              editing === m.id ? (
                <MemberEditRow
                  key={m.id}
                  member={m}
                  colSpan={9}
                  onCancel={() => setEditing(null)}
                  onSaved={() => { setEditing(null); router.refresh(); }}
                />
              ) : (
                <FragmentRow key={m.id}>
                  <tr className="border-t border-neutral-100">
                    <td className="px-4 py-3 font-medium align-top">
                      <span className="inline-flex items-center gap-2">
                        {m.name}
                        {m.is_trainee && (
                          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                            <GraduationCap size={11} /> Azubi
                          </span>
                        )}
                      </span>
                      <div className="mt-1">
                        {isAdmin ? (
                          <AdminSummary
                            member={m}
                            salary={salaryByMember[m.id] ?? []}
                            warnings={warningsByMember[m.id] ?? []}
                            today={today}
                            open={expanded === m.id}
                            onToggle={() => setExpanded(expanded === m.id ? null : m.id)}
                          />
                        ) : (
                          <button
                            onClick={() => setExpanded(expanded === m.id ? null : m.id)}
                            className="inline-flex items-center gap-1 text-xs text-neutral-600 hover:text-neutral-900"
                          >
                            <CalendarDays size={12} /> Urlaub & Anträge
                            <ChevronDown size={13} className={`transition-transform ${expanded === m.id ? "rotate-180" : ""}`} />
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${teamMeta(m.team).chip}`}>
                        {teamMeta(m.team).label}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-neutral-600">{fmtBirthday(m.birth_date)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{m.annual_vacation_days}</td>
                    <td className="px-4 py-3 text-right tabular-nums">{m.carryover_days || 0}</td>
                    <td className="px-4 py-3 text-neutral-600">{m.carryover_expires_on ?? "—"}</td>
                    <td className="px-4 py-3 text-neutral-600">{m.employment_start ?? "—"}</td>
                    <td className="px-4 py-3">
                      {m.active ? (
                        <span className="text-emerald-700 text-xs font-medium">Aktiv</span>
                      ) : (
                        <span className="text-neutral-500 text-xs">Inaktiv</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right space-x-3 whitespace-nowrap">
                      <button onClick={() => setEditing(m.id)} className="text-sm text-neutral-700 hover:text-neutral-900">
                        Bearbeiten
                      </button>
                      <DeleteBtn id={m.id} name={m.name} onDone={() => router.refresh()} />
                    </td>
                  </tr>
                  {expanded === m.id && (
                    <tr className="bg-neutral-50/60 border-t border-neutral-100">
                      <td colSpan={9} className="px-4 py-4 space-y-4">
                        <MemberVacation
                          member={m}
                          requests={requestsByMember[m.id] ?? []}
                          allRequests={requestsByMember}
                          members={members}
                          settings={settings}
                          blackouts={blackouts}
                          isAdmin={isAdmin}
                          today={today}
                          onChange={() => router.refresh()}
                        />
                        {isAdmin && (
                          <AdminPanel
                            member={m}
                            salary={salaryByMember[m.id] ?? []}
                            warnings={warningsByMember[m.id] ?? []}
                            today={today}
                            onChange={() => router.refresh()}
                          />
                        )}
                      </td>
                    </tr>
                  )}
                </FragmentRow>
              ),
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TeamSettingsCard({
  members,
  settings,
  onChange,
}: {
  members: StaffMember[];
  settings: TeamSetting[];
  onChange: () => void;
}) {
  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm">
      <div className="flex items-center gap-2 text-sm font-medium text-neutral-700 mb-1">
        <Users2 size={16} /> Team-Besetzung
      </div>
      <p className="text-xs text-neutral-500 mb-4">
        Wie viele dürfen <b>gleichzeitig</b> im Urlaub sein? Bei Überschreitung gibt es im
        Urlaubskalender eine Warnung (nicht blockiert). Leer/0 wird als „unbegrenzt" behandelt.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {TEAMS.map((t) => {
          const active = members.filter((m) => m.team === t.value && m.active).length;
          const current = maxOnVacation(settings, t.value);
          return (
            <TeamSettingRow
              key={t.value}
              team={t.value}
              label={t.label}
              chip={t.chip}
              activeCount={active}
              current={current >= UNLIMITED ? "" : String(current)}
              onChange={onChange}
            />
          );
        })}
      </div>
    </div>
  );
}

function TeamSettingRow({
  team, label, chip, activeCount, current, onChange,
}: {
  team: string; label: string; chip: string; activeCount: number; current: string; onChange: () => void;
}) {
  const [val, setVal] = useState(current);
  const [pending, start] = useTransition();
  const max = val === "" ? null : Number(val);
  const present = max !== null ? Math.max(0, activeCount - max) : null;

  function save() {
    start(async () => {
      await updateTeamSetting(team, val === "" ? 99 : Number(val));
      onChange();
    });
  }

  return (
    <div className="rounded-xl border border-neutral-200 p-3">
      <div className="flex items-center justify-between mb-2">
        <span className={`text-xs px-2 py-0.5 rounded-full ${chip}`}>{label}</span>
        <span className="text-[10px] text-neutral-400">{activeCount} aktiv</span>
      </div>
      <label className="text-[10px] uppercase text-neutral-500">Max. gleichzeitig im Urlaub</label>
      <div className="flex items-center gap-2 mt-1">
        <input
          type="number"
          min="0"
          value={val}
          onChange={(e) => setVal(e.target.value)}
          onBlur={save}
          placeholder="∞"
          className="w-20 rounded-lg border border-neutral-300 px-2 py-1.5 text-sm"
        />
        <button onClick={save} disabled={pending} className="text-xs text-neutral-700 hover:text-neutral-900">
          {pending ? "..." : "speichern"}
        </button>
      </div>
      <div className="text-[10px] text-neutral-400 mt-1">
        {present !== null ? `→ mind. ${present} anwesend` : "keine Begrenzung"}
      </div>
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={`px-4 py-2 text-xs uppercase text-neutral-500 ${right ? "text-right" : "text-left"}`}>
      {children}
    </th>
  );
}

function MemberForm({ isAdmin, onDone, onCancel }: { isAdmin: boolean; onDone: () => void; onCancel: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    fd.set("is_trainee", (e.currentTarget.elements.namedItem("is_trainee") as HTMLInputElement)?.checked ? "true" : "false");
    start(async () => {
      const res = await createStaffMember(null, fd);
      if (res?.error) { setError(res.error); return; }
      onDone();
    });
  }

  return (
    <form onSubmit={submit} className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm space-y-3">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div>
          <label className={labelCls}>Name</label>
          <input name="name" required className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Team</label>
          <select name="team" required defaultValue="salon" className={inputCls}>
            {TEAMS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Geburtstag</label>
          <input name="birth_date" type="date" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Jahresurlaub (Tage)</label>
          <input name="annual_vacation_days" type="number" step="0.5" min="0" defaultValue={30} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Übertrag Vorjahr (Tage)</label>
          <input name="carryover_days" type="number" step="0.5" min="0" defaultValue={0} className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Übertrag verfällt am</label>
          <input name="carryover_expires_on" type="date" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Eintrittsdatum</label>
          <input name="employment_start" type="date" className={inputCls} />
        </div>
        <div className="flex items-end pb-2">
          <label className="inline-flex items-center gap-2 text-sm text-neutral-700">
            <input name="is_trainee" type="checkbox" className="rounded border-neutral-300" />
            <GraduationCap size={15} /> Auszubildende/r
          </label>
        </div>
      </div>

      {isAdmin && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 border-t border-neutral-100 pt-3">
          <div className="md:col-span-3 flex items-center gap-2 text-xs font-medium text-neutral-600">
            <Euro size={13} /> Gehalt (nur Admin) — Startgehalt, spätere Erhöhungen pro Mitarbeiter
          </div>
          <div>
            <label className={labelCls}>Gehalt mtl. brutto (€)</label>
            <input name="initial_salary" type="number" step="1" min="0" placeholder="z.B. 2800" className={inputCls} />
          </div>
          <div className="md:col-span-2">
            <label className={labelCls}>Notiz (optional)</label>
            <input name="initial_salary_note" placeholder="z.B. Einstiegsgehalt" className={inputCls} />
          </div>
        </div>
      )}

      {error && <div className="text-rose-600 text-sm">{error}</div>}
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className="text-sm text-neutral-600">Abbrechen</button>
        <button type="submit" disabled={pending} className="bg-neutral-900 text-white rounded-lg px-4 py-2 text-sm font-medium flex items-center gap-2">
          <Save size={14} /> {pending ? "..." : "Speichern"}
        </button>
      </div>
    </form>
  );
}

function MemberEditRow({
  member, colSpan, onCancel, onSaved,
}: {
  member: StaffMember; colSpan: number; onCancel: () => void; onSaved: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    fd.set("is_trainee", (e.currentTarget.elements.namedItem("is_trainee") as HTMLInputElement)?.checked ? "true" : "false");
    start(async () => {
      const res = await updateStaffMember(member.id, fd);
      if (res?.error) { setError(res.error); return; }
      onSaved();
    });
  }

  return (
    <tr className="border-t border-neutral-100 bg-neutral-50">
      <td colSpan={colSpan} className="px-4 py-3">
        <form onSubmit={save} className="grid grid-cols-2 md:grid-cols-8 gap-2 items-end">
          <Field label="Name"><input name="name" defaultValue={member.name} className="w-full rounded border border-neutral-300 px-2 py-1 text-sm" /></Field>
          <Field label="Team">
            <select name="team" defaultValue={member.team} className="w-full rounded border border-neutral-300 px-2 py-1 text-sm">
              {TEAMS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </Field>
          <Field label="Geburtstag"><input name="birth_date" type="date" defaultValue={member.birth_date ?? ""} className="w-full rounded border border-neutral-300 px-2 py-1 text-sm" /></Field>
          <Field label="Jahresurlaub"><input name="annual_vacation_days" type="number" step="0.5" defaultValue={member.annual_vacation_days} className="w-full rounded border border-neutral-300 px-2 py-1 text-sm" /></Field>
          <Field label="Übertrag"><input name="carryover_days" type="number" step="0.5" defaultValue={member.carryover_days} className="w-full rounded border border-neutral-300 px-2 py-1 text-sm" /></Field>
          <Field label="Verfall"><input name="carryover_expires_on" type="date" defaultValue={member.carryover_expires_on ?? ""} className="w-full rounded border border-neutral-300 px-2 py-1 text-sm" /></Field>
          <Field label="Eintritt"><input name="employment_start" type="date" defaultValue={member.employment_start ?? ""} className="w-full rounded border border-neutral-300 px-2 py-1 text-sm" /></Field>
          <Field label="Status">
            <select name="active" defaultValue={String(member.active)} className="w-full rounded border border-neutral-300 px-2 py-1 text-sm">
              <option value="true">Aktiv</option>
              <option value="false">Inaktiv</option>
            </select>
          </Field>
          <div className="col-span-2 md:col-span-8 flex justify-between items-center gap-3 mt-1">
            <label className="inline-flex items-center gap-2 text-sm text-neutral-700">
              <input name="is_trainee" type="checkbox" defaultChecked={member.is_trainee} className="rounded border-neutral-300" />
              <GraduationCap size={14} /> Azubi
            </label>
            <div className="flex items-center gap-3">
              {error && <span className="text-rose-600 text-xs">{error}</span>}
              <button type="submit" disabled={pending} className="text-sm text-neutral-900 font-medium">
                <Save size={14} className="inline" /> Speichern
              </button>
              <button type="button" onClick={onCancel} className="text-sm text-neutral-500">
                <X size={14} className="inline" />
              </button>
            </div>
          </div>
        </form>
      </td>
    </tr>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[10px] uppercase text-neutral-500">{label}</span>
      {children}
    </label>
  );
}

function DeleteBtn({ id, name, onDone }: { id: string; name: string; onDone: () => void }) {
  const [pending, start] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() => {
        if (!confirm(`„${name}" inkl. aller Urlaubs- und Krankheitsdaten löschen?`)) return;
        start(async () => { await deleteStaffMember(id); onDone(); });
      }}
      className="text-sm text-rose-600 hover:text-rose-700"
    >
      Löschen
    </button>
  );
}

// ─── Admin-only: Gehalt, Probezeit, Verwarnungen ────────────────

function FragmentRow({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}

function probationBadge(member: StaffMember, today: string) {
  const p = probation(member.employment_start, today);
  if (!p) return null;
  if (p.over) return { text: `Probezeit beendet (${p.end})`, cls: "bg-neutral-100 text-neutral-600" };
  if (p.daysLeft <= 30) return { text: `Probezeit endet ${p.end} (in ${p.daysLeft} T)`, cls: "bg-amber-100 text-amber-800" };
  return { text: `Probezeit bis ${p.end}`, cls: "bg-emerald-100 text-emerald-800" };
}

function AdminSummary({
  member, salary, warnings, today, open, onToggle,
}: {
  member: StaffMember;
  salary: SalaryChange[];
  warnings: StaffWarning[];
  today: string;
  open: boolean;
  onToggle: () => void;
}) {
  const current = salary[0]; // bereits nach effective_date desc sortiert
  const pb = probationBadge(member, today);
  return (
    <button onClick={onToggle} className="inline-flex items-center gap-2 text-left hover:opacity-80">
      <div className="space-y-1">
        <span className="inline-flex items-center gap-1 text-sm font-medium text-neutral-800">
          <Euro size={13} /> {current ? fmtEur(current.amount) : "—"}
          {salary.length > 1 && <span className="text-[10px] text-emerald-700">+{salary.length - 1} Erhöh.</span>}
        </span>
        <div className="flex items-center gap-1.5">
          {warnings.length > 0 && (
            <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-rose-100 text-rose-700">
              <ShieldAlert size={10} /> {warnings.length} Verw.
            </span>
          )}
          {pb && <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${pb.cls}`}>{pb.text}</span>}
        </div>
      </div>
      <ChevronDown size={14} className={`text-neutral-400 transition-transform ${open ? "rotate-180" : ""}`} />
    </button>
  );
}

function AdminPanel({
  member, salary, warnings, today, onChange,
}: {
  member: StaffMember;
  salary: SalaryChange[];
  warnings: StaffWarning[];
  today: string;
  onChange: () => void;
}) {
  const p = probation(member.employment_start, today);
  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
      {/* Eintritt / Probezeit */}
      <div className="rounded-xl border border-neutral-200 bg-white p-3">
        <div className="flex items-center gap-2 text-xs font-medium text-neutral-700 mb-2">
          <Lock size={12} /> Eintritt & Probezeit
        </div>
        <div className="text-sm text-neutral-700">Eintritt: <b>{member.employment_start ?? "—"}</b></div>
        {p ? (
          <div className="text-sm mt-1">
            Probezeit (6 Mon.) bis <b>{p.end}</b>{" "}
            {p.over
              ? <span className="text-neutral-500">— beendet</span>
              : <span className={p.daysLeft <= 30 ? "text-amber-700 font-medium" : "text-emerald-700"}>— läuft (noch {p.daysLeft} Tage)</span>}
          </div>
        ) : (
          <div className="text-sm text-neutral-400 mt-1">Kein Eintrittsdatum hinterlegt.</div>
        )}
      </div>

      {/* Gehalt */}
      <div className="rounded-xl border border-neutral-200 bg-white p-3">
        <div className="flex items-center gap-2 text-xs font-medium text-neutral-700 mb-2">
          <TrendingUp size={12} /> Gehalt (mtl. brutto)
        </div>
        {salary.length === 0 ? (
          <div className="text-sm text-neutral-400">Noch kein Gehalt erfasst.</div>
        ) : (
          <ul className="space-y-1 mb-2">
            {salary.map((s, i) => (
              <li key={s.id} className="flex items-center justify-between text-sm">
                <span>
                  <b>{fmtEur(s.amount)}</b>
                  <span className="text-neutral-400"> ab {s.effective_date}</span>
                  {i === 0 && <span className="ml-1 text-[10px] text-emerald-700">aktuell</span>}
                  {s.note && <span className="block text-[10px] text-neutral-400">{s.note}</span>}
                </span>
                <button onClick={() => { if (confirm("Eintrag löschen?")) { void (async () => { await deleteSalaryChange(s.id); onChange(); })(); } }} className="text-neutral-300 hover:text-rose-600">
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <SalaryForm staffId={member.id} onChange={onChange} />
      </div>

      {/* Verwarnungen */}
      <div className="rounded-xl border border-neutral-200 bg-white p-3">
        <div className="flex items-center gap-2 text-xs font-medium text-neutral-700 mb-2">
          <ShieldAlert size={12} /> Verwarnungen
        </div>
        {warnings.length === 0 ? (
          <div className="text-sm text-neutral-400">Keine Verwarnungen.</div>
        ) : (
          <ul className="space-y-1 mb-2">
            {warnings.map((w) => (
              <li key={w.id} className="flex items-center justify-between text-sm">
                <span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${w.type === "written" ? "bg-rose-100 text-rose-700" : "bg-amber-100 text-amber-800"}`}>
                    {w.type === "written" ? "schriftlich" : "mündlich"}
                  </span>
                  <span className="text-neutral-400"> {w.warning_date}</span>
                  {w.reason && <span className="block text-[10px] text-neutral-500">{w.reason}</span>}
                </span>
                <button onClick={() => { if (confirm("Verwarnung löschen?")) { void (async () => { await deleteWarning(w.id); onChange(); })(); } }} className="text-neutral-300 hover:text-rose-600">
                  <Trash2 size={13} />
                </button>
              </li>
            ))}
          </ul>
        )}
        <WarningForm staffId={member.id} onChange={onChange} />
      </div>
    </div>
  );
}

function SalaryForm({ staffId, onChange }: { staffId: string; onChange: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const fd = new FormData(form);
    start(async () => {
      const res = await addSalaryChange(staffId, fd);
      if (res?.error) { setError(res.error); return; }
      form.reset();
      onChange();
    });
  }
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2 border-t border-neutral-100 pt-2">
      <label className="block">
        <span className="text-[10px] uppercase text-neutral-500">ab</span>
        <input name="effective_date" type="date" required className="block w-32 rounded border border-neutral-300 px-2 py-1 text-sm" />
      </label>
      <label className="block">
        <span className="text-[10px] uppercase text-neutral-500">Betrag €</span>
        <input name="amount" type="number" step="1" min="0" required placeholder="z.B. 2800" className="block w-24 rounded border border-neutral-300 px-2 py-1 text-sm" />
      </label>
      <label className="block flex-1 min-w-[100px]">
        <span className="text-[10px] uppercase text-neutral-500">Notiz</span>
        <input name="note" className="block w-full rounded border border-neutral-300 px-2 py-1 text-sm" />
      </label>
      <button type="submit" disabled={pending} className="rounded-lg bg-neutral-900 text-white px-3 py-1.5 text-xs font-medium">
        {pending ? "..." : "+ erfassen"}
      </button>
      {error && <span className="text-rose-600 text-[10px] w-full">{error}</span>}
    </form>
  );
}

// ─── Urlaub direkt beim Mitarbeiter (für alle staff-Nutzer) ─────

function vacStatusBadge(status: string) {
  const map: Record<string, string> = {
    submitted: "bg-sky-100 text-sky-800",
    approved: "bg-emerald-100 text-emerald-800",
    rejected: "bg-rose-100 text-rose-800",
  };
  const label: Record<string, string> = { submitted: "Offen", approved: "Genehmigt", rejected: "Abgelehnt" };
  return <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${map[status]}`}>{label[status]}</span>;
}

function MemberVacation({
  member, requests, allRequests, members, settings, blackouts, isAdmin, today, onChange,
}: {
  member: StaffMember;
  requests: VacationRequest[];
  allRequests: Record<string, VacationRequest[]>;
  members: StaffMember[];
  settings: TeamSetting[];
  blackouts: VacationBlackout[];
  isAdmin: boolean;
  today: string;
  onChange: () => void;
}) {
  const year = Number(today.slice(0, 4));
  const bal = vacationBalance(requests, {
    year,
    annualDays: member.annual_vacation_days,
    carryoverDays: member.carryover_days,
    carryoverExpiresOn: member.carryover_expires_on,
    today,
  });
  const flatAll = useMemo(() => Object.values(allRequests).flat(), [allRequests]);
  const sorted = [...requests].sort((a, b) => (a.start_date < b.start_date ? 1 : -1));

  return (
    <div className="rounded-xl border border-neutral-200 bg-white p-3 space-y-3">
      <div className="flex items-center gap-2 text-xs font-medium text-neutral-700">
        <CalendarDays size={13} /> Urlaub {member.name} · {year}
      </div>

      {/* Saldo */}
      <div className="flex flex-wrap gap-4 text-sm">
        <Stat label="Anspruch" value={member.annual_vacation_days} />
        <Stat label="Übertrag" value={bal.carryover} />
        <Stat label="Verbraucht" value={bal.used} />
        <Stat label="Geplant" value={bal.planned} muted />
        <div>
          <div className="text-[10px] uppercase text-neutral-500">Verfügbar</div>
          <span className={`inline-block mt-0.5 text-base font-bold tabular-nums px-2 py-0.5 rounded-lg ${
            bal.available <= 0 ? "bg-rose-100 text-rose-700" : bal.available <= 5 ? "bg-amber-100 text-amber-800" : "bg-emerald-100 text-emerald-800"
          }`}>{bal.available}</span>
        </div>
      </div>

      {/* Antrag direkt anlegen */}
      <MemberVacationForm member={member} requestsAll={flatAll} members={members} settings={settings} blackouts={blackouts} isAdmin={isAdmin} onChange={onChange} />

      {/* Anträge / vergangene Urlaube */}
      {sorted.length === 0 ? (
        <p className="text-sm text-neutral-400">Noch keine Urlaube/Anträge.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[10px] uppercase text-neutral-400 text-left">
                <th className="py-1 pr-3">Zeitraum</th>
                <th className="py-1 pr-3 text-right">Tage</th>
                <th className="py-1 pr-3">Art</th>
                <th className="py-1 pr-3">Status</th>
                <th className="py-1 pr-3">Eingereicht</th>
                <th className="py-1 text-right">Aktion</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => {
                const past = r.end_date < today;
                return (
                  <tr key={r.id} className={`border-t border-neutral-100 ${past ? "text-neutral-400" : ""}`}>
                    <td className="py-1.5 pr-3 whitespace-nowrap">{r.start_date} – {r.end_date}</td>
                    <td className="py-1.5 pr-3 text-right tabular-nums">{r.days}</td>
                    <td className="py-1.5 pr-3">{r.paid ? "Bezahlt" : "Unbezahlt"}</td>
                    <td className="py-1.5 pr-3">{vacStatusBadge(r.status)}{r.decided_at && <span className="block text-[9px] text-neutral-400">am {r.decided_at.slice(0, 10)}</span>}</td>
                    <td className="py-1.5 pr-3 text-neutral-400">{r.submitted_at?.slice(0, 10)}</td>
                    <td className="py-1.5 text-right whitespace-nowrap">
                      <VacRowActions request={r} onChange={onChange} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, muted }: { label: string; value: number; muted?: boolean }) {
  return (
    <div>
      <div className="text-[10px] uppercase text-neutral-500">{label}</div>
      <div className={`mt-0.5 tabular-nums font-medium ${muted ? "text-neutral-500" : "text-neutral-800"}`}>{value}</div>
    </div>
  );
}

function MemberVacationForm({
  member, requestsAll, members, settings, blackouts, isAdmin, onChange,
}: {
  member: StaffMember;
  requestsAll: VacationRequest[];
  members: StaffMember[];
  settings: TeamSetting[];
  blackouts: VacationBlackout[];
  isAdmin: boolean;
  onChange: () => void;
}) {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [override, setOverride] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startT] = useTransition();

  const autoDays = start && end && end >= start ? countWorkdays(start, end) : null;

  const warn = useMemo(() => {
    if (!start || !end || end < start) return null;
    const cap = maxOnVacation(settings, member.team);
    const teamMembers = members.filter((x) => x.team === member.team);
    let peak = 0;
    const blk = new Set<string>();
    for (let t = Date.parse(start); t <= Date.parse(end); t += 86400000) {
      const day = new Date(t).toISOString().slice(0, 10);
      if (cap < UNLIMITED) {
        const existing = teamOnDay(teamMembers, requestsAll, member.team, day).filter((e) => e.memberId !== member.id);
        peak = Math.max(peak, existing.length + 1);
      }
      blackoutsForDay(day, blackouts, member.team).forEach((b) => blk.add(b.label));
    }
    return {
      cap: cap < UNLIMITED && peak > cap ? { peak, cap } : null,
      blackouts: blk.size ? [...blk] : null,
    };
  }, [start, end, member, members, settings, blackouts, requestsAll]);

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const fd = new FormData(form);
    fd.set("staff_id", member.id);
    startT(async () => {
      const res = await createVacationRequest(null, fd);
      if (res?.error) { setError(res.error); return; }
      form.reset();
      setStart(""); setEnd(""); setOverride("");
      onChange();
    });
  }

  return (
    <form onSubmit={submit} className="space-y-2 border-t border-neutral-100 pt-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="block">
          <span className="text-[10px] uppercase text-neutral-500">Von</span>
          <input name="start_date" type="date" required value={start} onChange={(e) => setStart(e.target.value)} className="block w-36 rounded border border-neutral-300 px-2 py-1 text-sm" />
        </label>
        <label className="block">
          <span className="text-[10px] uppercase text-neutral-500">Bis</span>
          <input name="end_date" type="date" required value={end} onChange={(e) => setEnd(e.target.value)} className="block w-36 rounded border border-neutral-300 px-2 py-1 text-sm" />
        </label>
        <label className="block">
          <span className="text-[10px] uppercase text-neutral-500">Tage {autoDays !== null && <span className="normal-case text-neutral-400">(auto {autoDays})</span>}</span>
          <input name="days_override" type="number" step="0.5" min="0" value={override} onChange={(e) => setOverride(e.target.value)} placeholder={autoDays !== null ? String(autoDays) : "auto"} className="block w-20 rounded border border-neutral-300 px-2 py-1 text-sm" />
        </label>
        <label className="block">
          <span className="text-[10px] uppercase text-neutral-500">Art</span>
          <select name="paid" defaultValue="true" className="block rounded border border-neutral-300 px-2 py-1 text-sm">
            <option value="true">Bezahlt</option>
            <option value="false">Unbezahlt</option>
          </select>
        </label>
        {isAdmin && (
          <label className="block">
            <span className="text-[10px] uppercase text-neutral-500">Eintragen als</span>
            <select name="status" defaultValue="approved" className="block rounded border border-neutral-300 px-2 py-1 text-sm">
              <option value="approved">Genehmigt</option>
              <option value="submitted">Antrag (offen)</option>
            </select>
          </label>
        )}
        <label className="block flex-1 min-w-[120px]">
          <span className="text-[10px] uppercase text-neutral-500">Notiz</span>
          <input name="note" className="block w-full rounded border border-neutral-300 px-2 py-1 text-sm" />
        </label>
        <button type="submit" disabled={pending} className="rounded-lg bg-neutral-900 text-white px-3 py-1.5 text-xs font-medium">
          {pending ? "..." : isAdmin ? "+ Urlaub eintragen" : "+ Antrag"}
        </button>
      </div>
      {warn?.cap && (
        <div className="text-[11px] text-amber-800 bg-amber-50 border border-amber-300 rounded px-2 py-1">
          Team {teamMeta(member.team).label}: bis zu {warn.cap.peak} gleichzeitig im Urlaub (max. {warn.cap.cap}).
        </div>
      )}
      {warn?.blackouts && (
        <div className="text-[11px] text-rose-800 bg-rose-50 border border-rose-300 rounded px-2 py-1 flex items-center gap-1">
          <Ban size={12} /> Kritischer Zeitraum: {warn.blackouts.join(", ")} — trotzdem möglich.
        </div>
      )}
      {error && <div className="text-rose-600 text-xs">{error}</div>}
    </form>
  );
}

function VacRowActions({ request, onChange }: { request: VacationRequest; onChange: () => void }) {
  const [pending, start] = useTransition();
  return (
    <span className="inline-flex items-center gap-2">
      {request.status === "submitted" && (
        <>
          <button disabled={pending} onClick={() => start(async () => { await decideVacation(request.id, "approved"); onChange(); })} className="text-emerald-700 hover:text-emerald-800" title="Genehmigen">
            <Check size={15} />
          </button>
          <button disabled={pending} onClick={() => start(async () => { await decideVacation(request.id, "rejected"); onChange(); })} className="text-rose-600 hover:text-rose-700" title="Ablehnen">
            <XCircle size={15} />
          </button>
        </>
      )}
      <button disabled={pending} onClick={() => { if (confirm("Antrag/Urlaub löschen?")) start(async () => { await deleteVacation(request.id); onChange(); }); }} className="text-neutral-300 hover:text-rose-600" title="Löschen">
        <Trash2 size={14} />
      </button>
    </span>
  );
}

function WarningForm({ staffId, onChange }: { staffId: string; onChange: () => void }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const fd = new FormData(form);
    start(async () => {
      const res = await addWarning(staffId, fd);
      if (res?.error) { setError(res.error); return; }
      form.reset();
      onChange();
    });
  }
  return (
    <form onSubmit={submit} className="flex flex-wrap items-end gap-2 border-t border-neutral-100 pt-2">
      <label className="block">
        <span className="text-[10px] uppercase text-neutral-500">Datum</span>
        <input name="warning_date" type="date" required className="block w-32 rounded border border-neutral-300 px-2 py-1 text-sm" />
      </label>
      <label className="block">
        <span className="text-[10px] uppercase text-neutral-500">Art</span>
        <select name="type" className="block rounded border border-neutral-300 px-2 py-1 text-sm">
          <option value="oral">mündlich</option>
          <option value="written">schriftlich</option>
        </select>
      </label>
      <label className="block flex-1 min-w-[100px]">
        <span className="text-[10px] uppercase text-neutral-500">Grund</span>
        <input name="reason" className="block w-full rounded border border-neutral-300 px-2 py-1 text-sm" />
      </label>
      <button type="submit" disabled={pending} className="rounded-lg bg-neutral-900 text-white px-3 py-1.5 text-xs font-medium">
        {pending ? "..." : "+ erfassen"}
      </button>
      {error && <span className="text-rose-600 text-[10px] w-full">{error}</span>}
    </form>
  );
}
