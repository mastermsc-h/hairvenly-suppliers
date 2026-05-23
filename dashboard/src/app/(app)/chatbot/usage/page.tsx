/**
 * Token + Cost-Dashboard. Zeigt was der Bot wirklich kostet — pro Tag,
 * pro Kategorie, pro Modell. Basis für Optimierungs-Entscheidungen.
 */
import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { ArrowLeft, DollarSign, Zap, TrendingUp } from "lucide-react";

export const dynamic = "force-dynamic";

interface AggRow {
  purpose: string;
  model: string;
  calls: number;
  input_tokens: number;
  output_tokens: number;
  cache_read: number;
  cache_write: number;
  cost_usd: number;
}

interface DayRow {
  day: string;
  cost_usd: number;
  calls: number;
}

const PURPOSE_LABELS: Record<string, string> = {
  respond:           "🤖 Bot-Antwort",
  refine:            "🔄 Neu generieren",
  classify_category: "🏷 Kategorie",
  guardian_analyze:  "🛡 Guardian",
  needs_answer:      "❓ needs-answer",
  auto_consolidate:  "📚 Auto-Konsolidieren",
  grammar:           "✍ Grammatik",
  critic_pass:       "🔍 Fact-Check",
  training_insight:  "💡 Insights",
  other:             "Sonstige",
};

