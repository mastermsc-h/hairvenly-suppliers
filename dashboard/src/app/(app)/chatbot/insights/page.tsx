import { requireAdmin } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { AlertTriangle, TrendingUp, Users, Target, MessageCircle } from "lucide-react";
import Link from "next/link";
import AutoTrainButton from "./auto-train-button";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ filter?: string; member?: string; blocker?: string }>;
}

interface InsightRow {
  id: string;
  source_chat_id: string;
  cluster: string | null;
  main_request: string | null;
  objections: string[] | null;
  team_response_quality: string | null;
  conversion: boolean | null;
  conversion_blocker: string | null;
  lost_deal_score: number | null;
  team_member: string | null;
  good_phrases: string[] | null;
  bad_phrases: string[] | null;
  summary: string | null;
}

export default async function InsightsPage({ searchParams }: PageProps) {
  await requireAdmin();
  const params = await searchParams;
  const filter = params.filter || "lost_deals";
  const memberFilter = params.member || null;
  const blockerFilter = params.blocker || null;

  const svc = createServiceClient();

  // Hole alle (für Stats) + gefiltert (für Liste)
  const { data: all } = await svc.from("chatbot_insights").select("*").limit(5000);
  const list = (all || []) as InsightRow[];

  if (list.length === 0) {
    return (
      <div className="p-8 max-w-5xl mx-auto">
        <h1 className="text-xl font-semibold text-neutral-900 mb-2">Chat-Insights</h1>
        <p className="text-sm text-neutral-500 mb-4">
          Analyse läuft im Hintergrund (3300 Chats). Komm in 30–45 Min wieder oder lass es im Terminal laufen.
        </p>
        <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-sm">
          <code className="text-xs">tail -f /tmp/analyze.log</code>
        </div>
      </div>
    );
  }

  // Stats berechnen
  const total = list.length;
  const converted = list.filter(i => i.conversion === true).length;
  const lostDeals = list.filter(i => (i.lost_deal_score || 0) >= 7).length;
  const conversionRate = total > 0 ? Math.round((converted / total) * 100) : 0;

  // Top Einwände (alle objections aggregieren)
  const objectionCounts: Record<string, number> = {};
  for (const i of list) {
    for (const o of i.objections || []) {
      const norm = o.toLowerCase().trim().slice(0, 60);
      objectionCounts[norm] = (objectionCounts[norm] || 0) + 1;
    }
  }
  const topObjections = Object.entries(objectionCounts)
    .filter(([, c]) => c >= 3)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20);

  // Top Conversion-Blocker
  const blockerCounts: Record<string, number> = {};
  for (const i of list) {
    if (i.conversion === false && i.conversion_blocker) {
      blockerCounts[i.conversion_blocker] = (blockerCounts[i.conversion_blocker] || 0) + 1;
    }
  }
  const topBlockers = Object.entries(blockerCounts).sort((a, b) => b[1] - a[1]);

  // Mitarbeiter-Stats
  const memberStats: Record<string, { total: number; converted: number; lostDeals: number }> = {};
  for (const i of list) {
    if (!i.team_member) continue;
    const m = memberStats[i.team_member] ??= { total: 0, converted: 0, lostDeals: 0 };
    m.total++;
    if (i.conversion === true) m.converted++;
    if ((i.lost_deal_score || 0) >= 7) m.lostDeals++;
  }
  const topMembers = Object.entries(memberStats)
    .filter(([, s]) => s.total >= 3)
    .sort((a, b) => b[1].total - a[1].total)
    .slice(0, 15);

  // Liste filtern
  let filtered = list;
  if (filter === "lost_deals") filtered = list.filter(i => (i.lost_deal_score || 0) >= 7);
  else if (filter === "converted") filtered = list.filter(i => i.conversion === true);
  else if (filter === "not_converted") filtered = list.filter(i => i.conversion === false);
  else if (filter === "missed") filtered = list.filter(i => i.team_response_quality === "missed" || i.team_response_quality === "bad");
  if (memberFilter) filtered = filtered.filter(i => i.team_member === memberFilter);
  if (blockerFilter) filtered = filtered.filter(i => i.conversion_blocker === blockerFilter);
  filtered = filtered.sort((a, b) => (b.lost_deal_score || 0) - (a.lost_deal_score || 0)).slice(0, 200);

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900 flex items-center gap-2">
            <Target size={20} /> Chat-Insights
          </h1>
          <p className="text-sm text-neutral-500 mt-1">
            Was lernen wir aus echten Kundengesprächen? · {total.toLocaleString()} Chats analysiert
          </p>
        </div>
        <AutoTrainButton />
      </div>

      {/* KPI-Kacheln */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI label="Analysierte Chats"  value={total.toLocaleString()}                  icon={<MessageCircle size={14} />} />
        <KPI label="Conversion-Rate"   value={`${conversionRate}%`}                     icon={<TrendingUp size={14} />}    color="text-green-700" />
        <KPI label="Lost Deals (≥7)"   value={lostDeals.toLocaleString()}              icon={<AlertTriangle size={14} />} color="text-red-700" />
        <KPI label="Mitarbeiter erkannt" value={Object.keys(memberStats).length.toString()} icon={<Users size={14} />} />
      </div>

      {/* Top Einwände */}
      <Section title="Top Kunden-Einwände" subtitle="(mindestens 3× vorgekommen)">
        <div className="grid md:grid-cols-2 gap-1.5">
          {topObjections.map(([obj, count]) => (
            <div key={obj} className="flex items-center justify-between bg-neutral-50 rounded-lg px-3 py-2 text-sm">
              <span className="text-neutral-700">{obj}</span>
              <span className="text-xs bg-neutral-200 px-2 py-0.5 rounded-full font-medium">{count}×</span>
            </div>
          ))}
        </div>
      </Section>

      {/* Conversion-Blocker */}
      <Section title="Verkaufs-Blocker" subtitle="(warum konvertiert nicht)">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
          {topBlockers.map(([blocker, count]) => (
            <Link
              key={blocker}
              href={`/chatbot/insights?filter=not_converted&blocker=${encodeURIComponent(blocker)}`}
              className={`rounded-lg px-3 py-2.5 text-sm hover:opacity-80 ${
                blockerFilter === blocker ? "bg-red-200 text-red-900" : "bg-red-50 text-red-800"
              }`}
            >
              <div className="font-semibold">{blocker}</div>
              <div className="text-xs">{count} Chats</div>
            </Link>
          ))}
        </div>
      </Section>

      {/* Mitarbeiter-Performance */}
      <Section title="Mitarbeiter-Performance" subtitle="(min. 3 Chats mit klarer Signatur)">
        <table className="w-full text-sm">
          <thead className="text-xs text-neutral-500 uppercase tracking-wide">
            <tr className="border-b border-neutral-200">
              <th className="text-left py-2">Mitarbeiter</th>
              <th className="text-right py-2">Chats</th>
              <th className="text-right py-2">Conversion-Rate</th>
              <th className="text-right py-2">Lost Deals</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {topMembers.map(([name, s]) => {
              const rate = s.total > 0 ? Math.round((s.converted / s.total) * 100) : 0;
              const rateColor = rate >= 60 ? "text-green-700" : rate >= 30 ? "text-amber-700" : "text-red-700";
              return (
                <tr key={name} className="border-b border-neutral-100 hover:bg-neutral-50">
                  <td className="py-2 font-medium">{name}</td>
                  <td className="text-right">{s.total}</td>
                  <td className={`text-right font-medium ${rateColor}`}>{rate}%</td>
                  <td className="text-right text-red-600">{s.lostDeals}</td>
                  <td className="text-right py-2">
                    <Link
                      href={`/chatbot/insights?member=${encodeURIComponent(name)}`}
                      className="text-xs text-blue-600 hover:underline"
                    >
                      Chats →
                    </Link>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>

      {/* Filter + Liste */}
      <Section title="Chat-Liste" subtitle={`${filtered.length} Treffer`}>
        <div className="flex gap-2 mb-3 flex-wrap text-xs">
          {[
            ["lost_deals", "🔥 Lost Deals (≥7)"],
            ["not_converted", "❌ Nicht konvertiert"],
            ["converted", "✅ Konvertiert"],
            ["missed", "⚠️ Verpatzte Reaktionen"],
            ["all", "Alle"],
          ].map(([key, label]) => (
            <Link
              key={key}
              href={`/chatbot/insights?filter=${key}${memberFilter ? `&member=${encodeURIComponent(memberFilter)}` : ""}`}
              className={`px-3 py-1.5 rounded-full ${filter === key ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"}`}
            >
              {label}
            </Link>
          ))}
          {(memberFilter || blockerFilter) && (
            <Link href={`/chatbot/insights?filter=${filter}`} className="px-3 py-1.5 rounded-full bg-amber-100 text-amber-800 hover:bg-amber-200">
              ✕ {memberFilter || blockerFilter}
            </Link>
          )}
        </div>

        <ul className="divide-y divide-neutral-100">
          {filtered.map(i => (
            <li key={i.id} className="py-3">
              <div className="flex items-start gap-3">
                <div className={`text-xs font-bold rounded-full w-9 h-9 flex items-center justify-center flex-shrink-0 ${
                  (i.lost_deal_score || 0) >= 8 ? "bg-red-100 text-red-700" :
                  (i.lost_deal_score || 0) >= 5 ? "bg-amber-100 text-amber-700" :
                  "bg-neutral-100 text-neutral-600"
                }`}>
                  {i.lost_deal_score || 0}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 text-xs text-neutral-500 flex-wrap mb-0.5">
                    <span>{i.cluster}</span>
                    <span>·</span>
                    {i.team_member && (
                      <>
                        <Link href={`/chatbot/insights?member=${encodeURIComponent(i.team_member)}`} className="font-medium text-neutral-700 hover:underline">
                          {i.team_member}
                        </Link>
                        <span>·</span>
                      </>
                    )}
                    {i.conversion === true ? (
                      <span className="text-green-700">✓ konvertiert</span>
                    ) : (
                      <span className="text-red-700">✗ {i.conversion_blocker || "nicht konvertiert"}</span>
                    )}
                    {i.team_response_quality && (
                      <>
                        <span>·</span>
                        <span className={
                          i.team_response_quality === "excellent" ? "text-green-700" :
                          i.team_response_quality === "good" ? "text-green-600" :
                          i.team_response_quality === "ok" ? "text-neutral-600" :
                          i.team_response_quality === "bad" ? "text-red-600" :
                          "text-red-700 font-medium"
                        }>
                          Reaktion: {i.team_response_quality}
                        </span>
                      </>
                    )}
                  </div>
                  <div className="text-sm font-medium text-neutral-900">{i.main_request || "—"}</div>
                  <div className="text-xs text-neutral-600 mt-0.5">{i.summary}</div>
                  {i.objections && i.objections.length > 0 && (
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {i.objections.slice(0, 4).map((o, k) => (
                        <span key={k} className="text-[10px] bg-amber-50 text-amber-800 px-1.5 py-0.5 rounded">
                          {o.slice(0, 50)}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </li>
          ))}
        </ul>
      </Section>
    </div>
  );
}

function KPI({ label, value, icon, color }: { label: string; value: string; icon: React.ReactNode; color?: string }) {
  return (
    <div className="bg-white border border-neutral-200 rounded-xl p-3">
      <div className="flex items-center gap-1.5 text-xs text-neutral-500">{icon}{label}</div>
      <div className={`text-2xl font-bold mt-0.5 ${color || "text-neutral-900"}`}>{value}</div>
    </div>
  );
}

function Section({ title, subtitle, children }: { title: string; subtitle?: string; children: React.ReactNode }) {
  return (
    <div className="bg-white border border-neutral-200 rounded-2xl p-5 shadow-sm">
      <div className="mb-3">
        <h2 className="text-sm font-semibold text-neutral-900">{title}</h2>
        {subtitle && <p className="text-xs text-neutral-500">{subtitle}</p>}
      </div>
      {children}
    </div>
  );
}
