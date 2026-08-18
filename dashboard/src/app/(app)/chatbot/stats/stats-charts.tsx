"use client";

import {
  ComposedChart, BarChart, Bar, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, ReferenceArea, Cell, Legend,
} from "recharts";

export interface SeriesPoint {
  key: string;          // sortierbarer Perioden-Key (YYYY-MM-DD)
  label: string;        // Achsen-Label (z.B. "17.08." / "Aug 26")
  inbound: number;
  bot: number;
  human: number;
  newSessions: number;
  partial: boolean;     // laufende (unvollständige) Periode → nicht werten
  anomaly: "low" | "high" | "normal";
  baseline?: number | null; // Ø der letzten K Perioden (Trendlinie)
  [cat: string]: string | number | boolean | null | undefined; // Kategorie-Counts
}
export interface CampaignBand {
  id: string;
  name: string;
  color: string;
  x1: string;           // Label der Start-Periode
  x2: string;           // Label der End-Periode
}
export interface CategoryMeta { key: string; label: string; emoji: string; color: string; }

function anomalyColor(a: string, partial: boolean): string {
  if (partial) return "#d4d4d4";
  if (a === "low") return "#ef4444";
  if (a === "high") return "#10b981";
  return "#6366f1";
}

export function VolumeChart({ data, campaigns }: { data: SeriesPoint[]; campaigns: CampaignBand[]; }) {
  return (
    <div style={{ width: "100%", height: 320 }}>
      <ResponsiveContainer>
        <ComposedChart data={data} margin={{ top: 20, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#f3f4f6" />
          {/* Aktions-Bänder ZUERST (hinter den Balken) */}
          {campaigns.map((c) => (
            <ReferenceArea
              key={c.id}
              x1={c.x1}
              x2={c.x2}
              fill={c.color}
              fillOpacity={0.13}
              stroke={c.color}
              strokeOpacity={0.35}
              label={{ value: c.name, position: "insideTop", fontSize: 10, fill: c.color }}
              ifOverflow="extendDomain"
            />
          ))}
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#737373" }} interval="preserveStartEnd" />
          <YAxis yAxisId="msg" tick={{ fontSize: 11, fill: "#737373" }} />
          <YAxis yAxisId="sess" orientation="right" tick={{ fontSize: 11, fill: "#a3a3a3" }} />
          <Tooltip
            contentStyle={{ fontSize: 12, borderRadius: 8 }}
            formatter={(value, name) => [String(value), String(name)]}
            labelFormatter={(l) => `Periode: ${l}`}
          />
          <Bar yAxisId="msg" dataKey="inbound" name="Nachrichten (rein)" radius={[3, 3, 0, 0]}>
            {data.map((d) => (
              <Cell key={d.key} fill={anomalyColor(d.anomaly, d.partial)} />
            ))}
          </Bar>
          <Line yAxisId="msg" type="monotone" dataKey="baseline" name="Trend" stroke="#78716c" strokeDasharray="4 4" strokeWidth={1.5} dot={false} connectNulls={false} />
          <Line yAxisId="sess" type="monotone" dataKey="newSessions" name="Neue Chats" stroke="#f59e0b" strokeWidth={1.5} dot={{ r: 2 }} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export function CategoryChart({ data, categories }: { data: SeriesPoint[]; categories: CategoryMeta[]; }) {
  return (
    <div style={{ width: "100%", height: 320 }}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#f3f4f6" />
          <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#737373" }} interval="preserveStartEnd" />
          <YAxis tick={{ fontSize: 11, fill: "#737373" }} />
          <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} labelFormatter={(l) => `Periode: ${l}`} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
          {categories.map((c) => (
            <Bar key={c.key} dataKey={c.key} name={`${c.emoji} ${c.label}`} stackId="cat" fill={c.color} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
