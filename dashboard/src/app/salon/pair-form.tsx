"use client";

import { useState, useTransition } from "react";
import { pairDeviceWithToken } from "@/lib/actions/salon";
import { useRouter } from "next/navigation";

export default function PairForm() {
  const [token, setToken] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    start(async () => {
      const res = await pairDeviceWithToken(token.trim());
      if (!res.ok) {
        setError(res.error ?? "Pairing fehlgeschlagen");
        return;
      }
      router.refresh();
    });
  }

  return (
    <form onSubmit={submit} className="w-full max-w-sm bg-neutral-900 rounded-2xl p-6 space-y-4 border border-neutral-800">
      <div>
        <div className="text-xs uppercase tracking-widest text-neutral-500">Hairvenly Salon</div>
        <div className="text-xl font-semibold mt-1">Geraet pairen</div>
        <div className="text-sm text-neutral-400 mt-2">
          Damit nur das Salon-iPad zugreifen darf, einmalig den Pairing-Code aus dem Manager-Dashboard
          eingeben.
        </div>
      </div>
      <input
        type="password"
        inputMode="text"
        autoFocus
        value={token}
        onChange={(e) => setToken(e.target.value)}
        placeholder="Pairing-Code"
        className="w-full bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-3 text-base focus:ring-2 focus:ring-rose-500 outline-none"
      />
      {error && <div className="text-sm text-rose-400">{error}</div>}
      <button
        type="submit"
        disabled={pending || !token.trim()}
        className="w-full bg-rose-600 hover:bg-rose-500 disabled:bg-neutral-700 disabled:text-neutral-500 rounded-lg py-3 font-semibold"
      >
        {pending ? "Pairing..." : "Pairen"}
      </button>
    </form>
  );
}
