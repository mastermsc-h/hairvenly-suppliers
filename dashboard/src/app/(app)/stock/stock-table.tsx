"use client";

import { useState, useMemo } from "react";
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
  // Sum "totalWeight" (or any numeric field named totalWeight) for group footer
  const totalWeight = group.rows.reduce((s, r) => {
    const v = (r as Record<string, unknown>).totalWeight;
    return s + (typeof v === "number" ? v : 0);
  }, 0);
  const transitTotal = group.rows.reduce((s, r) => {
    const v = (r as Record<string, unknown>).transitTotal;
    return s + (typeof v === "number" ? v : 0);
  }, 0);
  const showFooter = groupBy && group.key && (totalWeight > 0 || transitTotal > 0);

  return (
    <>
      {groupBy && group.key && (
        <tr className="bg-indigo-600 text-white sticky top-0 z-10 shadow-md">
          <td colSpan={columns.length} className="px-3 py-2.5 font-bold text-sm uppercase tracking-wide">
            {group.key}
            <span className="ml-2 font-semibold text-indigo-200">({group.rows.length})</span>
          </td>
        </tr>
      )}
      {group.rows.map((row, i) => (
        <tr
          key={i}
          className={`hover:bg-indigo-100 hover:shadow-[inset_3px_0_0_0_rgb(79_70_229)] transition ${rowClassName?.(row) ?? ""}`}
        >
          {columns.map((col) => (
            <td
              key={String(col.key)}
              className={`px-2 py-1 ${alignClass(col.align)} ${col.className ?? ""}`}
            >
              {col.render ? col.render(row[col.key], row) : String(row[col.key] ?? "")}
            </td>
          ))}
        </tr>
      ))}
      {showFooter && (
        <tr className="bg-indigo-50/60 border-t border-indigo-200 font-semibold text-indigo-900">
          <td className="px-3 py-1.5 text-[10px] uppercase tracking-wide">Summe</td>
          {columns.slice(1).map((col) => {
            const isTotal = String(col.key) === "totalWeight";
            const isTransit = String(col.key) === "transitTotal";
            let content: React.ReactNode = "";
            if (isTotal) {
              content = <>{(totalWeight / 1000).toFixed(2)} kg</>;
            } else if (isTransit && transitTotal > 0) {
              content = <span className="text-cyan-700">{(transitTotal / 1000).toFixed(2)} kg</span>;
            }
            return (
              <td key={String(col.key)} className={`px-2 py-1.5 ${alignClass(col.align)}`}>
                {content}
              </td>
            );
          })}
        </tr>
      )}
    </>
  );
}
