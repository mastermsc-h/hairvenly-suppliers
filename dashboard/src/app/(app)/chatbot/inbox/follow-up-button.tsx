"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";

export default function FollowUpButton({ count }: { count: number }) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function trigger() {
    if (!confirm(`Follow-Ups an ${count} Kunden senden, die seit ≥3 Tagen nicht mehr geantwortet haben?`)) return;
    setLoading(true);
    try {
      const res = await fetch("/api/chat/follow-ups", { method: "POST" });
      const data = await res.json();
      alert(`${data.processed || 0} Follow-Ups gesendet.`);
      router.refresh();
    } catch (e) {
      alert(`Fehler: ${(e as Error).message}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <button
      onClick={trigger}
      disabled={loading}
      className="inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-purple-600 text-white text-xs font-medium hover:bg-purple-700 disabled:opacity-40"
    >
      <Send size={12} />
      {loading ? "Sende…" : `Follow-Up an ${count} Kunden senden`}
    </button>
  );
}