export default async function UsagePage() {
  await requireProfile();
  const svc = createServiceClient();

  // Letzte 30 Tage Aggregation per purpose × model
  const cutoff30 = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  const cutoff7  = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();
  const cutoff1  = new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString();

  const { data: agg30 } = await svc
    .from("chatbot_usage_log")
    .select("purpose, model, input_tokens, output_tokens, cache_read_input_tokens, cache_creation_input_tokens, cost_usd")
    .gte("created_at", cutoff30);

  const aggMap = new Map<string, AggRow>();
  let total30 = 0;
  for (const row of agg30 || []) {
    const key = `${row.purpose}|${row.model}`;
    const ex = aggMap.get(key) || {
      purpose: row.purpose, model: row.model,
      calls: 0, input_tokens: 0, output_tokens: 0,
      cache_read: 0, cache_write: 0, cost_usd: 0,
    };
    ex.calls++;
    ex.input_tokens += row.input_tokens || 0;
    ex.output_tokens += row.output_tokens || 0;
    ex.cache_read += row.cache_read_input_tokens || 0;
    ex.cache_write += row.cache_creation_input_tokens || 0;
    ex.cost_usd += Number(row.cost_usd) || 0;
    aggMap.set(key, ex);
    total30 += Number(row.cost_usd) || 0;
  }
  const aggSorted = Array.from(aggMap.values()).sort((a, b) => b.cost_usd - a.cost_usd);

  const total7 = (agg30 || []).filter(r => new Date((r as { created_at?: string }).created_at || cutoff30) >= new Date(cutoff7))
    .reduce((s, r) => s + Number(r.cost_usd || 0), 0);
  const total1 = (agg30 || []).filter(r => new Date((r as { created_at?: string }).created_at || cutoff30) >= new Date(cutoff1))
    .reduce((s, r) => s + Number(r.cost_usd || 0), 0);

  // Daily breakdown (last 14 days)
  const { data: rows14 } = await svc
    .from("chatbot_usage_log")
    .select("created_at, cost_usd, purpose")
    .gte("created_at", new Date(Date.now() - 14 * 24 * 3600 * 1000).toISOString())
    .order("created_at", { ascending: false });
  const days: Record<string, DayRow> = {};
  for (const r of rows14 || []) {
    const day = (r.created_at as string).slice(0, 10);
    if (!days[day]) days[day] = { day, cost_usd: 0, calls: 0 };
    days[day].cost_usd += Number(r.cost_usd) || 0;
    days[day].calls += 1;
  }
  const dayList = Object.values(days).sort((a, b) => a.day.localeCompare(b.day));

  // Cache-Hit-Rate (Sonnet only — wo's auf Caching ankommt)
  const sonnetRows = (agg30 || []).filter(r => (r.model || "").startsWith("claude-sonnet"));
  const totalSonnetInputTokens = sonnetRows.reduce((s, r) => s + (r.input_tokens || 0) + (r.cache_read_input_tokens || 0) + (r.cache_creation_input_tokens || 0), 0);
  const cacheReadTokens = sonnetRows.reduce((s, r) => s + (r.cache_read_input_tokens || 0), 0);
  const cacheHitRate = totalSonnetInputTokens > 0 ? (cacheReadTokens / totalSonnetInputTokens * 100) : 0;

  // Hochrechnung 30 Tage basierend auf last 7
  const projection30 = (total7 / 7) * 30;

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-6">
      <Link href="/chatbot" className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-900">
        <ArrowLeft size={14} /> Zurück zum Chatbot
      </Link>

      <div>
        <h1 className="text-2xl font-semibold">💰 Token + Kosten-Monitoring</h1>
        <p className="text-sm text-neutral-500 mt-1">
          Wie teuer ist der Bot wirklich, und wo geht das Geld hin? Daten kommen automatisch aus jedem Anthropic-Call.
        </p>
      </div>

      {/* KPI-Tiles */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
        <Tile icon={<DollarSign size={16} />} label="Heute (24h)"   value={`$${total1.toFixed(2)}`} sub={`${(agg30 || []).filter(r => new Date((r as { created_at?: string }).created_at || cutoff30) >= new Date(cutoff1)).length} Calls`} />
        <Tile icon={<DollarSign size={16} />} label="Letzte 7 Tage" value={`$${total7.toFixed(2)}`} sub={`Ø $${(total7/7).toFixed(2)} / Tag`} />
        <Tile icon={<DollarSign size={16} />} label="Letzte 30 Tage" value={`$${total30.toFixed(2)}`} sub={`Projektion 30d: $${projection30.toFixed(0)}`} />
        <Tile icon={<Zap size={16} />}        label="Sonnet Cache-Hit"  value={`${cacheHitRate.toFixed(0)}%`} sub="je höher, desto günstiger" />
      </div>

      {/* Tagesverlauf */}
      <div className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm">
        <div className="flex items-center gap-2 mb-3">
          <TrendingUp size={16} className="text-neutral-500" />
          <h2 className="font-semibold">Tagesverlauf (14 Tage)</h2>
        </div>
        <div className="space-y-1">
          {dayList.length === 0 ? (
            <p className="text-sm text-neutral-400">Noch keine Daten gesammelt. Wird nach den ersten Bot-Calls befüllt.</p>
          ) : dayList.map(d => {
            const max = Math.max(...dayList.map(x => x.cost_usd), 1);
            const pct = (d.cost_usd / max) * 100;
            return (
              <div key={d.day} className="flex items-center gap-3">
                <div className="text-[11px] text-neutral-500 w-20 shrink-0">{d.day}</div>
                <div className="flex-1 bg-neutral-100 rounded-full h-5 overflow-hidden">
                  <div className="bg-blue-500 h-full rounded-full" style={{ width: `${pct}%` }} />
                </div>
                <div className="text-[11px] text-neutral-700 w-32 shrink-0 text-right">${d.cost_usd.toFixed(3)} · {d.calls} Calls</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Breakdown nach Purpose × Model */}
      <div className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm">
        <h2 className="font-semibold mb-3">Wo geht das Geld hin? (30 Tage)</h2>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-neutral-500 uppercase tracking-wide border-b border-neutral-200">
              <th className="py-2 pr-3">Zweck</th>
              <th className="py-2 pr-3">Modell</th>
              <th className="py-2 pr-3 text-right">Calls</th>
              <th className="py-2 pr-3 text-right">Input</th>
              <th className="py-2 pr-3 text-right">Output</th>
              <th className="py-2 pr-3 text-right">Cache-Read</th>
              <th className="py-2 pr-3 text-right">Kosten</th>
              <th className="py-2 pr-3 text-right">Ø/Call</th>
            </tr>
          </thead>
          <tbody>
            {aggSorted.length === 0 ? (
              <tr><td colSpan={8} className="py-4 text-center text-neutral-400">Keine Daten yet.</td></tr>
            ) : aggSorted.map(r => (
              <tr key={`${r.purpose}-${r.model}`} className="border-b border-neutral-100">
                <td className="py-2 pr-3">{PURPOSE_LABELS[r.purpose] || r.purpose}</td>
                <td className="py-2 pr-3 text-neutral-500 text-xs">{r.model.replace("claude-", "")}</td>
                <td className="py-2 pr-3 text-right">{r.calls.toLocaleString("de-DE")}</td>
                <td className="py-2 pr-3 text-right text-xs">{(r.input_tokens/1000).toFixed(1)}k</td>
                <td className="py-2 pr-3 text-right text-xs">{(r.output_tokens/1000).toFixed(1)}k</td>
                <td className="py-2 pr-3 text-right text-xs text-green-700">{(r.cache_read/1000).toFixed(1)}k</td>
                <td className="py-2 pr-3 text-right font-medium">${r.cost_usd.toFixed(2)}</td>
                <td className="py-2 pr-3 text-right text-neutral-500 text-xs">${(r.cost_usd / r.calls).toFixed(4)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="text-xs text-neutral-500 bg-amber-50 border border-amber-200 rounded-xl p-3">
        💡 <strong>Tipp:</strong> Wenn "Bot-Antwort" mit Cache-Read &gt; 70% ist, läuft die Optimierung gut.
        Hohe "Neu generieren"-Kosten = vielleicht Refine-Limit auf 2 setzen.
        "Sonstige" sollte = $0 sein — sonst gibt's irgendwo einen Anthropic-Call der nicht geloggt wird.
      </div>
    </div>
  );
}

function Tile({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
      <div className="flex items-center gap-1.5 text-xs font-medium text-neutral-600 uppercase tracking-wide">
        {icon} {label}
      </div>
      <div className="text-2xl font-semibold text-neutral-900 mt-1">{value}</div>
      {sub && <div className="text-xs text-neutral-500 mt-0.5">{sub}</div>}
    </div>
  );
}
