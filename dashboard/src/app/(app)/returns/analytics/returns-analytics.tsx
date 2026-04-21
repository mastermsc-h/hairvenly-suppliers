"use client";

import { useState, useMemo } from "react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { t, type Locale } from "@/lib/i18n";
import { Package, TrendingDown, Euro, Clock, X, Info } from "lucide-react";

const COLORS = ["#6366f1", "#f43f5e", "#10b981", "#f59e0b", "#06b6d4", "#a855f7", "#ec4899", "#84cc16"];
const TYPE_COLORS: Record<string, string> = {
  return: "#ef4444",
  exchange: "#f97316",
  complaint: "#8b5cf6",
};

interface SummaryRow {
  month: string;
  return_type: string;
  total: number;
  resolved: number;
  total_refund: number | string;
}

interface ReasonRow {
  reason: string;
  return_type: string;
  cnt: number;
}

interface ItemByTypeRow {
  return_id?: string;
  product_type: string;
  length?: string;
  origin?: string;
  quantity?: number;
  refund_amount?: number;
  collection_title?: string;
  return_type: string;
  initiated_at?: string | null;
  reason?: string | null;
}

interface CollectionSalesRow {
  month?: string;
  collection_title: string;
  revenue: number;
  orders: number;
  items: number;
}

type PresetPeriod = "all" | "12m" | "3m" | "30d" | "14d";
type PeriodKey = PresetPeriod | { month: string }; // month = "YYYY-MM"

const PERIOD_LABELS: Record<PresetPeriod, string> = {
  all: "Gesamter Zeitraum",
  "12m": "Letzte 12 Monate",
  "3m": "Letzte 3 Monate",
  "30d": "Letzte 30 Tage",
  "14d": "Letzte 14 Tage",
};

const MONTH_NAMES_DE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

