"use client";

import { useState, useMemo } from "react";
import Link from "next/link";
import { Search, AlertTriangle, AlertCircle, Truck, Package, ExternalLink } from "lucide-react";
import type { AlertProduct } from "@/lib/stock-sheets";
import type { ClientOrderMeta } from "@/lib/order-name-map";
import SyncBadge from "./sync-badge";
import { needsAction, LOW_STOCK_G, CRIT_STATUS_ORDER, type CritStatus } from "@/lib/stock-criticality";

type AlertMode = "zero" | "critical" | "transit";

const MODE_CONFIG: Record<AlertMode, { icon: React.ReactNode; emptyText: string }> = {
  zero: { icon: <AlertTriangle size={18} />, emptyText: "Keine Produkte mit Nullbestand" },
  critical: { icon: <AlertCircle size={18} />, emptyText: "Keine Produkte mit kritischem Bestand" },
  transit: { icon: <Truck size={18} />, emptyText: "Keine Produkte unterwegs" },
};

interface Props {
  data: AlertProduct[];
  title: string;
  subtitle: string;
  mode: AlertMode;
  lastUpdated?: string | null;
  /**
   * Map from stock-sheet order name (e.g. "Amanda 07.04.2026") to order meta
   * (id + tracking). Used to link badges and display tracking info.
   */
  orderIdByName?: Record<string, ClientOrderMeta>;
}

type QuickFilter = "all" | "action" | "no_order" | "has_order" | "akut" | "luecke" | "knapp" | "ladenhueter" | "low600";

const QUICK_FILTERS: Record<AlertMode, { key: QuickFilter; label: string; description: string }[]> = {
  zero: [
    { key: "all", label: "Alle", description: "" },
    { key: "no_order", label: "Ohne Bestellung", description: "Nicht bestellt" },
    { key: "has_order", label: "Bestellt", description: "Bestellung unterwegs" },
  ],
  critical: [
    { key: "action", label: "Handlungsbedarf", description: "Akut + Lücke + Knapp" },
    { key: "akut", label: "Akut", description: "Lager + unterwegs reicht nicht bis zur nächstmöglichen Lieferung" },
    { key: "luecke", label: "Lücke vor Ankunft", description: "Lager ist leer, bevor die Bestellung ankommt" },
    { key: "knapp", label: "Knapp", description: "Reicht weniger als 1,5× Lieferzeit" },
    { key: "no_order", label: "Ohne Bestellung", description: "Handlungsbedarf und nichts bestellt" },
    { key: "ladenhueter", label: "Ladenhüter", description: "Unter 600 g, aber 0 Verkauf in 90 Tagen — nicht nachbestellen" },
    { key: "low600", label: "Alle < 600g", description: "Alte Liste: jedes Produkt unter 600 g, egal wie lange es reicht" },
  ],
  transit: [
    { key: "all", label: "Alle", description: "" },
  ],
};

const statusOf = (d: AlertProduct): CritStatus => d.crit?.status ?? "unbekannt";
const isAction = (d: AlertProduct): boolean => !!d.crit && needsAction(d, d.crit);

type Tier = "TOP7" | "MID" | "REST" | "KAUM";
const ALL_TIERS: Tier[] = ["TOP7", "MID", "REST", "KAUM"];

const TIER_BADGE: Record<Tier, string> = {
  TOP7: "bg-yellow-100 text-yellow-800 ring-yellow-200",
  MID: "bg-blue-100 text-blue-800 ring-blue-200",
  REST: "bg-neutral-100 text-neutral-600 ring-neutral-200",
  KAUM: "bg-neutral-100 text-neutral-400 ring-neutral-200",
};

const TIER_LABEL: Record<Tier, string> = {
  TOP7: "Topseller",
  MID: "Mid-Seller",
  REST: "Rest",
  KAUM: "Kaum",
};

const TIER_ORDER: Record<Tier | "UNKNOWN", number> = { TOP7: 0, MID: 1, REST: 2, UNKNOWN: 3, KAUM: 4 };

