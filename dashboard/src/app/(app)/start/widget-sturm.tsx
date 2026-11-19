"use client";

// Fenster "Auffälligkeiten": täglicher Prüfbericht, dargestellt als Gewitter.
// Je mehr ernste Punkte, desto dunkler der Himmel und desto öfter blitzt es.
// Keine Auffälligkeiten → aufgeklarter Himmel.
import { useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertOctagon, BadgePercent, Banknote, Camera, ChevronDown, CloudLightning, Database, Landmark, Megaphone, MessageSquareWarning,
  Package, RefreshCw, RotateCcw, Star, Sun, TrendingDown, Truck, Wallet, Zap,
} from "lucide-react";
import { berichtJetztPruefen } from "@/lib/actions/cockpit";
import SturmZylinder from "./sturm-zylinder";
import type { AuffaelligBereich, Bericht } from "@/lib/cockpit/typen";

const ICON: Record<AuffaelligBereich, React.ComponentType<{ size?: number }>> = {
  lager: Package, chats: MessageSquareWarning, werbung: Megaphone, aktionen: BadgePercent, zahlungen: Banknote,
  finanzen: Wallet, versand: Truck, retouren: RotateCcw, steuern: Landmark, instagram: Camera, umsatz: TrendingDown, daten: Database, bewertungen: Star,
};
const BEREICH: Record<AuffaelligBereich, string> = {
  lager: "Lager", chats: "Chats", werbung: "Werbung", aktionen: "Aktionen", zahlungen: "Zahlungen", finanzen: "Finanzen",
  versand: "Versand", retouren: "Retouren", steuern: "Steuern", instagram: "Instagram", umsatz: "Umsatz", daten: "Datenquellen", bewertungen: "Bewertungen",
};
/** Fällt zurück, wenn der Browser keinen Speicher erlaubt (privates Fenster). */
const ansichtSpeicher = { wert: "zylinder" as "zylinder" | "liste" };
function ansichtMerken(a: "zylinder" | "liste") {
  ansichtSpeicher.wert = a;
  try { localStorage.setItem("ck-sturm-ansicht", a); } catch { /* ohne Speicher: nur für diese Sitzung */ }
  window.dispatchEvent(new Event("ck-sturm-ansicht"));
}

const SCHWERE = { hoch: "Ernst", mittel: "Beachten", hinweis: "Hinweis" } as const;

/** Blitz als gezackter Pfad von oben nach unten, zufällig verzweigt. */
function blitzPfad(x: number): string {
  let y = 0;
  let px = x;
  const pts = [`M${px},${y}`];
  while (y < 100) {
    y += 8 + Math.random() * 14;
    px += (Math.random() - 0.5) * 14;
    pts.push(`L${px.toFixed(1)},${Math.min(y, 100).toFixed(1)}`);
  }
  return pts.join(" ");
}

function Gewitter({ staerke }: { staerke: number }) {
  // staerke 0 = klar, 1 = leichter Regen, 2 = Sturm, 3 = schweres Gewitter
  const [blitz, setBlitz] = useState<{ d: string; k: number } | null>(null);
  const zaehler = useRef(0);
  useEffect(() => {
    if (staerke < 2) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let t = 0;
    const naechster = () => {
      const pause = staerke >= 3 ? 2500 + Math.random() * 4000 : 6000 + Math.random() * 7000;
      t = window.setTimeout(() => {
        if (!document.hidden) {
          zaehler.current++;
          setBlitz({ d: blitzPfad(10 + Math.random() * 80), k: zaehler.current });
          window.setTimeout(() => setBlitz(null), 650);
        }
        naechster();
      }, pause);
    };
    naechster();
    return () => window.clearTimeout(t);
  }, [staerke]);

  return (
    <div className="st-himmel" data-staerke={staerke} aria-hidden>
      <div className="st-wolke st-w1" />
      <div className="st-wolke st-w2" />
      <div className="st-wolke st-w3" />
      {staerke >= 1 && <div className="st-regen" />}
      {staerke >= 1 && <div className="st-regen st-regen-2" />}
      {blitz && (
        <>
          <div key={`f${blitz.k}`} className="st-flash" />
          <svg key={`b${blitz.k}`} className="st-blitz" viewBox="0 0 100 100" preserveAspectRatio="none">
            <path d={blitz.d} />
          </svg>
        </>
      )}
      {staerke === 0 && <div className="st-sonne" />}
    </div>
  );
}

