import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { BarChart3, TrendingUp, TrendingDown, MessageSquare, Users, Bot } from "lucide-react";
import { VolumeChart, CategoryChart, type SeriesPoint, type CampaignBand, type CategoryMeta } from "./stats-charts";
import CampaignManager, { type CampaignRow } from "./campaign-manager";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ g?: string; range?: string }>;
}

const CAT: Record<string, { label: string; emoji: string; color: string }> = {
  availability: { label: "Verfügbarkeit", emoji: "📦", color: "#6366f1" },
  pricing:      { label: "Preis",         emoji: "💰", color: "#f59e0b" },
  color_advice: { label: "Farbberatung",  emoji: "🎨", color: "#ec4899" },
  appointment:  { label: "Termin",        emoji: "📅", color: "#10b981" },
  complaint:    { label: "Reklamation",   emoji: "⚠️", color: "#ef4444" },
  order_status: { label: "Bestellstatus", emoji: "🚚", color: "#14b8a6" },
  gewerbe:      { label: "Gewerbe",       emoji: "💼", color: "#8b5cf6" },
  partnership:  { label: "Partnership",   emoji: "🤝", color: "#0ea5e9" },
  models:       { label: "Modelle",       emoji: "📸", color: "#f43f5e" },
  general:      { label: "Sonstiges",     emoji: "💬", color: "#94a3b8" },
};
const MONTHS = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];

// ── Datums-Helfer (UTC, DST-frei) ───────────────────────────────────────────
function iso(d: Date): string { return d.toISOString().slice(0, 10); }
function parse(s: string): Date { return new Date(s + "T00:00:00Z"); }
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return x; }
function addMonths(d: Date, n: number): Date { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + n); return x; }
function mondayOf(d: Date): Date { const day = d.getUTCDay(); return addDays(d, day === 0 ? -6 : 1 - day); }
function firstOfMonth(d: Date): Date { return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)); }

function alignStart(d: Date, g: string): Date {
  if (g === "month") return firstOfMonth(d);
  if (g === "week") return mondayOf(d);
  return d;
}
function nextPeriod(d: Date, g: string): Date {
  if (g === "month") return addMonths(d, 1);
  if (g === "week") return addDays(d, 7);
  return addDays(d, 1);
}
function labelOf(key: string, g: string): string {
  const [y, m, dd] = key.split("-");
  if (g === "month") return `${MONTHS[parseInt(m, 10) - 1]} ${y.slice(2)}`;
  return `${dd}.${m}.`;
}
function containsToday(key: string, g: string, today: Date): boolean {
  const start = parse(key);
  const end = g === "day" ? start : addDays(nextPeriod(start, g), -1);
  return today >= start && today <= end;
}

