"use client";

import React, { useState, useMemo } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

interface Column<T> {
  key: keyof T;
  label: string;
  align?: "left" | "right" | "center";
  render?: (value: T[keyof T], row: T) => React.ReactNode;
  sortable?: boolean;
  className?: string;
}

interface StockTableProps<T> {
  data: T[];
  columns: Column<T>[];
  groupBy?: keyof T;
  rowClassName?: (row: T) => string;
  emptyMessage?: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function StockTable<T extends Record<string, any>>({
  data,
  columns,
  groupBy,
  rowClassName,
  emptyMessage = "Keine Daten",
}: StockTableProps<T>) {
  const [sortKey, setSortKey] = useState<keyof T | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const sorted = useMemo(() => {
    if (!sortKey) return data;
    return [...data].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (typeof av === "number" && typeof bv === "number") {
        return sortDir === "asc" ? av - bv : bv - av;
      }
      const as = String(av ?? "");
      const bs = String(bv ?? "");
      return sortDir === "asc" ? as.localeCompare(bs) : bs.localeCompare(as);
    });
  }, [data, sortKey, sortDir]);

  const handleSort = (key: keyof T) => {
    if (sortKey === key) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  if (data.length === 0) {
    return (
      <div className="text-center py-8 text-sm text-neutral-400">{emptyMessage}</div>
    );
  }

  // Group rows if groupBy is specified
  const groups: { key: string; rows: T[] }[] = [];
  if (groupBy) {
    const map = new Map<string, T[]>();
    for (const row of sorted) {
      const k = String(row[groupBy] ?? "");
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(row);
    }
    for (const [k, rows] of map) groups.push({ key: k, rows });
  } else {
    groups.push({ key: "", rows: sorted });
  }

  const alignClass = (a?: string) =>
    a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left";

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead className="bg-neutral-50 text-left text-[10px] uppercase text-neutral-500 sticky top-0">
          <tr>
            {columns.map((col) => (
              <th
                key={String(col.key)}
                className={`px-2 py-1.5 font-medium whitespace-nowrap ${alignClass(col.align)} ${col.className ?? ""} ${
                  col.sortable !== false ? "cursor-pointer select-none hover:text-neutral-900" : ""
                }`}
                onClick={() => col.sortable !== false && handleSort(col.key)}
              >
                <span className="inline-flex items-center gap-1">
                  {col.label}
                  {sortKey === col.key &&
                    (sortDir === "asc" ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-100">
          {groups.map((group) => (
            <GroupRows
              key={group.key}
              group={group}
              columns={columns}
              groupBy={groupBy}
              rowClassName={rowClassName}
              alignClass={alignClass}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}

function sumField<T>(rows: T[], field: string): number {
  return rows.reduce((s, r) => {
    const v = (r as Record<string, unknown>)[field];
    return s + (typeof v === "number" ? v : 0);
  }, 0);
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function SumRow<T extends Record<string, any>>({
  rows,
  columns,
  label,
  alignClass,
  variant,
}: {
  rows: T[];
  columns: { key: keyof T; label: string; align?: string; className?: string }[];
  label: string;
  alignClass: (a?: string) => string;
  variant: "sub" | "group";
}) {
  const totalWeight = sumField(rows, "totalWeight");
  const transitTotal = sumField(rows, "transitTotal");
  const bg = variant === "sub" ? "bg-neutral-100/70 border-t border-neutral-200" : "bg-indigo-50/60 border-t border-indigo-200";
  const text = variant === "sub" ? "text-neutral-700" : "text-indigo-900";
  return (
    <tr className={`${bg} font-semibold ${text}`}>
      <td className="px-3 py-1.5 text-[10px] uppercase tracking-wide">{label}</td>
      {columns.slice(1).map((col) => {
        const isTotal = String(col.key) === "totalWeight";
        const isTransit = String(col.key) === "transitTotal";
        let content: React.ReactNode = "";
        if (isTotal) content = <>{(totalWeight / 1000).toFixed(2)} kg</>;
        else if (isTransit && transitTotal > 0) content = <span className="text-cyan-700">{(transitTotal / 1000).toFixed(2)} kg</span>;
        return (
          <td key={String(col.key)} className={`px-2 py-1.5 ${alignClass(col.align)}`}>
            {content}
          </td>
        );
      })}
    </tr>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function Row<T extends Record<string, any>>({
  row,
  columns,
  rowClassName,
  alignClass,
}: {
  row: T;
  columns: { key: keyof T; label: string; align?: string; render?: (value: T[keyof T], row: T) => React.ReactNode; className?: string }[];
  rowClassName?: (row: T) => string;
  alignClass: (a?: string) => string;
}) {
  return (
    <tr className={`hover:bg-indigo-100 hover:shadow-[inset_3px_0_0_0_rgb(79_70_229)] transition ${rowClassName?.(row) ?? ""}`}>
      {columns.map((col) => (
        <td key={String(col.key)} className={`px-2 py-1 ${alignClass(col.align)} ${col.className ?? ""}`}>
          {col.render ? col.render(row[col.key], row) : String(row[col.key] ?? "")}
        </td>
      ))}
    </tr>
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function GroupRows<T extends Record<string, any>>({
  group,
  columns,
  groupBy,
  rowClassName,
  alignClass,
}: {
  group: { key: string; rows: T[] };
  columns: { key: keyof T; label: string; align?: string; render?: (value: T[keyof T], row: T) => React.ReactNode; className?: string }[];
  groupBy?: keyof T;
  rowClassName?: (row: T) => string;
  alignClass: (a?: string) => string;
}) {
  const totalWeight = sumField(group.rows, "totalWeight");
  const transitTotal = sumField(group.rows, "transitTotal");
  const showFooter = groupBy && group.key && (totalWeight > 0 || transitTotal > 0);

  // Detect clip-in collection — sub-group by unitWeight (100/150/225)
  const isClipIn = group.key.toUpperCase().includes("CLIP");
  const hasVariants = isClipIn && group.rows.some((r) => {
    const uw = (r as Record<string, unknown>).unitWeight;
    return typeof uw === "number" && uw > 0;
  });

  let body: React.ReactNode;
  if (hasVariants) {
    const subGroups = new Map<number, T[]>();
    for (const row of group.rows) {
      const uw = (row as { unitWeight?: number }).unitWeight ?? 0;
      if (!subGroups.has(uw)) subGroups.set(uw, []);
      subGroups.get(uw)!.push(row);
    }
    const sorted = Array.from(subGroups.entries()).sort((a, b) => a[0] - b[0]);
    body = sorted.map(([weight, rows]) => (
      <React.Fragment key={weight}>
        <tr className="bg-indigo-100/60 border-t border-indigo-200">
          <td colSpan={columns.length} className="px-3 py-1.5 font-semibold text-[11px] uppercase tracking-wide text-indigo-700">
            {weight}g Variante <span className="ml-1 font-normal text-indigo-400">({rows.length})</span>
          </td>
        </tr>
        {rows.map((row, i) => (
          <Row key={i} row={row} columns={columns} rowClassName={rowClassName} alignClass={alignClass} />
        ))}
        <SumRow rows={rows} columns={columns} label={`Summe ${weight}g`} alignClass={alignClass} variant="sub" />
      </React.Fragment>
    ));
  } else {
    body = group.rows.map((row, i) => (
      <Row key={i} row={row} columns={columns} rowClassName={rowClassName} alignClass={alignClass} />
    ));
  }

  const slug = slugify(group.key);

  return (
    <>
      {groupBy && group.key && (
        <tr id={`cat-${slug}`} className="bg-indigo-600 text-white sticky top-0 z-10 shadow-md scroll-mt-4">
          <td colSpan={columns.length} className="px-3 py-2.5 font-bold text-sm uppercase tracking-wide">
            {group.key}
            <span className="ml-2 font-semibold text-indigo-200">({group.rows.length})</span>
          </td>
        </tr>
      )}
      {body}
      {showFooter && (
        <SumRow rows={group.rows} columns={columns} label="Gesamt" alignClass={alignClass} variant="group" />
      )}
    </>
  );
}
