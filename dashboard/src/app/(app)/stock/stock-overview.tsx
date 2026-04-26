"use client";

import { useState } from "react";
import Link from "next/link";
import { Scale, Package, AlertTriangle, AlertCircle, Truck, ArrowRight, Snowflake, Flame, PackagePlus, Skull, TrendingUp, ShoppingCart, ChevronDown, Maximize2, Minimize2 } from "lucide-react";
import { t, type Locale } from "@/lib/i18n";
import SyncBadge from "./sync-badge";

interface CollectionStat {
  name: string;
  kg: number;
}

export interface InsightProduct {
  farbe: string;
  quality: string;
  group: string;
  laenge: string;
  lagerG: number;
  verkauftG: number;
  verkauft30d: number;
  unterwegsG: number;
  tier: string;
  value: string;
}

export interface InsightsData {
  slowMovers: InsightProduct[];
  hotMissing: InsightProduct[];
  overOrdered: InsightProduct[];
  deadStock: InsightProduct[];
  trendingUp: InsightProduct[];
  needsReorder: InsightProduct[];
}

interface StockStats {
  totalKg: number;
  welligKg: number;
  glattKg: number;
  welligProducts: number;
  glattProducts: number;
  welligZero: number;
  glattZero: number;
  nullbestandCount: number;
  kritischCount: number;
  unterwegsCount: number;
  welligCollections: CollectionStat[];
  glattCollections: CollectionStat[];
  lastUpdated: string | null;
  insights: InsightsData;
}