function periodRange(p: PeriodKey): { from: string; to: string } | null {
  if (typeof p === "object" && p.month) {
    const [y, m] = p.month.split("-").map(Number);
    const from = `${y}-${String(m).padStart(2, "0")}-01`;
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const to = `${y}-${String(m).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
    return { from, to };
  }
  if (p === "all") return null;
  const now = new Date();
  const to = now.toISOString().slice(0, 10);
  const d = new Date(now);
  if (p === "12m") d.setMonth(d.getMonth() - 12);
  else if (p === "3m") d.setMonth(d.getMonth() - 3);
  else if (p === "30d") d.setDate(d.getDate() - 30);
  else if (p === "14d") d.setDate(d.getDate() - 14);
  const from = d.toISOString().slice(0, 10);
  return { from, to };
}

function fmtDateDE(iso: string | null | undefined): string {
  if (!iso) return "";
  const s = String(iso).slice(0, 10);
  const [y, m, d] = s.split("-");
  if (!y || !m || !d) return s;
  return `${parseInt(d, 10)}.${parseInt(m, 10)}.${y}`;
}

// Detect origin: Russisch (straight) vs Usbekisch (wavy)
function detectOrigin(text: string, originField?: string): "Russisch" | "Usbekisch" | "" {
  const up = (text + " " + (originField ?? "")).toUpperCase();
  if (/RUSSISCH|\bGLATT\b|\bRU\b/.test(up)) return "Russisch";
  if (/USBEKISCH|\bWELLIG|\bUS\b/.test(up)) return "Usbekisch";
  return "";
}

// Detect length: 45/55/63/65/85 cm
function detectLength(text: string, lengthField?: string): string {
  if (lengthField && /\d{2}\s*cm/i.test(lengthField)) {
    const m = lengthField.match(/(\d{2})\s*cm/i);
    if (m) return `${m[1]}cm`;
  }
  const m = text.match(/(\d{2})\s*CM/i);
  return m ? `${m[1]}cm` : "";
}

// Detect base category — ORDER MATTERS: accessories first so they don't
// get swallowed by the TAPE/BONDING regex (e.g. "KLEBER FÜR TAPE EXTENSIONS")
function baseCategory(text: string): string {
  const up = text.toUpperCase();
  // ── Accessories / care products (must be checked BEFORE TAPE/BONDING) ──
  if (/KLEBER|TAPEKLEBER/.test(up)) return "Kleber";
  if (/REMOVER/.test(up)) return "Remover";
  if (/B(Ü|UE)RSTE|BRUSH/.test(up)) return "Bürsten";
  if (/SHAMPOO|CONDITIONER|SPÜLUNG|SPRAY|TREATMENT|MASK|SERUM|PFLEGE/.test(up)) return "Pflege";
  if (/FARBRING|COLOR RING/.test(up)) return "Farbring";
  // ── Hair extension categories ────────────────────────────────────────
  if (/MINI.*TAPE|MINITAPE/.test(up)) return "Mini Tapes";
  if (/\bTAPE/.test(up)) return "Tapes";
  if (/BONDING/.test(up)) return "Bondings";
  if (/CLIP/.test(up)) return "Clip ins";
  if (/PONYTAIL/.test(up)) return "Ponytails";
  if (/GENIUS/.test(up)) return "Genius Tressen";
  if (/INVISIBLE/.test(up)) return "Invisible Tressen";
  if (/CLASSIC.*TRESS|TRESS.*CLASSIC/.test(up)) return "Classic Tressen";
  if (/TRESS|WEFT/.test(up)) return "Tressen";
  if (/EXTENSION/.test(up)) return "Extensions";
  return "Sonstige";
}

// Categories that are accessories — no origin/length splitting
const ACCESSORY_CATEGORIES = new Set(["Kleber", "Remover", "Bürsten", "Pflege", "Farbring", "Clip ins", "Ponytails", "Sonstige"]);

// Relevant Shopify collections (mirror of the tabs "Russisch - GLATT" and
// "Usbekisch - WELLIG" in the stock sheets). Broad parent collections
// (e.g. "Best Selling Products", "Tressen Extensions", "Usbekische Tapes")
// are NOT relevant — they overlap with the specific ones.
const RELEVANT_COLLECTIONS = new Set([
  // Russisch GLATT
  "Standard Tapes Russisch",
  "Russische Tapes (Glatt)",
  "Mini Tapes Glatt",
  "Russische Bondings (Glatt)",
  "Russische Classic Tressen (Glatt)",
  "Russische Genius Tressen (Glatt)",
  "Russische Invisible Tressen (Glatt)",
  "Russische Invisible Tressen / Butterfly Weft",
  "Clip In Extensions Echthaar",
  "Clip in Extensions Echthaar",
  // Usbekisch WELLIG
  "Tapes Wellig 45cm",
  "Tapes Wellig 55cm",
  "Tapes Wellig 65cm",
  "Tapes Wellig 85cm",
  "Bondings wellig 65cm",
  "Bondings wellig 85cm",
  "Usbekische Classic Tressen (Wellig)",
  "Usbekische Genius Tressen (Wellig)",
  // Ponytails
  "Ponytail Extensions",
  "Ponytail Extensions kaufen",
  // Accessoires / Zubehör
  "Accessoires",
  "Extensions Zubehör",
]);

// Excluded overarching or irrelevant collection titles (case-insensitive substring match)
const EXCLUDED_COLLECTION_PATTERNS = [
  "best selling",
  "bestseller",
  "home",
  "homepage",
  "startseite",
  "sale",
  "unassigned",
  "alle produkte",
  "neu",
  "new arrivals",
  // Parent-level collections that would double-count
  "tressen extensions",
  "usbekische tressen (wellig)",
  "russische tressen (glatt)", // parent, not specific variant
  "usbekische tapes (wellig)",
  "russische tapes (glatt)", // parent — but "Russische Tapes (Glatt)" is allowed above by exact match
];

function isRelevantCollection(title: string): boolean {
  if (!title) return false;
  const t = title.trim();
  // Exact allow-list match wins
  if (RELEVANT_COLLECTIONS.has(t)) return true;
  const lower = t.toLowerCase();
  // Exclude parent/promotional collections
  for (const pattern of EXCLUDED_COLLECTION_PATTERNS) {
    if (lower.includes(pattern)) return false;
  }
  return false;
}

// Normalize heuristic category names to match Shopify collection naming
const HEURISTIC_TO_SHOPIFY: Record<string, string> = {
  "Russische Standard Tapes": "Standard Tapes Russisch",
  "Mini Tapes": "Mini Tapes Glatt",
  "Bondings Russisch": "Russische Bondings (Glatt)",
  "Bondings Usbekisch 65cm": "Bondings wellig 65cm",
  "Bondings Usbekisch 85cm": "Bondings wellig 85cm",
  "Tapes Usbekisch 45cm": "Tapes Wellig 45cm",
  "Tapes Usbekisch 55cm": "Tapes Wellig 55cm",
  "Tapes Usbekisch 65cm": "Tapes Wellig 65cm",
  "Tapes Usbekisch 85cm": "Tapes Wellig 85cm",
  "Genius Tressen Russisch": "Russische Genius Tressen (Glatt)",
  "Genius Tressen Usbekisch": "Usbekische Genius Tressen (Wellig)",
  "Classic Tressen Russisch": "Russische Classic Tressen (Glatt)",
  "Classic Tressen Usbekisch": "Usbekische Classic Tressen (Wellig)",
  "Invisible Tressen Russisch": "Russische Invisible Tressen (Glatt)",
  "Clip ins": "Clip In Extensions Echthaar",
  "Ponytails": "Ponytail Extensions",
  "Kleber": "Extensions Zubehör",
  "Remover": "Extensions Zubehör",
  "Bürsten": "Extensions Zubehör",
  "Pflege": "Extensions Zubehör",
  "Farbring": "Extensions Zubehör",
  "Accessoires": "Accessoires",
};

// Alternate spellings that should be merged into the canonical Shopify name.
// Checked BEFORE the allow-list so duplicates are merged.
const COLLECTION_ALIASES: Record<string, string> = {
  "Ponytail Extensions kaufen": "Ponytail Extensions",
  "Clip in Extensions Echthaar": "Clip In Extensions Echthaar",
  "Russische Invisible Tressen / Butterfly Weft": "Russische Invisible Tressen (Glatt)",
  "Russische Invisible Tressen": "Russische Invisible Tressen (Glatt)",
  "Russische Bondings": "Russische Bondings (Glatt)",
  "Russische Genius Tressen": "Russische Genius Tressen (Glatt)",
  "Russische Classic Tressen": "Russische Classic Tressen (Glatt)",
  "Usbekische Classic Tressen": "Usbekische Classic Tressen (Wellig)",
  "Usbekische Genius Tressen": "Usbekische Genius Tressen (Wellig)",
};

function normalizeCollectionName(raw: string): string | null {
  const t = (raw ?? "").trim();
  if (!t) return null;
  // 1. Apply alias mapping FIRST so "kaufen" / alternate spellings merge
  if (COLLECTION_ALIASES[t]) return COLLECTION_ALIASES[t];
  // 2. Case-insensitive alias match
  const lower = t.toLowerCase();
  for (const [alias, canonical] of Object.entries(COLLECTION_ALIASES)) {
    if (alias.toLowerCase() === lower) return canonical;
  }
  // 3. Exact allow-list match
  if (RELEVANT_COLLECTIONS.has(t)) return t;
  // 4. Heuristic mapping (from raw category name like "Tapes Usbekisch 55cm")
  const mapped = HEURISTIC_TO_SHOPIFY[t];
  if (mapped) return mapped;
  // 5. Filter out non-relevant
  if (!isRelevantCollection(t)) return null;
  return t;
}

// Build detailed category e.g. "Tapes Usbekisch 55cm" or "Bondings Russisch"
function categorize(row: { product_type: string; length?: string; origin?: string }): string {
  const text = row.product_type ?? "";
  const base = baseCategory(text);

  // Accessories & simple categories: no origin/length split
  if (ACCESSORY_CATEGORIES.has(base)) return base;

  const origin = detectOrigin(text, row.origin);
  const length = detectLength(text, row.length);

  // Special case: Russian straight tapes are always "Standard" (no length variants in collection)
  if (base === "Tapes" && origin === "Russisch") return "Russische Standard Tapes";
  if (base === "Mini Tapes") return origin === "Russisch" || origin === "" ? "Mini Tapes" : `Mini Tapes ${origin}`;

  // Tressen variants are already specific enough with origin
  if (base.includes("Tressen")) {
    return origin ? `${base} ${origin}` : base;
  }

  // Tapes / Bondings with origin + length
  const parts = [base];
  if (origin) parts.push(origin);
  if (length) parts.push(length);
  return parts.join(" ");
}

interface ReturnRow {
  return_type: string;
  status: string;
  handler: string | null;
  initiated_at: string | null;
  refund_amount: number | null;
  reason?: string | null;
}

function KPICard({
  icon,
  label,
  value,
  sub,
  info,
  period,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  info?: string;
  period?: string;
}) {
  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm relative">
      <div className="flex items-center gap-3">
        <div className="p-2 bg-neutral-100 rounded-lg">{icon}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <div className="text-xs font-medium text-neutral-500 uppercase tracking-wide">{label}</div>
            {info && (
              <span className="group relative inline-flex">
                <Info size={13} className="text-neutral-400 hover:text-neutral-700 cursor-help" />
                <span className="invisible group-hover:visible opacity-0 group-hover:opacity-100 transition absolute left-full ml-2 top-0 z-20 w-[320px] bg-neutral-900 text-white text-[11px] leading-relaxed rounded-lg px-3 py-2 shadow-lg whitespace-pre-line pointer-events-none">
                  {info}
                </span>
              </span>
            )}
          </div>
          <div className="text-2xl font-semibold text-neutral-900 mt-0.5">{value}</div>
          {sub && <div className="text-xs text-neutral-400">{sub}</div>}
          {period && <div className="text-[11px] text-neutral-400 mt-1">{period}</div>}
        </div>
      </div>
    </div>
  );
}

export default function ReturnsAnalytics({
  summary,
  byReason,
  itemsByType,
  returns,
  totalRevenue,
  collectionSales,
  syncInfo,
  excludedCollections,
  locale,
}: {
  summary: SummaryRow[];
  byReason: ReasonRow[];
  itemsByType: ItemByTypeRow[];
  returns: ReturnRow[];
  totalRevenue: number;
  collectionSales: CollectionSalesRow[];
  syncInfo?: { coverageFrom: string | null; coverageTo: string | null; lastSyncAt: string | null };
  excludedCollections?: string[];
  locale: Locale;
}) {
  // ── Period selector — all metrics respect this ─────────────
  const [period, setPeriod] = useState<PeriodKey>("all");
  // Mode toggle: "ext" excludes non-extension collections (default),
  // "all" includes every collection (accessories, care products, etc.).
  const [scopeMode, setScopeMode] = useState<"ext" | "all">("ext");
  const range = useMemo(() => periodRange(period), [period]);
  const inRange = (d: string | null | undefined): boolean => {
    if (!range) return true;
    if (!d) return false;
    const day = String(d).slice(0, 10);
    return day >= range.from && day <= range.to;
  };
  const filteredItems = useMemo(() => itemsByType.filter((i) => inRange(i.initiated_at)), [itemsByType, range]);
  const filteredReturns = useMemo(() => returns.filter((r) => inRange(r.initiated_at)), [returns, range]);
  const filteredSales = useMemo(() => {
    if (!range) return collectionSales;
    return collectionSales.filter((s) => {
      const monthStr = s.month ?? "";
      if (!monthStr) return true;
      const monthStart = monthStr.slice(0, 7) + "-01";
      const next = new Date(monthStart + "T00:00:00Z");
      next.setUTCMonth(next.getUTCMonth() + 1);
      const monthEnd = next.toISOString().slice(0, 10);
      return monthStart <= range.to && monthEnd > range.from;
    });
  }, [collectionSales, range]);
  const filteredTotalRevenue = useMemo(() => {
    const EXCLUDED = scopeMode === "ext" ? new Set([
      "Extensions Zubehör", "Blessed Haarpflege", "Sonstige Haarpflege",
      "Haarpflegeprodukte", "Accessoires", "Unassigned",
      "Newest Products", "Newest", "Neuste Produkte",
      "Hairvenly Extension Schulungen", "Best Selling Products",
    ]) : new Set<string>();
    if (!range) {
      return filteredSales.filter((s) => !EXCLUDED.has(s.collection_title))
        .reduce((sum, s) => sum + s.revenue, 0);
    }
    const perMonth = new Map<string, number>();
    for (const s of filteredSales) {
      if (EXCLUDED.has(s.collection_title)) continue;
      const key = (s.month ?? "").slice(0, 7);
      if (!key) continue;
      perMonth.set(key, (perMonth.get(key) ?? 0) + s.revenue);
    }
    let total = 0;
    for (const [monthKey, revenue] of perMonth) {
      const monthStart = monthKey + "-01";
      const next = new Date(monthStart + "T00:00:00Z");
      next.setUTCMonth(next.getUTCMonth() + 1);
      const monthEnd = next.toISOString().slice(0, 10);
      const effStart = monthStart > range.from ? monthStart : range.from;
      const effEnd = monthEnd < range.to ? monthEnd : range.to;
      if (effEnd <= effStart) continue;
      const monthDays = (new Date(monthEnd).getTime() - new Date(monthStart).getTime()) / 86400000;
      const effDays = (new Date(effEnd).getTime() - new Date(effStart).getTime()) / 86400000;
      const frac = monthDays > 0 ? effDays / monthDays : 1;
      total += revenue * frac;
    }
    return total;
  }, [filteredSales, range]);

  // Drill-down state: which category is selected
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  // ── KPIs ───────────────────────────────────────────────────
  // Collections to exclude from KPI totals when mode is "ext".
  const KPI_EXCLUDED = scopeMode === "ext" ? new Set([
    "Extensions Zubehör", "Blessed Haarpflege", "Sonstige Haarpflege",
    "Haarpflegeprodukte", "Accessoires", "Unassigned",
    "Newest Products", "Newest", "Neuste Produkte",
    "Hairvenly Extension Schulungen", "Best Selling Products",
  ]) : new Set<string>();

  // Gross refund € = sum of per-item refund_amount (subtotalSet basis = gross sales basis)
  // filtered to same collection set as totalRevenue.
  const isExcludedFromKpi = (item: ItemByTypeRow): boolean => {
    const cat = item.collection_title?.trim();
    if (cat && KPI_EXCLUDED.has(cat)) return true;
    return false;
  };
  const grossRefund = filteredItems
    .filter((i) => !isExcludedFromKpi(i))
    .reduce((sum, i) => sum + Math.max(0, Number(i.refund_amount ?? 0)), 0);

  const totalReturns = filteredReturns.length;
  const resolved = filteredReturns.filter((r) => r.status === "resolved").length;
  const open = filteredReturns.filter((r) => r.status === "open" || r.status === "in_progress").length;

  // Return rate uses the period-adjusted total revenue
  const effectiveTotalRevenue = range ? filteredTotalRevenue : totalRevenue;
  const returnRate = effectiveTotalRevenue > 0 ? (grossRefund / effectiveTotalRevenue) * 100 : 0;
  const refundsWithAmount = filteredReturns.filter((r) => r.refund_amount != null && r.refund_amount > 0);
  const avgRefund = refundsWithAmount.length > 0
    ? refundsWithAmount.reduce((sum, r) => sum + (r.refund_amount ?? 0), 0) / refundsWithAmount.length
    : 0;
  const totalRefund = filteredReturns.reduce((sum, r) => sum + (r.refund_amount ?? 0), 0);

  // ── Monthly trend data ─────────────────────────────────────
  const monthlyMap = new Map<string, { month: string; return: number; exchange: number; complaint: number; refund: number }>();
  const filteredSummary = range
    ? summary.filter((s) => {
        const key = (s.month ?? "").slice(0, 7);
        if (!key) return false;
        const monthStart = key + "-01";
        return monthStart <= range.to && monthStart >= range.from.slice(0, 7) + "-01";
      })
    : summary;
  for (const row of filteredSummary) {
    const key = row.month?.split("T")[0]?.slice(0, 7) ?? "";
    if (!key) continue;
    const existing = monthlyMap.get(key) ?? { month: key, return: 0, exchange: 0, complaint: 0, refund: 0 };
    existing[row.return_type as "return" | "exchange" | "complaint"] = row.total;
    existing.refund += Number(row.total_refund ?? 0);
    monthlyMap.set(key, existing);
  }
  const monthlyData = Array.from(monthlyMap.values()).sort((a, b) => a.month.localeCompare(b.month));

  // Format month labels
  const formatMonth = (m: string) => {
    const [y, mo] = m.split("-");
    const months = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
    return `${months[parseInt(mo, 10) - 1]} ${y?.slice(2)}`;
  };

  // ── Reasons pie data ───────────────────────────────────────
  // Build reasonMap from filtered returns so the pie chart respects the period
  const reasonMap = new Map<string, number>();
  if (range) {
    for (const r of filteredReturns) {
      const key = r.reason ?? "ohne_grundangabe";
      reasonMap.set(key, (reasonMap.get(key) ?? 0) + 1);
    }
  } else {
    for (const row of byReason) {
      reasonMap.set(row.reason, (reasonMap.get(row.reason) ?? 0) + row.cnt);
    }
  }
  const reasonData = Array.from(reasonMap.entries())
    .map(([reason, count]) => ({ name: t(locale, `returns.reason.${reason}`), value: count }))
    .sort((a, b) => b.value - a.value);

  // ── Category data: prefer real Shopify collection_title, fall back to heuristic.
  // Normalize all category names to the canonical Shopify collection set.
  const pickCategory = (item: ItemByTypeRow): string | null => {
    // Try Shopify's actual collection_title first
    if (item.collection_title && item.collection_title.trim()) {
      const n = normalizeCollectionName(item.collection_title);
      if (n) return n;
      // If collection_title is not in the allow-list, fall through to heuristic
    }
    // Heuristic fallback for items without a Shopify collection_title
    return normalizeCollectionName(categorize(item));
  };

  // Build sales lookup (with normalization so names match)
  // Prorate revenue for partial-month overlaps when a period is active
  const salesByCollection = new Map<string, CollectionSalesRow>();
  for (const s of filteredSales) {
    const normalized = normalizeCollectionName(s.collection_title);
    if (!normalized) continue;
    let factor = 1;
    if (range && s.month) {
      const monthStart = s.month.slice(0, 7) + "-01";
      const next = new Date(monthStart + "T00:00:00Z");
      next.setUTCMonth(next.getUTCMonth() + 1);
      const monthEnd = next.toISOString().slice(0, 10);
      const effStart = monthStart > range.from ? monthStart : range.from;
      const effEnd = monthEnd < range.to ? monthEnd : range.to;
      if (effEnd <= effStart) continue;
      const monthDays = (new Date(monthEnd).getTime() - new Date(monthStart).getTime()) / 86400000;
      const effDays = (new Date(effEnd).getTime() - new Date(effStart).getTime()) / 86400000;
      factor = monthDays > 0 ? effDays / monthDays : 1;
    }
    const existing = salesByCollection.get(normalized);
    if (existing) {
      existing.revenue += s.revenue * factor;
      existing.orders += s.orders * factor;
      existing.items += s.items * factor;
    } else {
      salesByCollection.set(normalized, { ...s, collection_title: normalized, revenue: s.revenue * factor, orders: s.orders * factor, items: s.items * factor });
    }
  }

  // Euro-based aggregation: sum refund_amount per collection; rate = refund € / gross sales €
  const categoryMap = new Map<string, {
    name: string;
    return: number; exchange: number; complaint: number; total: number;  // item counts (for display)
    refundEur: number;                                                    // refund € per collection
    salesEur: number;                                                     // gross sales €
    rate: number | null;
  }>();
  for (const item of filteredItems) {
    const cat = pickCategory(item);
    if (!cat) continue;
    const qty = Math.max(1, item.quantity ?? 1);
    const refund = Math.max(0, Number(item.refund_amount ?? 0));
    const existing = categoryMap.get(cat) ?? {
      name: cat,
      return: 0, exchange: 0, complaint: 0, total: 0,
      refundEur: 0, salesEur: 0, rate: null,
    };
    const key = item.return_type as "return" | "exchange" | "complaint";
    if (key === "return" || key === "exchange" || key === "complaint") {
      existing[key] += qty;
    }
    existing.total += qty;
    existing.refundEur += refund;
    categoryMap.set(cat, existing);
  }
  // Attach € rate from sales data
  for (const entry of categoryMap.values()) {
    const sales = salesByCollection.get(entry.name);
    if (sales && sales.revenue > 0) {
      entry.salesEur = sales.revenue;
      entry.rate = (entry.refundEur / sales.revenue) * 100;
    }
  }
  const categoryData = Array.from(categoryMap.values()).sort((a, b) => b.total - a.total);
  const topCategory = categoryData[0];
  // Sort by rate (descending) — only categories with sales data
  const categoriesByRate = categoryData
    .filter((c) => c.rate != null)
    .sort((a, b) => (b.rate ?? 0) - (a.rate ?? 0));
  // Trusted: rate plausible (<= 100%) AND enough revenue (>= €500)
  const trustedByRate = categoriesByRate.filter((c) => (c.rate ?? 0) <= 100 && c.salesEur >= 500);
  const hasSalesData = collectionSales.length > 0;

  // ── Handler workload ───────────────────────────────────────
  const handlerMap = new Map<string, number>();
  for (const r of filteredReturns) {
    if (r.handler) handlerMap.set(r.handler, (handlerMap.get(r.handler) ?? 0) + 1);
  }
  const handlerData = Array.from(handlerMap.entries())
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  // Period selector — filters ALL metrics and charts
  // Breakdown: products within the selected category (memoized).
  // Counts UNIQUE orders (return_id) per product, not line-item quantity —
  // so a single return with 4× of a variant counts as 1 order, not 4.
  const categoryProductBreakdown = useMemo(() => {
    if (!selectedCategory) return [];
    type Entry = {
      name: string;
      return: Set<string>;
      exchange: Set<string>;
      complaint: Set<string>;
      total: Set<string>;
    };
    const productMap = new Map<string, Entry>();
    for (const item of filteredItems) {
      let cat: string | null;
      if (item.collection_title && item.collection_title.trim()) {
        cat = normalizeCollectionName(item.collection_title);
        if (!cat) cat = normalizeCollectionName(categorize(item));
      } else {
        cat = normalizeCollectionName(categorize(item));
      }
      if (cat !== selectedCategory) continue;
      const name = (item.product_type || "—").trim();
      const rid = item.return_id ?? `${name}-fallback-${item.initiated_at ?? ""}`;
      const existing = productMap.get(name) ?? {
        name,
        return: new Set<string>(),
        exchange: new Set<string>(),
        complaint: new Set<string>(),
        total: new Set<string>(),
      };
      const key = item.return_type as "return" | "exchange" | "complaint";
      if (key === "return" || key === "exchange" || key === "complaint") {
        existing[key].add(rid);
      }
      existing.total.add(rid);
      productMap.set(name, existing);
    }
    return Array.from(productMap.values())
      .map((e) => ({
        name: e.name,
        return: e.return.size,
        exchange: e.exchange.size,
        complaint: e.complaint.size,
        total: e.total.size,
      }))
      .sort((a, b) => b.total - a.total);
  }, [selectedCategory, filteredItems]);

  const tooltipStyle = {
    borderRadius: 10,
    border: "1px solid #e5e7eb",
    fontSize: 11,
    padding: "4px 8px",
  };

  return (
    <div className="space-y-6">
      {/* Period selector */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-neutral-500 uppercase tracking-wide mr-1">Umfang:</span>
        <div className="inline-flex rounded-full border border-neutral-200 p-0.5 bg-neutral-50 mr-3">
          <button
            type="button"
            onClick={() => setScopeMode("ext")}
            className={`text-xs font-medium px-3 py-1 rounded-full transition ${
              scopeMode === "ext" ? "bg-neutral-900 text-white" : "text-neutral-600 hover:text-neutral-900"
            }`}
          >
            Nur Extensions
          </button>
          <button
            type="button"
            onClick={() => setScopeMode("all")}
            className={`text-xs font-medium px-3 py-1 rounded-full transition ${
              scopeMode === "all" ? "bg-neutral-900 text-white" : "text-neutral-600 hover:text-neutral-900"
            }`}
          >
            Gesamt
          </button>
        </div>
        <span className="text-xs font-medium text-neutral-500 uppercase tracking-wide mr-1">Zeitraum:</span>
        {(["all", "12m", "3m", "30d", "14d"] as PresetPeriod[]).map((p) => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={`text-xs font-medium px-3 py-1.5 rounded-full transition ${
              typeof period === "string" && period === p
                ? "bg-neutral-900 text-white"
                : "bg-white border border-neutral-200 text-neutral-700 hover:bg-neutral-50"
            }`}
          >
            {PERIOD_LABELS[p]}
          </button>
        ))}
        {(() => {
          const months = new Set<string>();
          for (const r of returns) {
            const k = (r.initiated_at ?? "").slice(0, 7);
            if (k) months.add(k);
          }
          for (const s of collectionSales) {
            const k = (s.month ?? "").slice(0, 7);
            if (k) months.add(k);
          }
          const sorted = Array.from(months).sort((a, b) => b.localeCompare(a));
          const selectedMonth = typeof period === "object" ? period.month : "";
          return (
            <select
              value={selectedMonth}
              onChange={(e) => {
                const v = e.target.value;
                if (v) setPeriod({ month: v });
              }}
              className={`text-xs font-medium px-3 py-1.5 rounded-full transition border cursor-pointer ${
                selectedMonth
                  ? "bg-neutral-900 text-white border-neutral-900"
                  : "bg-white border-neutral-200 text-neutral-700 hover:bg-neutral-50"
              }`}
            >
              <option value="">Monat wählen…</option>
              {sorted.map((m) => {
                const [y, mo] = m.split("-").map(Number);
                return (
                  <option key={m} value={m}>
                    {MONTH_NAMES_DE[mo - 1]} {y}
                  </option>
                );
              })}
            </select>
          );
        })()}
      </div>

      {/* Primary KPIs: Return Rate + Avg Refund */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <KPICard
          icon={<TrendingDown size={18} className="text-red-500" />}
          label={t(locale, "returns.kpi_return_rate")}
          value={effectiveTotalRevenue > 0 ? `${returnRate.toFixed(2)}%` : "—"}
          sub={effectiveTotalRevenue > 0
            ? `${grossRefund.toLocaleString("de-DE", { maximumFractionDigits: 0 })} € / ${effectiveTotalRevenue.toLocaleString("de-DE", { maximumFractionDigits: 0 })} € Gross Sales`
            : t(locale, "returns.no_revenue_data")}
          period={(() => {
            if (range) return `Zeitraum: ${fmtDateDE(range.from)} – ${fmtDateDE(range.to)}`;
            const from = syncInfo?.coverageFrom;
            const to = syncInfo?.coverageTo;
            if (!from || !to) return undefined;
            return `Zeitraum: ${fmtDateDE(from)} – ${fmtDateDE(to)}`;
          })()}
          info={(() => {
            const excl = excludedCollections ?? [];
            const list = excl.length > 0 ? excl.join(", ") : "(keine)";
            return `Nicht-Extension-Collections sind aus Umsatz UND Retouren herausgefiltert:\n\n${list}\n\nDeshalb sind Gross Sales und Retouren niedriger als im Shopify-Admin. Die Rückgabequote bezieht sich ausschließlich auf Extensions-Produkte.`;
          })()}
        />
        <KPICard
          icon={<Euro size={18} className="text-amber-500" />}
          label={t(locale, "returns.kpi_return_price")}
          value={`${avgRefund.toLocaleString("de-DE", { minimumFractionDigits: 2 })} €`}
          sub={`${refundsWithAmount.length} ${t(locale, "returns.kpi_resolved")}`}
        />
      </div>

      {/* Secondary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <KPICard
          icon={<Package size={18} className="text-neutral-600" />}
          label={t(locale, "returns.kpi_total")}
          value={String(totalReturns)}
          sub={`${open} ${t(locale, "returns.kpi_open")}`}
        />
        <KPICard
          icon={<TrendingDown size={18} className="text-emerald-500" />}
          label={t(locale, "returns.kpi_rate")}
          value={totalReturns > 0 ? `${((resolved / totalReturns) * 100).toFixed(0)}%` : "0%"}
          sub={t(locale, "returns.kpi_resolved")}
        />
        <KPICard
          icon={<Euro size={18} className="text-amber-500" />}
          label={t(locale, "returns.kpi_refund")}
          value={`${totalRefund.toLocaleString("de-DE", { minimumFractionDigits: 2 })} €`}
        />
        <KPICard
          icon={<Clock size={18} className="text-blue-500" />}
          label={t(locale, "returns.kpi_open_count")}
          value={String(open)}
          sub={t(locale, "returns.kpi_need_action")}
        />
      </div>

      {/* Charts grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Monthly Trend */}
        <div className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm">
          <h3 className="text-sm font-semibold text-neutral-900 mb-4">{t(locale, "returns.chart_trend")}</h3>
          {monthlyData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={monthlyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="month" tickFormatter={formatMonth} tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={tooltipStyle} labelFormatter={(label) => formatMonth(String(label))} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="return" name={t(locale, "returns.type.return")} fill="#ef4444" radius={[4, 4, 0, 0]} />
                <Bar dataKey="exchange" name={t(locale, "returns.type.exchange")} fill="#f97316" radius={[4, 4, 0, 0]} />
                <Bar dataKey="complaint" name={t(locale, "returns.type.complaint")} fill="#8b5cf6" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[280px] flex items-center justify-center text-sm text-neutral-400">
              {t(locale, "returns.no_data")}
            </div>
          )}
        </div>

        {/* Reasons Pie */}
        <div className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm">
          <h3 className="text-sm font-semibold text-neutral-900 mb-4">{t(locale, "returns.chart_reasons")}</h3>
          {reasonData.length > 0 ? (
            <div className="flex items-center gap-4">
              <ResponsiveContainer width="50%" height={280}>
                <PieChart>
                  <Pie data={reasonData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90} paddingAngle={2} stroke="none">
                    {reasonData.map((_, i) => (
                      <Cell key={i} fill={COLORS[i % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip contentStyle={tooltipStyle} />
                </PieChart>
              </ResponsiveContainer>
              <ul className="text-xs space-y-1.5 flex-1">
                {reasonData.map((d, i) => (
                  <li key={d.name} className="flex items-center gap-2">
                    <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: COLORS[i % COLORS.length] }} />
                    <span className="truncate">{d.name}</span>
                    <span className="ml-auto font-medium text-neutral-700">{d.value}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="h-[280px] flex items-center justify-center text-sm text-neutral-400">
              {t(locale, "returns.no_data")}
            </div>
          )}
        </div>

        {/* Rate-per-Collection (only when sales data is available) */}
        {hasSalesData && categoriesByRate.length > 0 && (
          <div className="lg:col-span-2 bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold text-neutral-900">Rückgabequote pro Collection</h3>
                <p className="text-[11px] text-neutral-400 mt-0.5">Sortiert nach Quote — zeigt problematische Collections</p>
              </div>
              {trustedByRate[0] && (
                <p className="text-xs text-neutral-400">
                  Höchste: <span className="font-medium text-red-600">{trustedByRate[0].name}</span> ({(trustedByRate[0].rate ?? 0).toFixed(1)}%)
                </p>
              )}
            </div>
            <div className="max-h-[400px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500 sticky top-0">
                  <tr>
                    <th className="px-4 py-2 font-medium">Collection</th>
                    <th className="px-3 py-2 font-medium text-right">Rückgaben €</th>
                    <th className="px-3 py-2 font-medium text-right">Gross Sales €</th>
                    <th className="px-4 py-2 font-medium text-right">Quote</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-neutral-100">
                  {categoriesByRate.map((c) => {
                    const rate = c.rate ?? 0;
                    const salesEur = Number(c.salesEur ?? 0);
                    const refundEur = Number(c.refundEur ?? 0);
                    const suspicious = rate > 100 || salesEur < 500;
                    const eur = (n: number) => `${Number(n ?? 0).toLocaleString("de-DE", { minimumFractionDigits: 0, maximumFractionDigits: 0 })} €`;
                    return (
                      <tr
                        key={c.name}
                        className="hover:bg-neutral-50 cursor-pointer"
                        onClick={() => setSelectedCategory(c.name)}
                      >
                        <td className="px-4 py-2 text-neutral-800">
                          {c.name}
                          {suspicious && <span className="ml-1 text-[10px] text-amber-500" title="Verdächtig: Gross Sales unter €500 oder Mapping ungenau">⚠️</span>}
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-neutral-700">{eur(refundEur)}</td>
                        <td className="px-3 py-2 text-right tabular-nums text-neutral-500">{eur(salesEur)}</td>
                        <td className={`px-4 py-2 text-right tabular-nums font-semibold ${
                          suspicious ? "text-neutral-400" :
                          rate >= 20 ? "text-red-600" :
                          rate >= 15 ? "text-amber-600" : "text-neutral-700"
                        }`}>
                          {rate.toFixed(1)}%
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Categories — bar chart with rate (quote) when sales data is present */}
        <div className="lg:col-span-2 bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-sm font-semibold text-neutral-900">
                {hasSalesData ? "Rückgabequote pro Kategorie" : t(locale, "returns.chart_categories")}
              </h3>
              <p className="text-[11px] text-neutral-400 mt-0.5">Klick auf Kategorie → Produkt-Details</p>
            </div>
            {topCategory && (
              <p className="text-xs text-neutral-400">
                {hasSalesData ? "Top-Quote" : "Top"}:{" "}
                <span className="font-medium text-neutral-700">
                  {hasSalesData && trustedByRate[0] ? trustedByRate[0].name : topCategory.name}
                </span>
                {hasSalesData && trustedByRate[0]?.rate != null
                  ? ` (${(trustedByRate[0].rate).toFixed(1)}%)`
                  : ` (${topCategory.total})`}
              </p>
            )}
          </div>
          {(() => {
            // If we have sales data, show quote-based chart; otherwise fall back to absolute counts
            type ChartRow = {
              name: string;
              rate?: number;
              total: number;
              refundEur?: number;
              salesEur?: number;
              return?: number;
              exchange?: number;
              complaint?: number;
            };
            const chartRows: ChartRow[] = hasSalesData
              ? trustedByRate.map((c) => ({
                  name: c.name,
                  rate: Number((c.rate ?? 0).toFixed(2)),
                  total: c.total,
                  refundEur: c.refundEur,
                  salesEur: c.salesEur,
                }))
              : categoryData.map((c) => ({
                  name: c.name,
                  return: c.return,
                  exchange: c.exchange,
                  complaint: c.complaint,
                  total: c.total,
                }));
            if (chartRows.length === 0) {
              return (
                <div className="h-[280px] flex items-center justify-center text-sm text-neutral-400">
                  {t(locale, "returns.no_data")}
                </div>
              );
            }
            return (
              <ResponsiveContainer width="100%" height={Math.max(280, chartRows.length * 26 + 60)}>
                <BarChart
                  data={chartRows}
                  layout="vertical"
                  margin={{ left: 8, right: 8 }}
                  onClick={(state: unknown) => {
                    const s = state as { activeLabel?: string } | null;
                    if (s?.activeLabel) setSelectedCategory(s.activeLabel);
                  }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                  <XAxis
                    type="number"
                    tick={{ fontSize: 11 }}
                    tickFormatter={hasSalesData ? (v) => `${v}%` : undefined}
                  />
                  <YAxis type="category" dataKey="name" tick={{ fontSize: 11, cursor: "pointer" }} width={170} />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    cursor={{ fill: "rgba(0,0,0,0.03)" }}
                    formatter={(value, _name, entry) => {
                      const key = entry?.dataKey;
                      if (key === "rate") {
                        const row = entry?.payload as { refundEur: number; salesEur: number } | undefined;
                        const eur = (n: number) => `${n.toLocaleString("de-DE", { maximumFractionDigits: 0 })} €`;
                        return [`${value}%${row ? ` · ${eur(row.refundEur)} / ${eur(row.salesEur)}` : ""}`, "Quote"];
                      }
                      const typeLabel = key === "return"
                        ? t(locale, "returns.type.return")
                        : key === "exchange"
                        ? t(locale, "returns.type.exchange")
                        : t(locale, "returns.type.complaint");
                      return [value, typeLabel];
                    }}
                  />
                  {hasSalesData ? (
                    <Bar dataKey="rate" name="Quote" fill="#ef4444" radius={[0, 4, 4, 0]} style={{ cursor: "pointer" }} />
                  ) : (
                    <>
                      <Legend wrapperStyle={{ fontSize: 11 }} />
                      <Bar dataKey="return" stackId="a" name={t(locale, "returns.type.return")} fill={TYPE_COLORS.return} style={{ cursor: "pointer" }} />
                      <Bar dataKey="exchange" stackId="a" name={t(locale, "returns.type.exchange")} fill={TYPE_COLORS.exchange} style={{ cursor: "pointer" }} />
                      <Bar dataKey="complaint" stackId="a" name={t(locale, "returns.type.complaint")} fill={TYPE_COLORS.complaint} radius={[0, 4, 4, 0]} style={{ cursor: "pointer" }} />
                    </>
                  )}
                </BarChart>
              </ResponsiveContainer>
            );
          })()}
        </div>

        {/* Handler Workload */}
        <div className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm">
          <h3 className="text-sm font-semibold text-neutral-900 mb-4">{t(locale, "returns.chart_handlers")}</h3>
          {handlerData.length > 0 ? (
            <ResponsiveContainer width="100%" height={280}>
              <BarChart data={handlerData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip contentStyle={tooltipStyle} />
                <Bar dataKey="count" name={t(locale, "returns.chart_count")} fill="#10b981" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-[280px] flex items-center justify-center text-sm text-neutral-400">
              {t(locale, "returns.no_data")}
            </div>
          )}
        </div>
      </div>

      {/* Category drill-down modal */}
      {selectedCategory && (
        <div
          className="fixed inset-0 bg-black/40 flex items-start justify-center pt-[5vh] z-50 overflow-y-auto"
          onClick={() => setSelectedCategory(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl w-full max-w-3xl mx-4 my-8 overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-6 border-b border-neutral-200 flex items-start justify-between">
              <div>
                <div className="text-xs font-medium text-neutral-500 uppercase tracking-wide">Kategorie</div>
                <h2 className="text-lg font-semibold text-neutral-900 mt-1">{selectedCategory}</h2>
                <p className="text-xs text-neutral-500 mt-1">
                  {categoryProductBreakdown.length} {categoryProductBreakdown.length === 1 ? "Produkt" : "Produkte"} ·
                  {" "}{(() => {
                    const uniqueOrders = new Set<string>();
                    for (const item of filteredItems) {
                      let cat: string | null;
                      if (item.collection_title && item.collection_title.trim()) {
                        cat = normalizeCollectionName(item.collection_title);
                        if (!cat) cat = normalizeCollectionName(categorize(item));
                      } else {
                        cat = normalizeCollectionName(categorize(item));
                      }
                      if (cat !== selectedCategory) continue;
                      if (item.return_id) uniqueOrders.add(item.return_id);
                    }
                    return uniqueOrders.size;
                  })()} Bestellungen gesamt
                </p>
              </div>
              <button
                onClick={() => setSelectedCategory(null)}
                className="p-1.5 text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100 rounded-lg transition"
              >
                <X size={18} />
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto">
              {categoryProductBreakdown.length === 0 ? (
                <div className="p-8 text-center text-sm text-neutral-400">
                  {t(locale, "returns.no_data")}
                </div>
              ) : (
                <table className="w-full text-sm">
                  <thead className="bg-neutral-50 text-left text-xs uppercase text-neutral-500 sticky top-0">
                    <tr>
                      <th className="px-4 py-2 font-medium">Produkt</th>
                      <th className="px-3 py-2 font-medium text-right">Rücksendung</th>
                      <th className="px-3 py-2 font-medium text-right">Umtausch</th>
                      <th className="px-3 py-2 font-medium text-right">Reklamation</th>
                      <th className="px-4 py-2 font-medium text-right">Bestellungen</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-100">
                    {categoryProductBreakdown.map((p) => (
                      <tr key={p.name} className="hover:bg-neutral-50">
                        <td className="px-4 py-2 text-neutral-800 text-xs" title={p.name}>
                          {p.name}
                        </td>
                        <td className="px-3 py-2 text-right text-red-600 tabular-nums">
                          {p.return > 0 ? p.return : "—"}
                        </td>
                        <td className="px-3 py-2 text-right text-orange-600 tabular-nums">
                          {p.exchange > 0 ? p.exchange : "—"}
                        </td>
                        <td className="px-3 py-2 text-right text-purple-600 tabular-nums">
                          {p.complaint > 0 ? p.complaint : "—"}
                        </td>
                        <td className="px-4 py-2 text-right font-semibold text-neutral-900 tabular-nums">
                          {p.total}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