export default function SturmWidget({ bericht, vorher, istAdmin }: { bericht: Bericht | null; vorher: { tag: string; hoch: number; gesamt: number } | null; istAdmin: boolean }) {
  const router = useRouter();
  const [laeuft, starte] = useTransition();
  const [fehler, setFehler] = useState<string | null>(null);
  const [offen, setOffen] = useState<string | null>(null);
  // Ansicht je Gerät merken (Zylinder ist Standard); auf dem Server immer Zylinder
  const ansicht = useSyncExternalStore(
    (cb) => { window.addEventListener("ck-sturm-ansicht", cb); return () => window.removeEventListener("ck-sturm-ansicht", cb); },
    () => { try { return localStorage.getItem("ck-sturm-ansicht") === "liste" ? "liste" : "zylinder"; } catch { return ansichtSpeicher.wert; } },
    () => "zylinder" as const,
  );
  const ansichtSetzen = ansichtMerken;

  const pruefen = () => starte(async () => {
    setFehler(null);
    const r = await berichtJetztPruefen();
    if (!r.ok) setFehler(r.error);
    router.refresh();
  });

  const punkte = bericht?.punkte ?? [];
  const hoch = punkte.filter((p) => p.schwere === "hoch").length;
  const mittel = punkte.filter((p) => p.schwere === "mittel").length;
  const ernst = hoch + mittel;
  const staerke = !bericht ? 1 : hoch >= 3 ? 3 : hoch >= 1 ? 2 : mittel >= 1 ? 1 : 0;
  const stand = bericht ? new Date(bericht.stand).toLocaleString("de-DE", { weekday: "short", day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" }) : null;
  const trend = vorher ? ernst - vorher.gesamt : null;

  return (
    <div className="st" data-staerke={staerke}>
      <Gewitter staerke={staerke} />
      <div className="st-inhalt">
        <div className="st-kopf">
          <div className="st-zahl">
            {staerke === 0 ? <Sun size={34} /> : <CloudLightning size={34} />}
            <div>
              <div className="st-gross">
                {!bericht ? "Noch kein Bericht" : ernst === 0 ? "Alles ruhig" : `${ernst} Auffälligkeit${ernst === 1 ? "" : "en"}`}
              </div>
              <div className="st-unter">
                {bericht && <>{hoch > 0 && <b className="st-rot">{hoch} ernst</b>}{hoch > 0 && mittel > 0 && " · "}{mittel > 0 && <span>{mittel} beachten</span>}{punkte.length - ernst > 0 && <span> · {punkte.length - ernst} Hinweis{punkte.length - ernst === 1 ? "" : "e"}</span>}</>}
                {trend != null && trend !== 0 && <span className="st-trend" data-gut={trend < 0}> · {trend > 0 ? `${trend} mehr` : `${-trend} weniger`} als am {Number(vorher!.tag.slice(8, 10))}.{Number(vorher!.tag.slice(5, 7))}.</span>}
              </div>
            </div>
          </div>
          <div className="st-rechts">
            {stand && <span className="st-stand">Bericht von {stand}</span>}
            {punkte.length > 0 && (
              <span className="st-umschalter" role="group" aria-label="Ansicht">
                {(["zylinder", "liste"] as const).map((a) => (
                  <button key={a} type="button" aria-pressed={ansicht === a} onClick={() => ansichtSetzen(a)}>{a === "zylinder" ? "Zylinder" : "Liste"}</button>
                ))}
              </span>
            )}
            {istAdmin && (
              <button type="button" className="st-knopf" onClick={pruefen} disabled={laeuft} title="Alle Prüfungen jetzt laufen lassen (dauert etwa 20 Sekunden)">
                <RefreshCw size={13} className={laeuft ? "st-dreht" : undefined} /> {laeuft ? "Prüft …" : "Jetzt prüfen"}
              </button>
            )}
          </div>
        </div>

        {fehler && <div className="st-fehler">Prüfung fehlgeschlagen: {fehler}</div>}
        {!bericht && <div className="st-leer">Der Bericht entsteht jeden Tag gegen 12 Uhr.{istAdmin ? " Mit „Jetzt prüfen“ sofort." : ""}</div>}
        {bericht && ernst === 0 && punkte.length === 0 && <div className="st-leer">Alle Prüfungen ohne Befund – Lager, Chats, Zahlungen, Steuern, Werbung, Versand und Retouren sehen gut aus.</div>}

        {ansicht === "zylinder" && punkte.length > 0 && <SturmZylinder punkte={punkte} icons={ICON} bereiche={BEREICH} schwereText={SCHWERE} />}
        {ansicht === "liste" && <div className="st-liste">
          {punkte.map((p, i) => {
            const Icon = ICON[p.bereich] ?? Zap;
            const auf = offen === p.id;
            return (
              <div key={p.id} className="st-punkt" data-schwere={p.schwere} style={{ ["--i" as string]: i }}>
                <div className="st-punkt-kopf">
                  <span className="st-icon"><Icon size={15} /></span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div className="st-titel">{p.titel}</div>
                    <div className="st-detail">{p.detail}</div>
                  </div>
                  <div className="st-aktionen">
                    <span className="st-marke">{BEREICH[p.bereich]} · {SCHWERE[p.schwere]}</span>
                    {p.liste && p.liste.length > 0 && (
                      <button type="button" className="st-mehr" aria-expanded={auf} onClick={() => setOffen(auf ? null : p.id)} title="Einzelheiten">
                        <ChevronDown size={14} style={{ transform: auf ? "rotate(180deg)" : undefined, transition: "transform .2s" }} />
                      </button>
                    )}
                    {p.href && <Link href={p.href} className="st-link" {...(p.href.startsWith("http") ? { target: "_blank", rel: "noopener noreferrer" } : {})}>Ansehen</Link>}
                  </div>
                </div>
                {auf && p.liste && (
                  <ul className="st-einzel">
                    {p.liste.map((l, j) => <li key={j}>{l}</li>)}
                  </ul>
                )}
              </div>
            );
          })}
        </div>}

        {bericht && bericht.fehler.length > 0 && (
          <div className="st-fehlerliste" title={bericht.fehler.join("\n")}>
            <AlertOctagon size={12} /> Nicht geprüft: {bericht.fehler.map((f) => f.split(":")[0]).join(", ")}
          </div>
        )}
      </div>
    </div>
  );
}
