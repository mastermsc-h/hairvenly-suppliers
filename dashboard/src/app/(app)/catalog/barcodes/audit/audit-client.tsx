"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, AlertTriangle, Copy, FileX, AlertCircle, ExternalLink, Search, ShieldAlert } from "lucide-react";
import type { AuditReport, BarcodeIssue, DuplicateGroup } from "@/lib/barcode-audit";
import type { AuditVariant } from "@/lib/shopify";

type Tab = "duplicates" | "missing" | "format" | "checksum" | "suspicious";

export default function AuditClient({ report, shopDomain }: { report: AuditReport; shopDomain: string }) {
  const [tab, setTab] = useState<Tab>(initialTab(report));
  const [search, setSearch] = useState("");

  const totalIssues =
    report.duplicates.length +
    report.missing.length +
    report.invalidFormat.length +
    report.invalidChecksum.length +
    report.suspicious.length;

  return (
    <div className="p-4 md:p-6 max-w-6xl">
      <Link href="/catalog/barcodes" className="inline-flex items-center gap-1 text-sm text-neutral-500 hover:text-neutral-900 mb-4">
        <ArrowLeft size={14} /> Zurück zu Barcodes
      </Link>

      <header className="mb-5">
        <h1 className="text-2xl font-semibold text-neutral-900">Barcode-Audit</h1>
        <p className="text-sm text-neutral-500 mt-1">
          {report.totalVariants.toLocaleString("de-DE")} Varianten geprüft · {report.totalWithBarcode.toLocaleString("de-DE")} mit Barcode ·{" "}
          {totalIssues === 0 ? (
            <span className="text-emerald-600 font-medium">keine Probleme gefunden ✓</span>
          ) : (
            <span className="text-rose-600 font-medium">{totalIssues} Probleme gefunden</span>
          )}
        </p>
      </header>

      {/* Stat Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 mb-5">
        <StatCard
          active={tab === "duplicates"}
          color="rose"
          icon={<Copy size={16} />}
          label="Duplikate"
          count={report.duplicates.length}
          subtext={report.duplicates.reduce((s, d) => s + d.variants.length, 0) + " Varianten"}
          onClick={() => setTab("duplicates")}
        />
        <StatCard
          active={tab === "missing"}
          color="amber"
          icon={<FileX size={16} />}
          label="Ohne Barcode"
          count={report.missing.length}
          onClick={() => setTab("missing")}
        />
        <StatCard
          active={tab === "format"}
          color="orange"
          icon={<AlertTriangle size={16} />}
          label="Format-Fehler"
          count={report.invalidFormat.length}
          onClick={() => setTab("format")}
        />
        <StatCard
          active={tab === "checksum"}
          color="purple"
          icon={<ShieldAlert size={16} />}
          label="Prüfziffer-Fehler"
          count={report.invalidChecksum.length}
          onClick={() => setTab("checksum")}
        />
        <StatCard
          active={tab === "suspicious"}
          color="blue"
          icon={<AlertCircle size={16} />}
          label="Verdächtig"
          count={report.suspicious.length}
          onClick={() => setTab("suspicious")}
        />
      </div>

      {/* Search */}
      <div className="relative mb-3">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Filtern in der aktuellen Liste (Produkt, Barcode, Variant)…"
          className="w-full rounded-lg border border-neutral-300 pl-9 pr-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900 focus:outline-none"
        />
      </div>

      {/* Tab Content */}
      <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
        {tab === "duplicates" && <DuplicatesView groups={report.duplicates} search={search} shopDomain={shopDomain} />}
        {tab === "missing" && <VariantList items={report.missing.map((v) => ({ variant: v, reason: "kein Barcode gesetzt" }))} search={search} shopDomain={shopDomain} emptyMsg="Alle Varianten haben einen Barcode ✓" />}
        {tab === "format" && <VariantList items={report.invalidFormat} search={search} shopDomain={shopDomain} emptyMsg="Keine Format-Fehler ✓" />}
        {tab === "checksum" && <VariantList items={report.invalidChecksum} search={search} shopDomain={shopDomain} emptyMsg="Alle Prüfziffern korrekt ✓" />}
        {tab === "suspicious" && <VariantList items={report.suspicious} search={search} shopDomain={shopDomain} emptyMsg="Keine verdächtigen Werte ✓" />}
      </div>

      <p className="text-xs text-neutral-400 mt-4">
        Hinweis: Klick auf das Produkt öffnet die Variante in der Shopify-Admin (neuer Tab).
      </p>
    </div>
  );
}

