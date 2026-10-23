"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, ChevronLeft, ChevronRight, Loader2, RefreshCw, RotateCcw, Search, Trash2, Wand2 } from "lucide-react";
import { KATEGORIEN, KATEGORIE_BY_KEY, type KategorieGruppe, type SteuerSplit } from "@/lib/bank/kategorien";
import {
  deleteRegelAction,
  fetchKontoumsaetze,
  rekategorisierenAction,
  resetKategorieAction,
  saveRegelAction,
  setKategorieAction,
  sucheKontoumsaetze,
  type KontoUmsatz,
  type RegelRow,
} from "@/lib/actions/kontoumsaetze";

type Data = { umsaetze: KontoUmsatz[]; regeln: RegelRow[]; letzterAbruf: string | null };

const MONATE = ["Januar", "Februar", "März", "April", "Mai", "Juni", "Juli", "August", "September", "Oktober", "November", "Dezember"];

const ART_LABEL: Record<SteuerSplit["art"], string> = {
  ust_va: "Umsatzsteuer-VA",
  ust_nachzahlung: "Umsatzsteuer (Jahr)",
  eust: "Einfuhrumsatzsteuer / Zoll",
  lst_anmeldung: "Lohnsteuer",
  est_vz: "ESt-Vorauszahlung",
  est_nachzahlung: "Einkommensteuer (Bescheid)",
  gewst_vz: "GewSt-Vorauszahlung",
  gewst_nachzahlung: "Gewerbesteuer (Bescheid)",
};

const GRUPPE_LABEL: Record<KategorieGruppe, string> = {
  einnahmen: "Einnahmen",
  steuern: "Steuern",
  ausgaben: "Ausgaben",
  neutral: "Neutral",
};

function fmt(n: number) {
  return n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}
function deDate(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
}
function zeitraumLabel(z: string) {
  const m = z.match(/^(\d{4})-(\d{2})$/);
  return m ? `${MONATE[Number(m[2]) - 1]} ${m[1]}` : z;
}
const BANKEN: Record<string, string> = { "29050101": "Sparkasse", "30020900": "Targobank" };
function konto(iban: string | null) {
  if (!iban) return "—";
  const bank = iban.startsWith("DE") ? BANKEN[iban.slice(4, 12)] : undefined;
  return `${bank ? bank + " " : ""}…${iban.slice(-4)}`;
}
const gruppeOf = (k: string | null) => KATEGORIE_BY_KEY[k ?? "unklar"]?.gruppe ?? "neutral";

/** Suchzeitraum: -1 = alle (null), 0 = ganzes Jahr, 1–12 = Monat. */
function zeitraumGrenzen(jahr: number, monat: number): { von: string; bis: string } | null {
  if (monat === -1) return null;
  if (monat === 0) return { von: `${jahr}-01-01`, bis: `${jahr}-12-31` };
  const mm = String(monat).padStart(2, "0");
  const letzter = new Date(Date.UTC(jahr, monat, 0)).getUTCDate();
  return { von: `${jahr}-${mm}-01`, bis: `${jahr}-${mm}-${letzter}` };
}

