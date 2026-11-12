"use client";

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { AlertTriangle, Check, ChevronLeft, ChevronRight, Loader2, X } from "lucide-react";
import { Area, Bar, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { KATEGORIE_BY_KEY } from "@/lib/bank/kategorien";
import { LIQ_DEFAULTS, VERSAND_FRUEHESTENS_TAGE, ZOLL_NACH_VERSAND_TAGE, prognose, zahlGruppe, zerlegeRateSchluessel, type Ereignis, type LiqEinstellungen, type LiqRohdaten, type VerlaufTag, type ZahlGruppe } from "@/lib/liquiditaet/rechnung";
import { SYMBOLE, TerminSymbol, symbolTyp, type SymbolTyp } from "./termin-symbol";
import { AMPEL_STIL } from "../../orders/liquiditaet-badge";
import EinfuhrRechnung from "./einfuhr-rechnung";
import ZahlTermin, { type TerminEntwurf } from "./zahl-termin";
import { saveLiquiditaetEinstellungen, setZahlTermin } from "@/lib/actions/liquiditaet";

type VerbrauchWerte = { avg12mKg: number; avg3mKg: number; d30Kg: number; avg3mEur: number } | null;
export type Verbrauch = { glatt: VerbrauchWerte; wellig: VerbrauchWerte; stand: string | null };

const MONATE = ["Jan", "Feb", "Mär", "Apr", "Mai", "Jun", "Jul", "Aug", "Sep", "Okt", "Nov", "Dez"];
const STATUS: Record<string, string> = {
  sent_to_supplier: "An Lieferant", confirmed: "Bestätigt", in_production: "In Produktion",
  ready_to_ship: "Versandbereit", shipped: "Versandt", in_customs: "Verzollung", delivered: "Angekommen",
};

function eur(n: number) {
  return Math.round(n).toLocaleString("de-DE") + " €";
}
function usd(n: number) {
  return "$" + Math.round(n).toLocaleString("de-DE");
}
function deDate(iso: string) {
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y.slice(2)}`;
}
function monatLabel(m: string) {
  const [y, mo] = m.split("-");
  return `${MONATE[Number(mo) - 1]} ${y}`;
}

/** Diagrammzeile: Vergangenheit hat nur `ist`, Vorschau `saldo`. `b_<gruppe>`/`g_<gruppe>` = bezahlt/geplant (Abfluss positiv). */
type DiagrammTag = {
  datum: string;
  saldo?: number;
  ist?: number;
  ev: Ereignis[];
  buchungen?: VerlaufTag["buchungen"];
  weitere?: number;
  zahlungen?: VerlaufTag["zahlungen"];
} & Partial<Record<`${"b" | "g"}_${ZahlGruppe}`, number>>;

/** Einblendbare Zahlungsarten im Diagramm. */
const GRUPPEN: Array<{ key: ZahlGruppe; name: string; typ: SymbolTyp }> = [
  { key: "amanda", name: "Amanda", typ: "lieferant" },
  { key: "ebru", name: "Ebru / Raten", typ: "manuell" },
  { key: "einfuhr", name: "Einfuhrabgaben", typ: "einfuhr" },
  { key: "steuern", name: "Steuern", typ: "ust" },
];

/** Offene Lieferantenschulden nach einem Tag (EUR); Einfuhrabgaben nur zur Info, nicht in der Summe. */
type Schulden = { amanda: number; raten: number; ratenGeschaetzt: number; einfuhr: number; summe: number };

/** Eine Zeile der Zahlungsliste unter dem Diagramm. */
type ZahlZeile = { datum: string; gruppe: ZahlGruppe; label: string; betrag: number; bezahlt: boolean; ev?: Ereignis };

export default function Liquiditaet({ roh, gespeichert, verbrauch, verlauf }: { roh: LiqRohdaten; gespeichert: LiqEinstellungen; verbrauch: Verbrauch | null; verlauf: VerlaufTag[] }) {
  const [e, setE] = useState<LiqEinstellungen>(gespeichert);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  // Offene Terminfelder rechnen sofort mit (Schlüssel "bestellung:<id>" / "rate:<Lieferant>")
  const [entwuerfe, setEntwuerfe] = useState<Record<string, TerminEntwurf>>({});
  const rohMitEntwurf = useMemo(() => {
    const keys = Object.entries(entwuerfe);
    if (!keys.length) return roh;
    const v = { bestellungen: { ...roh.verschiebungen?.bestellungen }, raten: { ...roh.verschiebungen?.raten } };
    for (const [key, ent] of keys) {
      const [art, ...rest] = key.split(":");
      const id = rest.join(":");
      if (art === "bestellung") {
        // Stand beim Planen wie auf dem Server: bleibt, solange dieselbe Anzahlung schon bezahlt ist
        const alt = roh.verschiebungen?.bestellungen[id];
        const offen = roh.bestellungen.find((b) => b.id === id)?.restUsd ?? 0;
        const schonBezahlt = !!ent.anzahlungUsd && alt?.anzahlungUsd === ent.anzahlungUsd && alt.restBasisUsd != null && offen < alt.restBasisUsd - 0.01;
        v.bestellungen[id] = {
          datum: ent.datum,
          notiz: null,
          anzahlungUsd: ent.anzahlungUsd ?? null,
          restDatum: ent.restDatum ?? null,
          restBasisUsd: ent.anzahlungUsd ? (schonBezahlt ? alt.restBasisUsd : offen) : null,
        };
      } else v.raten[id] = { datum: ent.datum, notiz: null, basisZahlung: roh.letzteZahlung?.[zerlegeRateSchluessel(id).lieferant] ?? null };
    }
    return { ...roh, verschiebungen: v };
  }, [roh, entwuerfe]);
  const p = useMemo(() => prognose(rohMitEntwurf, e), [rohMitEntwurf, e]);
  const geaendert = JSON.stringify(e) !== JSON.stringify(gespeichert);
  // Angeklickter Tag im Diagramm + Sprung zum Eintrag darunter
  const [pin, setPin] = useState<{ datum: string; x: number } | null>(null);
  const [markiert, setMarkiert] = useState<string | null>(null);
  const [fokus, setFokus] = useState<{ key: string; n: number } | null>(null);
  const markierTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Wie viele Tage das Diagramm von der Vorschau in die Vergangenheit geschoben ist
  const [zurueck, setZurueck] = useState(0);
  // Eingeblendete Zahlungsarten (Balken + Liste unter dem Diagramm)
  const [zeigen, setZeigen] = useState<ZahlGruppe[]>([]);

  const set = <K extends keyof LiqEinstellungen>(k: K, v: LiqEinstellungen[K]) => {
    setE((prev) => ({ ...prev, [k]: v }));
    setMsg(null);
  };

  async function speichern() {
    setSaving(true);
    const res = await saveLiquiditaetEinstellungen(e);
    setSaving(false);
    setMsg(res.ok ? { ok: true, text: "Gespeichert — gilt jetzt auch für die Ampel an den Bestellungen." } : { ok: false, text: res.error ?? "Fehler" });
  }

  const terminProps = (art: "bestellung" | "rate", schluessel: string) => {
    const key = `${art}:${schluessel}`;
    return {
      min: p.start,
      max: p.tage.at(-1)?.datum ?? p.start,
      oeffnenSignal: fokus?.key === key ? fokus.n : 0,
      tiefpunkt: `${eur(p.tiefpunkt.saldo)} am ${deDate(p.tiefpunkt.datum)}`,
      onVorschau: (ent: TerminEntwurf | null) =>
        setEntwuerfe((prev) => {
          const next = { ...prev };
          if (ent) next[key] = ent;
          else delete next[key];
          return next;
        }),
      onSpeichern: async (ent: TerminEntwurf | null, notiz: string) => {
        const res = await setZahlTermin({ art, schluessel, datum: ent?.datum ?? null, notiz, anzahlungUsd: ent?.anzahlungUsd ?? null, restDatum: ent?.restDatum ?? null });
        return res.ok ? null : (res.error ?? "Fehler");
      },
    };
  };

  const laufendMonat = (p.laufendProTag * 365) / 12;
  const freiProTag = p.einnahmenProTag + p.laufendProTag;
  const alleTage = useMemo<DiagrammTag[]>(() => {
    const byDay = new Map<string, Ereignis[]>();
    for (const ev of p.ereignisse) byDay.set(ev.datum, [...(byDay.get(ev.datum) ?? []), ev]);
    const vergangen = verlauf.filter((t) => t.datum < p.start);
    // Heutige Buchungen stecken schon im Startstand, gehören aber als "bezahlt" zum ersten Vorschau-Tag
    const heuteGebucht = verlauf.find((t) => t.datum === p.start)?.zahlungen;
    const vorschau: DiagrammTag[] = p.tage.map((t, i) => ({ ...t, ev: byDay.get(t.datum) ?? [], ...(i === 0 && heuteGebucht ? { zahlungen: heuteGebucht } : {}) }));
    // Echte Linie läuft bis an den Start der Vorschau heran
    if (vorschau[0] && vergangen.length) vorschau[0] = { ...vorschau[0], ist: vergangen.at(-1)?.saldo };
    const zeilen: DiagrammTag[] = [
      ...vergangen.map((t) => ({ datum: t.datum, ist: t.saldo, ev: [], buchungen: t.buchungen, weitere: t.weitere, zahlungen: t.zahlungen })),
      ...vorschau,
    ];
    for (const z of zeilen) {
      for (const b of z.zahlungen ?? []) z[`b_${b.gruppe}`] = (z[`b_${b.gruppe}`] ?? 0) - b.betrag;
      for (const ev of z.ev) {
        const g = zahlGruppe(ev);
        if (g) z[`g_${g}`] = (z[`g_${g}`] ?? 0) - ev.betrag;
      }
    }
    return zeilen;
  }, [p, verlauf]);
  const fensterTage = p.tage.length;
  const maxZurueck = Math.max(0, alleTage.length - fensterTage);
  const versatz = Math.min(zurueck, maxZurueck); // Vorschau-Zeitraum kann in den Annahmen kürzer werden
  const schritt = Math.max(7, Math.round(fensterTage / 3));
  const chartData = useMemo(() => alleTage.slice(maxZurueck - versatz, maxZurueck - versatz + fensterTage), [alleTage, maxZurueck, versatz, fensterTage]);
  const verschiebe = (tage: number) => {
    setPin(null);
    setZurueck(Math.max(0, Math.min(maxZurueck, versatz + tage)));
  };
  // Steuertermine als Marken im Diagramm (gleicher Tag → übereinander)
  const steuerMarken = useMemo(() => {
    const m = new Map<string, Ereignis[]>();
    for (const ev of p.ereignisse) if (ev.art === "steuer") m.set(ev.datum, [...(m.get(ev.datum) ?? []), ev]);
    return [...m.entries()];
  }, [p]);
  // Aktions-Eingänge (ein Eintrag pro Tag) im Terminkalender zu einer Zeile zusammenfassen
  const aktionEv = p.ereignisse.filter((x) => x.art === "aktion");
  const manuellRaten = p.ereignisse.filter((x) => x.art === "manuell" && !x.unterwegs);
  // Größte Abgänge bis zum Tiefpunkt (für den Warnhinweis)
  const ursachen = useMemo(() => {
    const NAMEN: Record<string, string> = { lieferant: "Amanda", manuell: "Ebru-Raten", einfuhr: "Einfuhrabgaben", steuer: "Steuern", nachbestellung: "Amanda-Nachbestellungen" };
    const sum = new Map<string, number>();
    for (const x of p.ereignisse) {
      if (x.datum > p.tiefpunkt.datum || x.betrag >= 0 || !NAMEN[x.art]) continue;
      sum.set(NAMEN[x.art], (sum.get(NAMEN[x.art]) ?? 0) - x.betrag);
    }
    return [...sum.entries()].sort((a, b) => b[1] - a[1]);
  }, [p]);

  // Ein Klick trifft selten genau den Tag mit der Stufe → nächsten Tag mit Terminen in der Nähe nehmen
  function diagrammKlick(state: { activeTooltipIndex?: unknown; activeCoordinate?: { x: number } }) {
    const idx = Number(state.activeTooltipIndex);
    if (!Number.isInteger(idx) || !chartData[idx]) return setPin(null);
    const toleranz = Math.max(2, Math.round(chartData.length / 40));
    const hatInhalt = (t: DiagrammTag | undefined) => !!t && (t.ev.length > 0 || !!t.buchungen?.length);
    let tag = chartData[idx];
    for (let d = 1; !hatInhalt(tag) && d <= toleranz; d++) {
      tag = hatInhalt(chartData[idx + d]) ? chartData[idx + d] : hatInhalt(chartData[idx - d]) ? chartData[idx - d] : tag;
    }
    if (!hatInhalt(tag) || pin?.datum === tag.datum) return setPin(null);
    setPin({ datum: tag.datum, x: state.activeCoordinate?.x ?? 0 });
  }

  /** Wo ein Termin auf der Seite steht und welches Terminfeld sich dabei öffnet. */
  function zielVon(ev: Ereignis): { id: string; oeffnen?: string } {
    if (ev.unterwegs) return { id: `bestellung-${ev.orderId}` };
    if (ev.art === "lieferant") return { id: `bestellung-${ev.orderId}`, oeffnen: `bestellung:${ev.orderId}` };
    if (ev.art === "einfuhr" && ev.orderId) return { id: `bestellung-${ev.orderId}` };
    if (ev.art === "manuell") {
      const lieferant = ev.ratenLieferant ?? "";
      return { id: `rate-${manuellRaten.indexOf(ev)}`, oeffnen: `rate:${ev.rateTermin?.schluessel ?? lieferant}` };
    }
    return { id: terminId(ev) };
  }

  function springeZu(ev: Ereignis) {
    const ziel = zielVon(ev);
    setPin(null);
    setMarkiert(ziel.id);
    if (ziel.oeffnen) setFokus((prev) => ({ key: ziel.oeffnen!, n: (prev?.n ?? 0) + 1 }));
    if (markierTimer.current) clearTimeout(markierTimer.current);
    markierTimer.current = setTimeout(() => setMarkiert(null), 3000);
    requestAnimationFrame(() => document.getElementById(ziel.id)?.scrollIntoView({ behavior: "smooth", block: "center" }));
  }

  const zeileCls = (id: string) => `transition-colors duration-500 ${markiert === id ? "bg-amber-100" : ""}`;
  const pinTag = pin ? chartData.find((d) => d.datum === pin.datum) : undefined;
  // Verbleibende Lieferantenschulden nach einem Tag: heute offen − bis dahin geplante Zahlungen
  const schuldenNach = useMemo(() => {
    const amandaOffen = p.bestellungen.filter((b) => !b.bezahlt).reduce((s, b) => s + b.betragEur, 0);
    const ratenPos = roh.ratenPositionen ?? roh.manuellePositionen ?? [];
    const ratenOffen = ratenPos.reduce((s, x) => s + Math.max(0, x.restUsd), 0) / p.fx;
    // Raten zahlen die ältesten Rechnungen zuerst ab → die geschätzten (in Produktion) bleiben am längsten offen
    const geschaetztOffen = ratenPos.filter((x) => x.geschaetzt).reduce((s, x) => s + Math.max(0, x.restUsd), 0) / p.fx;
    const einfuhrOffen = p.ereignisse.filter((x) => x.art === "einfuhr").reduce((s, x) => s - x.betrag, 0);
    return (datum: string): Schulden | null => {
      if (datum < p.start) return null;
      // Zahlungen "unterwegs" sind schon von der Schuld abgezogen (Rest an der Bestellung) — nicht doppelt
      const bis = (art: Ereignis["art"]) => p.ereignisse.filter((x) => x.art === art && !x.unterwegs && x.datum <= datum).reduce((s, x) => s - x.betrag, 0);
      const amanda = Math.max(0, amandaOffen - bis("lieferant"));
      const raten = Math.max(0, ratenOffen - bis("manuell"));
      return { amanda, raten, ratenGeschaetzt: Math.min(raten, geschaetztOffen), einfuhr: Math.max(0, einfuhrOffen - bis("einfuhr")), summe: amanda + raten };
    };
  }, [p, roh]);
  const pinSchulden = pin ? schuldenNach(pin.datum) : null;
  const chartAnzeige = useMemo(
    () => (pin && pin.datum >= p.start ? chartData.map((t) => (t.datum >= pin.datum ? { ...t, schuld: schuldenNach(t.datum)?.summe } : t)) : chartData),
    [chartData, pin, p.start, schuldenNach],
  );
  const fensterVon = chartData[0]?.datum ?? p.start;
  const fensterBis = chartData.at(-1)?.datum ?? p.start;
  const zahlListe: ZahlZeile[] = zeigen.length
    ? chartData.flatMap((t) => [
        ...(t.zahlungen ?? []).filter((b) => zeigen.includes(b.gruppe)).map((b) => ({ datum: t.datum, gruppe: b.gruppe, label: b.name, betrag: b.betrag, bezahlt: true })),
        ...t.ev.flatMap((ev) => {
          const g = zahlGruppe(ev);
          return g && zeigen.includes(g) ? [{ datum: t.datum, gruppe: g, label: ev.label, betrag: ev.betrag, bezahlt: false, ev }] : [];
        }),
      ])
    : [];
  const umschalten = (g: ZahlGruppe) => setZeigen((prev) => (prev.includes(g) ? prev.filter((x) => x !== g) : [...prev, g]));
  const ebruRegel = e.ratenLieferanten[0] ?? null;
  const setEbru = (patch: Partial<NonNullable<typeof ebruRegel>>) =>
    ebruRegel && set("ratenLieferanten", [{ ...ebruRegel, ...patch }, ...e.ratenLieferanten.slice(1)]);
  const termine = [
    ...p.ereignisse.filter((x) => x.art !== "lieferant" && x.art !== "aktion"),
    ...(aktionEv.length
      ? [{ datum: aktionEv[0].datum, betrag: aktionEv.reduce((s, x) => s + x.betrag, 0), art: "aktion" as const, label: `${e.aktion?.label ?? "Aktion"}: Mehrumsatz-Eingänge bis ${deDate(aktionEv.at(-1)!.datum)}` }]
      : []),
  ].sort((a, b) => a.datum.localeCompare(b.datum));
  const setAktion = (patch: Partial<NonNullable<LiqEinstellungen["aktion"]>>) =>
    e.aktion && set("aktion", { ...e.aktion, ...patch });
  const offenAmanda = p.bestellungen.filter((b) => !b.bezahlt).reduce((s, b) => s + b.betragEur, 0);
  const ebruGeschaetztUsd = (roh.ratenPositionen ?? []).filter((x) => x.geschaetzt).reduce((s, x) => s + x.restUsd, 0);
  const einfuhrAndereSumme = p.einfuhrAndere.reduce((s, b) => s + (b.einfuhr ? b.einfuhr.eust + b.einfuhr.zoll : 0), 0);
  const einfuhrSumme = p.bestellungen.reduce((s, b) => s + (b.einfuhr ? b.einfuhr.eust + b.einfuhr.zoll : 0), 0);

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">Liquidität</h1>
        <p className="text-sm text-neutral-500 mt-1">
          Vorschau {e.horizontTage} Tage ab {deDate(p.start)} · Kontostand Sparkasse aus Monatsabschluss + Buchungen bis {deDate(roh.saldoStand)} ·
          Basis Ø {roh.basis.monate.length ? roh.basis.monate.map(monatLabel).join(", ") : "letzte 30 Tage"}
        </p>
      </div>

      {/* Warnung */}
      {p.tiefpunkt.saldo < e.puffer && (
        <div className={`flex items-start gap-3 rounded-2xl border-2 px-4 py-3 ${p.tiefpunkt.saldo < 0 ? "border-red-300 bg-red-50 text-red-800" : "border-amber-300 bg-amber-50 text-amber-800"}`}>
          <AlertTriangle size={20} className="shrink-0 mt-0.5" />
          <div className="text-sm">
            <div className="font-semibold">
              {p.tiefpunkt.saldo < 0
                ? `Am ${deDate(p.tiefpunkt.datum)} fehlen voraussichtlich ${eur(-p.tiefpunkt.saldo)} auf dem Konto.`
                : `Am ${deDate(p.tiefpunkt.datum)} sinkt das Konto auf ${eur(p.tiefpunkt.saldo)} — unter der Reserve von ${eur(e.puffer)}.`}
            </div>
            {ursachen.length > 0 && (
              <div className="mt-0.5 opacity-90">
                Bis dahin: {ursachen.map(([name, betrag]) => `${name} ${eur(betrag)}`).join(" · ")} (Details unten).
              </div>
            )}
          </div>
        </div>
      )}
      {manuellRaten.length > 0 ? (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <div>
            <b>Ebru ist über den Ratenplan eingerechnet:</b> {manuellRaten.length} Raten ({eur(-manuellRaten.reduce((s, x) => s + x.betrag, 0))}) vom{" "}
            {deDate(manuellRaten[0].datum)} bis {deDate(manuellRaten[manuellRaten.length - 1].datum)} für alle offenen Rechnungen
            {ebruGeschaetztUsd > 0 && <> und die Ware in Produktion (≈ {usd(ebruGeschaetztUsd)}, Rechnung geschätzt beim Versand — reiht sich hinten ein)</>}.
            {" "}Einfuhrabgaben der Ebru-Lieferungen stehen einzeln kurz nach dem Versand (Tabelle unten).
            {Object.entries(roh.ratenKommendUsd ?? {}).filter(([, v]) => v > 0).map(([l, v]) => (
              <span key={l}>
                {" "}Noch nicht enthalten: {l.split(" ")[0]}-Ware in Produktion ≈ {usd(v)} — die Rechnung kommt erst beim Versand, dann reiht sie sich automatisch hinten ein.
              </span>
            ))}
            {e.andereLieferantenEinrechnen && (
              <>
                {" "}<b>Achtung:</b> zusätzlich ist der Lieferanten-Ø aus der Bank eingerechnet — Ebru zählt dadurch doppelt.{" "}
                <button onClick={() => set("andereLieferantenEinrechnen", false)} className="underline font-medium">Ø ausschalten</button>
              </>
            )}
          </div>
        </div>
      ) : !e.andereLieferantenEinrechnen && p.andereLieferantenProTag < 0 && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          <AlertTriangle size={18} className="shrink-0 mt-0.5" />
          <div>
            <b>Ebru/China und andere Lieferanten sind nicht eingerechnet</b> (keine offenen Rechnungen erfasst). Laut Kontoumsätzen gingen an sie Ø{" "}
            {eur((-p.andereLieferantenProTag * 365) / 12)} pro Monat. Mit diesem Durchschnitt läge der Tiefpunkt bei{" "}
            <b>{eur(p.tiefpunktMitAnderen.saldo)} am {deDate(p.tiefpunktMitAnderen.datum)}</b>.{" "}
            <button onClick={() => set("andereLieferantenEinrechnen", true)} className="underline font-medium">Einrechnen</button>
          </div>
        </div>
      )}

      {/* Kennzahlen */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kachel
          label={p.paypal?.eingerechnet ? "Sparkasse + PayPal" : "Kontostand Sparkasse"}
          value={eur(p.startSaldoGesamt)}
          sub={roh.konten
            .map((k) => {
              const bank = roh.bankSalden.find((b) => b.iban === k.iban);
              return `…${k.iban.slice(-4)} ${eur(k.saldo)}${bank && Math.abs(bank.saldo - k.saldo) > 1 ? ` (Bank ${eur(bank.saldo)})` : ""}`;
            })
            .join(" · ")}
        />
        <Kachel label="Ø Einnahmen / Tag" value={eur(p.einnahmenProTag)} sub={`${eur((p.einnahmenProTag * 365) / 12)} / Monat`} tone="green" />
        <Kachel label="Ø laufende Abgänge" value={eur(-laufendMonat)} sub="pro Monat (ohne Ware & Steuern)" />
        <Kachel label="Frei pro Tag" value={eur(freiProTag)} sub="vor Lieferanten & Steuern" tone={freiProTag >= 0 ? "green" : "red"} />
        <Kachel label="Tiefpunkt" value={eur(p.tiefpunkt.saldo)} sub={deDate(p.tiefpunkt.datum)} tone={p.tiefpunkt.saldo < 0 ? "red" : p.tiefpunkt.saldo < e.puffer ? "amber" : "green"} />
      </div>
      {p.paypal && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-neutral-200 bg-white px-4 py-2 text-sm">
          <span className="text-neutral-600">
            PayPal-Guthaben (noch nicht aufs Konto überwiesen){" "}
            <span className="text-xs text-neutral-400">
              {p.paypal.eingerechnet ? "— als verfügbares Geld im Startstand" : "— nicht eingerechnet"} · PayPal meldet mit bis zu 3 h Verzögerung
            </span>
          </span>
          <span className="flex items-center gap-3">
            <span className="font-semibold tabular-nums">
              {eur(p.paypal.saldo)} <span className="text-xs font-normal text-neutral-400">abgerufen {deDate(p.paypal.abgerufenAm.slice(0, 10))}</span>
            </span>
            <Schalter label="einrechnen" checked={e.paypalEinrechnen} onChange={(v) => set("paypalEinrechnen", v)} />
          </span>
        </div>
      )}
      {roh.bankSalden.filter((b) => b.iban.slice(4, 12) === "30020900").map((b) => (
        <div key={b.iban} className="flex flex-wrap items-baseline justify-between gap-2 rounded-xl border border-neutral-200 bg-white px-4 py-2 text-sm">
          <span className="text-neutral-600">
            Gehaltskonto Targobank …{b.iban.slice(-4)} <span className="text-xs text-neutral-400">(nicht in der Vorschau — Gehälter, Miete, Krankenkassen laufen dort über die Überträge von der Sparkasse)</span>
          </span>
          <span className="font-semibold tabular-nums">{eur(b.saldo)} <span className="text-xs font-normal text-neutral-400">Stand {deDate(b.stand)}</span></span>
        </div>
      ))}

      {/* Verlauf */}
      <Card title="Kontostand-Verlauf" accent="border-l-blue-500">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="text-xs tabular-nums text-neutral-500">
            {deDate(fensterVon)} – {deDate(fensterBis)}
            {fensterVon < p.start && <span className="ml-2 inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-neutral-500" /> echter Kontostand</span>}
            {fensterBis >= p.start && <span className="ml-2 inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-blue-600" /> Vorschau</span>}
          </span>
          <span className="flex items-center gap-1">
            {versatz > 0 && (
              <button onClick={() => verschiebe(-versatz)} className="rounded-md px-2 py-1 text-xs font-medium text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900">
                Heute
              </button>
            )}
            <button
              onClick={() => verschiebe(schritt)}
              disabled={versatz >= maxZurueck}
              aria-label={`${schritt} Tage zurück`}
              title={`${schritt} Tage zurück`}
              className="rounded-md border border-neutral-200 p-1 text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              onClick={() => verschiebe(-schritt)}
              disabled={versatz === 0}
              aria-label={`${schritt} Tage vor`}
              title={`${schritt} Tage vor`}
              className="rounded-md border border-neutral-200 p-1 text-neutral-600 hover:bg-neutral-100 hover:text-neutral-900 disabled:opacity-30 disabled:hover:bg-transparent"
            >
              <ChevronRight size={16} />
            </button>
          </span>
        </div>
        <div className="mb-2 flex flex-wrap items-center gap-1.5 text-xs">
          <span className="mr-1 text-neutral-500">Zahlungen einblenden:</span>
          {GRUPPEN.map((g) => {
            const an = zeigen.includes(g.key);
            const farbe = SYMBOLE[g.typ].farbe;
            return (
              <button
                key={g.key}
                onClick={() => umschalten(g.key)}
                aria-pressed={an}
                style={an ? { backgroundColor: farbe, borderColor: farbe } : { borderColor: farbe, color: farbe }}
                className={`rounded-full border px-2.5 py-0.5 font-medium transition-colors ${an ? "text-white" : "bg-white hover:bg-neutral-50"}`}
              >
                {g.name}
              </button>
            );
          })}
          {zeigen.length > 0 && (
            <button onClick={() => setZeigen([])} className="ml-1 text-neutral-500 underline decoration-dotted underline-offset-2 hover:text-neutral-900">
              ausblenden
            </button>
          )}
        </div>
        <div className="relative cursor-pointer [&_*:focus]:outline-none" style={{ width: "100%", height: 300 }}>
          <ResponsiveContainer>
            <ComposedChart data={chartAnzeige} margin={{ top: 12, right: 8, left: 8, bottom: 0 }} onClick={diagrammKlick}>
              <CartesianGrid stroke="#f3f4f6" />
              <XAxis dataKey="datum" tick={{ fontSize: 11, fill: "#737373" }} tickFormatter={(d) => `${String(d).slice(8, 10)}.${String(d).slice(5, 7)}.`} minTickGap={24} />
              <YAxis tick={{ fontSize: 11, fill: "#737373" }} tickFormatter={(v) => `${Math.round(v / 1000)}k`} width={44} />
              {zeigen.length > 0 && (
                <YAxis
                  yAxisId="z"
                  orientation="right"
                  tick={{ fontSize: 10, fill: "#a3a3a3" }}
                  tickFormatter={(v) => `${Math.round(v / 1000)}k`}
                  width={44}
                  label={{ value: "Zahlungen (Balken)", angle: 90, position: "insideRight", fontSize: 10, fill: "#a3a3a3", dx: 6 }}
                />
              )}
              {/* Eigene Achse, damit die Schuldensumme die Kontostand-Kurve nicht flach drückt */}
              {pinSchulden && (
                <YAxis
                  yAxisId="s"
                  orientation="right"
                  domain={[0, "auto"]}
                  tick={{ fontSize: 10, fill: "#7c3aed" }}
                  tickFormatter={(v) => `${Math.round(v / 1000)}k`}
                  width={44}
                  label={{ value: "offene Schulden", angle: 90, position: "insideRight", fontSize: 10, fill: "#7c3aed", dx: 6 }}
                />
              )}
              <Tooltip
                content={({ active, payload }) => {
                  if (pin || !active || !payload?.length) return null;
                  const d = payload[0].payload as DiagrammTag;
                  return (
                    <div className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs shadow-sm max-w-sm space-y-1">
                      <div className="font-semibold">{deDate(d.datum)}: {eur(d.saldo ?? d.ist ?? 0)}</div>
                      <TagesBuchungen tag={d} />
                      {d.ev.map((x, i) => (
                        <div key={i} className="flex items-start gap-1.5 text-neutral-600">
                          <TerminSymbol typ={symbolTyp(x)} schaetzung={x.schaetzung} />
                          <span>
                            <span className={`tabular-nums font-medium ${x.betrag >= 0 ? "text-emerald-700" : "text-neutral-900"}`}>
                              {x.betrag < 0 ? "−" : "+"}{eur(Math.abs(x.betrag))}
                            </span>{" "}
                            {x.label}
                            {x.verschoben && <span className="ml-1 font-medium text-amber-700">verschoben</span>}
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                }}
              />
              <ReferenceLine y={0} stroke="#dc2626" strokeWidth={1.5} />
              {pin && <ReferenceLine x={pin.datum} stroke="#171717" strokeWidth={1.5} />}
              {versatz > 0 && fensterBis >= p.start && (
                <ReferenceLine x={p.start} stroke="#737373" strokeDasharray="4 3" label={{ value: "Heute", position: "insideBottomLeft", fontSize: 10, fill: "#737373" }} />
              )}
              <ReferenceLine y={e.puffer} stroke="#d97706" strokeDasharray="4 4" label={{ value: "Reserve", position: "insideTopRight", fontSize: 10, fill: "#d97706" }} />
              <Area type="stepAfter" dataKey="ist" stroke="#737373" fill="#f5f5f5" strokeWidth={2} isAnimationActive={false} />
              <Area type="stepAfter" dataKey="saldo" stroke="#2563eb" fill="#dbeafe" strokeWidth={2} isAnimationActive={false} />
              {/* Ab dem angeklickten Tag: was an Lieferanten danach noch offen ist */}
              {pinSchulden && <Line yAxisId="s" type="stepAfter" dataKey="schuld" stroke="#7c3aed" strokeWidth={2} strokeDasharray="6 4" dot={false} activeDot={false} isAnimationActive={false} />}
              {/* Zahlungen als Balken (rechte Achse): bezahlt blass, geplant kräftig */}
              {GRUPPEN.filter((g) => zeigen.includes(g.key)).flatMap((g) => [
                <Bar key={`b_${g.key}`} yAxisId="z" dataKey={`b_${g.key}`} stackId="z" fill={SYMBOLE[g.typ].farbe} fillOpacity={0.4} maxBarSize={10} isAnimationActive={false} />,
                <Bar key={`g_${g.key}`} yAxisId="z" dataKey={`g_${g.key}`} stackId="z" fill={SYMBOLE[g.typ].farbe} maxBarSize={10} isAnimationActive={false} />,
              ])}
              {steuerMarken.filter(([datum]) => datum >= fensterVon && datum <= fensterBis).map(([datum, evs]) => (
                <ReferenceLine
                  key={datum}
                  x={datum}
                  stroke={SYMBOLE[symbolTyp(evs[0])].farbe}
                  strokeDasharray="2 3"
                  strokeOpacity={0.6}
                  label={(props: { viewBox?: { x?: number; y?: number } }) => <SteuerMarke x={props.viewBox?.x ?? 0} y={props.viewBox?.y ?? 0} evs={evs} />}
                />
              ))}
            </ComposedChart>
          </ResponsiveContainer>
          {pin && pinTag && (
            <TagPopup
              datum={pinTag.datum}
              saldo={pinTag.saldo ?? pinTag.ist ?? 0}
              ereignisse={pinTag.ev}
              tag={pinTag}
              schulden={pinSchulden}
              kommendUsd={roh.ratenKommendUsd}
              x={pin.x}
              onSchliessen={() => setPin(null)}
              onWaehlen={springeZu}
            />
          )}
        </div>
        {zeigen.length > 0 && <ZahlungsListe zeilen={zahlListe} zeigen={zeigen} von={fensterVon} bis={fensterBis} onWaehlen={springeZu} />}
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-neutral-500">
          {(["ust", "lst", "est", "gewst", "einfuhr", "lieferant", "manuell", "aktion"] as SymbolTyp[]).map((t) => (
            <span key={t} className="inline-flex items-center gap-1">
              <TerminSymbol typ={t} /> {SYMBOLE[t].name}
            </span>
          ))}
          <span className="inline-flex items-center gap-1"><span className="font-semibold">≈</span> = Schätzung</span>
        </div>
        <p className="mt-2 text-xs text-neutral-500">
          Täglich: + Ø Einnahmen − Ø laufende Abgänge. Stufen = Lieferantenzahlungen, Einfuhrabgaben und Steuertermine; die Marken oben zeigen,
          wann welche Steuer abgeht (Maus darüber für Details). Ein Klick auf einen Termin im Diagramm hält die Liste fest, von dort springst du zum Eintrag.
          Mit dem Pfeil nach links siehst du die Vergangenheit: echter Kontostand der Sparkasse am Tagesende{verlauf[0] ? ` ab ${deDate(verlauf[0].datum)}` : ""}, ohne PayPal.
          Die lila gestrichelte Linie ab dem angeklickten Tag zeigt die danach noch offenen Lieferantenschulden (Amanda + Ebru/Raten inkl. ≈ Ware in Produktion, ohne künftige Nachbestellungen).
        </p>
      </Card>

      {/* Bestellungen */}
      <Card title={`Amanda-Bestellungen — offen ${eur(offenAmanda)} + Einfuhrabgaben ${eur(einfuhrSumme)}`} accent="border-l-violet-500">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200">
                <Th>Bestellung</Th>
                <Th>Status</Th>
                <Th>Ankunft</Th>
                <Th>Zahlung (versandbereit)</Th>
                <Th right>Betrag</Th>
                <Th right>Konto danach</Th>
                <Th>Ampel</Th>
                <Th>Einfuhrabgaben bei Ankunft</Th>
              </tr>
            </thead>
            <tbody>
              {p.bestellungen.map((b) => (
                <tr key={b.orderId} id={`bestellung-${b.orderId}`} className={`border-b border-neutral-100 align-top ${zeileCls(`bestellung-${b.orderId}`)}`}>
                  <td className="py-2 pr-2">
                    <Link href={`/orders/${b.orderId}`} className="font-medium text-neutral-900 hover:underline">{b.label}</Link>
                  </td>
                  <td className="py-2 pr-2 text-xs text-neutral-600">{STATUS[b.status] ?? b.status}</td>
                  <td className="py-2 pr-2 tabular-nums text-neutral-600">{b.eta ? deDate(b.eta) : "—"}</td>
                  <td className="py-2 pr-2 tabular-nums">
                    {b.bezahlt ? (
                      <span className="text-emerald-700">bezahlt</span>
                    ) : (
                      <ZahlTermin
                        datum={b.zahlDatum}
                        sofort={b.sofort}
                        termin={b.termin}
                        anzahlung={{ offenUsd: b.betragUsd, restTage: e.restNachAnzahlungTage, teilung: b.teilung }}
                        {...terminProps("bestellung", b.orderId)}
                      />
                    )}
                  </td>
                  <td className="py-2 pr-2 text-right tabular-nums whitespace-nowrap">
                    {b.bezahlt ? "—" : <>{eur(b.betragEur)}<div className="text-xs text-neutral-400">{usd(b.betragUsd)}</div></>}
                  </td>
                  <td className={`py-2 pr-2 text-right tabular-nums font-medium ${b.bezahlt ? "text-neutral-400" : b.saldoNachZahlung < 0 ? "text-red-700" : "text-neutral-900"}`}>
                    {b.bezahlt ? "—" : eur(b.saldoNachZahlung)}
                  </td>
                  <td className="py-2 pr-2">
                    {!b.bezahlt && (
                      <span className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${AMPEL_STIL[b.ampel].cls}`}>
                        {AMPEL_STIL[b.ampel].text}
                        {b.ampel === "luecke" && ` −${eur(b.fehlbetrag)}`}
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-2 text-xs tabular-nums">
                    {b.einfuhr ? (
                      <>
                        {deDate(b.einfuhr.datum)}: {eur(b.einfuhr.eust + b.einfuhr.zoll)}
                        <span className="text-neutral-400"> (EUSt {eur(b.einfuhr.eust)}{b.einfuhr.zoll ? ` + Zoll ${eur(b.einfuhr.zoll)}` : ""})</span>
                        <div className={b.einfuhr.saldoDanach < 0 ? "text-red-700 font-medium" : "text-neutral-500"}>Konto danach {eur(b.einfuhr.saldoDanach)}</div>
                      </>
                    ) : b.einfuhrZahlung || b.einfuhrVermutung ? null : "—"}
                    <EinfuhrRechnung orderId={b.orderId} rechnung={b.einfuhrRechnung} zahlung={b.einfuhrZahlung} vermutung={b.einfuhrVermutung} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-neutral-500">
          Seit Juni zahlt ihr Amanda komplett, sobald die Ware versandbereit ist (vorher mit Anzahlung). Zahltag hier = Ankunft − {e.zahlungVorAnkunftTage} Tage;
          Status „Versandbereit/Versandt“ ohne Zahlung = sofort. Klick aufs Datum: verschieben oder Anzahlung planen (Rest standardmäßig {e.restNachAnzahlungTage} Tage später) —
          sobald eine Zahlung an der Bestellung eingetragen ist, gilt die Anzahlung als bezahlt. Betrag = offener Rest in USD ÷ {p.fx.toLocaleString("de-DE", { maximumFractionDigits: 4 })} USD/€
          ({p.fxQuelle === "auto" ? `Kurs eurer letzten Auslandsüberweisung${roh.fxAuto ? ` vom ${deDate(roh.fxAuto.datum)}` : ""}` : p.fxQuelle === "manuell" ? "manuell" : "Standard"}).
          Die EUSt holt ihr über die USt-Voranmeldung zurück — das ist unten bei der Umsatzsteuer eingerechnet; der Zoll nicht.
          Einfuhrabgaben sind geschätzt, fällig bei Ankunft (noch nicht versendete Ware mit überholtem Datum: frühestens in {VERSAND_FRUEHESTENS_TAGE} Tagen), und zählen ohne Rechnungsnummer, bis die Ware angekommen ist. Mit DHL-Rechnungsnummer (ZIT…) zählt das Konto:
          Sobald die Nummer im Verwendungszweck einer Abbuchung steht, gelten sie als bezahlt — vorher bleiben sie drin, auch wenn die Ware schon eingelagert ist.
          Ohne Nummer: Bucht DHL nach dem Versand eine ZIT-Rechnung ab, die an keiner Bestellung steht, wird sie mit der ältesten verschickten Bestellung verrechnet
          („wahrscheinlich bezahlt“ — mit „Zuordnen“ bestätigen), damit sie nicht doppelt zählt (schon im Kontostand und noch als Zahlung).
        </p>
      </Card>

      {/* Ebru-Lieferungen: Einfuhrabgaben kurz nach Versand (die Ware selbst läuft über die Raten) */}
      {p.einfuhrAndere.length > 0 && (
        <Card title={`Ebru-Lieferungen — Einfuhrabgaben ${eur(einfuhrAndereSumme)}`} accent="border-l-orange-500">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200">
                  <Th>Lieferung</Th>
                  <Th>Status</Th>
                  <Th>Ankunft</Th>
                  <Th right>Warenwert</Th>
                  <Th>Einfuhrabgaben (Ungewitter)</Th>
                </tr>
              </thead>
              <tbody>
                {p.einfuhrAndere.map((b) => (
                  <tr key={b.orderId} id={`bestellung-${b.orderId}`} className={`border-b border-neutral-100 align-top ${zeileCls(`bestellung-${b.orderId}`)}`}>
                    <td className="py-2 pr-2">
                      <Link href={`/orders/${b.orderId}`} className="font-medium text-neutral-900 hover:underline">{b.label}</Link>
                    </td>
                    <td className="py-2 pr-2 text-xs text-neutral-600">{STATUS[b.status] ?? b.status}</td>
                    <td className="py-2 pr-2 tabular-nums text-neutral-600">{b.eta ? deDate(b.eta) : "—"}</td>
                    <td className="py-2 pr-2 text-right tabular-nums whitespace-nowrap">
                      {b.geschaetzt ? "≈ " : ""}{usd(b.warenUsd)}
                      {b.geschaetzt && <div className="text-xs text-neutral-400">noch ohne Rechnung</div>}
                    </td>
                    <td className="py-2 pr-2 text-xs tabular-nums">
                      {b.einfuhr ? (
                        <>
                          {deDate(b.einfuhr.datum)}: {eur(b.einfuhr.eust + b.einfuhr.zoll)}
                          <span className="text-neutral-400"> (EUSt {eur(b.einfuhr.eust)}{b.einfuhr.zoll ? ` + Zoll ${eur(b.einfuhr.zoll)}` : ""})</span>
                          <div className={b.einfuhr.saldoDanach < 0 ? "text-red-700 font-medium" : "text-neutral-500"}>Konto danach {eur(b.einfuhr.saldoDanach)}</div>
                        </>
                      ) : b.einfuhrZahlung || b.einfuhrVermutung ? null : "—"}
                      <EinfuhrRechnung orderId={b.orderId} rechnung={b.einfuhrRechnung} zahlung={b.einfuhrZahlung} vermutung={b.einfuhrVermutung} art="zoll" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-xs text-neutral-500">
            Bezahlt wird die Ware über den Ebru-Ratenplan; hier stehen nur Zoll und EUSt, geschätzt aus dem Warenwert (≈ = noch keine Rechnung,
            Warenwert aus der Bestellung). Termin: Die Rechnung von Carl Ungewitter kommt ~{ZOLL_NACH_VERSAND_TAGE} Tage nach dem Versand, Versand = Ankunft − {e.zahlungVorAnkunftTage} Tage.
            Ist die Ankunft vorbei, die Ware aber noch nicht versendet, wird der Versand frühestens in {VERSAND_FRUEHESTENS_TAGE} Tagen angenommen — dann bitte das Ankunftsdatum an der Bestellung aktualisieren. Trag die Rechnungsnummer des Verzollers ein (z.B. Ungewitter „26 33474“ oder DHL „ZIT…“) — sobald sie auf dem Konto
            abgebucht ist, fallen die Abgaben aus der Vorschau.
          </p>
        </Card>
      )}

      {/* Termine */}
      <Card title="Weitere Termine im Zeitraum" accent="border-l-red-500">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <tbody>
              {termine.map((t, i) => (
                <tr key={i} id={terminId(t)} className={`border-b border-neutral-100 ${zeileCls(terminId(t))}`}>
                  <td className="py-1.5 pr-3 tabular-nums text-neutral-600 whitespace-nowrap">{deDate(t.datum)}</td>
                  <td className="py-1.5 pr-2 whitespace-nowrap">
                    <TerminSymbol typ={symbolTyp(t)} schaetzung={"schaetzung" in t ? t.schaetzung : false} />
                  </td>
                  <td className="py-1.5 pr-3 text-neutral-800">
                    {t.label}
                    {t.sofort && <span className="ml-1 text-xs text-red-600">überfällig</span>}
                    {"verschoben" in t && t.verschoben && <span className="ml-1 text-xs font-medium text-amber-700">verschoben</span>}
                    {t.art === "steuer" && (
                      <Link href="/finances/prepayments" className="ml-2 text-xs text-neutral-500 underline decoration-dotted underline-offset-2 hover:text-neutral-900">
                        in Vorauszahlungen ändern
                      </Link>
                    )}
                  </td>
                  <td className={`py-1.5 text-right tabular-nums font-medium ${t.betrag >= 0 ? "text-emerald-700" : "text-neutral-900"}`}>{t.betrag >= 0 ? "+" : "−"}{eur(Math.abs(t.betrag))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-3 text-xs text-neutral-500">
          Umsatzsteuer: tatsächlich gezahlt Ø {p.ustIstSchnitt != null ? eur(p.ustIstSchnitt) : "—"} pro Monat ({roh.steuern.ustHistorie.map((h) => monatLabel(h.monat)).join(", ") || "keine Historie"}).
          Vorschau: {eur(p.ustBasis)} vor EUSt-Verrechnung, minus EUSt des Monats — Amanda-Lieferungen einzeln, übrige Lieferanten (Ebru …) Ø {eur(p.eustAndereMonat)};
          mit Dauerfristverlängerung fällig am 10. des übernächsten Monats, Erstattungen ca. 3 Wochen später.
          Lohnsteuer = Ø der letzten Anmeldungen. ESt/GewSt = letzte Vorauszahlung.
        </p>
      </Card>

      <div className="grid md:grid-cols-2 gap-6">
        {/* Einnahmen + laufende Abgänge */}
        <Card title="Einnahmen & laufende Abgänge" accent="border-l-emerald-500">
          <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-1">Einnahmen pro Tag (Konto)</div>
          {roh.basis.monatsWerte.map((m) => (
            <div key={m.monat} className="flex justify-between text-sm py-0.5">
              <span className="text-neutral-700">{monatLabel(m.monat)}{m.monat === roh.heute.slice(0, 7) && <span className="text-xs text-neutral-400"> (bis {deDate(roh.saldoStand)})</span>}</span>
              <span className="tabular-nums">{eur(m.einnahmen / m.tage)} <span className="text-xs text-neutral-400">· {eur(m.einnahmen)}</span></span>
            </div>
          ))}
          <div className="flex items-baseline justify-between mt-4 mb-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-neutral-500">Laufende Abgänge Ø pro Monat</span>
            <span className="text-[10px] text-neutral-400">fällt weg</span>
          </div>
          {roh.basis.laufend.map((l) => {
            const weg = e.ausgeblendeteKategorien.includes(l.kategorie);
            return (
              <label key={l.kategorie} className="flex items-center justify-between gap-2 text-sm py-0.5 cursor-pointer">
                <span className={weg ? "text-neutral-400 line-through" : "text-neutral-700"}>{KATEGORIE_BY_KEY[l.kategorie]?.label ?? l.kategorie}</span>
                <span className="flex items-center gap-2">
                  <span className={`tabular-nums ${weg ? "text-neutral-400 line-through" : ""}`}>{eur((-l.summe / roh.basis.tage) * (365 / 12))}</span>
                  <input
                    type="checkbox"
                    checked={weg}
                    onChange={(ev) =>
                      set(
                        "ausgeblendeteKategorien",
                        ev.target.checked ? [...e.ausgeblendeteKategorien, l.kategorie] : e.ausgeblendeteKategorien.filter((k) => k !== l.kategorie)
                      )
                    }
                    className="h-3.5 w-3.5 rounded border-neutral-300"
                    title="Fällt ab jetzt weg (z.B. Kredit abbezahlt) — wird nicht mehr eingerechnet"
                  />
                </span>
              </label>
            );
          })}
          <p className="mt-3 text-xs text-neutral-500">
            Aus den <Link href="/finances/bank" className="underline">Kontoumsätzen</Link> (Sparkasse). Der Übertrag aufs Targobank-Gehaltskonto deckt Gehälter, Miete,
            Krankenkassen und Versicherungen ab. Wareneinkauf und Steuern laufen oben einzeln.
          </p>
        </Card>

        {/* Verbrauch */}
        <Card title="Verbrauch & Bestellrhythmus" accent="border-l-neutral-400">
          {verbrauch?.glatt ? (
            <>
              <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-1">Russisch glatt (Amanda) — Verkauf laut Shopify</div>
              <Zeile l="Ø letzte 3 Monate" r={`${verbrauch.glatt.avg3mKg.toLocaleString("de-DE", { maximumFractionDigits: 1 })} kg / Monat`} />
              <Zeile l="Ø letzte 12 Monate" r={`${verbrauch.glatt.avg12mKg.toLocaleString("de-DE", { maximumFractionDigits: 1 })} kg / Monat`} />
              <Zeile l="Letzte 30 Tage" r={`${verbrauch.glatt.d30Kg.toLocaleString("de-DE", { maximumFractionDigits: 1 })} kg`} />
            </>
          ) : (
            <p className="text-sm text-neutral-400">Verkaufsanalyse (Stock-Sheet) gerade nicht erreichbar.</p>
          )}
          {verbrauch?.wellig && (
            <>
              <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mt-3 mb-1">Usbekisch wellig (Ebru) — Verkauf laut Shopify</div>
              <Zeile l="Ø letzte 3 Monate" r={`${verbrauch.wellig.avg3mKg.toLocaleString("de-DE", { maximumFractionDigits: 1 })} kg / Monat`} />
            </>
          )}
          <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mt-3 mb-1">Amanda-Bestellungen</div>
          <Zeile l="Bestellt Ø letzte 3 Monate (inkl. Black-Friday-Vorrat)" r={`${roh.nachbestellung.kgProMonatAuto.toLocaleString("de-DE")} kg / Monat`} />
          <Zeile l="Für Nachbestellungen gerechnet" r={`${p.nachbestellKgMonat.toLocaleString("de-DE", { maximumFractionDigits: 1 })} kg / Monat${e.nachbestellKgMonat ? " (manuell)" : roh.nachbestellung.kgVerbrauchMonat ? " (= Verbrauch)" : ""}`} />
          <Zeile l="Ø Einkaufspreis" r={`${usd(roh.nachbestellung.usdProKgAuto)} / kg`} />
          <Zeile l="Lieferzeit" r={`${roh.nachbestellung.leadWochen} Wochen`} />
          {roh.ebruNachbestellung && (
            <>
              <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mt-3 mb-1">Ebru-Bestellungen</div>
              <Zeile l="Bestellt Ø letzte 6 Monate" r={`${roh.ebruNachbestellung.kgProMonatAuto.toLocaleString("de-DE")} kg / Monat`} />
              <Zeile l="Ø Einkaufspreis" r={`${usd(roh.ebruNachbestellung.usdProKgAuto)} / kg`} />
              <Zeile l="Lieferzeit" r={`${roh.ebruNachbestellung.leadWochen} Wochen`} />
            </>
          )}
          {verbrauch?.stand && <p className="mt-2 text-xs text-neutral-400">Verkaufsanalyse: {verbrauch.stand}</p>}
        </Card>
      </div>

      {/* Verkaufsaktion */}
      {e.aktion && (
        <Card title={`${e.aktion.label} ${deDate(e.aktion.von)}–${deDate(e.aktion.bis)}`} accent="border-l-emerald-500">
          <div className="grid sm:grid-cols-2 md:grid-cols-4 gap-4">
            <div className="pt-5">
              <Schalter label="Mehrumsatz einrechnen" checked={e.aktion.aktiv} onChange={(v) => setAktion({ aktiv: v })} />
            </div>
            <Feld label="Mehrumsatz gesamt brutto (€)" value={e.aktion.mehrumsatzBrutto} onChange={(v) => setAktion({ mehrumsatzBrutto: v ?? 0 })} />
            <Feld label="Tage bis Geld auf dem Konto" value={e.aktion.verzugTage} onChange={(v) => setAktion({ verzugTage: v ?? 0 })} />
            <Feld label="Ankommender Anteil nach Gebühren (%)" value={e.aktion.auszahlungProzent} step={0.5} onChange={(v) => setAktion({ auszahlungProzent: v ?? 100 })} />
          </div>
          <p className="mt-3 text-xs text-neutral-500">
            {e.aktion.quelle}. Verteilt nach dem Tagesverlauf des Vorjahres (Spitzen rund um Black Friday). Eingang auf dem Konto {e.aktion.verzugTage} Tage
            später (Stripe/PayPal-Auszahlung), abzüglich Gebühren. Die Umsatzsteuer auf den Mehrumsatz ({eur((e.aktion.mehrumsatzBrutto * 19) / 119)}) ist in der
            USt-Voranmeldung des Aktionsmonats eingerechnet.
          </p>
        </Card>
      )}

      {manuellRaten.length > 0 && (
        <Card title="Ratenplan offene Rechnungen" accent="border-l-amber-400">
          <div className="text-xs text-neutral-500 mb-3 space-y-1">
            {ebruRegel && (
              <p>
                <b>{ebruRegel.name}:</b> alle offenen Rechnungen in Raten à {usd(ebruRegel.rateUsd)} — erste Rate {ebruRegel.fristTage} Tage nach
                Rechnungseingang (= Datum der Position), danach alle {ebruRegel.abstandTage} Tage ab der letzten Zahlung
                {ebruRegel.wechselAb && ebruRegel.abstandTageAb ? `, ab ${deDate(ebruRegel.wechselAb)} alle ${ebruRegel.abstandTageAb} Tage` : ""}
                {Object.entries(roh.letzteZahlung ?? {}).filter(([l]) => l.toLowerCase().includes(ebruRegel.name.toLowerCase())).map(([, d]) => ` (letzte laut Bank: ${deDate(d)})`)}.
              </p>
            )}
            <p>
              Manuelle Positionen anderer Lieferanten: Raten à {usd(e.manuellRateUsd)}, erste {e.manuellFristTage} Tage nach Datum, dann alle {e.manuellAbstandTage} Tage.
              Älteste Rechnung zuerst; eine Rate kann den Rest der einen und den Anfang der nächsten abdecken.
            </p>
            <p>
              Klick aufs Datum einer Rate verschiebt sie, die folgenden Raten rechnen ab ihr weiter. Mit jeder Bankzahlung rücken verschobene Raten
              eins vor (aus Rate 3 wird Rate 2) — ist die verschobene Rate selbst bezahlt, ist die Verschiebung erledigt.
            </p>
          </div>
          <div className="divide-y divide-neutral-100">
            {manuellRaten.map((r, i) => (
              <div key={i} id={`rate-${i}`} className={`flex items-center justify-between gap-3 py-1.5 text-sm ${zeileCls(`rate-${i}`)}`}>
                <span className="text-neutral-500 min-w-24 shrink-0">
                  {r.rateTermin ? (
                    <ZahlTermin datum={r.datum} sofort={!!r.sofort} termin={r.rateTermin} {...terminProps("rate", r.rateTermin.schluessel)} />
                  ) : (
                    deDate(r.datum)
                  )}
                </span>
                <span className="flex-1 min-w-0 truncate text-neutral-800">{r.label}</span>
                <span className="font-medium text-neutral-900">{eur(-r.betrag)}</span>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* Einstellungen */}
      <Card title="Annahmen (anpassbar)" accent="border-l-neutral-400">
        <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-4">
          <Feld label="Zahlung an Amanda (Tage vor Ankunft)" value={e.zahlungVorAnkunftTage} onChange={(v) => set("zahlungVorAnkunftTage", v ?? LIQ_DEFAULTS.zahlungVorAnkunftTage)} />
          <Feld label="Reserve / Puffer (€)" value={e.puffer} onChange={(v) => set("puffer", v ?? 0)} />
          <Feld label="Amanda: Rest nach Anzahlung (Tage)" value={e.restNachAnzahlungTage} onChange={(v) => set("restNachAnzahlungTage", Math.max(1, Math.min(180, v ?? LIQ_DEFAULTS.restNachAnzahlungTage)))} />
          {ebruRegel && (
            <>
              <Feld label={`${ebruRegel.name}: Rate (USD)`} value={ebruRegel.rateUsd} step={1000} onChange={(v) => setEbru({ rateUsd: Math.max(1000, v ?? 40_000) })} />
              <Feld label={`${ebruRegel.name}: erste Rate nach Rechnungseingang (Tage)`} value={ebruRegel.fristTage} onChange={(v) => setEbru({ fristTage: Math.max(0, v ?? 14) })} />
              <Feld label={`${ebruRegel.name}: Abstand der Raten (Tage)`} value={ebruRegel.abstandTage} onChange={(v) => setEbru({ abstandTage: Math.max(1, v ?? 14) })} />
              <label className="block">
                <span className="text-xs font-medium text-neutral-600">{ebruRegel.name}: neuer Rhythmus ab (leer = keiner)</span>
                <input
                  type="date"
                  value={ebruRegel.wechselAb ?? ""}
                  onChange={(ev) => setEbru({ wechselAb: ev.target.value || null, abstandTageAb: ev.target.value ? (ebruRegel.abstandTageAb ?? 7) : null })}
                  className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900 focus:outline-none"
                />
              </label>
              {ebruRegel.wechselAb && (
                <Feld label={`${ebruRegel.name}: Abstand ab ${deDate(ebruRegel.wechselAb)} (Tage)`} value={ebruRegel.abstandTageAb ?? 7} onChange={(v) => setEbru({ abstandTageAb: Math.max(1, v ?? 7) })} />
              )}
            </>
          )}
          <Feld label="Manuelle Positionen: Rate (USD)" value={e.manuellRateUsd} step={1000} onChange={(v) => set("manuellRateUsd", Math.max(1000, v ?? LIQ_DEFAULTS.manuellRateUsd))} />
          <Feld label="Manuelle Positionen: Zahlungsfrist (Tage)" value={e.manuellFristTage} onChange={(v) => set("manuellFristTage", Math.max(0, v ?? LIQ_DEFAULTS.manuellFristTage))} />
          <Feld label="Manuelle Positionen: Abstand der Raten (Tage)" value={e.manuellAbstandTage} onChange={(v) => set("manuellAbstandTage", Math.max(1, v ?? LIQ_DEFAULTS.manuellAbstandTage))} />
          <Feld label="Vorschau (Tage)" value={e.horizontTage} onChange={(v) => set("horizontTage", Math.max(14, Math.min(365, v ?? 90)))} />
          <Feld label={`Wechselkurs USD/€ (leer = aus Bank: ${roh.fxAuto?.kurs ?? "—"})`} value={e.fxUsdProEur} step={0.0001} optional onChange={(v) => set("fxUsdProEur", v)} />
          <Feld label="EUSt-Satz (%)" value={e.eustSatz} step={0.1} onChange={(v) => set("eustSatz", v ?? 19)} />
          <Feld label="Zollsatz (%) — Extensions 2,2" value={e.zollSatz} step={0.1} onChange={(v) => set("zollSatz", v ?? 0)} />
          <Feld label="Fracht-Aufschlag auf Zollwert (%)" value={e.frachtProzent} step={0.5} onChange={(v) => set("frachtProzent", v ?? 0)} />
          <Feld label={`USt pro Monat vor EUSt (leer = Ø ${eur(p.ustBasis)})`} value={e.ustBasisMonat} optional onChange={(v) => set("ustBasisMonat", v)} />
          <div className="space-y-2 pt-5">
            <Schalter label="Ebru/andere Lieferanten (Ø aus Bank)" checked={e.andereLieferantenEinrechnen} onChange={(v) => set("andereLieferantenEinrechnen", v)} />
            <Schalter label="Künftige Amanda-Nachbestellungen (Schätzung)" checked={e.nachbestellungenEinrechnen} onChange={(v) => set("nachbestellungenEinrechnen", v)} />
            <Schalter label="Künftige Ebru-Nachbestellungen (Schätzung)" checked={e.ebruNachbestellungenEinrechnen} onChange={(v) => set("ebruNachbestellungenEinrechnen", v)} />
            <Schalter label="Nicht zugeordnete DHL-/Ungewitter-Abbuchungen nach Versand verrechnen" checked={e.zollAbbuchungenVerrechnen} onChange={(v) => set("zollAbbuchungenVerrechnen", v)} />
          </div>
          {e.nachbestellungenEinrechnen && (
            <>
              <Feld
                label={`Nachbestellung kg/Monat (leer = ${roh.nachbestellung.kgVerbrauchMonat != null ? `Verbrauch ${roh.nachbestellung.kgVerbrauchMonat}` : `Ø Bestellungen ${roh.nachbestellung.kgProMonatAuto}`})`}
                value={e.nachbestellKgMonat}
                optional
                onChange={(v) => set("nachbestellKgMonat", v)}
              />
              <Feld label={`USD pro kg (leer = ${roh.nachbestellung.usdProKgAuto})`} value={e.usdProKg} optional onChange={(v) => set("usdProKg", v)} />
            </>
          )}
          {e.ebruNachbestellungenEinrechnen && (
            <>
              <Feld
                label={`Ebru kg/Monat (leer = Ø Bestellungen ${roh.ebruNachbestellung?.kgProMonatAuto ?? 0})`}
                value={e.ebruNachbestellKgMonat}
                optional
                onChange={(v) => set("ebruNachbestellKgMonat", v)}
              />
              <Feld label={`Ebru USD pro kg (leer = ${roh.ebruNachbestellung?.usdProKgAuto ?? 0})`} value={e.ebruUsdProKg} optional onChange={(v) => set("ebruUsdProKg", v)} />
            </>
          )}
        </div>
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={speichern}
            disabled={saving || !geaendert}
            className="flex items-center gap-1.5 bg-neutral-900 text-white font-medium rounded-lg px-4 py-2 text-sm disabled:opacity-40"
          >
            {saving ? <Loader2 size={14} className="animate-spin" /> : msg?.ok ? <Check size={14} /> : null}
            Speichern
          </button>
          <button onClick={() => setE({ ...LIQ_DEFAULTS, aktion: e.aktion })} className="text-sm text-neutral-500 hover:text-neutral-900">Standardwerte</button>
          {geaendert && !saving && <span className="text-xs text-amber-700">Vorschau zeigt ungespeicherte Annahmen</span>}
          {msg && <span className={`text-xs ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.text}</span>}
        </div>
        {p.hinweise.length > 0 && (
          <ul className="mt-3 list-disc pl-5 text-xs text-amber-700">{p.hinweise.map((h, i) => <li key={i}>{h}</li>)}</ul>
        )}
      </Card>
    </div>
  );
}

/** Steuer-Marke(n) oben im Diagramm: farbige Kapsel mit Symbol + Kürzel, gleicher Tag gestapelt. */
function SteuerMarke({ x, y, evs }: { x: number; y: number; evs: Ereignis[] }) {
  return (
    <g>
      {evs.map((ev, i) => {
        const s = SYMBOLE[symbolTyp(ev)];
        const text = `${ev.schaetzung ? "≈" : ""}${s.kurz}`;
        const w = 18 + text.length * 6;
        const top = y + 2 + i * 18;
        return (
          <g key={i}>
            <title>{`${ev.label}: ${eur(Math.abs(ev.betrag))}`}</title>
            <rect x={x - w / 2} y={top} width={w} height={16} rx={8} fill="#fff" stroke={s.farbe} strokeWidth={1.2} />
            <s.Icon x={x - w / 2 + 4} y={top + 3} width={10} height={10} color={s.farbe} strokeWidth={2.5} />
            <text x={x - w / 2 + 16} y={top + 11.5} fontSize={9.5} fontWeight={600} fill={s.farbe}>
              {text}
            </text>
          </g>
        );
      })}
    </g>
  );
}

function Zeile({ l, r }: { l: string; r: string }) {
  return (
    <div className="flex justify-between text-sm py-0.5">
      <span className="text-neutral-700">{l}</span>
      <span className="tabular-nums">{r}</span>
    </div>
  );
}

function Feld({ label, value, onChange, step = 1, optional }: { label: string; value: number | null; onChange: (v: number | null) => void; step?: number; optional?: boolean }) {
  return (
    <label className="block">
      <span className="text-xs font-medium text-neutral-600">{label}</span>
      <input
        type="number"
        step={step}
        value={value ?? ""}
        placeholder={optional ? "automatisch" : undefined}
        onChange={(ev) => {
          const raw = ev.target.value.replace(",", ".");
          onChange(raw === "" ? null : Number(raw));
        }}
        className="mt-1 w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900 focus:outline-none"
      />
    </label>
  );
}

function Schalter({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-neutral-700 cursor-pointer">
      <input type="checkbox" checked={checked} onChange={(ev) => onChange(ev.target.checked)} className="h-4 w-4 rounded border-neutral-300" />
      {label}
    </label>
  );
}

function Kachel({ label, value, sub, tone = "neutral" }: { label: string; value: string; sub?: string; tone?: "green" | "red" | "amber" | "neutral" }) {
  const color = { green: "text-emerald-700", red: "text-red-700", amber: "text-amber-700", neutral: "text-neutral-900" }[tone];
  return (
    <div className="bg-neutral-50 rounded-xl p-3 text-center">
      <div className="text-xs font-medium text-neutral-500 uppercase tracking-wide">{label}</div>
      <div className={`text-lg font-bold mt-1 tabular-nums ${color}`}>{value}</div>
      {sub && <div className="text-[11px] text-neutral-400 mt-0.5 leading-tight">{sub}</div>}
    </div>
  );
}

/** Anker einer Zeile in „Weitere Termine“; die Aktion ist dort eine Sammelzeile. */
function terminId(ev: Pick<Ereignis, "art" | "datum" | "label">) {
  return ev.art === "aktion" ? "termin-aktion" : `termin-${ev.art}-${ev.datum}-${ev.label}`;
}

const ZIEL_TEXT: Partial<Record<Ereignis["art"], string>> = { lieferant: "Termin ändern", manuell: "Termin ändern" };

/** Eingeblendete Zahlungen im sichtbaren Zeitraum: Summen je Art + Liste (bezahlt = Bank, geplant = Vorschau). */
function ZahlungsListe({ zeilen, zeigen, von, bis, onWaehlen }: { zeilen: ZahlZeile[]; zeigen: ZahlGruppe[]; von: string; bis: string; onWaehlen: (ev: Ereignis) => void }) {
  const summe = (g: ZahlGruppe, bezahlt: boolean) => {
    const z = zeilen.filter((x) => x.gruppe === g && x.bezahlt === bezahlt);
    return { betrag: -z.reduce((s, x) => s + x.betrag, 0), n: z.length };
  };
  return (
    <div className="mt-3 rounded-xl border border-neutral-200">
      <div className="grid gap-px overflow-hidden rounded-t-xl bg-neutral-200 sm:grid-cols-2 lg:grid-cols-4">
        {GRUPPEN.filter((g) => zeigen.includes(g.key)).map((g) => {
          const b = summe(g.key, true);
          const v = summe(g.key, false);
          return (
            <div key={g.key} className="bg-neutral-50 px-3 py-2 text-xs">
              <div className="flex items-center gap-1.5 font-semibold text-neutral-800">
                <TerminSymbol typ={g.typ} /> {g.name}
              </div>
              <div className="mt-1 flex justify-between text-neutral-500">
                <span>bezahlt ({b.n})</span>
                <span className="tabular-nums text-neutral-700">{eur(b.betrag)}</span>
              </div>
              <div className="flex justify-between text-neutral-500">
                <span>geplant ({v.n})</span>
                <span className="tabular-nums font-semibold text-neutral-900">{eur(v.betrag)}</span>
              </div>
            </div>
          );
        })}
      </div>
      <div className="px-3 pt-2 text-[11px] text-neutral-400">
        {deDate(von)} – {deDate(bis)} · mit den Pfeilen oben verschieben · bezahlt = laut Kontoumsätzen, geplant = Vorschau
      </div>
      {zeilen.length === 0 ? (
        <p className="px-3 py-3 text-sm text-neutral-400">Keine Zahlungen in diesem Zeitraum.</p>
      ) : (
        <div className="max-h-80 overflow-y-auto px-3 pb-2">
          <table className="w-full text-sm">
            <tbody>
              {zeilen.map((z, i) => {
                const typ = GRUPPEN.find((g) => g.key === z.gruppe)!.typ;
                return (
                  <tr key={i} className="border-b border-neutral-100 last:border-0">
                    <td className="py-1.5 pr-3 tabular-nums text-neutral-600 whitespace-nowrap">{deDate(z.datum)}</td>
                    <td className="py-1.5 pr-2 whitespace-nowrap">
                      <TerminSymbol typ={z.ev ? symbolTyp(z.ev) : typ} schaetzung={z.ev?.schaetzung} />
                    </td>
                    <td className="py-1.5 pr-3 text-neutral-800">
                      {z.ev ? (
                        <button onClick={() => onWaehlen(z.ev!)} className="text-left hover:underline">
                          {z.label}
                          {z.ev.verschoben && <span className="ml-1 text-xs font-medium text-amber-700">verschoben</span>}
                        </button>
                      ) : (
                        z.label
                      )}
                    </td>
                    <td className="py-1.5 pr-3 text-xs whitespace-nowrap">
                      {z.bezahlt ? <span className="text-emerald-700">bezahlt</span> : <span className="text-neutral-500">geplant</span>}
                    </td>
                    <td className={`py-1.5 text-right tabular-nums font-medium whitespace-nowrap ${z.betrag >= 0 ? "text-emerald-700" : z.bezahlt ? "text-neutral-500" : "text-neutral-900"}`}>
                      {z.betrag >= 0 ? "+" : "−"}{eur(Math.abs(z.betrag))}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Größte Buchungen eines vergangenen Tages. */
function TagesBuchungen({ tag }: { tag: DiagrammTag }) {
  if (!tag.buchungen?.length) return null;
  return (
    <div className="space-y-0.5">
      {tag.buchungen.map((b, i) => (
        <div key={i} className="flex items-baseline justify-between gap-3 text-neutral-600">
          <span className="min-w-0 truncate">{b.name}</span>
          <span className={`shrink-0 tabular-nums font-medium ${b.betrag >= 0 ? "text-emerald-700" : "text-neutral-900"}`}>
            {b.betrag < 0 ? "−" : "+"}{eur(Math.abs(b.betrag))}
          </span>
        </div>
      ))}
      {!!tag.weitere && <div className="text-neutral-400">+ {tag.weitere} kleinere Buchungen</div>}
    </div>
  );
}

/** Festgehaltene Tagesliste im Diagramm; jeder Eintrag springt zu seiner Zeile auf der Seite. */
function TagPopup({
  datum,
  saldo,
  ereignisse,
  tag,
  schulden,
  kommendUsd = {},
  x,
  onSchliessen,
  onWaehlen,
}: {
  datum: string;
  saldo: number;
  ereignisse: Ereignis[];
  tag: DiagrammTag;
  schulden: Schulden | null;
  /** Ratenlieferanten: Ware in Produktion ohne Rechnung (USD) — noch nicht in den Schulden. */
  kommendUsd?: Record<string, number>;
  x: number;
  onSchliessen: () => void;
  onWaehlen: (ev: Ereignis) => void;
}) {
  const links = x > 340;
  return (
    <div
      onClick={(ev) => ev.stopPropagation()}
      style={links ? { right: `calc(100% - ${x - 8}px)` } : { left: x + 8 }}
      className="absolute top-2 z-10 max-h-72 w-80 max-w-full cursor-default overflow-y-auto rounded-lg border border-neutral-300 bg-white p-2 text-xs shadow-lg"
    >
      <div className="flex items-center justify-between gap-2 px-1 pb-1">
        <span className="font-semibold text-neutral-900">{deDate(datum)}: {eur(saldo)}</span>
        <button onClick={onSchliessen} aria-label="Schließen" className="text-neutral-400 hover:text-neutral-900">
          <X size={14} />
        </button>
      </div>
      <div className="px-1">
        <TagesBuchungen tag={tag} />
        {!!tag.buchungen?.length && (
          <Link href="/finances/bank" className="mt-1 inline-block text-neutral-500 underline decoration-dotted underline-offset-2 hover:text-neutral-900">
            Alle Kontoumsätze
          </Link>
        )}
      </div>
      <div className="space-y-0.5">
        {ereignisse.map((x2, i) => (
          <button
            key={i}
            onClick={() => onWaehlen(x2)}
            className="flex w-full items-start gap-1.5 rounded-md px-1 py-1 text-left text-neutral-600 hover:bg-neutral-100"
          >
            <TerminSymbol typ={symbolTyp(x2)} schaetzung={x2.schaetzung} />
            <span className="min-w-0 flex-1">
              <span className={`tabular-nums font-medium ${x2.betrag >= 0 ? "text-emerald-700" : "text-neutral-900"}`}>
                {x2.betrag < 0 ? "−" : "+"}{eur(Math.abs(x2.betrag))}
              </span>{" "}
              {x2.label}
              {x2.verschoben && <span className="ml-1 font-medium text-amber-700">verschoben</span>}
            </span>
            <span className="inline-flex shrink-0 items-center whitespace-nowrap font-medium text-neutral-900">
              {ZIEL_TEXT[x2.art] ?? "Zum Eintrag"}
              <ChevronRight size={12} />
            </span>
          </button>
        ))}
      </div>
      {schulden && (
        <div className="mt-1 border-t border-neutral-100 px-1 pt-1.5">
          <div className="flex justify-between font-semibold text-violet-800">
            <span>Danach noch offen</span>
            <span className="tabular-nums">{eur(schulden.summe)}</span>
          </div>
          <div className="flex justify-between text-neutral-600">
            <span>Amanda</span>
            <span className="tabular-nums">{eur(schulden.amanda)}</span>
          </div>
          <div className="flex justify-between text-neutral-600">
            <span>Ebru / Raten</span>
            <span className="tabular-nums">{eur(schulden.raten)}</span>
          </div>
          {schulden.ratenGeschaetzt > 0.5 && (
            <div className="flex justify-between text-neutral-400">
              <span>davon ≈ Ware in Produktion (noch ohne Rechnung)</span>
              <span className="tabular-nums">{eur(schulden.ratenGeschaetzt)}</span>
            </div>
          )}
          {Object.entries(kommendUsd).filter(([, v]) => v > 0).map(([l, v]) => (
            <div key={l} className="text-neutral-400">
              noch ohne Rechnung: {l.split(" ")[0]}-Ware in Produktion ≈ {usd(v)}
            </div>
          ))}
          {schulden.einfuhr > 0.5 && (
            <div className="flex justify-between text-neutral-400">
              <span>dazu Einfuhrabgaben (geschätzt)</span>
              <span className="tabular-nums">{eur(schulden.einfuhr)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Card({ title, accent, children }: { title: string; accent: string; children: React.ReactNode }) {
  return (
    <div className={`bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden border-l-4 ${accent}`}>
      <div className="px-4 md:px-6 py-3 bg-neutral-50 border-b border-neutral-200">
        <h2 className="text-sm font-semibold text-neutral-900 uppercase tracking-wide">{title}</h2>
      </div>
      <div className="px-4 md:px-6 py-4">{children}</div>
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th className={`py-2 pr-2 text-xs font-medium text-neutral-500 uppercase tracking-wide ${right ? "text-right" : "text-left"}`}>{children}</th>;
}