function initialTab(report: AuditReport): Tab {
  if (report.duplicates.length > 0) return "duplicates";
  if (report.missing.length > 0) return "missing";
  if (report.invalidFormat.length > 0) return "format";
  if (report.invalidChecksum.length > 0) return "checksum";
  if (report.suspicious.length > 0) return "suspicious";
  return "duplicates";
}

function StatCard({ active, color, icon, label, count, subtext, onClick }: {
  active: boolean;
  color: "rose" | "amber" | "orange" | "purple" | "blue";
  icon: React.ReactNode;
  label: string;
  count: number;
  subtext?: string;
  onClick: () => void;
}) {
  const palette: Record<string, { bg: string; text: string; border: string; chip: string; activeBorder: string }> = {
    rose: { bg: "bg-rose-50", text: "text-rose-700", border: "border-rose-200", chip: "bg-rose-100 text-rose-700", activeBorder: "ring-rose-500" },
    amber: { bg: "bg-amber-50", text: "text-amber-700", border: "border-amber-200", chip: "bg-amber-100 text-amber-700", activeBorder: "ring-amber-500" },
    orange: { bg: "bg-orange-50", text: "text-orange-700", border: "border-orange-200", chip: "bg-orange-100 text-orange-700", activeBorder: "ring-orange-500" },
    purple: { bg: "bg-purple-50", text: "text-purple-700", border: "border-purple-200", chip: "bg-purple-100 text-purple-700", activeBorder: "ring-purple-500" },
    blue: { bg: "bg-blue-50", text: "text-blue-700", border: "border-blue-200", chip: "bg-blue-100 text-blue-700", activeBorder: "ring-blue-500" },
  };
  const c = palette[color];
  const ok = count === 0;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-left rounded-xl border p-3 transition ${
        ok ? "bg-white border-neutral-200 opacity-60" : `${c.bg} ${c.border}`
      } ${active ? `ring-2 ring-offset-1 ${c.activeBorder}` : "hover:shadow-sm"}`}
    >
      <div className="flex items-center justify-between mb-1">
        <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${ok ? "bg-emerald-100 text-emerald-600" : c.chip}`}>
          {ok ? "✓" : icon}
        </div>
        <span className={`text-2xl font-bold tabular-nums ${ok ? "text-neutral-300" : c.text}`}>{count}</span>
      </div>
      <div className={`text-xs font-semibold uppercase tracking-wider ${ok ? "text-neutral-400" : c.text}`}>{label}</div>
      {subtext && <div className="text-[10px] text-neutral-500 mt-0.5">{subtext}</div>}
    </button>
  );
}

