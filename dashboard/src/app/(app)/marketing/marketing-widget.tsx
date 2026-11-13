// Startbildschirm-Widget "Marketing (HALO)": dringende Team-Aufgaben aus HALO.
// Server-Komponente; nutzt die Cockpit-Klassen (ck-*) aus start/cockpit.css.
import Link from "next/link";
import { dringendeAufgaben, personName, heuteBerlin, type HaloDaten, type DringendEintrag } from "@/lib/marketing-extern";

const ton: Record<DringendEintrag["art"], string | undefined> = { ueberfaellig: "alarm", heute: "warn", bald: undefined, prio: "akzent" };
const farbe: Record<DringendEintrag["art"], string> = { ueberfaellig: "var(--ck-alarm)", heute: "var(--ck-warn)", bald: "var(--ck-akzent)", prio: "#ff7a45" };
const tagMonat = (iso: string) => `${Number(iso.slice(8, 10))}.${Number(iso.slice(5, 7))}.`;

function wann(e: DringendEintrag): string {
  if (e.art === "ueberfaellig") return `überfällig seit ${e.datum ? tagMonat(e.datum) : "?"}`;
  if (e.art === "heute") return "heute";
  if (e.tageBis === 1) return "morgen";
  return `bis ${e.datum ? tagMonat(e.datum) : "?"}`;
}

export default function MarketingWidget({ d, max = 6 }: { d: HaloDaten; max?: number }) {
  const heute = heuteBerlin();
  const liste = dringendeAufgaben(d, heute);
  const offen = d.aufgaben.filter((a) => a.status === "offen");
  const schritte = offen.reduce((s, a) => s + a.offene_schritte.length, 0);
  const heuteGeplant = offen.reduce((s, a) => s + a.offene_schritte.filter((x) => x.geplant === heute).length, 0);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10, height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", gap: 14, alignItems: "baseline", flexWrap: "wrap" }}>
        <span><b className="ck-mono" style={{ fontSize: 22 }}>{liste.length}</b> <span className="ck-etikett">dringend</span></span>
        <span className="ck-dim" style={{ fontSize: 12.5 }}>{offen.length} Aufgaben offen · {schritte} Schritte · {heuteGeplant} heute geplant</span>
      </div>

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", display: "flex", flexDirection: "column", gap: 6 }}>
        {liste.length === 0 ? (
          <div className="ck-dim" style={{ fontSize: 13 }}>Nichts Dringendes im Marketing: nichts überfällig oder in den nächsten 2 Tagen fällig.</div>
        ) : (
          liste.slice(0, max).map((e, i) => (
            <div key={`${e.aufgabeId}-${i}`} className="ck-aufgabe" style={{ ["--a" as string]: farbe[e.art] }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13.5, lineHeight: 1.35, overflowWrap: "anywhere" }}>{e.schritt ?? e.aufgabe}</div>
                <div style={{ display: "flex", gap: 5, flexWrap: "wrap", marginTop: 4 }}>
                  <span className="ck-marke" data-ton="akzent">{personName(e.person)}</span>
                  <span className="ck-marke" data-ton={ton[e.art]}>{wann(e)}</span>
                  {e.schritt && <span className="ck-marke">{e.aufgabe}</span>}
                </div>
              </div>
            </div>
          ))
        )}
        {liste.length > max && <div className="ck-matt" style={{ fontSize: 12 }}>… und {liste.length - max} weitere</div>}
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12 }}>
        <Link href="/marketing/aufgaben" className="ck-dim" style={{ textDecoration: "underline" }}>Alle Aufgaben</Link>
        <Link href="/marketing" className="ck-dim" style={{ textDecoration: "underline" }}>Marketing-Zahlen →</Link>
      </div>
    </div>
  );
}
