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
  return (
    <>
      {groupBy && group.key && (
        <tr className="bg-indigo-50 border-t-2 border-indigo-200">
          <td colSpan={columns.length} className="px-2 py-2 font-bold text-indigo-800 text-xs uppercase tracking-wide">
            {group.key}
            <span className="ml-2 font-medium text-indigo-400">({group.rows.length})</span>
          </td>
        </tr>
      )}
      {group.rows.map((row, i) => (
        <tr
          key={i}
          className={`hover:bg-neutral-50 transition ${rowClassName?.(row) ?? ""}`}
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
    </>
  );
}