function DuplicatesView({ groups, search, shopDomain }: { groups: DuplicateGroup[]; search: string; shopDomain: string }) {
  const filtered = useMemo(() => {
    if (!search.trim()) return groups;
    const q = search.toLowerCase();
    return groups.filter((g) =>
      g.barcode.includes(q) ||
      g.variants.some((v) =>
        v.productTitle.toLowerCase().includes(q) ||
        (v.variantTitle ?? "").toLowerCase().includes(q),
      ),
    );
  }, [groups, search]);

  if (groups.length === 0) {
    return <div className="px-6 py-10 text-center text-sm text-emerald-600 font-medium">Keine doppelten Barcodes gefunden ✓</div>;
  }
  if (filtered.length === 0) {
    return <div className="px-6 py-10 text-center text-sm text-neutral-400">Keine Duplikate für „{search}".</div>;
  }
  return (
    <div className="divide-y divide-neutral-100">
      {filtered.map((g) => (
        <div key={g.barcode} className="px-4 py-3">
          <div className="flex items-baseline justify-between mb-2">
            <div className="font-mono text-sm font-bold text-rose-700">{g.barcode}</div>
            <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-rose-100 text-rose-700">
              {g.variants.length}× verwendet
            </span>
          </div>
          <ul className="space-y-1">
            {g.variants.map((v) => (
              <li key={v.variantId} className="flex items-center justify-between gap-3 text-xs bg-rose-50/50 rounded px-2 py-1.5">
                <ShopifyLink variant={v} shopDomain={shopDomain} className="flex-1 min-w-0" />
                <span className="text-neutral-400 shrink-0">{v.variantTitle ?? "Default"}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function VariantList({ items, search, shopDomain, emptyMsg }: {
  items: BarcodeIssue[];
  search: string;
  shopDomain: string;
  emptyMsg: string;
}) {
  const filtered = useMemo(() => {
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter((i) =>
      i.variant.productTitle.toLowerCase().includes(q) ||
      (i.variant.variantTitle ?? "").toLowerCase().includes(q) ||
      i.variant.barcode.toLowerCase().includes(q) ||
      (i.variant.sku ?? "").toLowerCase().includes(q),
    );
  }, [items, search]);

  if (items.length === 0) {
    return <div className="px-6 py-10 text-center text-sm text-emerald-600 font-medium">{emptyMsg}</div>;
  }
  if (filtered.length === 0) {
    return <div className="px-6 py-10 text-center text-sm text-neutral-400">Keine Treffer für „{search}".</div>;
  }
  return (
    <table className="w-full text-sm">
      <thead className="bg-neutral-50 text-xs uppercase tracking-wide text-neutral-600 sticky top-0 z-10">
        <tr>
          <th className="text-left px-4 py-2">Produkt / Variante</th>
          <th className="text-left px-4 py-2 w-[200px]">Barcode</th>
          <th className="text-left px-4 py-2 w-[140px]">SKU</th>
          <th className="text-left px-4 py-2 w-[180px]">Problem</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-neutral-100">
        {filtered.map((i, idx) => (
          <tr key={`${i.variant.variantId}-${idx}`} className="hover:bg-neutral-50">
            <td className="px-4 py-2">
              <ShopifyLink variant={i.variant} shopDomain={shopDomain} />
            </td>
            <td className="px-4 py-2 font-mono text-xs">
              {i.variant.barcode || <span className="text-neutral-300 italic">leer</span>}
            </td>
            <td className="px-4 py-2 font-mono text-xs text-neutral-500">
              {i.variant.sku || <span className="text-neutral-300">—</span>}
            </td>
            <td className="px-4 py-2 text-xs text-neutral-700">{i.reason}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ShopifyLink({ variant, shopDomain, className }: { variant: AuditVariant; shopDomain: string; className?: string }) {
  // GraphQL ID: gid://shopify/ProductVariant/12345 → numerische ID extrahieren
  const variantNumId = variant.variantId.split("/").pop();
  const productNumId = variant.productId.split("/").pop();
  const url = shopDomain && productNumId
    ? `https://${shopDomain}/admin/products/${productNumId}/variants/${variantNumId}`
    : null;

  return (
    <div className={`min-w-0 ${className ?? ""}`}>
      {url ? (
        <a href={url} target="_blank" rel="noreferrer" className="text-neutral-900 hover:text-indigo-600 inline-flex items-center gap-1 truncate">
          <span className="truncate">{variant.productTitle}</span>
          <ExternalLink size={11} className="shrink-0 text-neutral-300 group-hover:text-indigo-500" />
        </a>
      ) : (
        <span className="text-neutral-900 truncate">{variant.productTitle}</span>
      )}
      {variant.variantTitle && (
        <div className="text-[10px] text-neutral-500 truncate">{variant.variantTitle}</div>
      )}
    </div>
  );
}
