"use client";

import Link from "next/link";
import { useMemo } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  LineChart,
  Line,
  Legend,
} from "recharts";

type Range = "today" | "7d" | "30d" | "month" | "all";

interface Row {
  id: string;
  employeeId: string;
  employeeName: string;
  takenAt: string;
  status: string;
  usedGrams: number;
  restGrams: number;
  packGrams: number;
  category: string;
  lengthCm: number | null;
  color: string | null;
  productTitle: string;
  variantTitle: string | null;
}

const CAT_LABELS: Record<string, string> = {
  tape: "Tape",
  mini_tape: "Mini-Tape",
  bonding: "Bonding",
  tresse: "Tresse",
  clip: "Clip-In",
  other: "Sonstiges",
};

const RANGE_LABELS: Record<Range, string> = {
  today: "Heute",
  "7d": "Letzte 7 Tage",
  "30d": "Letzte 30 Tage",
  month: "Dieser Monat",
  all: "Alles",
};

export default function StatistikClient({
  range,
  rows,
  employees,
}: {
  range: Range;
  rows: Row[];
  employees: { id: string; name: string }[];
}) {
  const stats = useMemo(() => computeStats(rows, employees), [rows, employees]);

  return (
    <div className="p-4 md:p-6 space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-semibold">Salon-Statistik</h1>
          <p className="text-sm text-neutral-500">{RANGE_LABELS[range]} · {rows.length} Entnahmen</p>
        </div>
        <div className="flex gap-1 bg-neutral-100 rounded-lg p-1">
          {(Object.keys(RANGE_LABELS) as Range[]).map((r) => (
            <Link
              key={r}
              href={`/salon-admin/statistik?range=${r}`}
              prefetch={false}
              className={`px-3 py-1.5 text-sm rounded-md ${
                r === range ? "bg-white shadow-sm font-medium" : "text-neutral-600 hover:text-neutral-900"
              }`}
            >
              {RANGE_LABELS[r]}
            </Link>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Kpi label="Verbraucht" value={`${stats.totalUsed} g`} />
        <Kpi label="Packs entnommen" value={`${stats.totalPacks}`} />
        <Kpi label="Vollst. zurueck" value={`${stats.totalReturnedFull}`} />
        <Kpi label="Angebrochen zurueck" value={`${stats.totalReturnedPartial}`} />
        <Kpi
          label="Offen"
          value={`${stats.totalOpen}`}
          accent={stats.totalOpen > 0 ? "warn" : undefined}
        />
      </div>

      {/* Pro Mitarbeiter */}
      <Card title="Pro Mitarbeiter" subtitle="Entnommen vs. zurueckgebracht im Zeitraum">
        {stats.perEmployee.length === 0 ? (
          <Empty />
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-neutral-500 border-b border-neutral-200">
              <tr>
                <th className="text-left py-2">Mitarbeiter</th>
                <th className="text-right py-2">Entnommen</th>
                <th className="text-right py-2">Vollst.</th>
                <th className="text-right py-2">Angebrochen</th>
                <th className="text-right py-2">Offen</th>
                <th className="text-right py-2">Verbraucht</th>
                <th className="text-right py-2">Ø pro Pack</th>
              </tr>
            </thead>
            <tbody>
              {stats.perEmployee.map((e) => (
                <tr key={e.id} className="border-t border-neutral-100">
                  <td className="py-2 font-medium">{e.name}</td>
                  <td className="py-2 text-right">{e.packs}</td>
                  <td className="py-2 text-right text-emerald-700">{e.returnedFull}</td>
                  <td className="py-2 text-right text-amber-700">{e.returnedPartial}</td>
                  <td className="py-2 text-right text-rose-600">{e.open}</td>
                  <td className="py-2 text-right font-medium tabular-nums">{e.usedGrams} g</td>
                  <td className="py-2 text-right text-neutral-500 tabular-nums">{e.avgPerPack} g</td>
                </tr>
              ))}
              <tr className="border-t-2 border-neutral-300 font-medium bg-neutral-50">
                <td className="py-2">Gesamt</td>
                <td className="py-2 text-right">{stats.totalPacks}</td>
                <td className="py-2 text-right text-emerald-700">{stats.totalReturnedFull}</td>
                <td className="py-2 text-right text-amber-700">{stats.totalReturnedPartial}</td>
                <td className="py-2 text-right text-rose-600">{stats.totalOpen}</td>
                <td className="py-2 text-right tabular-nums">{stats.totalUsed} g</td>
                <td className="py-2"></td>
              </tr>
            </tbody>
          </table>
        )}
      </Card>

      {/* Verbrauch nach Kategorie + Länge */}
      <Card title="Verbrauch nach Kategorie + Länge" subtitle="z.B. Tape 45cm, Bonding 65cm">
        {stats.perCategoryLength.length === 0 ? (
          <Empty />
        ) : (
          <div style={{ height: 300 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={stats.perCategoryLength} margin={{ top: 5, right: 10, left: 0, bottom: 50 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" vertical={false} />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: "#525252" }}
                  angle={-35}
                  textAnchor="end"
                  height={60}
                  interval={0}
                />
                <YAxis tick={{ fontSize: 10, fill: "#737373" }} unit=" g" />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e5e5" }}
                  formatter={(v) => [`${v} g`, "Verbrauch"]}
                />
                <Bar dataKey="usedGrams" fill="#0f172a" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      {/* Verbrauch nach Farbe */}
      <Card title="Verbrauch nach Farbe" subtitle="Top 15 Farben im Zeitraum">
        {stats.perColor.length === 0 ? (
          <Empty />
        ) : (
          <div style={{ height: 320 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={stats.perColor}
                layout="vertical"
                margin={{ top: 5, right: 20, left: 90, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 10, fill: "#737373" }} unit=" g" />
                <YAxis dataKey="color" type="category" tick={{ fontSize: 11, fill: "#525252" }} width={100} />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e5e5" }}
                  formatter={(v) => [`${v} g`, "Verbrauch"]}
                />
                <Bar dataKey="usedGrams" fill="#7c3aed" radius={[0, 3, 3, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      {/* Verbrauch ueber Zeit */}
      <Card title="Verbrauch ueber Zeit" subtitle="Tageswerte">
        {stats.perDay.length === 0 ? (
          <Empty />
        ) : (
          <div style={{ height: 240 }}>
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={stats.perDay} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e5e5" />
                <XAxis
                  dataKey="day"
                  tick={{ fontSize: 10, fill: "#737373" }}
                  tickFormatter={(v: string) => v.slice(5)}
                />
                <YAxis tick={{ fontSize: 10, fill: "#737373" }} unit=" g" />
                <Tooltip
                  contentStyle={{ fontSize: 12, borderRadius: 8, border: "1px solid #e5e5e5" }}
                  labelFormatter={(l) => new Date(String(l)).toLocaleDateString("de-DE")}
                  formatter={(v) => [`${v} g`, "Verbraucht"]}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Line type="monotone" dataKey="usedGrams" name="Verbrauch" stroke="#0f172a" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="packs" name="Packs" stroke="#dc2626" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>

      {/* Pro Kategorie (Top-Level Aggregation) */}
      <Card title="Pro Kategorie" subtitle="Aggregiert ohne Längen">
        {stats.perCategory.length === 0 ? (
          <Empty />
        ) : (
          <table className="w-full text-sm">
            <thead className="text-xs uppercase text-neutral-500 border-b border-neutral-200">
              <tr>
                <th className="text-left py-2">Kategorie</th>
                <th className="text-right py-2">Packs</th>
                <th className="text-right py-2">Verbraucht</th>
              </tr>
            </thead>
            <tbody>
              {stats.perCategory.map((c) => (
                <tr key={c.category} className="border-t border-neutral-100">
                  <td className="py-2 font-medium">{CAT_LABELS[c.category] ?? c.category}</td>
                  <td className="py-2 text-right">{c.packs}</td>
                  <td className="py-2 text-right tabular-nums">{c.usedGrams} g</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    </div>
  );
}

// ─── Aggregation ────────────────────────────────────────────────

interface EmployeeStat {
  id: string;
  name: string;
  packs: number;
  open: number;
  returnedFull: number;
  returnedPartial: number;
  usedGrams: number;
  avgPerPack: number;
}

function computeStats(rows: Row[], employees: { id: string; name: string }[]) {
  const employeeMap = new Map<string, EmployeeStat>();
  for (const e of employees) {
    employeeMap.set(e.id, {
      id: e.id,
      name: e.name,
      packs: 0,
      open: 0,
      returnedFull: 0,
      returnedPartial: 0,
      usedGrams: 0,
      avgPerPack: 0,
    });
  }

  let totalUsed = 0;
  let totalPacks = 0;
  let totalReturnedFull = 0;
  let totalReturnedPartial = 0;
  let totalOpen = 0;

  const catLengthMap = new Map<string, { label: string; usedGrams: number; packs: number }>();
  const colorMap = new Map<string, number>();
  const categoryMap = new Map<string, { packs: number; usedGrams: number }>();
  const dayMap = new Map<string, { usedGrams: number; packs: number }>();

  for (const r of rows) {
    totalPacks += 1;
    let used = r.usedGrams;
    if (r.status === "open") {
      totalOpen += 1;
      // bei offenen Entnahmen rechnen wir den Pack komplett als "noch verbraucht"
      // (worst-case fuer Plausibilitaet — wird bei Rueckgabe korrigiert)
      used = r.packGrams;
    } else if (r.status === "returned_full") {
      totalReturnedFull += 1;
      used = 0;
    } else if (r.status === "returned_partial") {
      totalReturnedPartial += 1;
    }
    totalUsed += used;

    // Mitarbeiter
    let emp = employeeMap.get(r.employeeId);
    if (!emp) {
      emp = {
        id: r.employeeId,
        name: r.employeeName,
        packs: 0,
        open: 0,
        returnedFull: 0,
        returnedPartial: 0,
        usedGrams: 0,
        avgPerPack: 0,
      };
      employeeMap.set(r.employeeId, emp);
    }
    emp.packs += 1;
    emp.usedGrams += used;
    if (r.status === "open") emp.open += 1;
    else if (r.status === "returned_full") emp.returnedFull += 1;
    else if (r.status === "returned_partial") emp.returnedPartial += 1;

    // Kategorie + Laenge
    const lenLabel = r.lengthCm ? `${r.lengthCm}cm` : "—";
    const catLabel = CAT_LABELS[r.category] ?? r.category;
    const key = `${catLabel} ${lenLabel}`;
    const cur = catLengthMap.get(key) ?? { label: key, usedGrams: 0, packs: 0 };
    cur.usedGrams += used;
    cur.packs += 1;
    catLengthMap.set(key, cur);

    // Farbe
    const color = (r.color ?? "—").trim() || "—";
    colorMap.set(color, (colorMap.get(color) ?? 0) + used);

    // Kategorie ohne Laenge
    const catCur = categoryMap.get(r.category) ?? { packs: 0, usedGrams: 0 };
    catCur.packs += 1;
    catCur.usedGrams += used;
    categoryMap.set(r.category, catCur);

    // Pro Tag
    const day = r.takenAt.slice(0, 10);
    const d = dayMap.get(day) ?? { usedGrams: 0, packs: 0 };
    d.usedGrams += used;
    d.packs += 1;
    dayMap.set(day, d);
  }

  // Mitarbeiter sortiert nach Verbrauch
  const perEmployee = [...employeeMap.values()]
    .filter((e) => e.packs > 0)
    .map((e) => ({
      ...e,
      usedGrams: Math.round(e.usedGrams),
      avgPerPack: e.packs > 0 ? Math.round(e.usedGrams / e.packs) : 0,
    }))
    .sort((a, b) => b.usedGrams - a.usedGrams);

  const perCategoryLength = [...catLengthMap.values()]
    .map((c) => ({ ...c, usedGrams: Math.round(c.usedGrams) }))
    .sort((a, b) => b.usedGrams - a.usedGrams);

  const perColor = [...colorMap.entries()]
    .map(([color, usedGrams]) => ({ color, usedGrams: Math.round(usedGrams) }))
    .filter((c) => c.usedGrams > 0)
    .sort((a, b) => b.usedGrams - a.usedGrams)
    .slice(0, 15);

  const perCategory = [...categoryMap.entries()]
    .map(([category, v]) => ({ category, ...v, usedGrams: Math.round(v.usedGrams) }))
    .sort((a, b) => b.usedGrams - a.usedGrams);

  // Tage komplett ergaenzen (lueckenfrei)
  const perDay: { day: string; usedGrams: number; packs: number }[] = [];
  if (dayMap.size > 0) {
    const sortedDays = [...dayMap.keys()].sort();
    const firstD = new Date(sortedDays[0] + "T00:00:00");
    const lastD = new Date(sortedDays[sortedDays.length - 1] + "T00:00:00");
    for (let d = new Date(firstD); d.getTime() <= lastD.getTime(); d.setDate(d.getDate() + 1)) {
      const k = d.toISOString().slice(0, 10);
      const v = dayMap.get(k);
      perDay.push({ day: k, usedGrams: v ? Math.round(v.usedGrams) : 0, packs: v ? v.packs : 0 });
    }
  }

  return {
    totalUsed: Math.round(totalUsed),
    totalPacks,
    totalReturnedFull,
    totalReturnedPartial,
    totalOpen,
    perEmployee,
    perCategoryLength,
    perColor,
    perCategory,
    perDay,
  };
}

// ─── UI ─────────────────────────────────────────────────────────

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm">
      <div className="mb-3">
        <div className="text-base font-semibold">{title}</div>
        {subtitle && <div className="text-xs text-neutral-500">{subtitle}</div>}
      </div>
      {children}
    </div>
  );
}

function Empty() {
  return <div className="text-sm text-neutral-500 py-2">Keine Daten im Zeitraum</div>;
}

function Kpi({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: "warn";
}) {
  return (
    <div
      className={`rounded-2xl border p-4 shadow-sm ${
        accent === "warn" ? "bg-amber-50 border-amber-200" : "bg-white border-neutral-200"
      }`}
    >
      <div className="text-xs uppercase tracking-wide text-neutral-500">{label}</div>
      <div className="text-2xl font-bold mt-1">{value}</div>
    </div>
  );
}
