"use client";

import Link from "next/link";
import { Scale, Package, AlertTriangle, AlertCircle, Truck, ArrowRight } from "lucide-react";
import { t, type Locale } from "@/lib/i18n";
import SyncBadge from "./sync-badge";

interface CollectionStat {
  name: string;
  kg: number;
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
}

export default function StockOverviewClient({ stats, locale }: { stats: StockStats; locale: Locale }) {
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