export default function AlertsClient({ data, title, subtitle, mode, lastUpdated, orderIdByName }: Props) {
  const [query, setQuery] = useState("");
  const defaultFilter: QuickFilter = mode === "critical" ? "action" : "all";
  const [quickFilter, setQuickFilter] = useState<QuickFilter>(defaultFilter);
  const [activeTiers, setActiveTiers] = useState<Set<Tier | "UNKNOWN">>(new Set([...ALL_TIERS, "UNKNOWN"]));
  const config = MODE_CONFIG[mode];
  const filters = QUICK_FILTERS[mode];

  const tierKey = (d: AlertProduct): Tier | "UNKNOWN" => (d.tier ?? "UNKNOWN");
  const toggleTier = (tier: Tier | "UNKNOWN") => {
    setActiveTiers((prev) => {
      const next = new Set(prev);
      if (next.has(tier)) next.delete(tier);
      else next.add(tier);
      return next;
    });
  };
  const allTiersActive = activeTiers.size === ALL_TIERS.length + 1;
  const hasAnyTier = useMemo(() => data.some((d) => d.tier), [data]);

  // Collect unique order names for transit mode
  const allOrderNames = useMemo(() => {
    if (mode !== "transit") return [];
    const names = new Set<string>();
    for (const d of data) {
      for (const o of d.perOrder) names.add(o.name);
    }
    return Array.from(names).sort();
  }, [data, mode]);

  const [activeOrders, setActiveOrders] = useState<Set<string>>(new Set(allOrderNames));
  // True when every order name is currently selected.
  const allOrdersActive = allOrderNames.length > 0 && activeOrders.size === allOrderNames.length;
  const noOrdersActive = activeOrders.size === 0;

  const toggleOrder = (name: string) => {
    setActiveOrders((prev) => {
      const next = new Set(prev);
      if (next.has(name)) next.delete(name);
      else next.add(name);
      return next;
    });
  };

  const toggleAll = () => {
    // Click: if everything selected → deselect all; otherwise select all.
    setActiveOrders((prev) =>
      prev.size === allOrderNames.length ? new Set() : new Set(allOrderNames),
    );
  };

  const matchQuick = (d: AlertProduct, f: QuickFilter): boolean => {
    switch (f) {
      case "all": return true;
      case "action": return isAction(d);
      case "no_order": return d.unterwegsG <= 0 && (mode !== "critical" || isAction(d));
      case "has_order": return d.unterwegsG > 0;
      case "akut":
      case "luecke":
      case "knapp":
      case "ladenhueter": return statusOf(d) === f;
      case "low600": return d.lagerG < LOW_STOCK_G;
    }
  };
  // Grundmenge des aktiven Schnellfilters — Basis für KPIs und Rang-Zähler
  const scope = data.filter((d) => matchQuick(d, quickFilter));

  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const filterFn = (d: AlertProduct) => {
    // Text search
    if (words.length > 0) {
      const combined = `${d.product} ${d.collection}`.toLowerCase();
      if (!words.every((w) => combined.includes(w))) return false;
    }
    // Quick filter
    if (!matchQuick(d, quickFilter)) return false;
    // Tier filter (critical mode)
    if (mode === "critical" && hasAnyTier && !allTiersActive) {
      if (!activeTiers.has(tierKey(d))) return false;
    }
    // Order filter (transit mode): show product only if it has at least one selected order.
    // If all are selected → show everything. If none are selected → hide everything.
    if (mode === "transit" && allOrderNames.length > 0 && !allOrdersActive) {
      if (noOrdersActive) return false;
      const hasSelectedOrder = d.perOrder.some((o) => activeOrders.has(o.name));
      if (!hasSelectedOrder) return false;
    }
    return true;
  };

  const sortFn = (a: AlertProduct, b: AlertProduct) => {
    if (mode !== "critical") return 0;
    // Sort: akut → Lücke → knapp, dann Tier (TOP7 vor REST/KAUM),
    // innerhalb gleicher Bucket: kürzere Reichweite zuerst.
    const statusDiff = CRIT_STATUS_ORDER[statusOf(a)] - CRIT_STATUS_ORDER[statusOf(b)];
    if (statusDiff !== 0) return statusDiff;
    const tierDiff = TIER_ORDER[tierKey(a)] - TIER_ORDER[tierKey(b)];
    if (tierDiff !== 0) return tierDiff;
    const ra = a.crit?.rangeWithOrder ?? Number.MAX_SAFE_INTEGER;
    const rb = b.crit?.rangeWithOrder ?? Number.MAX_SAFE_INTEGER;
    if (ra !== rb) return ra - rb;
    return a.lagerG - b.lagerG;
  };

  const filtered = data.filter(filterFn).sort(sortFn);
  const wellig = filtered.filter((d) => d.sheetKey === "wellig");
  const glatt = filtered.filter((d) => d.sheetKey === "glatt");


  return (
    <div className="p-4 md:p-8 space-y-6 max-w-7xl">
      <header className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">{title}</h1>
          <p className="text-sm text-neutral-500 mt-1">{subtitle}</p>
        </div>
        <SyncBadge lastUpdated={lastUpdated ?? null} />
      </header>

      <section className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {(() => {
          // Kritisch: KPIs zählen den aktiven Schnellfilter (Standard: Handlungsbedarf)
          const kpiItems = mode === "critical" ? scope : data;
          const welligItems = kpiItems.filter((d) => d.sheetKey === "wellig");
          const glattItems = kpiItems.filter((d) => d.sheetKey === "glatt");
          // Pick relevant kg metric per mode:
          //   transit / zero  → kg unterwegs (für zero-stock: Nachschub)
          //   critical        → kg Lager (aktueller Restbestand)
          const useLagerKg = mode === "critical";
          const valueFor = (d: AlertProduct) => (useLagerKg ? d.lagerG : d.unterwegsG);
          const totalKg = kpiItems.reduce((s, d) => s + valueFor(d), 0) / 1000;
          const welligKg = welligItems.reduce((s, d) => s + valueFor(d), 0) / 1000;
          const glattKg = glattItems.reduce((s, d) => s + valueFor(d), 0) / 1000;
          const kgLabel = useLagerKg ? "kg Lager" : "kg unterwegs";
          return (
            <>
              <KpiCard
                label="Gesamt"
                value={kpiItems.length.toString()}
                sub={`${totalKg.toFixed(2)} ${kgLabel}`}
                icon={config.icon}
                color="rose"
              />
              <KpiCard
                label="Usbekisch Wellig"
                value={welligItems.length.toString()}
                sub={`${welligKg.toFixed(2)} ${kgLabel}`}
                icon={config.icon}
                color="indigo"
              />
              <KpiCard
                label="Russisch Glatt"
                value={glattItems.length.toString()}
                sub={`${glattKg.toFixed(2)} ${kgLabel}`}
                icon={config.icon}
                color="emerald"
              />
            </>
          );
        })()}
      </section>

      {/* Search + Quick Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-md">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Produkt suchen..."
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-neutral-300 text-sm focus:ring-2 focus:ring-neutral-900 focus:outline-none"
          />
        </div>
        {filters.length > 1 && (
          <div className="flex flex-wrap gap-2">
            {filters.map((f) => {
              const count = data.filter((d) => matchQuick(d, f.key)).length;
              const isAkut = f.key === "akut";
              const isKnapp = f.key === "knapp";
              const isLuecke = f.key === "luecke";
              return (
                <button
                  key={f.key}
                  onClick={() => setQuickFilter(f.key)}
                  title={f.description || undefined}
                  className={`px-3 py-2 rounded-lg text-sm font-medium transition inline-flex items-center gap-1.5 ${
                    quickFilter === f.key
                      ? isAkut ? "bg-red-600 text-white"
                        : isLuecke ? "bg-violet-600 text-white"
                        : isKnapp ? "bg-orange-500 text-white"
                        : f.key === "no_order" ? "bg-red-600 text-white"
                        : "bg-neutral-900 text-white"
                      : isAkut ? "bg-red-50 text-red-700 hover:bg-red-100 border border-red-200"
                        : isLuecke ? "bg-violet-50 text-violet-700 hover:bg-violet-100 border border-violet-200"
                        : isKnapp ? "bg-orange-50 text-orange-700 hover:bg-orange-100 border border-orange-200"
                        : f.key === "no_order" ? "bg-red-50 text-red-700 hover:bg-red-100 border border-red-200"
                        : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
                  }`}
                >
                  {f.label}
                  <span className={`text-xs ${quickFilter === f.key ? "opacity-70" : "opacity-50"}`}>({count})</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Tier filter (critical mode) */}
      {mode === "critical" && hasAnyTier && (
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="text-[10px] uppercase text-neutral-400 font-medium mr-1">Verkaufsrang:</span>
          <button
            onClick={() => setActiveTiers(new Set([...ALL_TIERS, "UNKNOWN"]))}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
              allTiersActive ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
            }`}
          >
            Alle
          </button>
          {ALL_TIERS.map((tier) => {
            const active = activeTiers.has(tier);
            const count = scope.filter((d) => tierKey(d) === tier).length;
            return (
              <button
                key={tier}
                onClick={() => toggleTier(tier)}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition inline-flex items-center gap-1 ${
                  active ? TIER_BADGE[tier].replace("ring-", "ring-1 ring-") : "bg-neutral-50 text-neutral-400 hover:bg-neutral-100 border border-dashed border-neutral-300"
                }`}
                title={TIER_LABEL[tier]}
              >
                {TIER_LABEL[tier]}
                <span className="opacity-60">({count})</span>
              </button>
            );
          })}
          {scope.some((d) => !d.tier) && (
            <button
              onClick={() => toggleTier("UNKNOWN")}
              className={`px-2.5 py-1 rounded-md text-xs font-medium transition inline-flex items-center gap-1 ${
                activeTiers.has("UNKNOWN") ? "bg-neutral-200 text-neutral-700" : "bg-neutral-50 text-neutral-400 hover:bg-neutral-100 border border-dashed border-neutral-300"
              }`}
              title="Kein Verkaufsrang im Topseller-Tab gefunden"
            >
              ohne Rang
              <span className="opacity-60">({scope.filter((d) => !d.tier).length})</span>
            </button>
          )}
        </div>
      )}

      {/* Order selection (transit mode) */}
      {mode === "transit" && allOrderNames.length > 0 && (
        <div className="flex flex-wrap gap-1.5 items-center">
          <span className="text-[10px] uppercase text-neutral-400 font-medium mr-1">Bestellungen:</span>
          <button
            onClick={toggleAll}
            className={`px-2.5 py-1 rounded-md text-xs font-medium transition ${
              allOrdersActive ? "bg-neutral-900 text-white" : "bg-neutral-100 text-neutral-600 hover:bg-neutral-200"
            }`}
          >
            Alle
          </button>
          {allOrderNames.map((name) => {
            const active = activeOrders.has(name);
            const count = data.filter((d) => d.perOrder.some((o) => o.name === name)).length;
            const isChina = name.toLowerCase().includes("china");
            const colorActive = isChina ? "bg-blue-600 text-white" : "bg-green-700 text-white";
            const colorInactive = isChina ? "bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100" : "bg-green-50 text-green-700 border border-green-200 hover:bg-green-100";
            const meta = orderIdByName?.[name];
            return (
              <span
                key={name}
                className={`rounded-md text-xs font-medium transition inline-flex items-center overflow-hidden ${
                  active ? colorActive : colorInactive
                }`}
              >
                <button
                  onClick={() => toggleOrder(name)}
                  className="px-2.5 py-1 inline-flex items-center gap-1 hover:opacity-90"
                  title={active ? "Filter entfernen" : "Filter hinzufügen"}
                >
                  <Package size={10} />
                  {name}
                  <span className="opacity-60">({count})</span>
                </button>
                {meta?.trackingUrl && (
                  <a
                    href={meta.trackingUrl}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    title={meta.trackingNumber ? `Sendung verfolgen: ${meta.trackingNumber}` : "Sendung verfolgen"}
                    className="px-1.5 py-1 border-l bg-yellow-400 text-yellow-900 border-yellow-500 hover:bg-yellow-300 inline-flex items-center"
                  >
                    <Truck size={11} />
                  </a>
                )}
                {meta?.id && (
                  <Link
                    href={`/orders/${meta.id}`}
                    onClick={(e) => e.stopPropagation()}
                    title="Bestellung öffnen"
                    className={`px-1.5 py-1 border-l ${active ? "border-white/25 hover:bg-black/10" : isChina ? "border-blue-200 hover:bg-blue-100" : "border-green-200 hover:bg-green-100"}`}
                  >
                    <ExternalLink size={11} />
                  </Link>
                )}
              </span>
            );
          })}
        </div>
      )}

      {/* Filtered count indicator */}
      {(quickFilter !== defaultFilter || (!allOrdersActive && mode === "transit")) && (
        <div className="text-sm text-neutral-500">
          {filtered.length} von {data.length} Produkten angezeigt
          <button onClick={() => { setQuickFilter(defaultFilter); setActiveOrders(new Set(allOrderNames)); }} className="ml-2 text-indigo-600 hover:text-indigo-800 font-medium">Filter zurücksetzen</button>
        </div>
      )}

      {wellig.length > 0 && (
        <AlertSection
          label="Usbekisch Wellig"
          items={wellig}
          accent="blue"
          mode={mode}
          orderIdByName={orderIdByName}
        />
      )}
      {glatt.length > 0 && (
        <AlertSection
          label="Russisch Glatt"
          items={glatt}
          accent="green"
          mode={mode}
          orderIdByName={orderIdByName}
        />
      )}

      {filtered.length === 0 && data.length > 0 && (
        <div className="text-center py-12 text-neutral-400">
          Keine Produkte für diesen Filter
          <br />
          <button onClick={() => { setQuickFilter("all"); setQuery(""); setActiveOrders(new Set(allOrderNames)); }} className="mt-2 text-indigo-600 hover:text-indigo-800 text-sm font-medium">
            Alle anzeigen
          </button>
        </div>
      )}

      {data.length === 0 && (
        <div className="text-center py-12 text-neutral-400">{config.emptyText}</div>
      )}
    </div>
  );
}

