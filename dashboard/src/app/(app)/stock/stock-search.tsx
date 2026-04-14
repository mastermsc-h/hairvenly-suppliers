"use client";

import { useState, useMemo } from "react";
import { Search } from "lucide-react";

interface StockSearchProps<T> {
  data: T[];
  searchFields: (keyof T)[];
  placeholder?: string;
  children: (filtered: T[]) => React.ReactNode;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export default function StockSearch<T extends Record<string, any>>({
  data,
  searchFields,
  placeholder = "Produkt suchen...",
  children,
}: StockSearchProps<T>) {
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    if (!query.trim()) return data;
    // Split query into words — ALL words must match somewhere across searchFields
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return data.filter((row) => {
      // Combine all searchable text into one string
      const combined = searchFields
        .map((field) => {
          const val = row[field];
          return typeof val === "string" ? val.toLowerCase() : "";
        })
        .join(" ");
      return words.every((w) => combined.includes(w));
    });
  }, [data, query, searchFields]);

  return (
    <>
      <div className="relative">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={placeholder}
          className="w-full pl-9 pr-3 py-2 rounded-lg border border-neutral-300 text-sm focus:ring-2 focus:ring-neutral-900 focus:outline-none"
        />
      </div>
      {children(filtered)}
    </>
  );
}
