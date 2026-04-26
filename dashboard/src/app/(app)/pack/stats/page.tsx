import { requireProfile, hasFeature } from "@/lib/auth";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BarChart3, Users, Camera, AlertTriangle, RotateCcw, Clock, Package2 } from "lucide-react";
import StatsChart from "./stats-chart";

export const dynamic = "force-dynamic";

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return startOfDay(d);
}

export default async function StatsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string }>;
}) {
  const profile = await requireProfile();
  if (!hasFeature(profile, "shipping")) redirect("/");
  const sp = await searchParams;
  const days = Math.max(1, Math.min(365, parseInt(sp.days ?? "30", 10) || 30));

  const supabase = await createClient();
  const fromIso = daysAgo(days).toISOString();

  // Sessions im Zeitraum (verified + shipped als "fertig gepackt")
  const { data: sessions } = await supabase
    .from("pack_sessions")
    .select("id, status, started_at, finished_at, packed_by, profiles:packed_by(display_name, username)")
    .in("status", ["verified", "shipped"])
    .gte("finished_at", fromIso);

  // Scans im Zeitraum (alle Status)
  const { data: scans } = await supabase
    .from("pack_scans")
    .select("status, scan_method, matched_title, scanned_at")
    .gte("scanned_at", fromIso);

  const totalSessions = sessions?.length ?? 0;
  const totalScans = scans?.length ?? 0;
  const matchScans = (scans ?? []).filter((s) => s.status === "match").length;
  const mismatchScans = (scans ?? []).filter((s) => s.status === "mismatch").length;
  const overflowScans = (scans ?? []).filter((s) => s.status === "overflow").length;
  const resetScans = (scans ?? []).filter((s) => s.status === "reset").length;
  const manualConfirms = (scans ?? []).filter((s) => s.scan_method === "manual" && s.status === "match").length;

  // Pack-Zeit pro Session (in Sekunden)
  const packTimes: number[] = [];
  for (const s of sessions ?? []) {
    if (s.started_at && s.finished_at) {
      const ms = new Date(s.finished_at).getTime() - new Date(s.started_at).getTime();
      if (ms > 0 && ms < 1000 * 60 * 60 * 6) packTimes.push(Math.round(ms / 1000));
    }
  }
  packTimes.sort((a, b) => a - b);
  const avgPackSec = packTimes.length > 0 ? Math.round(packTimes.reduce((a, b) => a + b, 0) / packTimes.length) : 0;
  const medPackSec = packTimes.length > 0 ? packTimes[Math.floor(packTimes.length / 2)] : 0;

  // Pro Mitarbeiter: Anzahl + Avg Pack-Zeit
  const byOperator = new Map<string, { count: number; totalSec: number; samples: number }>();
  for (const s of sessions ?? []) {
    const profileRel = (s as { profiles?: { display_name?: string | null; username?: string | null } | null }).profiles;
    const name = profileRel?.display_name || profileRel?.username || "—";
    const cur = byOperator.get(name) ?? { count: 0, totalSec: 0, samples: 0 };
    cur.count++;
    if (s.started_at && s.finished_at) {
      const ms = new Date(s.finished_at).getTime() - new Date(s.started_at).getTime();
      if (ms > 0 && ms < 1000 * 60 * 60 * 6) {
        cur.totalSec += Math.round(ms / 1000);
        cur.samples++;
      }
    }
    byOperator.set(name, cur);
  }
  const operatorRows = Array.from(byOperator.entries())
    .map(([name, v]) => ({
      name,
      count: v.count,
      avgSec: v.samples > 0 ? Math.round(v.totalSec / v.samples) : null,
    }))
    .sort((a, b) => b.count - a.count);

  // Häufigste Mismatches (was wird oft falsch gegriffen)
  const mismatchByTitle = new Map<string, number>();
  for (const s of scans ?? []) {
    if (s.status === "mismatch") {
      const title = s.matched_title ?? "(unbekannter Barcode)";
      mismatchByTitle.set(title, (mismatchByTitle.get(title) ?? 0) + 1);
    }
  }
  const topMismatches = Array.from(mismatchByTitle.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  // Bestellungen pro Tag (für Chart)
  const dayBuckets = new Map<string, number>();
  for (let i = 0; i < days; i++) {
    const d = daysAgo(days - 1 - i);
    dayBuckets.set(d.toISOString().slice(0, 10), 0);
  }
  for (const s of sessions ?? []) {
    if (!s.finished_at) continue;
    const k = s.finished_at.slice(0, 10);
    if (dayBuckets.has(k)) dayBuckets.set(k, (dayBuckets.get(k) ?? 0) + 1);
  }
  const chartData = Array.from(dayBuckets.entries()).map(([date, count]) => ({ date, count }));

  function fmtSec(sec: number): string {
    if (sec === 0) return "—";
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}m ${s}s`;
  }

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-7xl">
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900 flex items-center gap-2">
            <BarChart3 size={24} /> Versand-Statistik
          </h1>
          <p className="text-sm text-neutral-500 mt-1">Pack-Performance der letzten {days} Tage</p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {[7, 30, 90, 365].map((d) => (
            <a
              key={d}
              href={`/pack/stats?days=${d}`}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${
                d === days
                  ? "bg-neutral-900 text-white border-neutral-900"
                  : "bg-white border-neutral-300 hover:bg-neutral-50"
              }`}
            >
              {d === 365 ? "1 Jahr" : `${d} Tage`}
            </a>
          ))}
        </div>
      </header>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <KPI label="Bestellungen verpackt" value={totalSessions.toString()} icon={<Package2 size={18} />} />
        <KPI label="Ø Pack-Zeit" value={fmtSec(avgPackSec)} sub={`Median ${fmtSec(medPackSec)}`} icon={<Clock size={18} />} />
        <KPI
          label="Fehlscan-Rate"
          value={totalScans > 0 ? `${((mismatchScans / totalScans) * 100).toFixed(1)}%` : "—"}
          sub={`${mismatchScans} von ${totalScans} Scans`}
          icon={<AlertTriangle size={18} className="text-red-500" />}
        />
        <KPI
          label="Manuell bestätigt"
          value={matchScans > 0 ? `${((manualConfirms / matchScans) * 100).toFixed(0)}%` : "—"}
          sub={`${manualConfirms} von ${matchScans} Matches`}
          icon={<Camera size={18} className="text-amber-500" />}
        />
      </div>

      {/* Chart */}
      <div className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm">
        <div className="text-xs font-medium text-neutral-600 uppercase tracking-wide mb-3">
          Bestellungen pro Tag
        </div>
        <StatsChart data={chartData} />
      </div>

      {/* Pro Mitarbeiter */}
      <div className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm">
        <div className="text-xs font-medium text-neutral-600 uppercase tracking-wide mb-3 flex items-center gap-1">
          <Users size={14} /> Pack-Performance pro Mitarbeiter
        </div>
        {operatorRows.length === 0 ? (
          <div className="text-sm text-neutral-400 italic">Keine Daten im Zeitraum.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-neutral-500 border-b border-neutral-200">
                <th className="text-left py-2 font-medium">Bearbeiter</th>
                <th className="text-right py-2 font-medium">Bestellungen</th>
                <th className="text-right py-2 font-medium">Ø Pack-Zeit</th>
              </tr>
            </thead>
            <tbody>
              {operatorRows.map((r, idx) => (
                <tr key={r.name} className={`border-b border-neutral-100 ${idx % 2 === 1 ? "bg-neutral-50/40" : ""}`}>
                  <td className="py-2 font-medium text-neutral-900">{r.name}</td>
                  <td className="py-2 text-right text-neutral-700">{r.count}</td>
                  <td className="py-2 text-right text-neutral-700">{r.avgSec ? fmtSec(r.avgSec) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Häufigste Fehlscans */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm">
          <div className="text-xs font-medium text-neutral-600 uppercase tracking-wide mb-3 flex items-center gap-1">
            <AlertTriangle size={14} className="text-red-500" /> Häufigste Fehlscans (Top 10)
          </div>
          {topMismatches.length === 0 ? (
            <div className="text-sm text-neutral-400 italic">Keine Fehlscans im Zeitraum 🎉</div>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {topMismatches.map(([title, count]) => (
                <li key={title} className="flex items-center justify-between gap-2 py-1.5 border-b border-neutral-100 last:border-0">
                  <span className="text-neutral-700 truncate flex-1">{title}</span>
                  <span className="text-red-700 font-bold shrink-0">{count}×</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm">
          <div className="text-xs font-medium text-neutral-600 uppercase tracking-wide mb-3">
            Zusammenfassung Scans
          </div>
          <div className="space-y-2 text-sm">
            <Row label="Total Scans" value={totalScans} />
            <Row label="✓ Korrekt (Match)" value={matchScans} cls="text-emerald-700" />
            <Row label="⚠ Falscher Artikel (Mismatch)" value={mismatchScans} cls="text-red-700" />
            <Row label="Überzählig (Overflow)" value={overflowScans} cls="text-amber-700" />
            <Row label="Zurückgesetzt (Reset)" value={resetScans} cls="text-neutral-500" />
            <div className="border-t border-neutral-200 pt-2 mt-2">
              <Row
                label="Manuell bestätigt"
                value={manualConfirms}
                cls="text-amber-700"
                icon={<RotateCcw size={12} />}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function KPI({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
      <div className="flex items-start justify-between mb-1">
        <div className="text-xs font-medium text-neutral-600 uppercase tracking-wide">{label}</div>
        {icon && <div className="text-neutral-400">{icon}</div>}
      </div>
      <div className="text-2xl font-bold text-neutral-900 mt-1">{value}</div>
      {sub && <div className="text-xs text-neutral-500 mt-1">{sub}</div>}
    </div>
  );
}

function Row({
  label,
  value,
  cls,
  icon,
}: {
  label: string;
  value: number;
  cls?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className={`flex items-center gap-1 ${cls ?? "text-neutral-700"}`}>
        {icon}
        {label}
      </span>
      <span className={`font-semibold ${cls ?? "text-neutral-900"}`}>{value}</span>
    </div>
  );
}