export default async function ChatbotStatsPage({ searchParams }: PageProps) {
  await requireProfile();
  const sp = await searchParams;
  const G = sp.g === "day" || sp.g === "month" ? sp.g : "week";
  const RANGE = ({ "30": 30, "90": 90, "180": 180, "365": 365 } as Record<string, number>)[sp.range ?? "180"] ?? 180;

  const svc = createServiceClient();
  const now = new Date();
  const today = parse(iso(now));
  const sinceStr = iso(addDays(today, -RANGE));

  // Kampagnen laden (für Uplift-Fenster ggf. weiter zurück nötig)
  const { data: campRows } = await svc
    .from("chatbot_campaigns")
    .select("id, name, starts_on, ends_on, color, note")
    .order("starts_on", { ascending: true });
  const campaigns = (campRows ?? []) as { id: string; name: string; starts_on: string; ends_on: string | null; color: string; note: string | null }[];

  // Haupt-Serie (gewählte Granularität) + Tages-Serie (für KPIs & Uplift)
  const earliestCampStart = campaigns.length ? campaigns[0].starts_on : sinceStr;
  const dailySinceStr = iso(new Date(Math.min(
    parse(sinceStr).getTime(),
    addDays(parse(earliestCampStart), -14).getTime(),
    addDays(today, -65).getTime(),
  )));

  const [{ data: mainRows }, { data: dailyRows }] = await Promise.all([
    svc.rpc("chatbot_stats", { p_granularity: G, p_since: sinceStr }),
    svc.rpc("chatbot_stats", { p_granularity: "day", p_since: dailySinceStr }),
  ]);

  type Row = { period: string; inbound: number; bot: number; human: number; new_sessions: number; by_category: Record<string, number> };
  const rowByKey = new Map<string, Row>();
  for (const r of (mainRows ?? []) as Row[]) rowByKey.set(r.period, r);

  // Tages-Map (inbound) für KPIs + Uplift
  const dayInbound = new Map<string, number>();
  for (const r of (dailyRows ?? []) as Row[]) dayInbound.set(r.period, r.inbound);
  const sumDays = (from: Date, to: Date): number => {
    let s = 0;
    for (let d = new Date(from); d <= to; d = addDays(d, 1)) s += dayInbound.get(iso(d)) ?? 0;
    return s;
  };

  // ── Perioden-Sequenz füllen (Lücken = 0) ──────────────────────────────────
  const catTotals = new Map<string, number>();
  const rawSeries: SeriesPoint[] = [];
  for (let d = alignStart(parse(sinceStr), G); d <= today; d = nextPeriod(d, G)) {
    const key = iso(d);
    const r = rowByKey.get(key);
    const partial = containsToday(key, G, today);
    const point: SeriesPoint = {
      key, label: labelOf(key, G),
      inbound: r?.inbound ?? 0, bot: r?.bot ?? 0, human: r?.human ?? 0,
      newSessions: r?.new_sessions ?? 0, partial, anomaly: "normal",
    };
    for (const [cat, n] of Object.entries(r?.by_category ?? {})) {
      point[cat] = n;
      catTotals.set(cat, (catTotals.get(cat) ?? 0) + n);
    }
    rawSeries.push(point);
  }

  // ── Durchschnitt + Anomalie (ab erster aktiver Periode, ohne laufende) ─────
  const firstActive = rawSeries.findIndex((p) => p.inbound > 0);
  const scored = firstActive >= 0 ? rawSeries.slice(firstActive) : [];
  const complete = scored.filter((p) => !p.partial);
  const avg = complete.length ? complete.reduce((s, p) => s + p.inbound, 0) / complete.length : 0;
  // Anomalie relativ zum LOKALEN Trend (Ø der letzten K Perioden), nicht zum
  // Gesamt-Ø — sonst würde bei wachsendem Volumen bloß "alt=niedrig, neu=hoch"
  // markiert statt echter Ausreißer.
  const K = G === "month" ? 3 : G === "day" ? 7 : 4;
  for (let i = 0; i < scored.length; i++) {
    const p = scored[i];
    const prior = scored.slice(0, i).filter((q) => !q.partial).slice(-K);
    const base = prior.length >= 2 ? prior.reduce((s, q) => s + q.inbound, 0) / prior.length : null;
    p.baseline = base;
    // Rausch-Filter: bei sehr kleinen Zahlen (Trend < 15) keine Anomalie werten
    // — sonst würde "1 → 31 Nachrichten" fälschlich als dramatischer Sprung gelten.
    if (base && base >= 15 && !p.partial) {
      if (p.inbound < base * 0.6) p.anomaly = "low";
      else if (p.inbound > base * 1.6) p.anomaly = "high";
    }
  }
  const series = scored.length ? scored : rawSeries;

  // ── Kategorien (nach Gesamtmenge sortiert) ────────────────────────────────
  const categories: CategoryMeta[] = [...catTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => ({ key, label: CAT[key]?.label ?? key, emoji: CAT[key]?.emoji ?? "•", color: CAT[key]?.color ?? "#94a3b8" }));
  const catGrandTotal = [...catTotals.values()].reduce((s, n) => s + n, 0) || 1;

  // ── KPIs (rollierende Fenster) ────────────────────────────────────────────
  const yday = addDays(today, -1);
  const kToday = dayInbound.get(iso(today)) ?? 0;
  const kYday = dayInbound.get(iso(yday)) ?? 0;
  const last7 = sumDays(addDays(today, -6), today);
  const prev7 = sumDays(addDays(today, -13), addDays(today, -7));
  const last30 = sumDays(addDays(today, -29), today);
  const prev30 = sumDays(addDays(today, -59), addDays(today, -30));
  const pct = (a: number, b: number): number | null => (b > 0 ? Math.round(((a - b) / b) * 100) : null);
  const totalRange = series.reduce((s, p) => s + p.inbound, 0);
  const answeredBot = series.reduce((s, p) => s + p.bot, 0);
  const answeredHuman = series.reduce((s, p) => s + p.human, 0);
  const botShare = answeredBot + answeredHuman > 0 ? Math.round((answeredBot / (answeredBot + answeredHuman)) * 100) : 0;

  // ── Kampagnen-Bänder + Uplift ─────────────────────────────────────────────
  const labelForDate = (dateStr: string): string => {
    const aligned = alignStart(parse(dateStr), G);
    const clamped = aligned < parse(series[0]?.key ?? sinceStr) ? parse(series[0].key)
      : aligned > parse(series[series.length - 1]?.key ?? iso(today)) ? parse(series[series.length - 1].key)
      : aligned;
    return labelOf(iso(clamped), G);
  };
  const campaignBands: CampaignBand[] = campaigns
    .filter((c) => (c.ends_on ?? iso(today)) >= (series[0]?.key ?? sinceStr) && c.starts_on <= iso(today))
    .map((c) => ({ id: c.id, name: c.name, color: c.color, x1: labelForDate(c.starts_on), x2: labelForDate(c.ends_on ?? iso(today)) }));

  const campaignRows: CampaignRow[] = campaigns.map((c) => {
    const start = parse(c.starts_on);
    const end = c.ends_on ? parse(c.ends_on) : today;
    const clampedEnd = end > today ? today : end;
    const days = Math.max(1, Math.round((clampedEnd.getTime() - start.getTime()) / 86400000) + 1);
    const totalDuring = sumDays(start, clampedEnd);
    const avgDuring = totalDuring / days;
    const avgBefore = sumDays(addDays(start, -14), addDays(start, -1)) / 14;
    return {
      id: c.id, name: c.name, starts_on: c.starts_on, ends_on: c.ends_on, color: c.color, note: c.note,
      totalDuring, upliftPct: pct(avgDuring, avgBefore),
    };
  }).sort((a, b) => (a.starts_on < b.starts_on ? 1 : -1));

  // ── Auffällige Perioden ───────────────────────────────────────────────────
  const flagged = series.filter((p) => p.anomaly !== "normal" && !p.partial).slice(-8).reverse();

  const rangeOpts = [["30", "30 Tage"], ["90", "90 Tage"], ["180", "6 Monate"], ["365", "1 Jahr"]];
  const granOpts = [["day", "Tag"], ["week", "Woche"], ["month", "Monat"]];
  const mkHref = (g: string, r: string) => `/chatbot/stats?g=${g}&range=${r}`;
  const curRange = sp.range ?? "180";

  return (
    <div className="max-w-6xl mx-auto px-4 py-6 space-y-6">
      <div className="flex items-center gap-2">
        <BarChart3 size={22} className="text-neutral-700" />
        <h1 className="text-xl font-semibold text-neutral-900">Chatbot-Statistik</h1>
      </div>

      {/* Steuerung */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="inline-flex rounded-lg border border-neutral-200 overflow-hidden">
          {granOpts.map(([g, lbl]) => (
            <Link key={g} href={mkHref(g, curRange)} scroll={false}
              className={`px-3 py-1.5 text-sm ${G === g ? "bg-neutral-900 text-white" : "bg-white text-neutral-600 hover:bg-neutral-50"}`}>{lbl}</Link>
          ))}
        </div>
        <div className="inline-flex rounded-lg border border-neutral-200 overflow-hidden">
          {rangeOpts.map(([r, lbl]) => (
            <Link key={r} href={mkHref(G, r)} scroll={false}
              className={`px-3 py-1.5 text-sm ${curRange === r ? "bg-neutral-900 text-white" : "bg-white text-neutral-600 hover:bg-neutral-50"}`}>{lbl}</Link>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi icon={<MessageSquare size={16} />} label="Heute" value={kToday} delta={pct(kToday, kYday)} deltaLabel="vs. gestern" />
        <Kpi icon={<TrendingUp size={16} />} label="Letzte 7 Tage" value={last7} delta={pct(last7, prev7)} deltaLabel="vs. Vorwoche" />
        <Kpi icon={<TrendingUp size={16} />} label="Letzte 30 Tage" value={last30} delta={pct(last30, prev30)} deltaLabel="vs. Vormonat" />
        <Kpi icon={<Bot size={16} />} label="Bot-Anteil (Antworten)" value={`${botShare}%`} sub={`${answeredBot} Bot · ${answeredHuman} Team`} />
      </div>

      {/* Verlauf */}
      <div className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-semibold text-neutral-800">Nachrichten-Verlauf</h2>
          <span className="text-xs text-neutral-500">Ø {Math.round(avg)} / {G === "day" ? "Tag" : G === "week" ? "Woche" : "Monat"} · {totalRange} gesamt</span>
        </div>
        <p className="text-xs text-neutral-500 mb-3">
          Balken = eingehende Kundennachrichten (<span className="text-red-500 font-medium">rot</span> = deutlich unter dem Trend, <span className="text-emerald-600 font-medium">grün</span> = deutlich über dem Trend, grau = laufend).
          Gestrichelt = Trend (Ø der letzten Perioden). Orange = neue Chats. Farbige Bänder = deine Aktionen.
        </p>
        <VolumeChart data={series} campaigns={campaignBands} />
      </div>

      {/* Auffällige Perioden */}
      {flagged.length > 0 && (
        <div className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-neutral-800 mb-3">Auffällige Perioden (vs. lokalem Trend)</h2>
          <div className="flex flex-wrap gap-2">
            {flagged.map((p) => (
              <span key={p.key}
                className={`inline-flex items-center gap-1 text-xs rounded-full px-2.5 py-1 border ${p.anomaly === "low" ? "bg-red-50 text-red-700 border-red-200" : "bg-emerald-50 text-emerald-700 border-emerald-200"}`}>
                {p.anomaly === "low" ? <TrendingDown size={12} /> : <TrendingUp size={12} />}
                {p.label} — {p.inbound} ({p.baseline ? (p.inbound >= p.baseline ? "+" : "") + Math.round(((p.inbound - p.baseline) / p.baseline) * 100) : 0}%)
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Kategorien: Verlauf + Verteilung */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-neutral-800 mb-3">Nach Art (Verlauf)</h2>
          <CategoryChart data={series} categories={categories} />
        </div>
        <div className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-neutral-800 mb-3">Verteilung im Zeitraum</h2>
          <div className="space-y-2">
            {categories.map((c) => {
              const n = catTotals.get(c.key) ?? 0;
              const share = Math.round((n / catGrandTotal) * 100);
              return (
                <div key={c.key}>
                  <div className="flex items-center justify-between text-xs mb-0.5">
                    <span className="text-neutral-700">{c.emoji} {c.label}</span>
                    <span className="text-neutral-500 tabular-nums">{n} · {share}%</span>
                  </div>
                  <div className="h-2 rounded-full bg-neutral-100 overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${share}%`, background: c.color }} />
                  </div>
                </div>
              );
            })}
            {categories.length === 0 && <p className="text-sm text-neutral-500">Keine Daten im Zeitraum.</p>}
          </div>
        </div>
      </div>

      {/* Aktionen / Kampagnen */}
      <CampaignManager campaigns={campaignRows} />
    </div>
  );
}

function Kpi({ icon, label, value, delta, deltaLabel, sub }: {
  icon: React.ReactNode; label: string; value: number | string; delta?: number | null; deltaLabel?: string; sub?: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
      <div className="flex items-center gap-1.5 text-neutral-500 text-xs font-medium uppercase tracking-wide">{icon}{label}</div>
      <div className="mt-1 text-2xl font-semibold text-neutral-900 tabular-nums">{value}</div>
      {delta != null && (
        <div className={`text-xs font-medium ${delta >= 0 ? "text-emerald-600" : "text-red-600"}`}>
          {delta >= 0 ? "▲" : "▼"} {Math.abs(delta)}% <span className="text-neutral-400 font-normal">{deltaLabel}</span>
        </div>
      )}
      {sub && <div className="text-xs text-neutral-400 mt-0.5">{sub}</div>}
    </div>
  );
}
