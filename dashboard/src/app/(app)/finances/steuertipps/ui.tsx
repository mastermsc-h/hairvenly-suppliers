"use client";

// Kleine Bausteine der Steuertipps-Seite.

export function eur(n: number) {
  return Math.round(n).toLocaleString("de-DE") + " €";
}
export function eurK(n: number) {
  const a = Math.abs(n);
  if (a >= 1_000_000) return `${(n / 1_000_000).toLocaleString("de-DE", { maximumFractionDigits: 2 })} Mio €`;
  if (a >= 10_000) return `${Math.round(n / 1000).toLocaleString("de-DE")}k €`;
  if (a >= 1_000) return `${(n / 1000).toLocaleString("de-DE", { maximumFractionDigits: 1 })}k €`;
  return eur(n);
}

export type KartenTon = "emerald" | "violet" | "blue" | "amber" | "red" | "slate" | "sky" | "rose";

const TON: Record<KartenTon, { rand: string; kopf: string; text: string }> = {
  emerald: { rand: "border-l-emerald-500", kopf: "bg-emerald-50 border-emerald-100", text: "text-emerald-800" },
  violet: { rand: "border-l-violet-500", kopf: "bg-violet-50 border-violet-100", text: "text-violet-800" },
  blue: { rand: "border-l-blue-500", kopf: "bg-blue-50 border-blue-100", text: "text-blue-800" },
  amber: { rand: "border-l-amber-500", kopf: "bg-amber-50 border-amber-100", text: "text-amber-800" },
  red: { rand: "border-l-red-500", kopf: "bg-red-50 border-red-100", text: "text-red-800" },
  slate: { rand: "border-l-slate-500", kopf: "bg-slate-100 border-slate-200", text: "text-slate-800" },
  sky: { rand: "border-l-sky-500", kopf: "bg-sky-50 border-sky-100", text: "text-sky-800" },
  rose: { rand: "border-l-rose-500", kopf: "bg-rose-50 border-rose-100", text: "text-rose-800" },
};

export function Karte({ titel, ton, icon, children, rechts }: { titel: string; ton: KartenTon; icon?: React.ReactNode; children: React.ReactNode; rechts?: React.ReactNode }) {
  const t = TON[ton];
  return (
    <section className={`bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden border-l-4 ${t.rand}`}>
      <div className={`px-4 md:px-6 py-3 border-b flex items-center justify-between gap-3 ${t.kopf}`}>
        <h2 className={`text-sm font-bold uppercase tracking-wide flex items-center gap-2 ${t.text}`}>
          {icon}
          {titel}
        </h2>
        {rechts}
      </div>
      <div className="px-4 md:px-6 py-4">{children}</div>
    </section>
  );
}

const ZAHL_TON: Record<string, string> = {
  red: "border-red-200 bg-red-50 [&_.l]:text-red-800 [&_.w]:text-red-900",
  emerald: "border-emerald-200 bg-emerald-50 [&_.l]:text-emerald-800 [&_.w]:text-emerald-900",
  slate: "border-slate-200 bg-slate-50 [&_.l]:text-slate-700 [&_.w]:text-slate-900",
  violet: "border-violet-200 bg-violet-50 [&_.l]:text-violet-800 [&_.w]:text-violet-900",
  blue: "border-blue-200 bg-blue-50 [&_.l]:text-blue-800 [&_.w]:text-blue-900",
};

export function Zahl({ label, wert, unter, ton }: { label: string; wert: string; unter?: string; ton: keyof typeof ZAHL_TON }) {
  return (
    <div className={`rounded-xl border p-3 ${ZAHL_TON[ton]}`}>
      <div className="l text-xs font-semibold uppercase tracking-wide">{label}</div>
      <div className="w text-lg font-bold tabular-nums mt-1">{wert}</div>
      {unter && <div className="text-[11px] text-neutral-600 mt-0.5">{unter}</div>}
    </div>
  );
}

export function Feld({ label, wert, set, schritt = 1, breite = "w-32" }: { label: string; wert: number; set: (v: number) => void; schritt?: number; breite?: string }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[11px] font-medium text-neutral-500">{label}</span>
      <input
        type="number"
        value={wert}
        step={schritt}
        min={0}
        onChange={(e) => set(Math.max(0, Number(e.target.value) || 0))}
        className={`${breite} rounded-lg border border-neutral-300 px-2 py-1 text-sm tabular-nums focus:ring-2 focus:ring-neutral-900 focus:outline-none`}
      />
    </label>
  );
}
