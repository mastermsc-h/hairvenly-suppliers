import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import {
  Coins, TrendingUp, Database, Zap, AlertTriangle,
  MessageSquare, RotateCcw, Sparkles, Shield,
} from "lucide-react";
import CostTrendChart from "./cost-trend-chart";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ range?: string }>;
}

const PURPOSE_LABELS: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  respond:           { label: "Bot-Antwort",       icon: <MessageSquare size={14} />, color: "text-blue-700" },
  refine:            { label: "Refine / Verbessern", icon: <RotateCcw size={14} />,    color: "text-purple-700" },
  classify_category: { label: "Kategorisierung",   icon: <Sparkles size={14} />,      color: "text-amber-700" },
  guardian_analyze:  { label: "Wächter-Analyse",    icon: <Shield size={14} />,        color: "text-pink-700" },
  needs_answer:      { label: "Needs-Answer-Check", icon: <Zap size={14} />,           color: "text-emerald-700" },
  auto_consolidate:  { label: "Auto-Consolidate",   icon: <Database size={14} />,     color: "text-cyan-700" },
  grammar:           { label: "Grammatik-Korrekt.", icon: <Sparkles size={14} />,     color: "text-violet-700" },
  critic_pass:       { label: "Critic-Pass",        icon: <AlertTriangle size={14} />,color: "text-orange-700" },
  polish:            { label: "Polieren",           icon: <Sparkles size={14} />,     color: "text-indigo-700" },
  suggest:           { label: "Vorschlag",          icon: <Sparkles size={14} />,     color: "text-fuchsia-700" },
  other:             { label: "Sonstiges",          icon: <Coins size={14} />,        color: "text-neutral-600" },
};

function fmtUsd(n: number): string {
  if (n < 0.01) return `${(n * 100).toFixed(2)}¢`;
  if (n < 1) return `${(n * 100).toFixed(1)}¢`;
  return `$${n.toFixed(2)}`;
}

function fmtTokens(n: number): string {
  if (n < 1000) return n.toString();
  if (n < 1_000_000) return `${(n / 1000).toFixed(1)}K`;
  return `${(n / 1_000_000).toFixed(2)}M`;
}

