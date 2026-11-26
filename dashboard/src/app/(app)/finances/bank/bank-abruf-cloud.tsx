"use client";

import { useEffect, useState } from "react";
import { AlertTriangle, Check, Cloud, Loader2, Smartphone } from "lucide-react";

type Bank = {
  key: string;
  name: string;
  eingerichtet: boolean;
  needs_tan: boolean;
  auth_failed: boolean;
  last_success_at: string | null;
  last_error: string | null;
};

function zeit(iso: string | null) {
  if (!iso) return "noch nie";
  return new Date(iso).toLocaleString("de-DE", { timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/**
 * Bank-Abruf in der Cloud (läuft stündlich bei Vercel, auch ohne Laptop).
 * Zeigt je Bank den Zustand und den Knopf „Freigabe erneuern“ (pushTAN alle ~90 Tage).
 */
export default function BankAbrufCloud({ kompakt = false }: { kompakt?: boolean }) {
  const [daten, setDaten] = useState<{ aus: boolean; banken: Bank[] } | null>(null);
  const [laeuft, setLaeuft] = useState<string | null>(null);
  const [meldung, setMeldung] = useState<{ ok: boolean; text: string } | null>(null);

  async function laden() {
    const r = await fetch("/api/bank/fints-cloud", { cache: "no-store" }).catch(() => null);
    if (r?.ok) setDaten(await r.json());
  }
  useEffect(() => {
    let aktiv = true;
    fetch("/api/bank/fints-cloud", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (aktiv && j) setDaten(j);
      })
      .catch(() => {});
    return () => {
      aktiv = false;
    };
  }, []);

  async function aktion(bank: Bank, action: "renew" | "reset_auth") {
    if (action === "renew" && !confirm(`Gleich schickt die ${bank.name} eine Freigabe-Anfrage aufs Handy.\n\nBitte innerhalb von 3 Minuten in der Banking-App bestätigen.`)) return;
    setLaeuft(`${bank.key}:${action}`);
    setMeldung(null);
    const r = await fetch("/api/bank/fints-cloud", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bank: bank.key, action }),
    }).catch(() => null);
    const j = r ? await r.json().catch(() => null) : null;
    setMeldung({ ok: !!j?.ok, text: j?.message ?? "Keine Antwort — bitte später erneut versuchen." });
    setLaeuft(null);
    await laden();
  }

  if (!daten) return null;
  const probleme = daten.banken.filter((b) => b.eingerichtet && (b.needs_tan || b.auth_failed));
  if (kompakt && probleme.length === 0 && !meldung && !laeuft) return null;

  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${probleme.length ? "border-amber-300 bg-amber-50" : "border-neutral-200 bg-white"}`}>
      <div className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-neutral-800">
        <Cloud size={16} /> Bank-Abruf (rund um die Uhr)
        {daten.aus && <span className="normal-case font-normal text-xs text-red-700">· ausgeschaltet (FINTS_CLOUD=off)</span>}
      </div>
      <div className="mt-3 grid md:grid-cols-2 gap-3">
        {daten.banken.map((b) => {
          const busy = laeuft?.startsWith(b.key + ":");
          return (
            <div key={b.key} className="rounded-xl border border-neutral-200 bg-white p-3">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-neutral-900">{b.name}</span>
                {!b.eingerichtet ? (
                  <span className="text-xs text-neutral-500">noch nicht eingerichtet</span>
                ) : b.auth_failed ? (
                  <span className="flex items-center gap-1 text-xs font-medium text-red-700"><AlertTriangle size={13} /> Anmeldung abgelehnt</span>
                ) : b.needs_tan ? (
                  <span className="flex items-center gap-1 text-xs font-medium text-amber-800"><AlertTriangle size={13} /> Freigabe nötig</span>
                ) : (
                  <span className="flex items-center gap-1 text-xs font-medium text-emerald-700"><Check size={13} /> läuft</span>
                )}
              </div>
              <div className="mt-1 text-xs text-neutral-500">Letzter Abruf: {zeit(b.last_success_at)}</div>
              {b.last_error && b.last_error !== "needs_tan" && <div className="mt-1 text-xs text-red-700 break-words">{b.last_error}</div>}
              {b.eingerichtet && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {b.auth_failed ? (
                    <button
                      onClick={() => aktion(b, "reset_auth")}
                      disabled={!!laeuft}
                      className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-50"
                      title="Erst im Online-Banking anmelden und ggf. PIN bei Vercel korrigieren — sonst droht die Sperre des Zugangs"
                    >
                      Sperre lösen (nach Prüfung der PIN)
                    </button>
                  ) : (
                    <button
                      onClick={() => aktion(b, "renew")}
                      disabled={!!laeuft}
                      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium disabled:opacity-50 ${b.needs_tan ? "bg-neutral-900 text-white hover:bg-neutral-800" : "border border-neutral-300 bg-white text-neutral-700 hover:bg-neutral-50"}`}
                    >
                      {busy ? <Loader2 size={13} className="animate-spin" /> : <Smartphone size={13} />}
                      {busy ? "Warte auf Bestätigung in der Banking-App …" : "Freigabe erneuern"}
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      {meldung && (
        <div className={`mt-3 text-xs rounded-lg px-3 py-2 border ${meldung.ok ? "bg-emerald-50 text-emerald-800 border-emerald-200" : "bg-red-50 text-red-700 border-red-200"}`}>
          {meldung.text}
        </div>
      )}
      {!kompakt && (
        <p className="mt-3 text-xs text-neutral-500">
          Holt stündlich (6–23 Uhr) Umsätze und Kontostände, auch wenn kein Laptop an ist. Etwa alle 90 Tage verlangt die Bank eine
          neue Freigabe — dann hier „Freigabe erneuern“ klicken und in der Banking-App bestätigen.
        </p>
      )}
    </div>
  );
}