export default function StockOverviewClient({ stats, locale }: { stats: StockStats; locale: Locale }) {
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [focusedCard, setFocusedCard] = useState<string | null>(null);
  const toggleFocus = (id: string) => setFocusedCard((cur) => (cur === id ? null : id));
  return (
    <div className="p-4 md:p-8 space-y-6 max-w-7xl">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">{t(locale, "nav.stock")}</h1>
          <p className="text-sm text-neutral-500 mt-1">Lagerbestand-Übersicht</p>
        </div>
        <SyncBadge lastUpdated={stats.lastUpdated} />
      </header>

      {/* Main KPIs */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-neutral-200 p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="text-xs text-neutral-500 uppercase tracking-wide">Gesamt Lager</div>
            <div className="w-8 h-8 rounded-lg flex items-center justify-center bg-amber-50 text-amber-600">
              <Scale size={18} />
            </div>
          </div>
          <div className="mt-2 text-3xl font-bold text-neutral-900">{stats.totalKg.toFixed(2)} kg</div>
          <div className="text-xs text-neutral-400 mt-1">{stats.welligProducts + stats.glattProducts} Produkte</div>
        </div>

        <div className="bg-white rounded-2xl border-2 border-blue-200 p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="text-xs text-blue-600 uppercase tracking-wide font-medium">Usbekisch Wellig</div>
            <Link href="/stock/uzbek" className="text-blue-500 hover:text-blue-700"><ArrowRight size={16} /></Link>
          </div>
          <div className="mt-2 text-2xl font-bold text-blue-700">{stats.welligKg.toFixed(2)} kg</div>
          <div className="text-xs text-neutral-400 mt-1">{stats.welligProducts} Produkte · {stats.welligZero} Nullbestand</div>
        </div>

        <div className="bg-white rounded-2xl border-2 border-green-200 p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div className="text-xs text-green-700 uppercase tracking-wide font-medium">Russisch Glatt</div>
            <Link href="/stock/russian" className="text-green-500 hover:text-green-700"><ArrowRight size={16} /></Link>
          </div>
          <div className="mt-2 text-2xl font-bold text-green-700">{stats.glattKg.toFixed(2)} kg</div>
          <div className="text-xs text-neutral-400 mt-1">{stats.glattProducts} Produkte · {stats.glattZero} Nullbestand</div>
        </div>
      </section>

      {/* Alert Quick-Links */}
      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <AlertCard
          href="/stock/zero"
          icon={<AlertTriangle size={18} />}
          label="Nullbestand"
          count={stats.nullbestandCount}
          color="red"
          description="Produkte ohne Lagerbestand"
        />
        <AlertCard
          href="/stock/critical"
          icon={<AlertCircle size={18} />}
          label="Kritischer Bestand"
          count={stats.kritischCount}
          color="orange"
          description="Produkte unter 600g"
        />
        <AlertCard
          href="/stock/transit"
          icon={<Truck size={18} />}
          label="Unterwegs"
          count={stats.unterwegsCount}
          color="cyan"
          description="Produkte in offenen Bestellungen"
        />
      </section>

      {/* Collections Breakdown */}
      <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <CollectionBreakdown
          title="Usbekisch Wellig — kg pro Kollektion"
          totalKg={stats.welligKg}
          collections={stats.welligCollections}
          accentColor="blue"
        />
        <CollectionBreakdown
          title="Russisch Glatt — kg pro Kollektion"
          totalKg={stats.glattKg}
          collections={stats.glattCollections}
          accentColor="green"
        />
      </section>

      {/* Insights — collapsible */}
      <section className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
        <button
          onClick={() => setInsightsOpen(!insightsOpen)}
          className="w-full flex items-center justify-between px-5 py-4 hover:bg-neutral-50 transition"
        >
          <div className="text-left">
            <h2 className="text-lg font-semibold text-neutral-900">📊 Mehr Insights und Analysen</h2>
            <p className="text-xs text-neutral-500 mt-0.5">Auffälligkeiten basierend auf Topseller-Daten</p>
          </div>
          <ChevronDown
            size={20}
            className={`text-neutral-400 transition-transform ${insightsOpen ? "rotate-180" : ""}`}
          />
        </button>
        {insightsOpen && (
          <div className="px-4 pb-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
            {([
              { id: "deadStock", title: "Auf Lager — kein Verkauf (90T)", description: "Hoher Bestand, aber 0 Verkäufe in 90 Tagen — Kapital liegt brach", icon: <Skull size={16} />, color: "rose" as const, products: stats.insights.deadStock },
              { id: "slowMovers", title: "Slow Mover", description: "Lager > 150g, aber kaum Bewegung in 90 Tagen", icon: <Snowflake size={16} />, color: "blue" as const, products: stats.insights.slowMovers },
              { id: "hotMissing", title: "🔥 Topseller mit niedrigem Lager", description: "TOP7-Produkte unter 200g & nichts unterwegs — dringend nachbestellen", icon: <Flame size={16} />, color: "orange" as const, products: stats.insights.hotMissing },
              { id: "needsReorder", title: "Nachbestellen empfohlen", description: "Lager < Bedarfsprognose und kein Nachschub unterwegs", icon: <ShoppingCart size={16} />, color: "amber" as const, products: stats.insights.needsReorder },
              { id: "trendingUp", title: "Wachsende Verkäufe", description: "30-Tage-Trend deutlich höher als 90-Tage-Schnitt", icon: <TrendingUp size={16} />, color: "emerald" as const, products: stats.insights.trendingUp },
              { id: "overOrdered", title: "Eventuell überbestellt", description: "Mehr als 2× des Bedarfs unterwegs — könnten Lagerproblem werden", icon: <PackagePlus size={16} />, color: "purple" as const, products: stats.insights.overOrdered },
            ])
              .slice()
              .sort((a, b) => {
                if (focusedCard === a.id) return -1;
                if (focusedCard === b.id) return 1;
                return 0;
              })
              .map((card) => (
                <InsightCard
                  key={card.id}
                  title={card.title}
                  description={card.description}
                  icon={card.icon}
                  color={card.color}
                  products={card.products}
                  focused={focusedCard === card.id}
                  onToggleFocus={() => toggleFocus(card.id)}
                />
              ))}
          </div>
        )}
      </section>
    </div>
  );
}

const INITIAL_LIMIT = 15;
const STEP = 25;

function InsightCard({ title, description, icon, color, products, focused, onToggleFocus }: {
  title: string;
  description: string;
  icon: React.ReactNode;
  color: "rose" | "blue" | "orange" | "amber" | "emerald" | "purple";
  products: InsightProduct[];
  focused?: boolean;
  onToggleFocus?: () => void;
}) {
  const colors: Record<string, { bg: string; text: string; border: string; chip: string }> = {
    rose: { bg: "bg-rose-50", text: "text-rose-700", border: "border-rose-200", chip: "bg-rose-100 text-rose-800" },
    blue: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200", chip: "bg-blue-100 text-blue-800" },
    orange: { bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200", chip: "bg-orange-100 text-orange-800" },
    amber: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200", chip: "bg-amber-100 text-amber-800" },
    emerald: { bg: "bg-emerald-50", text: "text-emerald-700", border: "border-emerald-200", chip: "bg-emerald-100 text-emerald-800" },
    purple: { bg: "bg-purple-50", text: "text-purple-700", border: "border-purple-200", chip: "bg-purple-100 text-purple-800" },
  };
  const c = colors[color];

  const [limit, setLimit] = useState(INITIAL_LIMIT);
  const effectiveLimit = focused ? products.length : limit;
  const visible = products.slice(0, effectiveLimit);
  const hasMore = !focused && products.length > limit;
  const remaining = products.length - limit;

  return (
    <div className={`bg-white rounded-2xl border ${c.border} shadow-sm overflow-hidden ${focused ? "lg:col-span-2 ring-2 ring-offset-2 ring-neutral-300" : ""}`}>
      <div className={`${c.bg} px-4 py-3 border-b ${c.border}`}>
        <div className="flex items-center gap-2">
          <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${c.chip}`}>{icon}</div>
          <div className="flex-1 min-w-0">
            <div className={`font-semibold text-sm ${c.text}`}>{title}</div>
            <div className="text-[11px] text-neutral-500 mt-0.5">{description}</div>
          </div>
          <span className={`shrink-0 px-2 py-0.5 rounded-full text-xs font-semibold ${c.chip}`}>
            {products.length}
          </span>
          {onToggleFocus && products.length > 0 && (
            <button
              onClick={onToggleFocus}
              title={focused ? "Verkleinern" : "Ganze Tabelle anzeigen"}
              className={`shrink-0 w-7 h-7 rounded-lg flex items-center justify-center ${c.chip} hover:opacity-80 transition`}
            >
              {focused ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            </button>
          )}
        </div>
      </div>
      {products.length === 0 ? (
        <div className="px-4 py-6 text-center text-xs text-neutral-400">Keine Produkte gefunden</div>
      ) : (
        <>
          <ul className={`divide-y divide-neutral-100 ${focused ? "" : "max-h-[400px] overflow-y-auto"}`}>
            {visible.map((p, i) => (
              <li key={i} className="px-4 py-2 flex items-start gap-2 text-xs hover:bg-neutral-50 transition">
                <span className={`shrink-0 mt-0.5 px-1.5 py-0.5 rounded text-[9px] font-semibold ${p.quality === "Usbekisch Wellig" ? "bg-blue-100 text-blue-700" : "bg-green-100 text-green-700"}`}>
                  {p.quality === "Usbekisch Wellig" ? "WELLIG" : "GLATT"}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-neutral-900 truncate" title={p.farbe}>{p.farbe}</div>
                  <div className="text-[10px] text-neutral-500 truncate">{p.group}</div>
                </div>
                <div className="shrink-0 text-right">
                  <div className={`text-[11px] font-semibold ${c.text}`}>{p.value}</div>
                </div>
              </li>
            ))}
          </ul>
          {!focused && (hasMore || limit > INITIAL_LIMIT) && (
            <div className="px-4 py-2 border-t border-neutral-100 bg-neutral-50/50 flex items-center justify-between gap-2">
              <span className="text-[10px] text-neutral-500">{visible.length} von {products.length}</span>
              <div className="flex items-center gap-1.5">
                {hasMore && (
                  <>
                    <button
                      onClick={() => setLimit((l) => l + STEP)}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-medium ${c.chip} hover:opacity-80 transition`}
                    >
                      +{Math.min(STEP, remaining)}
                    </button>
                    <button
                      onClick={() => setLimit(products.length)}
                      className={`px-2.5 py-1 rounded-md text-[11px] font-medium ${c.chip} hover:opacity-80 transition`}
                    >
                      Alle ({products.length})
                    </button>
                  </>
                )}
                {limit > INITIAL_LIMIT && (
                  <button
                    onClick={() => setLimit(INITIAL_LIMIT)}
                    className="px-2.5 py-1 rounded-md text-[11px] font-medium bg-neutral-200 text-neutral-600 hover:bg-neutral-300 transition"
                  >
                    Weniger
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function AlertCard({ href, icon, label, count, color, description }: {
  href: string; icon: React.ReactNode; label: string; count: number;
  color: "red" | "orange" | "cyan"; description: string;
}) {
  const colors = {
    red: { bg: "bg-red-50", text: "text-red-600", border: "border-red-200", badge: "bg-red-100 text-red-700" },
    orange: { bg: "bg-orange-50", text: "text-orange-600", border: "border-orange-200", badge: "bg-orange-100 text-orange-700" },
    cyan: { bg: "bg-cyan-50", text: "text-cyan-600", border: "border-cyan-200", badge: "bg-cyan-100 text-cyan-700" },
  };
  const c = colors[color];

  return (
    <Link href={href} className={`${c.bg} rounded-2xl border ${c.border} p-5 shadow-sm hover:shadow-md transition group`}>
      <div className="flex items-center justify-between">
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${c.badge}`}>{icon}</div>
        <ArrowRight size={16} className="text-neutral-300 group-hover:text-neutral-500 transition" />
      </div>
      <div className="mt-3">
        <div className="flex items-center gap-2">
          <span className="text-2xl font-bold text-neutral-900">{count}</span>
          <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${c.badge}`}>{label}</span>
        </div>
        <div className="text-xs text-neutral-500 mt-1">{description}</div>
      </div>
    </Link>
  );
}

function CollectionBreakdown({ title, totalKg, collections, accentColor }: {
  title: string; totalKg: number; collections: CollectionStat[]; accentColor: "blue" | "green";
}) {
  const barColor = accentColor === "blue" ? "bg-blue-500" : "bg-green-600";
  const headerBg = accentColor === "blue" ? "bg-blue-600" : "bg-green-700";

  return (
    <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
      <div className={`${headerBg} text-white px-4 py-3 font-semibold text-sm`}>
        {title}
      </div>
      <div className="divide-y divide-neutral-100">
        {collections.map((c) => {
          const pct = totalKg > 0 ? (c.kg / totalKg) * 100 : 0;
          return (
            <div key={c.name} className="px-4 py-2.5 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <div className="text-sm text-neutral-700 truncate">{c.name}</div>
                <div className="mt-1 h-1.5 bg-neutral-100 rounded-full overflow-hidden">
                  <div className={`h-full ${barColor} rounded-full`} style={{ width: `${Math.max(pct, 1)}%` }} />
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm font-semibold text-neutral-900">{c.kg.toFixed(2)} kg</div>
                <div className="text-[10px] text-neutral-400">{pct.toFixed(1)}%</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