export default async function ChatbotCostsPage({ searchParams }: PageProps) {
  await requireProfile();
  const params = await searchParams;
  const range = params.range || "7d";

  // Range → cutoff timestamp
  const days = range === "30d" ? 30 : range === "1d" ? 1 : range === "all" ? 365 : 7;
  const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const svc = createServiceClient();

  // 1. Aggregierte KPIs für die Range
  const { data: allRows } = await svc
    .from("chatbot_usage_log")
    .select("created_at, purpose, model, input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens, cost_usd, session_id, error")
    .gte("created_at", cutoff)
    .order("created_at", { ascending: false })
    .limit(50_000);
  const rows = allRows || [];

  // Totals
  const totalCalls = rows.length;
  const totalCost = rows.reduce((s, r) => s + (Number(r.cost_usd) || 0), 0);
  const totalInputTokens = rows.reduce((s, r) => s + (r.input_tokens || 0), 0);
  const totalOutputTokens = rows.reduce((s, r) => s + (r.output_tokens || 0), 0);
  const totalCacheRead = rows.reduce((s, r) => s + (r.cache_read_input_tokens || 0), 0);
  const totalCacheCreate = rows.reduce((s, r) => s + (r.cache_creation_input_tokens || 0), 0);
  const cachedTotal = totalCacheRead + totalCacheCreate;
  const cacheHitRate = cachedTotal > 0 ? totalCacheRead / cachedTotal : 0;
  const errors = rows.filter(r => r.error).length;

  // Aufschlüsselung nach Purpose
  const byPurpose = new Map<string, { calls: number; cost: number; input: number; output: number }>();
  for (const r of rows) {
    const p = r.purpose || "other";
    const acc = byPurpose.get(p) || { calls: 0, cost: 0, input: 0, output: 0 };
    acc.calls += 1;
    acc.cost += Number(r.cost_usd) || 0;
    acc.input += r.input_tokens || 0;
    acc.output += r.output_tokens || 0;
    byPurpose.set(p, acc);
  }
  const purposeRows = Array.from(byPurpose.entries())
    .map(([purpose, v]) => ({ purpose, ...v }))
    .sort((a, b) => b.cost - a.cost);

  // Daily trend (für Chart)
  const dayMap = new Map<string, { date: string; cost: number; calls: number; input: number; output: number }>();
  for (const r of rows) {
    const day = (r.created_at || "").slice(0, 10);
    const d = dayMap.get(day) || { date: day, cost: 0, calls: 0, input: 0, output: 0 };
    d.cost += Number(r.cost_usd) || 0;
    d.calls += 1;
    d.input += r.input_tokens || 0;
    d.output += r.output_tokens || 0;
    dayMap.set(day, d);
  }
  const trend = Array.from(dayMap.values()).sort((a, b) => a.date.localeCompare(b.date));

  // Top Sessions nach Kosten
  const bySession = new Map<string, { sessionId: string; calls: number; cost: number }>();
  for (const r of rows) {
    if (!r.session_id) continue;
    const acc = bySession.get(r.session_id) || { sessionId: r.session_id, calls: 0, cost: 0 };
    acc.calls += 1;
    acc.cost += Number(r.cost_usd) || 0;
    bySession.set(r.session_id, acc);
  }
  const topSessions = Array.from(bySession.values()).sort((a, b) => b.cost - a.cost).slice(0, 10);

  // Durchschnitt pro Call
  const avgCostPerCall = totalCalls > 0 ? totalCost / totalCalls : 0;

  // Hochrechnung Monat
  const monthlyProjection = days > 0 ? (totalCost / days) * 30 : 0;

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Coins size={20} className="text-amber-600" />
          <h1 className="text-xl font-semibold text-neutral-900">Chatbot-Kosten</h1>
          <span className="text-sm text-neutral-500 ml-2">Token-Verbrauch & Anthropic-API-Kosten</span>
        </div>
        <div className="flex gap-1.5">
          {[
            { v: "1d",  label: "24h" },
            { v: "7d",  label: "7 Tage" },
            { v: "30d", label: "30 Tage" },
            { v: "all", label: "Alle" },
          ].map(opt => (
            <Link
              key={opt.v}
              href={`/chatbot/costs?range=${opt.v}`}
              className={`text-xs px-3 py-1.5 rounded-full border ${
                range === opt.v
                  ? "bg-neutral-900 text-white border-neutral-900"
                  : "bg-white text-neutral-600 border-neutral-300 hover:bg-neutral-50"
              }`}
            >
              {opt.label}
            </Link>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI label="Gesamt-Kosten" value={fmtUsd(totalCost)} sub={`${fmtTokens(totalCalls)} Calls`} color="text-amber-700" icon={<Coins size={16} />} />
        <KPI label="Hochrechnung Monat" value={fmtUsd(monthlyProjection)} sub="basierend auf gewählter Range" color="text-pink-700" icon={<TrendingUp size={16} />} />
        <KPI label="Ø pro Call" value={fmtUsd(avgCostPerCall)} sub={`Output ${fmtTokens(totalOutputTokens)} Tk`} color="text-blue-700" icon={<MessageSquare size={16} />} />
        <KPI label="Cache-Hit-Rate" value={`${(cacheHitRate * 100).toFixed(0)}%`} sub={`${fmtTokens(totalCacheRead)} cached / ${fmtTokens(cachedTotal)} total`} color="text-emerald-700" icon={<Database size={16} />} />
      </div>

      {/* Trend Chart */}
      {trend.length > 1 && (
        <div className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm">
          <h2 className="text-sm font-semibold text-neutral-900 mb-3">Tägliche Kosten</h2>
          <CostTrendChart data={trend} />
        </div>
      )}

      {/* Aufschlüsselung pro Purpose */}
      <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
        <h2 className="text-sm font-semibold text-neutral-900 px-4 md:px-6 pt-4">Kosten pro Zweck</h2>
        <table className="w-full mt-3 text-sm">
          <thead className="bg-neutral-50 border-y border-neutral-200">
            <tr className="text-xs text-neutral-500 uppercase tracking-wide">
              <th className="text-left px-4 md:px-6 py-2 font-medium">Zweck</th>
              <th className="text-right px-2 py-2 font-medium">Calls</th>
              <th className="text-right px-2 py-2 font-medium">Input Tk</th>
              <th className="text-right px-2 py-2 font-medium">Output Tk</th>
              <th className="text-right px-2 py-2 font-medium">Ø/Call</th>
              <th className="text-right px-4 md:px-6 py-2 font-medium">Kosten</th>
            </tr>
          </thead>
          <tbody>
            {purposeRows.map(p => {
              const meta = PURPOSE_LABELS[p.purpose] || PURPOSE_LABELS.other;
              const avg = p.calls > 0 ? p.cost / p.calls : 0;
              return (
                <tr key={p.purpose} className="border-b border-neutral-100 last:border-0 hover:bg-neutral-50/50">
                  <td className="px-4 md:px-6 py-2">
                    <span className={`inline-flex items-center gap-1.5 ${meta.color}`}>
                      {meta.icon}
                      <span className="font-medium">{meta.label}</span>
                    </span>
                  </td>
                  <td className="px-2 py-2 text-right text-neutral-600 tabular-nums">{p.calls}</td>
                  <td className="px-2 py-2 text-right text-neutral-500 tabular-nums">{fmtTokens(p.input)}</td>
                  <td className="px-2 py-2 text-right text-neutral-500 tabular-nums">{fmtTokens(p.output)}</td>
                  <td className="px-2 py-2 text-right text-neutral-500 tabular-nums">{fmtUsd(avg)}</td>
                  <td className="px-4 md:px-6 py-2 text-right font-medium tabular-nums">{fmtUsd(p.cost)}</td>
                </tr>
              );
            })}
            {purposeRows.length === 0 && (
              <tr><td colSpan={6} className="px-4 py-6 text-center text-neutral-400">Keine Daten in diesem Zeitraum</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Top Sessions */}
      {topSessions.length > 0 && (
        <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
          <h2 className="text-sm font-semibold text-neutral-900 px-4 md:px-6 pt-4">Top 10 Sessions nach Kosten</h2>
          <ul className="mt-3 divide-y divide-neutral-100">
            {topSessions.map((s, i) => (
              <li key={s.sessionId} className="px-4 md:px-6 py-2.5 flex items-center justify-between text-sm hover:bg-neutral-50/50">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="text-xs text-neutral-400 tabular-nums w-5">{i + 1}.</span>
                  <Link href={`/chatbot/inbox/${s.sessionId}`} className="text-blue-600 hover:underline font-mono text-[11px] truncate">
                    {s.sessionId.slice(0, 13)}…
                  </Link>
                  <span className="text-neutral-500 text-xs">{s.calls} Calls</span>
                </div>
                <span className="font-medium tabular-nums">{fmtUsd(s.cost)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Fußzeile mit Cache-Spar-Hint */}
      <div className="text-xs text-neutral-500 space-y-1 px-2">
        <div>
          🛡 <strong>Cache-Hit-Rate</strong>: {(cacheHitRate * 100).toFixed(0)}% (cached input ist 10× billiger als uncached).
          {cacheHitRate < 0.7 && cachedTotal > 1000 && (
            <span className="text-amber-700"> ⚠ Unter 70% — Cache reißt wahrscheinlich (dynamische Inhalte im stable Prompt-Block).</span>
          )}
        </div>
        {errors > 0 && (
          <div className="text-red-700">⚠ {errors} fehlgeschlagene Calls (kosten meist trotzdem teils Input-Tokens).</div>
        )}
        <div>📊 Daten aus <code>chatbot_usage_log</code>. Jeder LLM-Call landet hier — auch Klassifikatoren und Refines.</div>
      </div>
    </div>
  );
}

function KPI({ label, value, sub, color, icon }: { label: string; value: string; sub?: string; color: string; icon: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
      <div className="text-xs font-medium text-neutral-500 uppercase tracking-wide flex items-center gap-1">{icon} {label}</div>
      <div className={`text-2xl font-bold mt-1 tabular-nums ${color}`}>{value}</div>
      {sub && <div className="text-[11px] text-neutral-400 mt-0.5">{sub}</div>}
    </div>
  );
}
