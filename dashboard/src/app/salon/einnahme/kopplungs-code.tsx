"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { geraetMitCodeFreischalten } from "@/lib/actions/salon-einnahmen";

/** Freischalt-Code eintippen — nötig in der Home-Bildschirm-App (eigene Cookies, QR öffnet Safari). */
export default function KopplungsCode() {
  const [code, setCode] = useState("");
  const [fehler, setFehler] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function freischalten(e: React.FormEvent) {
    e.preventDefault();
    setFehler(null);
    start(async () => {
      const r = await geraetMitCodeFreischalten(code);
      if (!r.ok) return setFehler(r.error);
      router.refresh();
    });
  }

  return (
    <form onSubmit={freischalten} className="pt-3 space-y-3">
      <input
        value={code}
        onChange={(e) => setCode(e.target.value.toUpperCase())}
        placeholder="XXXX-XXXX"
        autoCapitalize="characters"
        autoCorrect="off"
        autoComplete="off"
        spellCheck={false}
        maxLength={12}
        className="w-full rounded-xl border-2 border-neutral-700 px-4 py-4 text-center font-mono text-2xl tracking-widest focus:outline-none focus:border-amber-400"
      />
      {fehler && <div className="text-rose-400">{fehler}</div>}
      <button
        disabled={pending || code.replace(/[^A-Z0-9]/g, "").length !== 8}
        className="w-full rounded-2xl bg-emerald-600 hover:bg-emerald-500 py-4 text-xl font-bold disabled:opacity-50"
      >
        {pending ? "Prüfe …" : "Freischalten"}
      </button>
    </form>
  );
}
