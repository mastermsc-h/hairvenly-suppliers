"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";

export default function KnowledgeSearchBox({ defaultValue }: { defaultValue: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const [val, setVal] = useState(defaultValue);

  function submit(e?: React.FormEvent) {
    e?.preventDefault();
    const params = new URLSearchParams(sp.toString());
    if (val.trim()) params.set("q", val.trim());
    else params.delete("q");
    router.push(`/chatbot/chat-wissen?${params.toString()}`);
  }

  function clear() {
    setVal("");
    const params = new URLSearchParams(sp.toString());
    params.delete("q");
    router.push(`/chatbot/chat-wissen?${params.toString()}`);
  }

  return (
    <form onSubmit={submit} className="flex gap-2 items-center">
      <div className="relative flex-1">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
        <input
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder='z.B. "wie pflege ich tapes?" oder "was kosten 150g bondings?"'
          className="w-full pl-9 pr-9 py-2 text-sm rounded-lg border border-neutral-300 focus:ring-2 focus:ring-purple-500 focus:outline-none"
        />
        {val && (
          <button
            type="button"
            onClick={clear}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-400 hover:text-neutral-700"
            title="Suche zurücksetzen"
          >
            <X size={14} />
          </button>
        )}
      </div>
      <button
        type="submit"
        className="px-3 py-2 rounded-lg bg-purple-600 text-white text-xs font-medium hover:bg-purple-700"
      >
        Suchen
      </button>
    </form>
  );
}
