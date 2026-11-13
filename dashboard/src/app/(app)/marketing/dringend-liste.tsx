import { personName, type DringendEintrag } from "@/lib/marketing-extern";

const ART: Record<DringendEintrag["art"], { text: (n: number | null) => string; cls: string }> = {
  ueberfaellig: { text: (n) => `${Math.abs(n ?? 0)} T überfällig`, cls: "bg-rose-100 text-rose-700" },
  heute: { text: () => "heute", cls: "bg-amber-100 text-amber-800" },
  bald: { text: (n) => (n === 1 ? "morgen" : `in ${n} T`), cls: "bg-sky-100 text-sky-700" },
  prio: { text: (n) => `Prio hoch · in ${n} T`, cls: "bg-violet-100 text-violet-700" },
};

// Server-Komponente (kein State) — wird auch vom Startbildschirm-Widget nutzbar sein.
export default function DringendListe({ eintraege, max = 12 }: { eintraege: DringendEintrag[]; max?: number }) {
  if (!eintraege.length) return <p className="text-sm text-neutral-500">Nichts Dringendes: keine überfälligen oder in den nächsten 2 Tagen fälligen Schritte.</p>;
  return (
    <ul className="divide-y divide-neutral-100 text-sm">
      {eintraege.slice(0, max).map((e, i) => (
        <li key={`${e.aufgabeId}-${i}`} className="py-2 flex items-start gap-3">
          <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium ${ART[e.art].cls}`}>{ART[e.art].text(e.tageBis)}</span>
          <div className="min-w-0 flex-1">
            <div className="text-neutral-900 truncate">{e.schritt ?? e.aufgabe}</div>
            <div className="text-xs text-neutral-500 truncate">
              {e.schritt ? `${e.aufgabe} · ` : ""}{e.bereich ?? ""}{e.prio ? ` · Prio ${e.prio}` : ""}
            </div>
          </div>
          <span className="shrink-0 text-xs text-neutral-600">{personName(e.person)}</span>
        </li>
      ))}
      {eintraege.length > max && <li className="pt-2 text-xs text-neutral-500">… und {eintraege.length - max} weitere</li>}
    </ul>
  );
}
