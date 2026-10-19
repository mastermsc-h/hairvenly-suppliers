import Link from "next/link";
import type { Ampel, BestellPrognose } from "@/lib/liquiditaet/rechnung";

export const AMPEL_STIL: Record<Ampel, { text: string; cls: string }> = {
  ok: { text: "bezahlbar", cls: "bg-emerald-100 text-emerald-800" },
  knapp: { text: "knapp", cls: "bg-amber-100 text-amber-800" },
  luecke: { text: "Lücke", cls: "bg-red-100 text-red-800" },
};

const eur = (n: number) => Math.round(n).toLocaleString("de-DE") + " €";
const deDate = (iso: string) => `${iso.slice(8, 10)}.${iso.slice(5, 7)}.`;

/**
 * Kleine Ampel an einer Bestellung: Kann sie bezahlt werden, wenn sie versandbereit ist —
 * inkl. Einfuhrabgaben bei Ankunft? Nur für Nutzer mit Finanz-Zugriff rendern (nie Lieferanten).
 */
export default function LiquiditaetBadge({ p, groß = false, alsLink = true }: { p: BestellPrognose; groß?: boolean; alsLink?: boolean }) {
  const ampel: Ampel = p.bezahlt ? (p.einfuhr?.ampel ?? "ok") : p.ampel;
  const stil = AMPEL_STIL[ampel];
  const einfuhr = p.einfuhr ? ` · Einfuhrabgaben ${eur(p.einfuhr.eust + p.einfuhr.zoll)} am ${deDate(p.einfuhr.datum)} (Konto danach ${eur(p.einfuhr.saldoDanach)})` : "";
  const title = p.bezahlt
    ? `Lieferant bezahlt${einfuhr}`
    : `Zahlung ${eur(p.betragEur)} ${p.sofort ? "sofort fällig" : `ca. ${deDate(p.zahlDatum)} (versandbereit)`} · Konto danach ${eur(p.saldoNachZahlung)}${einfuhr}`;
  const text = p.bezahlt
    ? `EUSt ${p.einfuhr ? eur(p.einfuhr.eust + p.einfuhr.zoll) : "—"}`
    : ampel === "luecke"
      ? `${stil.text} −${eur(p.fehlbetrag)}`
      : `${stil.text} ${p.sofort ? "jetzt" : deDate(p.zahlDatum)}`;
  const cls = `inline-flex items-center gap-1 rounded-full font-medium whitespace-nowrap ${stil.cls} ${groß ? "px-2.5 py-1 text-xs" : "px-1.5 py-0.5 text-[10px]"}`;
  // In Karten, die selbst ein Link sind, kein verschachteltes <a>
  if (!alsLink) return <span title={title} className={cls}>€ {text}</span>;
  return (
    <Link href="/finances/liquiditaet" title={title} className={`${cls} hover:opacity-80`}>
      € {text}
    </Link>
  );
}
