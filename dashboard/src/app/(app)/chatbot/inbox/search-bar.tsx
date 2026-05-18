"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";

export default function InboxSearchBar() {
  const router = useRouter();
  const params = useSearchParams();
  const [value, setValue] = useState(params.get("q") || "");

  function submit(q: string) {
    const next = new URLSearchParams(params.toString());
    if (q.trim()) next.set("q", q.trim());
    else next.delete("q");
    router.push(`/chatbot/inbox?${next.toString()}`);
  }

  return (
    <div className="relative flex-1 max-w-xl">
      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter") submit(value); }}
        placeholder="Suche nach Kundenname oder Nachricht…"
        className="w-full pl-9 pr-9 py-2 text-sm rounded-xl border border-neutral-300 bg-white focus:outline-none focus:ring-2 focus:ring-neutral-900/20 focus:border-neutral-400"
      />
      {value && (
        <button
          type="button"
          onClick={() => { setValue(""); submit(""); }}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-neutral-400 hover:text-neutral-700"
          title="Suche löschen"
        >
          <X size={14} />
        </button>
      )}
    </div>
  );
}
