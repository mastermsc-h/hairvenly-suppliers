import { Building2, Factory, PackagePlus, Percent, Ship, Sparkles, Truck, User, Users, type LucideIcon } from "lucide-react";
import type { Ereignis } from "@/lib/liquiditaet/rechnung";

export type SymbolTyp = "ust" | "lst" | "est" | "gewst" | "einfuhr" | "lieferant" | "manuell" | "nachbestellung" | "aktion";

export const SYMBOLE: Record<SymbolTyp, { Icon: LucideIcon; kurz: string; name: string; cls: string; farbe: string }> = {
  ust: { Icon: Percent, kurz: "USt", name: "Umsatzsteuer", cls: "bg-rose-100 text-rose-700", farbe: "#e11d48" },
  lst: { Icon: Users, kurz: "LSt", name: "Lohnsteuer", cls: "bg-orange-100 text-orange-700", farbe: "#ea580c" },
  est: { Icon: User, kurz: "ESt", name: "Einkommensteuer", cls: "bg-violet-100 text-violet-700", farbe: "#7c3aed" },
  gewst: { Icon: Building2, kurz: "GewSt", name: "Gewerbesteuer", cls: "bg-sky-100 text-sky-700", farbe: "#0284c7" },
  einfuhr: { Icon: Ship, kurz: "EUSt", name: "Einfuhrabgaben (EUSt + Zoll)", cls: "bg-amber-100 text-amber-800", farbe: "#d97706" },
  lieferant: { Icon: Truck, kurz: "Amanda", name: "Amanda-Zahlung", cls: "bg-indigo-100 text-indigo-700", farbe: "#4f46e5" },
  manuell: { Icon: Factory, kurz: "Rate", name: "Lieferanten-Rate (Ebru …)", cls: "bg-teal-100 text-teal-700", farbe: "#0d9488" },
  nachbestellung: { Icon: PackagePlus, kurz: "Nachb.", name: "Nachbestellung (Schätzung)", cls: "bg-neutral-100 text-neutral-600", farbe: "#525252" },
  aktion: { Icon: Sparkles, kurz: "BF", name: "Black-Friday-Mehrumsatz", cls: "bg-emerald-100 text-emerald-700", farbe: "#059669" },
};

export function symbolTyp(ev: Pick<Ereignis, "art" | "steuer">): SymbolTyp {
  if (ev.art === "steuer") return ev.steuer ?? "ust";
  return ev.art as SymbolTyp;
}

/** Kleine farbige Marke mit Symbol + Kürzel; "≈" bei Schätzungen. */
export function TerminSymbol({ typ, schaetzung = false }: { typ: SymbolTyp; schaetzung?: boolean }) {
  const s = SYMBOLE[typ];
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold whitespace-nowrap ${s.cls}`}
      title={`${s.name}${schaetzung ? " — Schätzung" : ""}`}
    >
      <s.Icon size={11} strokeWidth={2.5} />
      {schaetzung && "≈ "}
      {s.kurz}
    </span>
  );
}
