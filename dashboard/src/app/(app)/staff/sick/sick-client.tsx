"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  ResponsiveContainer, BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid,
} from "recharts";
import {
  Plus, Save, Upload, FileText, AlertTriangle, Trash2, Eye, Clock,
} from "lucide-react";
import { TEAMS, teamMeta } from "@/lib/staff/teams";
import {
  createSickDay, uploadSickCertificate, deleteSickDay, getCertificateSignedUrl,
} from "@/lib/actions/staff";
import type { StaffMember, SickDay } from "@/lib/types";
import { Card, CardHead } from "../staff-ui";

const inputCls =
  "mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900 outline-none";
const labelCls = "text-xs font-medium text-neutral-600 uppercase tracking-wide";
const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

export default function SickClient({
  members, sickDays, today,
}: {
  members: StaffMember[];
  sickDays: SickDay[];
  today: string;
}) {
  const router = useRouter();
  const currentYear = Number(today.slice(0, 4));
  const [year, setYear] = useState(currentYear);
  const [teamFilter, setTeamFilter] = useState("all");
  const [adding, setAdding] = useState(false);

  const memberById = useMemo(() => new Map(members.map((m) => [m.id, m])), [members]);
  const visibleMembers = members.filter((m) => teamFilter === "all" || m.team === teamFilter);

  const yearSick = sickDays.filter((s) => s.start_date.slice(0, 4) === String(year));

  // Offene AU-Pflicht (rote Markierung): >3 Tage, Pflicht, nicht hochgeladen.
  const missingCerts = yearSick.filter((s) => s.certificate_required && !s.certificate_uploaded);

  // Folgebescheinigung läuft demnächst aus (<= 3 Tage, noch krank).
  const expiringCerts = yearSick.filter(
    (s) => s.certificate_expires_on && s.certificate_expires_on >= today &&
      Date.parse(s.certificate_expires_on) - Date.parse(today) <= 3 * 86400000,
  );

  // Pro-Mitarbeiter-Summe
  const perMember = visibleMembers.map((m) => {
    const list = yearSick.filter((s) => s.staff_id === m.id);
    return {
      member: m,
      total: list.reduce((sum, s) => sum + Number(s.days || 0), 0),
      count: list.length,
      missing: list.filter((s) => s.certificate_required && !s.certificate_uploaded).length,
    };
  });

  // Monats-Trend (Krankheitstage pro Monat, gefiltertes Team)
  const monthData = MONTHS.map((label, i) => {
    const days = yearSick
      .filter((s) => {
        const m = memberById.get(s.staff_id);
        if (teamFilter !== "all" && m?.team !== teamFilter) return false;
        return Number(s.start_date.slice(5, 7)) === i + 1;
      })
      .reduce((sum, s) => sum + Number(s.days || 0), 0);
    return { month: label, days };
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="rounded-lg border border-neutral-300 px-3 py-2 text-sm">
          {[currentYear - 1, currentYear, currentYear + 1].map((y) => <option key={y} value={y}>{y}</option>)}
        </select>
        <select value={teamFilter} onChange={(e) => setTeamFilter(e.target.value)} className="rounded-lg border border-neutral-300 px-3 py-2 text-sm">
          <option value="all">Alle Teams</option>
          {TEAMS.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
        </select>
        <div className="flex-1" />
        <button onClick={() => setAdding((a) => !a)} className="bg-neutral-900 text-white rounded-lg px-4 py-2 text-sm font-medium flex items-center gap-2">
          <Plus size={16} /> Krankmeldung
        </button>
      </div>

      {/* Warnbanner */}
      {(missingCerts.length > 0 || expiringCerts.length > 0) && (
        <div className="rounded-2xl border border-amber-300 bg-amber-50 p-4 space-y-1">
          {missingCerts.length > 0 && (
            <div className="flex items-center gap-2 text-sm text-amber-800">
              <AlertTriangle size={16} className="text-amber-600" />
              <b>{missingCerts.length}</b> Krankmeldung(en) &gt; 3 Tage ohne hochgeladene Bescheinigung (AU-Pflicht).
            </div>
          )}
          {expiringCerts.length > 0 && (
            <div className="flex items-center gap-2 text-sm text-amber-800">
              <Clock size={16} className="text-amber-600" />
              <b>{expiringCerts.length}</b> Bescheinigung(en) laufen in ≤ 3 Tagen aus — Folgebescheinigung prüfen.
            </div>
          )}
        </div>
      )}

      {adding && (
        <SickForm members={members} onDone={() => { setAdding(false); router.refresh(); }} onCancel={() => setAdding(false)} />
      )}

      {/* Pro-Mitarbeiter-Übersicht */}
      <div className="bg-white rounded-2xl border border-neutral-200/80 shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50/80 border-b border-neutral-200">
            <tr>
              <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Mitarbeiter</th>
              <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Team</th>
              <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Krankheitstage {year}</th>
              <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Meldungen</th>
              <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Fehlende AU</th>
            </tr>
          </thead>
          <tbody>
            {perMember.length === 0 && (
              <tr><td colSpan={5} className="px-4 py-8 text-center text-neutral-500">Keine Mitarbeiter.</td></tr>
            )}
            {perMember.map((r) => (
              <tr key={r.member.id} className="border-t border-neutral-100 hover:bg-neutral-50/50 transition-colors">
                <td className="px-4 py-3 font-medium">{r.member.name}</td>
                <td className="px-4 py-3"><span className={`text-xs px-2 py-0.5 rounded-full ${teamMeta(r.member.team).chip}`}>{teamMeta(r.member.team).label}</span></td>
                <td className="px-4 py-3 text-right tabular-nums font-semibold">{r.total}</td>
                <td className="px-4 py-3 text-right tabular-nums text-neutral-500">{r.count}</td>
                <td className="px-4 py-3 text-right">
                  {r.missing > 0
                    ? <span className="text-xs px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 font-medium">{r.missing}</span>
                    : <span className="text-neutral-400">—</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Statistik: Monats-Trend */}
      <Card>
        <CardHead icon={<AlertTriangle size={14} />} title={`Krankheitstage je Monat · ${year}`} tint="rose" />
        <div className="p-4 md:p-5">
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={monthData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
              <XAxis dataKey="month" tick={{ fontSize: 12 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 12 }} />
              <Tooltip />
              <Bar dataKey="days" fill="#f43f5e" radius={[4, 4, 0, 0]} name="Tage" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </Card>

      {/* Einzelmeldungen mit Upload */}
      <SickTable members={memberById} sickDays={yearSick} year={year} onChange={() => router.refresh()} />
    </div>
  );
}

function SickForm({ members, onDone, onCancel }: { members: StaffMember[]; onDone: () => void; onCancel: () => void }) {
  const [start, setStart] = useState("");
  const [end, setEnd] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startT] = useTransition();

  const calDays = start && end && end >= start
    ? Math.round((Date.parse(end) - Date.parse(start)) / 86400000) + 1
    : null;
  const certNeeded = calDays !== null && calDays > 3;

  function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fd = new FormData(e.currentTarget);
    startT(async () => {
      const res = await createSickDay(null, fd);
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
          <label className={labelCls}>Kategorie</label>
          <select name="category" defaultValue="own" className={inputCls}>
            <option value="own">Eigene Krankheit</option>
            <option value="child">Kind krank</option>
          </select>
        </div>
        <div>
          <label className={labelCls}>AU gültig bis (optional)</label>
          <input name="certificate_expires_on" type="date" className={inputCls} />
        </div>
        <div>
          <label className={labelCls}>Notiz (optional)</label>
          <input name="note" className={inputCls} />
        </div>
      </div>
      {calDays !== null && (
        <div className="text-xs text-neutral-500">
          {calDays} Kalendertag(e){certNeeded && <span className="text-amber-700 font-medium"> — AU-Bescheinigung erforderlich (&gt; 3 Tage). Nach dem Anlegen hochladen.</span>}
        </div>
      )}
      {error && <div className="text-rose-600 text-sm">{error}</div>}
      <div className="flex gap-2 justify-end">
        <button type="button" onClick={onCancel} className="text-sm text-neutral-600">Abbrechen</button>
        <button type="submit" disabled={pending} className="bg-neutral-900 text-white rounded-lg px-4 py-2 text-sm font-medium flex items-center gap-2">
          <Save size={14} /> {pending ? "..." : "Krankmeldung anlegen"}
        </button>
      </div>
    </form>
  );
}

function SickTable({ members, sickDays, year, onChange }: { members: Map<string, StaffMember>; sickDays: SickDay[]; year: number; onChange: () => void }) {
  return (
    <div className="bg-white rounded-2xl border border-neutral-200/80 shadow-sm overflow-x-auto">
      <div className="px-4 py-3 text-sm font-semibold text-neutral-800 border-b border-neutral-100 bg-gradient-to-b from-neutral-50 to-white">Krankmeldungen {year}</div>
      <table className="w-full text-sm">
        <thead className="bg-neutral-50/80 border-b border-neutral-200">
          <tr>
            <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Mitarbeiter</th>
            <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Zeitraum</th>
            <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Tage</th>
            <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Kategorie</th>
            <th className="text-left px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Bescheinigung</th>
            <th className="text-right px-4 py-2.5 text-[11px] font-semibold uppercase tracking-wide text-neutral-500">Aktion</th>
          </tr>
        </thead>
        <tbody>
          {sickDays.length === 0 && (
            <tr><td colSpan={6} className="px-4 py-8 text-center text-neutral-500">Keine Krankmeldungen in {year}.</td></tr>
          )}
          {sickDays.map((s) => (
            <tr key={s.id} className="border-t border-neutral-100 hover:bg-neutral-50/50 transition-colors">
              <td className="px-4 py-3 font-medium">{members.get(s.staff_id)?.name ?? "—"}</td>
              <td className="px-4 py-3 whitespace-nowrap">{s.start_date} – {s.end_date}</td>
              <td className="px-4 py-3 text-right tabular-nums">{s.days}</td>
              <td className="px-4 py-3">{s.category === "child" ? "Kind krank" : "Eigene"}</td>
              <td className="px-4 py-3"><CertCell sick={s} onChange={onChange} /></td>
              <td className="px-4 py-3 text-right">
                <DeleteSick id={s.id} onChange={onChange} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CertCell({ sick, onChange }: { sick: SickDay; onChange: () => void }) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function openCert() {
    start(async () => {
      if (!sick.certificate_path) return;
      const url = await getCertificateSignedUrl(sick.certificate_path);
      if (url) window.open(url, "_blank");
    });
  }

  function upload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    const fd = new FormData();
    fd.set("file", file);
    start(async () => {
      const res = await uploadSickCertificate(sick.id, fd);
      if (res?.error) { setError(res.error); return; }
      onChange();
    });
  }

  if (sick.certificate_uploaded) {
    return (
      <span className="inline-flex items-center gap-2">
        <button onClick={openCert} disabled={pending} className="inline-flex items-center gap-1 text-emerald-700 hover:text-emerald-800 text-sm">
          <FileText size={15} /> <Eye size={14} /> ansehen
        </button>
        {sick.certificate_expires_on && <span className="text-[10px] text-neutral-400">gültig bis {sick.certificate_expires_on}</span>}
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      {sick.certificate_required && (
        <span className="text-xs px-2 py-0.5 rounded-full bg-rose-100 text-rose-700 font-medium">AU fehlt</span>
      )}
      <label className="inline-flex items-center gap-1 text-sm text-neutral-700 hover:text-neutral-900 cursor-pointer">
        <Upload size={15} /> {pending ? "..." : "hochladen"}
        <input type="file" accept="application/pdf,image/*" onChange={upload} disabled={pending} className="hidden" />
      </label>
      {error && <span className="text-rose-600 text-[10px]">{error}</span>}
    </span>
  );
}

function DeleteSick({ id, onChange }: { id: string; onChange: () => void }) {
  const [pending, start] = useTransition();
  return (
    <button
      disabled={pending}
      onClick={() => { if (confirm("Krankmeldung löschen?")) start(async () => { await deleteSickDay(id); onChange(); }); }}
      className="text-neutral-400 hover:text-rose-600"
      title="Löschen"
    >
      <Trash2 size={15} />
    </button>
  );
}