function AlertSection({
  label,
  items,
  accent,
  mode,
  orderIdByName,
}: {
  label: string;
  items: AlertProduct[];
  accent: "blue" | "green";
  mode: AlertMode;
  orderIdByName?: Record<string, ClientOrderMeta>;
}) {
  const headerBg = accent === "blue" ? "bg-blue-600" : "bg-green-700";

  return (
    <section className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
      <div className={`${headerBg} text-white px-4 py-2.5 font-semibold text-sm`}>
        {label}
        <span className="ml-2 font-normal opacity-80">({items.length} Produkte)</span>
      </div>

      {/* Mobile */}
      <div className="md:hidden divide-y divide-neutral-100">
        {items.map((item, i) => {
          const status = mode === "critical" ? statusOf(item) : "ok";
          return (
          <div key={i} className={`px-3 py-2 ${
            mode === "critical" && status === "akut" ? "bg-red-50/50" :
            mode === "critical" && status === "luecke" ? "bg-violet-50/50" :
            mode === "critical" && status === "knapp" ? "bg-orange-50/40" :
            item.tier === "KAUM" ? "opacity-60" : ""
          }`}>
            <div className="flex justify-between items-start">
              <div className="min-w-0">
                <div className="text-xs font-medium text-neutral-900 truncate">
                  {item.product}
                  {item.variant && <span className="text-neutral-400 ml-1">[{item.variant}g]</span>}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                  <span className="text-[10px] text-neutral-500">{item.collection}</span>
                  {item.tier && (
                    <span className={`inline-flex px-1.5 py-0.5 rounded-full text-[9px] font-semibold ${TIER_BADGE[item.tier]}`}>
                      {TIER_LABEL[item.tier]}
                    </span>
                  )}
                  {mode === "critical" && <ReichweiteBadge item={item} compact />}
                  {item.verkauft30d !== undefined && (
                    <span className="text-[9px] text-neutral-400">
                      30T: {item.verkauft30d}g · 90T: {item.verkauft90d ?? 0}g
                    </span>
                  )}
                </div>
              </div>
              <div className="text-right shrink-0 ml-3">
                <LagerBadge lagerG={item.lagerG} stufe={item.stufe} />
              </div>
            </div>
            {item.unterwegsG > 0 && (
              <div className="mt-2">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-cyan-50 text-cyan-700">
                  <Truck size={10} /> {item.unterwegsG}g unterwegs
                </span>
                {item.perOrder.length > 0 && (
                  <div className="mt-1 space-y-0.5">
                    {item.perOrder.map((o, j) => {
                      const meta = orderIdByName?.[o.name];
                      const line = (
                        <>
                          {o.name}: {o.menge}g {o.ankunft && `· ${o.ankunft}`}
                        </>
                      );
                      return (
                        <div key={j} className="flex items-center gap-1">
                          {meta?.id ? (
                            <Link href={`/orders/${meta.id}`} className="text-xs text-indigo-600 hover:underline">{line}</Link>
                          ) : (
                            <div className="text-xs text-neutral-500">{line}</div>
                          )}
                          {meta?.trackingUrl && (
                            <a
                              href={meta.trackingUrl}
                              target="_blank"
                              rel="noreferrer"
                              title={meta.trackingNumber ? `Sendung verfolgen: ${meta.trackingNumber}` : "Sendung verfolgen"}
                              className="inline-flex items-center px-1 py-0.5 rounded bg-yellow-400 text-yellow-900 hover:bg-yellow-300"
                            >
                              <Truck size={10} />
                            </a>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
          );
        })}
      </div>

      {/* Desktop */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-neutral-50/60 text-left text-[10px] uppercase text-neutral-500">
            <tr>
              <th className="px-2 py-1.5 font-medium">Kollektion</th>
              <th className="px-2 py-1.5 font-medium">Produkt</th>
              {mode === "critical" && <th className="px-2 py-1.5 font-medium">Rang</th>}
              {mode === "critical" && <th className="px-2 py-1.5 font-medium text-right" title="Verkauf letzte 30 Tage">30T</th>}
              {mode === "critical" && <th className="px-2 py-1.5 font-medium text-right" title="Verkauf letzte 90 Tage">90T</th>}
              {mode === "critical" && <th className="px-2 py-1.5 font-medium text-right" title="Reichweite des Lagers in Tagen (+ Tage durch Bestellungen) — verglichen mit Lieferzeit und Ankunft">Reichw.</th>}
              <th className="px-2 py-1.5 font-medium text-right">Lager</th>
              <th className="px-2 py-1.5 font-medium text-right">Unterwegs</th>
              <th className="px-2 py-1.5 font-medium">Bestellungen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {items.map((item, i) => {
              const tier = item.tier;
              const isKaum = tier === "KAUM";
              const status = mode === "critical" ? statusOf(item) : "ok";
              return (
              <tr
                key={i}
                className={`hover:bg-indigo-100 hover:shadow-[inset_3px_0_0_0_rgb(79_70_229)] transition ${
                  mode === "critical" && status === "akut" ? "bg-red-50/50" :
                  mode === "critical" && status === "luecke" ? "bg-violet-50/50" :
                  mode === "critical" && status === "knapp" ? "bg-orange-50/40" :
                  mode === "critical" && tier === "TOP7" && item.lagerG < 600 ? "bg-yellow-50/40" :
                  mode === "critical" && item.stufe === "kritisch" && !isKaum ? "bg-orange-50/30" :
                  mode === "zero" && item.unterwegsG === 0 ? "bg-yellow-50/30" :
                  isKaum ? "opacity-60" : ""
                }`}
              >
                <td className="px-2 py-1 text-neutral-500">{item.collection}</td>
                <td className="px-2 py-1 font-medium text-neutral-900 max-w-[250px] truncate" title={item.product}>
                  {item.product}
                  {item.variant && <span className="text-neutral-400 ml-1">[{item.variant}g]</span>}
                </td>
                {mode === "critical" && (
                  <td className="px-2 py-1">
                    {tier ? (
                      <span className={`inline-flex px-1.5 py-0.5 rounded-full text-[9px] font-semibold ${TIER_BADGE[tier]}`}>
                        {TIER_LABEL[tier]}
                      </span>
                    ) : (
                      <span className="text-neutral-300 text-[10px]">–</span>
                    )}
                  </td>
                )}
                {mode === "critical" && (
                  <td className="px-2 py-1 text-right text-neutral-500">
                    <VerkaufCell value={item.verkauft30d} />
                  </td>
                )}
                {mode === "critical" && (
                  <td className="px-2 py-1 text-right text-neutral-500">
                    <VerkaufCell value={item.verkauft90d} />
                  </td>
                )}
                {mode === "critical" && (
                  <td className="px-2 py-1 text-right">
                    <ReichweiteBadge item={item} />
                  </td>
                )}
                <td className="px-2 py-1 text-right">
                  <LagerBadge lagerG={item.lagerG} stufe={item.stufe} />
                </td>
                <td className="px-2 py-1 text-right">
                  {item.unterwegsG > 0 ? (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-cyan-50 text-cyan-700">
                      {item.unterwegsG}g
                    </span>
                  ) : (
                    <span className="text-neutral-300">–</span>
                  )}
                </td>
                <td className="px-2 py-1">
                  {item.perOrder.length > 0 ? (
                    <div className="flex flex-wrap gap-0.5">
                      {item.perOrder.map((o, j) => {
                        const meta = orderIdByName?.[o.name];
                        const tooltip = `${o.name}: ${o.menge}g${o.ankunft ? ` — ${o.ankunft}` : ""}${meta?.id ? " · Bestellung öffnen" : ""}`;
                        const content = (
                          <>
                            <span className="font-semibold">{o.menge}g</span>
                            <span className="text-indigo-400">·</span>
                            <span className="text-indigo-500 truncate max-w-[100px]">{o.name}</span>
                            {o.ankunft && <span className="text-indigo-400 whitespace-nowrap">· {o.ankunft}</span>}
                          </>
                        );
                        return (
                          <span
                            key={j}
                            className="inline-flex items-stretch rounded overflow-hidden border border-indigo-100 hover:border-indigo-300 transition"
                          >
                            {meta?.id ? (
                              <Link
                                href={`/orders/${meta.id}`}
                                title={tooltip}
                                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium bg-indigo-50 text-indigo-700 hover:bg-indigo-100 transition"
                              >
                                {content}
                              </Link>
                            ) : (
                              <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] font-medium bg-indigo-50 text-indigo-700" title={tooltip}>
                                {content}
                              </span>
                            )}
                            {meta?.trackingUrl && (
                              <a
                                href={meta.trackingUrl}
                                target="_blank"
                                rel="noreferrer"
                                onClick={(e) => e.stopPropagation()}
                                title={meta.trackingNumber ? `Sendung verfolgen: ${meta.trackingNumber}` : "Sendung verfolgen"}
                                className="inline-flex items-center px-1 bg-yellow-400 text-yellow-900 hover:bg-yellow-300 border-l border-yellow-500"
                              >
                                <Truck size={10} />
                              </a>
                            )}
                          </span>
                        );
                      })}
                    </div>
                  ) : (
                    <span className="text-[10px] text-red-300 font-medium">Keine Bestellung!</span>
                  )}
                </td>
              </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function LagerBadge({ lagerG, stufe }: { lagerG: number; stufe?: "kritisch" | "niedrig" }) {
  if (lagerG === 0) {
    return <span className="inline-flex px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700">0g</span>;
  }
  const bg = stufe === "kritisch" ? "bg-orange-100 text-orange-700" : stufe === "niedrig" ? "bg-amber-100 text-amber-700" : "bg-neutral-100 text-neutral-700";
  return <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${bg}`}>{lagerG}g</span>;
}

/** Verkaufs-Zelle: 0 wird sichtbar als "0g" (rot, Ladenhüter-Signal) statt "–".
 *  "–" nur wenn gar kein Topseller-Match existiert (Wert undefined). */
function VerkaufCell({ value }: { value: number | undefined }) {
  if (value === undefined) return <span className="text-neutral-300">–</span>;
  if (value === 0) return <span className="text-red-400 font-medium">0g</span>;
  return <>{value}g</>;
}

function ReichweiteBadge({ item, compact = false }: { item: AlertProduct; compact?: boolean }) {
  const c = item.crit;
  if (!c) return <span className="text-neutral-300 text-[10px]">–</span>;
  if (c.status === "ladenhueter") {
    return (
      <span
        className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-medium bg-neutral-100 text-neutral-500"
        title="Seit 90 Tagen kein Verkauf — Nachbestellung nicht nötig"
      >
        Ladenhüter
      </span>
    );
  }
  if (c.daily === null || c.range === null || c.rangeWithOrder === null) {
    return <span className="text-neutral-300 text-[10px]" title="Keine Verkaufszahlen gefunden">–</span>;
  }
  const color =
    c.status === "akut" ? "bg-red-100 text-red-700" :
    c.status === "luecke" ? "bg-violet-100 text-violet-700" :
    c.status === "knapp" ? "bg-orange-100 text-orange-700" :
    "bg-emerald-50 text-emerald-700";
  const orderInfo = item.unterwegsG > 0 ? ` (+${c.rangeWithOrder - c.range})` : "";
  const tooltip =
    `Lager reicht ${c.range} Tage` +
    (item.unterwegsG > 0 ? ` · mit Bestellungen ${c.rangeWithOrder} Tage` : "") +
    (c.daysToEta !== null ? ` · erste Ankunft in ${c.daysToEta} Tagen` : "") +
    ` · Lieferzeit ${c.leadTime} Tage · Verbrauch ${c.daily.toFixed(1)} g/Tag`;
  return (
    <span className="inline-flex items-center gap-1 justify-end flex-wrap">
      <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${color}`} title={tooltip}>
        {c.range}T{orderInfo}
      </span>
      {c.gapDays !== null && (
        <span
          className={`inline-flex px-1.5 py-0.5 rounded-full font-semibold bg-violet-600 text-white ${compact ? "text-[9px]" : "text-[10px]"}`}
          title={`Lager leer in ~${c.range} Tagen, Bestellung kommt in ~${c.daysToEta} Tagen → ca. ${c.gapDays} Tage ausverkauft`}
        >
          {c.gapDays}T leer
        </span>
      )}
    </span>
  );
}

function KpiCard({ label, value, sub, icon, color }: { label: string; value: string; sub?: string; icon: React.ReactNode; color: "indigo" | "rose" | "emerald" }) {
  const colors = { indigo: "bg-indigo-50 text-indigo-600", rose: "bg-rose-50 text-rose-600", emerald: "bg-emerald-50 text-emerald-600" };
  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-5 shadow-sm">
      <div className="flex items-center justify-between">
        <div className="text-xs text-neutral-500 uppercase tracking-wide">{label}</div>
        <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${colors[color]}`}>{icon}</div>
      </div>
      <div className="mt-2 text-2xl font-semibold text-neutral-900">{value}</div>
      {sub && <div className="text-[11px] text-neutral-500 mt-0.5">{sub}</div>}
    </div>
  );
}