export default function Kontoumsaetze({ initialJahr, initialMonat, initial }: { initialJahr: number; initialMonat: number; initial: Data }) {
  const [jahr, setJahr] = useState(initialJahr);
  const [monat, setMonat] = useState<number>(initialMonat); // 0 = ganzes Jahr, -1 = alle Zeiträume
  const [data, setData] = useState<Data>(initial);
  const [kontoFilter, setKontoFilter] = useState("alle");
  const [katFilter, setKatFilter] = useState<string | null>(null);
  const [suche, setSuche] = useState("");
  // Suche ab 2 Zeichen im gewählten Zeitraum (Monat / Jahr / alle), alle Konten; null = keine Suche
  const [treffer, setTreffer] = useState<KontoUmsatz[] | null>(null);
  const [sucht, setSucht] = useState(false);
  const sucheRef = useRef("");
  sucheRef.current = suche;
  const zeitRef = useRef({ jahr, monat });
  zeitRef.current = { jahr, monat };

  async function suchen(q: string) {
    if (q.trim().length < 2) {
      setTreffer(null);
      return;
    }
    setSucht(true);
    const { jahr: j, monat: m } = zeitRef.current;
    const res = await sucheKontoumsaetze(q, zeitraumGrenzen(j, m));
    // Nur übernehmen, wenn inzwischen nicht weitergetippt / umgeschaltet wurde
    if (sucheRef.current === q && zeitRef.current.jahr === j && zeitRef.current.monat === m) {
      setTreffer(res.umsaetze);
      if (!res.ok) setMeldung({ ok: false, text: res.error ?? "Suche fehlgeschlagen" });
    }
    setSucht(false);
  }

  useEffect(() => {
    const q = suche;
    const timer = setTimeout(() => suchen(q), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suche, jahr, monat]);
  const [limit, setLimit] = useState(150);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [meldung, setMeldung] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, startLoad] = useTransition();

  async function reload(j = jahr, alle = zeitRef.current.monat === -1) {
    const d = await fetchKontoumsaetze(j, alle);
    setData(d);
    // Treffer nach Änderungen (Kategorie, Regel) aktualisieren
    if (sucheRef.current.trim().length >= 2) await suchen(sucheRef.current);
  }

  function changeYear(j: number) {
    setJahr(j);
    startLoad(() => reload(j));
  }

  // "Alle Zeiträume" lädt alle Jahre; zurück auf Monat/Jahr lädt wieder nur das gewählte Jahr
  function changeMonat(m: number) {
    const vorher = monat;
    setMonat(m);
    if (m === -1 && vorher !== -1) startLoad(() => reload(jahr, true));
    if (m !== -1 && vorher === -1) startLoad(() => reload(jahr, false));
  }

  const konten = useMemo(() => [...new Set(data.umsaetze.map((u) => u.account_iban).filter(Boolean))] as string[], [data]);

  // Zeitraum + Konto (Basis für Summen)
  const imZeitraum = useMemo(
    () =>
      data.umsaetze.filter(
        (u) =>
          (monat <= 0 || Number(u.booking_date.slice(5, 7)) === monat) &&
          (kontoFilter === "alle" || u.account_iban === kontoFilter)
      ),
    [data, monat, kontoFilter]
  );

  const summen = useMemo(() => {
    const byKat = new Map<string, { n: number; sum: number }>();
    const g: Record<KategorieGruppe, number> = { einnahmen: 0, steuern: 0, ausgaben: 0, neutral: 0 };
    for (const u of imZeitraum) {
      const k = u.kategorie ?? "unklar";
      const prev = byKat.get(k) ?? { n: 0, sum: 0 };
      prev.n++;
      prev.sum += u.amount;
      byKat.set(k, prev);
      g[gruppeOf(k)] += u.amount;
    }
    const unklar = byKat.get("unklar") ?? { n: 0, sum: 0 };
    const saldo = imZeitraum.reduce((s, u) => s + u.amount, 0);
    return { byKat, g, unklar, saldo };
  }, [imZeitraum]);

  // Steuerbuchungen im Zeitraum (jeder Anteil einzeln)
  const steuerZeilen = useMemo(
    () =>
      imZeitraum
        .filter((u) => gruppeOf(u.kategorie) === "steuern")
        .flatMap((u) =>
          u.steuer_split.length > 0
            ? u.steuer_split.map((s) => ({ u, art: ART_LABEL[s.art], zeitraum: zeitraumLabel(s.zeitraum), betrag: s.betrag }))
            : [{ u, art: KATEGORIE_BY_KEY[u.kategorie ?? "st_sonstige"]?.label ?? "Steuer", zeitraum: "—", betrag: -u.amount }]
        )
        .sort((a, b) => b.u.booking_date.localeCompare(a.u.booking_date)),
    [imZeitraum]
  );

  // Suche aktiv → Treffer aus allen Zeiträumen (Konto- und Kategoriefilter gelten weiter)
  const liste = useMemo(() => {
    const basis = treffer ?? imZeitraum;
    return basis.filter(
      (u) =>
        (!katFilter || (u.kategorie ?? "unklar") === katFilter) &&
        (!treffer || kontoFilter === "alle" || u.account_iban === kontoFilter)
    );
  }, [imZeitraum, treffer, katFilter, kontoFilter]);

  async function setKat(u: KontoUmsatz, kategorie: string) {
    setBusyId(u.id);
    setMeldung(null);
    const res = await setKategorieAction([u.id], kategorie);
    if (res.ok) await reload();
    else setMeldung({ ok: false, text: res.error ?? "Fehler" });
    setBusyId(null);
  }

  async function merken(u: KontoUmsatz) {
    if (!u.counterparty_name || !u.kategorie) return;
    setBusyId(u.id);
    const res = await saveRegelAction({
      feld: "counterparty_name",
      muster: u.counterparty_name,
      richtung: u.amount >= 0 ? "ein" : "aus",
      kategorie: u.kategorie,
    });
    await reload();
    setMeldung(
      res.ok
        ? { ok: true, text: `Regel gespeichert: „${u.counterparty_name}“ → ${KATEGORIE_BY_KEY[u.kategorie]?.label}. ${res.geaendert ?? 0} Umsätze neu eingeordnet.` }
        : { ok: false, text: res.error ?? "Fehler" }
    );
    setBusyId(null);
  }

  async function zuruecksetzen(u: KontoUmsatz) {
    setBusyId(u.id);
    const res = await resetKategorieAction(u.id);
    if (res.ok) await reload();
    else setMeldung({ ok: false, text: res.error ?? "Fehler" });
    setBusyId(null);
  }

  async function neuEinordnen() {
    setBusyId("all");
    const res = await rekategorisierenAction();
    await reload();
    setMeldung(res.ok ? { ok: true, text: `${res.geaendert ?? 0} Umsätze neu eingeordnet.` } : { ok: false, text: res.error ?? "Fehler" });
    setBusyId(null);
  }

  async function regelLoeschen(r: RegelRow) {
    if (!confirm(`Regel „${r.muster}“ → ${KATEGORIE_BY_KEY[r.kategorie]?.label ?? r.kategorie} löschen?`)) return;
    setBusyId(r.id);
    const res = await deleteRegelAction(r.id);
    await reload();
    if (!res.ok) setMeldung({ ok: false, text: res.error ?? "Fehler" });
    setBusyId(null);
  }

  const zeitraumText = monat === -1 ? "Alle Zeiträume" : monat === 0 ? `Jahr ${jahr}` : `${MONATE[monat - 1]} ${jahr}`;
  const steuerNetto = -summen.g.steuern;

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-6">
      {/* Kopf */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">Kontoumsätze</h1>
          <p className="text-sm text-neutral-500 mt-1">
            {zeitraumText} — {konten.map(konto).join(", ")}
            {data.letzterAbruf && <> · letzter Bankabruf {deDate(data.letzterAbruf)} {data.letzterAbruf.slice(11, 16)} UTC</>}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className={`flex items-center rounded-lg border border-neutral-300 bg-white ${monat === -1 ? "opacity-40 pointer-events-none" : ""}`}>
            <button onClick={() => changeYear(jahr - 1)} className="px-2 py-1.5 text-neutral-500 hover:text-neutral-900" aria-label="Vorjahr">
              <ChevronLeft size={16} />
            </button>
            <span className="px-1 text-sm font-semibold tabular-nums">{loading ? <Loader2 size={14} className="animate-spin inline" /> : jahr}</span>
            <button onClick={() => changeYear(jahr + 1)} className="px-2 py-1.5 text-neutral-500 hover:text-neutral-900" aria-label="Folgejahr">
              <ChevronRight size={16} />
            </button>
          </div>
          <select value={monat} onChange={(e) => changeMonat(Number(e.target.value))} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm bg-white">
            <option value={-1}>Alle Zeiträume</option>
            <option value={0}>Ganzes Jahr</option>
            {MONATE.map((m, i) => (
              <option key={m} value={i + 1}>{m}</option>
            ))}
          </select>
          <select value={kontoFilter} onChange={(e) => setKontoFilter(e.target.value)} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm bg-white">
            <option value="alle">Alle Konten</option>
            {konten.map((k) => (
              <option key={k} value={k}>{konto(k)}</option>
            ))}
          </select>
          <button
            onClick={neuEinordnen}
            disabled={busyId !== null}
            className="flex items-center gap-1.5 rounded-lg border border-neutral-300 bg-white px-3 py-1.5 text-sm text-neutral-700 hover:bg-neutral-50 disabled:opacity-50"
            title="Alle Umsätze nach den aktuellen Regeln neu einordnen (manuelle Zuordnungen bleiben)"
          >
            {busyId === "all" ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />} Neu einordnen
          </button>
        </div>
      </div>

      {meldung && (
        <div className={`text-xs rounded-lg px-3 py-2 border ${meldung.ok ? "bg-emerald-50 text-emerald-800 border-emerald-200" : "bg-red-50 text-red-700 border-red-200"}`}>
          {meldung.text}
        </div>
      )}

      {/* Kennzahlen */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <Kachel label="Einnahmen" value={fmt(summen.g.einnahmen)} tone="green" />
        <Kachel label="Ausgaben" value={fmt(-summen.g.ausgaben)} tone="neutral" />
        <Kachel label="Steuern (netto ans FA/Zoll)" value={fmt(steuerNetto)} tone="red" />
        <Kachel label="Saldo inkl. Umbuchungen" value={fmt(summen.saldo)} tone={summen.saldo >= 0 ? "green" : "red"} />
        <button
          onClick={() => setKatFilter(katFilter === "unklar" ? null : "unklar")}
          className={`rounded-xl p-3 text-center border-2 ${summen.unklar.n > 0 ? "border-amber-300 bg-amber-50" : "border-transparent bg-neutral-50"}`}
        >
          <div className="text-xs font-medium uppercase tracking-wide text-amber-700">Nicht zugeordnet</div>
          <div className="text-lg font-bold tabular-nums text-amber-800 mt-1">{summen.unklar.n}</div>
          <div className="text-xs text-amber-700/80 tabular-nums">{fmt(summen.unklar.sum)}</div>
        </button>
      </div>

      {/* Steuern */}
      <Card title={`Steuern laut Konto — ${zeitraumText}`} accent="border-l-red-500">
        {steuerZeilen.length === 0 ? (
          <p className="text-sm text-neutral-400">Keine Steuerbuchungen in diesem Zeitraum.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-neutral-200">
                  <Th>Gebucht</Th>
                  <Th>Steuer</Th>
                  <Th>Für Zeitraum</Th>
                  <Th>Empfänger</Th>
                  <Th right>Betrag</Th>
                </tr>
              </thead>
              <tbody>
                {steuerZeilen.map((z, i) => (
                  <tr key={`${z.u.id}-${i}`} className="border-b border-neutral-100">
                    <td className="py-1.5 tabular-nums text-neutral-600">{deDate(z.u.booking_date)}</td>
                    <td className="py-1.5 text-neutral-800">{z.art}</td>
                    <td className="py-1.5 text-neutral-600">{z.zeitraum}</td>
                    <td className="py-1.5 text-neutral-500 text-xs">{z.u.counterparty_name ?? "—"}</td>
                    <td className={`py-1.5 text-right tabular-nums font-medium ${z.betrag < 0 ? "text-emerald-700" : "text-red-700"}`}>
                      {z.betrag < 0 ? `Erstattung ${fmt(-z.betrag)}` : fmt(z.betrag)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-3 text-xs text-neutral-500">
          Finanzamt-Buchungen werden über den Verwendungszweck erkannt (z.B. „LOHNST JUL.26“) und automatisch als Ist in die{" "}
          <Link href="/finances/prepayments" className="underline">Vorauszahlungen</Link> übernommen. Von Hand eingetragene Beträge werden dabei nie
          überschrieben. EUSt/Zoll (Carl Ungewitter, DHL Express) kann Zoll und Gebühren enthalten; der genaue EUSt-Anteil steht auf der Rechnung.
        </p>
      </Card>

      {/* Kategorien */}
      <Card title={`Nach Kategorie — ${zeitraumText}`} accent="border-l-blue-500">
        <div className="grid md:grid-cols-2 gap-x-8 gap-y-4">
          {(["einnahmen", "ausgaben", "steuern", "neutral"] as KategorieGruppe[]).map((gruppe) => {
            const rows = KATEGORIEN.filter((k) => k.gruppe === gruppe && summen.byKat.has(k.key));
            if (rows.length === 0) return null;
            return (
              <div key={gruppe}>
                <div className="text-xs font-semibold uppercase tracking-wide text-neutral-500 mb-1">{GRUPPE_LABEL[gruppe]}</div>
                {rows.map((k) => {
                  const s = summen.byKat.get(k.key)!;
                  const active = katFilter === k.key;
                  return (
                    <button
                      key={k.key}
                      onClick={() => setKatFilter(active ? null : k.key)}
                      className={`w-full flex items-baseline justify-between gap-2 rounded-md px-2 py-1 text-sm text-left hover:bg-neutral-50 ${active ? "bg-neutral-100 font-semibold" : ""} ${k.key === "unklar" ? "text-amber-700" : ""}`}
                    >
                      <span>
                        {k.label} <span className="text-xs text-neutral-400">({s.n})</span>
                      </span>
                      <span className={`tabular-nums ${s.sum >= 0 ? "text-emerald-700" : "text-neutral-800"}`}>{fmt(s.sum)}</span>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      </Card>

      {/* Umsätze */}
      <Card
        title={`${treffer ? `Suchergebnisse — ${zeitraumText} (${liste.length}${treffer.length >= 300 ? "+" : ""})` : `Umsätze (${liste.length})`}${katFilter ? ` — ${KATEGORIE_BY_KEY[katFilter]?.label}` : ""}`}
        accent="border-l-neutral-400"
      >
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <div className="relative">
            <Search size={14} className="absolute left-2.5 top-2.5 text-neutral-400" />
            <input
              value={suche}
              onChange={(e) => setSuche(e.target.value)}
              placeholder={`Suche — ${zeitraumText}: Name, Zweck, 449,90, 19.10. …`}
              className="rounded-lg border border-neutral-300 pl-8 pr-8 py-1.5 text-sm w-80 max-w-full focus:ring-2 focus:ring-neutral-900 focus:outline-none"
            />
            {sucht && <Loader2 size={14} className="absolute right-2.5 top-2.5 animate-spin text-neutral-400" />}
            {!sucht && suche && (
              <button onClick={() => setSuche("")} className="absolute right-2.5 top-1.5 text-neutral-400 hover:text-neutral-900" title="Suche leeren">
                ✕
              </button>
            )}
          </div>
          {treffer && (
            <span className="text-xs text-neutral-500">
              {zeitraumText} (oben umschaltbar, auch „Alle Zeiträume“) · alle Konten · mehrere Begriffe = alle müssen vorkommen · Betrag „449,90“, Datum „19.10.“
              {treffer.length >= 300 && " · nur die neuesten 300 — Suche genauer eingrenzen"}
            </span>
          )}
          {katFilter && (
            <button onClick={() => setKatFilter(null)} className="text-xs rounded-lg border border-neutral-300 px-2 py-1 text-neutral-600 hover:bg-neutral-50">
              Filter „{KATEGORIE_BY_KEY[katFilter]?.label}“ entfernen ✕
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200">
                <Th>Datum</Th>
                <Th>Konto</Th>
                <Th>Gegenpartei / Zweck</Th>
                <Th right>Betrag</Th>
                <Th>Kategorie</Th>
              </tr>
            </thead>
            <tbody>
              {liste.slice(0, limit).map((u) => {
                const kat = u.kategorie ?? "unklar";
                const busy = busyId === u.id;
                return (
                  <tr key={u.id} className={`border-b border-neutral-100 align-top ${kat === "unklar" ? "bg-amber-50/40" : ""}`}>
                    <td className="py-2 pr-2 tabular-nums text-neutral-600 whitespace-nowrap">{deDate(u.booking_date)}</td>
                    <td className="py-2 pr-2 text-xs text-neutral-400 whitespace-nowrap">{konto(u.account_iban)}</td>
                    <td className="py-2 pr-2 max-w-[420px]">
                      <div className="text-neutral-800 truncate" title={u.counterparty_name ?? ""}>
                        {u.counterparty_name ?? <span className="text-neutral-400">{u.posting_text ?? "—"}</span>}
                      </div>
                      <div className="text-xs text-neutral-500 truncate" title={u.purpose ?? ""}>{u.purpose}</div>
                    </td>
                    <td className={`py-2 pr-2 text-right tabular-nums font-medium whitespace-nowrap ${u.amount >= 0 ? "text-emerald-700" : "text-neutral-900"}`}>
                      {fmt(u.amount)}
                    </td>
                    <td className="py-2">
                      <div className="flex items-center gap-1.5">
                        <select
                          value={kat}
                          disabled={busy || busyId === "all"}
                          onChange={(e) => setKat(u, e.target.value)}
                          className={`rounded-lg border px-2 py-1 text-xs bg-white max-w-[230px] focus:ring-2 focus:ring-neutral-900 focus:outline-none ${kat === "unklar" ? "border-amber-400 text-amber-800" : "border-neutral-300"}`}
                        >
                          {(["einnahmen", "ausgaben", "steuern", "neutral"] as KategorieGruppe[]).map((g) => (
                            <optgroup key={g} label={GRUPPE_LABEL[g]}>
                              {KATEGORIEN.filter((k) => k.gruppe === g).map((k) => (
                                <option key={k.key} value={k.key}>{k.label}</option>
                              ))}
                            </optgroup>
                          ))}
                        </select>
                        {busy && <Loader2 size={13} className="animate-spin text-neutral-400" />}
                        <QuelleBadge quelle={u.kategorie_quelle} />
                        {u.kategorie_quelle === "manuell" && !busy && (
                          <>
                            {u.counterparty_name && (
                              <button
                                onClick={() => merken(u)}
                                className="text-neutral-400 hover:text-neutral-900"
                                title={`Als Regel merken: alle ${u.amount >= 0 ? "Eingänge" : "Ausgänge"} von „${u.counterparty_name}“ → ${KATEGORIE_BY_KEY[kat]?.label}`}
                              >
                                <Wand2 size={14} />
                              </button>
                            )}
                            <button onClick={() => zuruecksetzen(u)} className="text-neutral-400 hover:text-neutral-900" title="Manuelle Zuordnung zurücknehmen">
                              <RotateCcw size={14} />
                            </button>
                          </>
                        )}
                      </div>
                      {u.steuer_split.length > 0 && (
                        <div className="mt-1 text-xs text-neutral-500">
                          {u.steuer_split.map((s) => `${ART_LABEL[s.art]} ${zeitraumLabel(s.zeitraum)}`).join(", ")}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {liste.length > limit && (
          <button onClick={() => setLimit(limit + 300)} className="mt-3 text-sm font-medium text-neutral-600 hover:text-neutral-900">
            Weitere {Math.min(300, liste.length - limit)} von {liste.length - limit} anzeigen
          </button>
        )}
        {liste.length === 0 && (
          <p className="py-4 text-sm text-neutral-400">{treffer ? `Keine Umsätze zu „${suche.trim()}“ gefunden.` : "Keine Umsätze für diese Auswahl."}</p>
        )}
        <p className="mt-3 text-xs text-neutral-500">
          Kategorie per Auswahlfeld ändern = gilt für diesen einen Umsatz. Mit <Wand2 size={12} className="inline" /> wird daraus eine Regel für alle
          Umsätze derselben Gegenpartei (auch künftige).
        </p>
      </Card>

      {/* Regeln */}
      <details className="bg-white rounded-2xl border border-neutral-200 shadow-sm">
        <summary className="cursor-pointer px-4 md:px-6 py-3 text-sm font-semibold text-neutral-900 uppercase tracking-wide">
          Regeln ({data.regeln.length})
        </summary>
        <div className="px-4 md:px-6 pb-4 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-neutral-200">
                <Th>Wenn …</Th>
                <Th>enthält</Th>
                <Th>Richtung</Th>
                <Th>→ Kategorie</Th>
                <Th>Notiz</Th>
                <Th right>{""}</Th>
              </tr>
            </thead>
            <tbody>
              {data.regeln.map((r) => (
                <tr key={r.id} className="border-b border-neutral-100">
                  <td className="py-1.5 text-xs text-neutral-500">
                    {{ counterparty_name: "Gegenpartei", counterparty_iban: "IBAN", purpose: "Verwendungszweck", posting_text: "Buchungstext" }[r.feld]}
                  </td>
                  <td className="py-1.5 font-mono text-xs">{r.muster}</td>
                  <td className="py-1.5 text-xs text-neutral-500">{{ ein: "Eingang", aus: "Ausgang", alle: "beide" }[r.richtung]}</td>
                  <td className="py-1.5">{KATEGORIE_BY_KEY[r.kategorie]?.label ?? r.kategorie}</td>
                  <td className="py-1.5 text-xs text-neutral-400">{r.notiz}</td>
                  <td className="py-1.5 text-right">
                    <button onClick={() => regelLoeschen(r)} disabled={busyId !== null} className="text-neutral-400 hover:text-red-600" title="Regel löschen">
                      {busyId === r.id ? <Loader2 size={14} className="animate-spin" /> : <Trash2 size={14} />}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-2 text-xs text-neutral-400">
            Finanzamt-Buchungen brauchen keine Regel — sie werden am Verwendungszweck erkannt. Kundenüberweisungen ordnet der Vorkasse-Abgleich zu.
          </p>
        </div>
      </details>

      {summen.unklar.n > 0 && (
        <div className="flex items-start gap-2 bg-amber-50 text-amber-800 text-xs rounded-lg px-3 py-2 border border-amber-200">
          <AlertTriangle size={14} className="shrink-0 mt-0.5" />
          {summen.unklar.n} Umsätze ({fmt(summen.unklar.sum)}) sind noch nicht zugeordnet. Kachel „Nicht zugeordnet“ anklicken, um nur diese zu sehen.
        </div>
      )}
    </div>
  );
}

function QuelleBadge({ quelle }: { quelle: KontoUmsatz["kategorie_quelle"] }) {
  if (!quelle) return null;
  const map = {
    auto: ["auto", "bg-neutral-100 text-neutral-500", "Automatisch erkannt (Finanzamt-Zweck oder Vorkasse-Abgleich)"],
    regel: ["Regel", "bg-blue-50 text-blue-700", "Über eine Regel zugeordnet"],
    manuell: ["manuell", "bg-violet-50 text-violet-700", "Von Hand zugeordnet — wird nie automatisch geändert"],
  } as const;
  const [label, cls, title] = map[quelle];
  return <span className={`text-[10px] font-medium rounded px-1.5 py-0.5 ${cls}`} title={title}>{label}</span>;
}

function Kachel({ label, value, tone }: { label: string; value: string; tone: "green" | "red" | "neutral" }) {
  const color = tone === "green" ? "text-emerald-700" : tone === "red" ? "text-red-700" : "text-neutral-900";
  return (
    <div className="bg-neutral-50 rounded-xl p-3 text-center">
      <div className="text-xs font-medium text-neutral-500 uppercase tracking-wide">{label}</div>
      <div className={`text-lg font-bold mt-1 tabular-nums ${color}`}>{value}</div>
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
  return (
    <th className={`py-2 pr-2 text-xs font-medium text-neutral-500 uppercase tracking-wide ${right ? "text-right" : "text-left"}`}>{children}</th>
  );
}
