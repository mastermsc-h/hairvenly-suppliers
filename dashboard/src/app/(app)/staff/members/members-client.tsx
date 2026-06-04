"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Plus, Save, X, GraduationCap, Users2, Euro, ShieldAlert, Trash2,
  ChevronDown, TrendingUp, Lock,
} from "lucide-react";
import { TEAMS, teamMeta } from "@/lib/staff/teams";
import { maxOnVacation, UNLIMITED, probation } from "@/lib/staff/capacity";
import {
  createStaffMember,
  updateStaffMember,
  deleteStaffMember,
  updateTeamSetting,
  addSalaryChange,
  deleteSalaryChange,
  addWarning,
  deleteWarning,
} from "@/lib/actions/staff";
import type { StaffMember, TeamSetting, SalaryChange, StaffWarning } from "@/lib/types";

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
  isAdmin,
  today,
  salaryByMember,
  warningsByMember,
}: {
  members: StaffMember[];
  settings: TeamSetting[];
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
              {isAdmin && <Th>Personal (Admin)</Th>}
              <Th>Status</Th>
              <Th right>Aktion</Th>
            </tr>
          </thead>
          <tbody>
            {members.length === 0 && (
              <tr>
                <td colSpan={isAdmin ? 11 : 9} className="px-4 py-8 text-center text-neutral-500">
                  Noch keine Mitarbeiter angelegt
                </td>
              </tr>
            )}
            {members.map((m) =>
              editing === m.id ? (
                <MemberEditRow
                  key={m.id}
                  member={m}
                  colSpan={isAdmin ? 11 : 9}
                  onCancel={() => setEditing(null)}
                  onSaved={() => { setEditing(null); router.refresh(); }}
                />
              ) : (
                <FragmentRow key={m.id}>
                  <tr className="border-t border-neutral-100">
                    <td className="px-4 py-3 font-medium">
                      <span className="inline-flex items-center gap-2">
                        {m.name}
                        {m.is_trainee && (
                          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded-full bg-indigo-100 text-indigo-700">
                            <GraduationCap size={11} /> Azubi
                          </span>
                        )}
                      </span>
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
                    {isAdmin && (
                      <td className="px-4 py-3">
                        <AdminSummary
                          member={m}
                          salary={salaryByMember[m.id] ?? []}
                          warnings={warningsByMember[m.id] ?? []}
                          today={today}
                          open={expanded === m.id}
                          onToggle={() => setExpanded(expanded === m.id ? null : m.id)}
                        />
                      </td>
                    )}
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
                  {isAdmin && expanded === m.id && (
                    <tr className="bg-neutral-50/60 border-t border-neutral-100">
                      <td colSpan={11} className="px-4 py-4">
                        <AdminPanel
                          member={m}
                          salary={salaryByMember[m.id] ?? []}
                          warnings={warningsByMember[m.id] ?? []}
                          today={today}
                          onChange={() => router.refresh()}
                        />
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

function MemberForm({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
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
