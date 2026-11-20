"use client";

// Gewerbekunden: markierte (Tag „B2B“/„B“) nach Status aktiv · inaktiv · tot · nie bestellt,
// dazu „Undercover“-Verdacht (bestellen wie ein Salon, aber ohne Tag). Sortierbar, durchsuchbar,
// als Liste oder nach Ort gruppiert.
import { useMemo, useState, useTransition } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Briefcase, Check, ChevronDown, ExternalLink, MapPin, Search, Sparkles, X } from "lucide-react";
import { speichereGewerbeNotiz } from "@/lib/actions/gewerbe";

export type GewerbeStatus = "aktiv" | "inaktiv" | "tot" | "nie";

export interface GewerbeZeile {
  id: number;
  name: string;
  firma: string | null;
  email: string | null;
  ort: string | null;
  plz: string | null;
  land: string | null;
  markiert: boolean;
  bestellungen: number;
  umsatz: number;
  bestellungen12: number;
  umsatz12: number;
  erste: string | null;
  letzte: string | null;
  tageSeit: number | null;
  status: GewerbeStatus;
  punkte: number;
  gruende: string[];
  notiz: string;
  notizAm: string | null;
  notizVon: string | null;
}

type Notiz = { text: string; am: string | null; von: string | null };

const STATUS: Record<GewerbeStatus, { name: string; info: string; klasse: string; punkt: string }> = {
  aktiv: { name: "Aktiv", info: "Bestellung in den letzten 90 Tagen", klasse: "bg-emerald-50 text-emerald-700 border-emerald-200", punkt: "bg-emerald-500" },
  inaktiv: { name: "Inaktiv", info: "Letzte Bestellung vor 3–12 Monaten", klasse: "bg-amber-50 text-amber-700 border-amber-200", punkt: "bg-amber-500" },
  tot: { name: "Tot", info: "Seit über einem Jahr nichts bestellt", klasse: "bg-neutral-100 text-neutral-600 border-neutral-300", punkt: "bg-neutral-500" },
  nie: { name: "Nie bestellt", info: "Markiert, aber noch keine Bestellung", klasse: "bg-neutral-50 text-neutral-400 border-neutral-200", punkt: "bg-neutral-300" },
};
const STATUS_RANG: Record<GewerbeStatus, number> = { aktiv: 0, inaktiv: 1, tot: 2, nie: 3 };
/** Sortierung: Wert (Zahl oder Text) und Standard-Richtung beim ersten Klick. */
const SORTEN = {
  kunde: { name: "Kunde (A–Z)", f: (z: GewerbeZeile) => (z.firma || z.name).toLowerCase(), ab: false },
  ort: { name: "Ort (A–Z)", f: (z: GewerbeZeile) => (z.ort ?? "\uffff").toLowerCase(), ab: false },
  status: { name: "Status", f: (z: GewerbeZeile) => STATUS_RANG[z.status] * 1e9 - z.umsatz12, ab: false },
  umsatz: { name: "Umsatz gesamt", f: (z: GewerbeZeile) => z.umsatz, ab: true },
  umsatz12: { name: "Umsatz 12 Monate", f: (z: GewerbeZeile) => z.umsatz12, ab: true },
  bestellungen: { name: "Bestellungen gesamt", f: (z: GewerbeZeile) => z.bestellungen, ab: true },
  bestellungen12: { name: "Bestellungen 12 Monate", f: (z: GewerbeZeile) => z.bestellungen12, ab: true },
  letzte: { name: "Letzte Bestellung", f: (z: GewerbeZeile) => (z.letzte ? Date.parse(z.letzte) : 0), ab: true },
  punkte: { name: "Verdachtspunkte", f: (z: GewerbeZeile) => z.punkte * 1e7 + z.umsatz12, ab: true },
} as const;
type Sorte = keyof typeof SORTEN;
type Sortierung = { k: Sorte; ab: boolean };

const eur = (n: number) => new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 }).format(n);
const zahl = (n: number) => new Intl.NumberFormat("de-DE").format(n);
const datum = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: "Europe/Berlin" }) : "–");
const shopifyLink = (id: number) => `https://admin.shopify.com/store/339520-3/customers/${id}`;

function seitText(t: number | null) {
  if (t == null) return "noch nie";
  if (t === 0) return "heute";
  if (t === 1) return "gestern";
  if (t < 60) return `vor ${t} Tagen`;
  if (t < 730) return `vor ${Math.round(t / 30.4)} Monaten`;
  return `vor ${(t / 365).toFixed(1).replace(".", ",")} Jahren`;
}

/** Notiz direkt in der Zeile: speichert beim Verlassen des Feldes. */
function NotizFeld({ id, notiz, setNotiz }: { id: number; notiz: Notiz; setNotiz: (id: number, n: Notiz) => void }) {
  const [text, setText] = useState(notiz.text);
  const [laeuft, start] = useTransition();
  const [fehler, setFehler] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  const speichern = () => {
    if (text.trim() === notiz.text.trim()) return;
    start(async () => {
      const res = await speichereGewerbeNotiz(id, text);
      if (!res.ok) { setFehler(res.error); return; }
      setFehler(null);
      setOk(true);
      setNotiz(id, { text: text.trim(), am: res.am, von: res.von });
      setTimeout(() => setOk(false), 1600);
    });
  };
  return (
    <div className="min-w-[180px]">
      <textarea
        value={text} rows={text.split("\n").length > 1 || text.length > 38 ? 2 : 1}
        onChange={(e) => setText(e.target.value)} onBlur={speichern}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) (e.target as HTMLTextAreaElement).blur(); }}
        placeholder="Notiz …" maxLength={2000}
        className={`w-full resize-y rounded-lg border px-2 py-1 text-xs leading-snug outline-none focus:ring-2 focus:ring-neutral-900 ${text ? "border-amber-200 bg-amber-50/60" : "border-transparent bg-transparent hover:border-neutral-200 focus:bg-white"}`}
      />
      <div className="text-[10.5px] text-neutral-400 h-3.5 leading-3.5">
        {laeuft ? "Speichert …" : fehler ? <span className="text-red-600">{fehler}</span> : ok ? <span className="text-emerald-600">Gespeichert ✓</span>
          : notiz.text && notiz.am ? `${notiz.von ?? ""}${notiz.von ? " · " : ""}${datum(notiz.am)}` : ""}
      </div>
    </div>
  );
}

function Zeile({ z, notiz, setNotiz }: { z: GewerbeZeile; notiz: Notiz; setNotiz: (id: number, n: Notiz) => void }) {
  const s = STATUS[z.status];
  return (
    <tr className="border-t border-neutral-100 hover:bg-neutral-50/70">
      <td className="py-2.5 pl-4 pr-2">
        <div className="font-medium text-neutral-900 leading-tight">{z.firma || z.name}</div>
        <div className="text-xs text-neutral-500 leading-tight">
          {z.firma ? z.name : z.email ?? ""}
        </div>
        {!z.markiert && z.gruende.length > 0 && (
          <div className="mt-1 flex flex-wrap gap-1">
            {z.gruende.map((g) => <span key={g} className="text-[11px] rounded-full bg-violet-50 text-violet-700 border border-violet-200 px-2 py-0.5">{g}</span>)}
          </div>
        )}
      </td>
      <td className="py-2.5 px-2 text-sm text-neutral-600 whitespace-nowrap">{z.ort ?? "–"}{z.land && z.land !== "DE" ? <span className="text-neutral-400"> · {z.land}</span> : null}</td>
      <td className="py-2.5 px-2">
        {z.markiert ? (
          <span className={`inline-flex items-center gap-1.5 text-xs font-medium border rounded-full px-2 py-0.5 ${s.klasse}`} title={s.info}>
            <i className={`w-1.5 h-1.5 rounded-full ${s.punkt}`} />{s.name}
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 text-xs font-medium border rounded-full px-2 py-0.5 bg-violet-50 text-violet-700 border-violet-200" title="Verdachtspunkte">
            <Sparkles size={11} /> {z.punkte} Punkte
          </span>
        )}
      </td>
      <td className="py-2.5 px-2 text-right tabular-nums text-sm"><b className="text-neutral-900">{zahl(z.bestellungen12)}</b><span className="text-neutral-400"> / {zahl(z.bestellungen)}</span></td>
      <td className="py-2.5 px-2 text-right tabular-nums text-sm"><b className="text-neutral-900">{eur(z.umsatz12)}</b><div className="text-xs text-neutral-400">{eur(z.umsatz)} gesamt</div></td>
      <td className="py-2.5 px-2 text-sm text-neutral-600 whitespace-nowrap" title={`Erste Bestellung ${datum(z.erste)}`}>{seitText(z.tageSeit)}<div className="text-xs text-neutral-400">{datum(z.letzte)}</div></td>
      <td className="py-1.5 px-2 align-top"><NotizFeld key={`${z.id}-${notiz.am ?? ""}`} id={z.id} notiz={notiz} setNotiz={setNotiz} /></td>
      <td className="py-2.5 pl-2 pr-4 text-right">
        <a href={shopifyLink(z.id)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-neutral-600 hover:text-neutral-900 border border-neutral-200 rounded-lg px-2 py-1" title={z.markiert ? "In Shopify öffnen" : "In Shopify öffnen und Tag „B2B“ setzen"}>
          {z.markiert ? "Shopify" : "Markieren"} <ExternalLink size={11} />
        </a>
      </td>
    </tr>
  );
}

function SortKnopf({ k, name, sort, setSort, rechts }: { k: Sorte; name: string; sort: Sortierung; setSort: (s: Sortierung) => void; rechts?: boolean }) {
  const aktiv = sort.k === k;
  const Icon = !aktiv ? ArrowUpDown : sort.ab ? ArrowDown : ArrowUp;
  return (
    <button type="button" onClick={() => setSort(aktiv ? { k, ab: !sort.ab } : { k, ab: SORTEN[k].ab })}
      className={`inline-flex items-center gap-1 uppercase tracking-wide rounded px-1 -mx-1 hover:text-neutral-900 hover:bg-neutral-100 ${aktiv ? "text-neutral-900 font-semibold" : ""} ${rechts ? "flex-row-reverse" : ""}`}
      title={`Nach ${SORTEN[k].name} sortieren`}>
      {name}<Icon size={12} className={aktiv ? "text-neutral-900" : "text-neutral-300"} />
    </button>
  );
}

function Kopf({ sort, setSort, verdacht }: { sort: Sortierung; setSort: (s: Sortierung) => void; verdacht: boolean }) {
  const p = { sort, setSort };
  return (
    <thead>
      <tr className="text-left text-[11px] font-medium text-neutral-500 whitespace-nowrap">
        <th className="py-2 pl-4 pr-2"><SortKnopf k="kunde" name="Kunde" {...p} /></th>
        <th className="py-2 px-2"><SortKnopf k="ort" name="Ort" {...p} /></th>
        <th className="py-2 px-2">{verdacht ? <SortKnopf k="punkte" name="Punkte" {...p} /> : <SortKnopf k="status" name="Status" {...p} />}</th>
        <th className="py-2 px-2 text-right">
          <SortKnopf k="bestellungen12" name="Bestellungen" rechts {...p} />
          <div className="normal-case font-normal text-neutral-400 flex justify-end gap-1">
            <button type="button" className={`hover:underline ${sort.k === "bestellungen12" ? "text-neutral-900 font-medium" : ""}`} onClick={() => setSort({ k: "bestellungen12", ab: true })}>12 M</button>/
            <button type="button" className={`hover:underline ${sort.k === "bestellungen" ? "text-neutral-900 font-medium" : ""}`} onClick={() => setSort({ k: "bestellungen", ab: true })}>gesamt</button>
          </div>
        </th>
        <th className="py-2 px-2 text-right">
          <SortKnopf k="umsatz12" name="Umsatz" rechts {...p} />
          <div className="normal-case font-normal text-neutral-400 flex justify-end gap-1">
            <button type="button" className={`hover:underline ${sort.k === "umsatz12" ? "text-neutral-900 font-medium" : ""}`} onClick={() => setSort({ k: "umsatz12", ab: true })}>12 M</button>/
            <button type="button" className={`hover:underline ${sort.k === "umsatz" ? "text-neutral-900 font-medium" : ""}`} onClick={() => setSort({ k: "umsatz", ab: true })}>gesamt</button>
          </div>
        </th>
        <th className="py-2 px-2"><SortKnopf k="letzte" name="Zuletzt" {...p} /></th>
        <th className="py-2 px-2 uppercase tracking-wide">Notiz</th>
        <th className="py-2 pl-2 pr-4" />
      </tr>
    </thead>
  );
}

export default function GewerbeListe({ zeilen, stand }: { zeilen: GewerbeZeile[]; stand: string }) {
  const [reiter, setReiter] = useState<"markiert" | "verdacht">("markiert");
  const [status, setStatus] = useState<GewerbeStatus | "alle">("alle");
  const [sort, setSort] = useState<Sortierung>({ k: "umsatz12", ab: true });
  const [notizen, setNotizen] = useState<Map<number, Notiz>>(() => new Map(zeilen.map((z) => [z.id, { text: z.notiz, am: z.notizAm, von: z.notizVon }])));
  const setNotiz = (id: number, n: Notiz) => setNotizen((m) => new Map(m).set(id, n));
  const notizVon = (id: number): Notiz => notizen.get(id) ?? { text: "", am: null, von: null };
  const [suche, setSuche] = useState("");
  const [ansicht, setAnsicht] = useState<"liste" | "ort">("liste");
  const [offen, setOffen] = useState<string[]>([]);

  const markiert = zeilen.filter((z) => z.markiert);
  const verdacht = zeilen.filter((z) => !z.markiert);
  const zaehl = (s: GewerbeStatus) => markiert.filter((z) => z.status === s).length;
  const summe12 = (l: GewerbeZeile[]) => l.reduce((s, z) => s + z.umsatz12, 0);

  const sichtbar = useMemo(() => {
    const q = suche.trim().toLowerCase();
    const basis = reiter === "markiert" ? markiert.filter((z) => status === "alle" || z.status === status) : verdacht;
    const k: Sorte = reiter === "markiert" && sort.k === "punkte" ? "umsatz12" : reiter === "verdacht" && sort.k === "status" ? "punkte" : sort.k;
    const f = SORTEN[k].f as (z: GewerbeZeile) => number | string;
    const vergleich = (a: GewerbeZeile, b: GewerbeZeile) => {
      const x = f(a), y = f(b);
      const d = typeof x === "string" ? x.localeCompare(String(y), "de") : x - (y as number);
      return sort.ab ? -d : d;
    };
    return basis
      .filter((z) => !q || [z.name, z.firma, z.email, z.ort, z.plz, notizen.get(z.id)?.text].some((x) => x?.toLowerCase().includes(q)))
      .sort((a, b) => vergleich(a, b) || a.name.localeCompare(b.name, "de"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [zeilen, reiter, status, sort, suche, notizen]);

  const orte = useMemo(() => {
    const m = new Map<string, GewerbeZeile[]>();
    for (const z of sichtbar) {
      const k = z.ort ?? "Ohne Ort";
      m.set(k, [...(m.get(k) ?? []), z]);
    }
    return [...m.entries()]
      .map(([ort, l]) => ({ ort, l, aktiv: l.filter((z) => z.status === "aktiv").length, umsatz12: summe12(l), umsatz: l.reduce((s, z) => s + z.umsatz, 0) }))
      .sort((a, b) => (a.ort === "Ohne Ort" ? 1 : b.ort === "Ohne Ort" ? -1 : 0) || b.l.length - a.l.length || b.umsatz12 - a.umsatz12);
  }, [sichtbar]);

  const kacheln: Array<{ s: GewerbeStatus | "alle"; name: string; wert: number; info: string; farbe: string }> = [
    { s: "alle", name: "Gewerbekunden", wert: markiert.length, info: `${eur(summe12(markiert))} Umsatz in 12 Monaten`, farbe: "border-l-neutral-900" },
    { s: "aktiv", name: "Aktiv", wert: zaehl("aktiv"), info: "Bestellung ≤ 90 Tage", farbe: "border-l-emerald-500" },
    { s: "inaktiv", name: "Inaktiv", wert: zaehl("inaktiv"), info: "3–12 Monate still", farbe: "border-l-amber-500" },
    { s: "tot", name: "Tot", wert: zaehl("tot"), info: "über 1 Jahr nichts", farbe: "border-l-neutral-500" },
    { s: "nie", name: "Nie bestellt", wert: zaehl("nie"), info: "markiert, ohne Bestellung", farbe: "border-l-neutral-300" },
  ];

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-[1400px]">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold flex items-center gap-2"><Briefcase size={20} /> Gewerbekunden</h1>
          <p className="text-sm text-neutral-500 mt-1">Kunden mit Tag „B2B“ oder „B“ in Shopify · Bestellungen ohne Stornos · Stand {new Date(stand).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Berlin" })}</p>
        </div>
      </div>

      <div>
        <div className="text-xs text-neutral-500 mb-2">Kachel anklicken, um die Liste darauf zu filtern</div>
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          {kacheln.map((k) => {
            const an = reiter === "markiert" && status === k.s;
            return (
              <button key={k.s} type="button" aria-pressed={an} onClick={() => { setReiter("markiert"); setStatus(k.s); }}
                className={`group relative text-left rounded-2xl border border-l-4 ${k.farbe} p-4 transition cursor-pointer ${an
                  ? "bg-neutral-900 text-white border-neutral-900 shadow-lg -translate-y-0.5"
                  : "bg-white border-neutral-200 shadow-sm hover:shadow-md hover:-translate-y-0.5 hover:border-neutral-400"}`}>
                <div className={`text-xs font-medium uppercase tracking-wide truncate ${an ? "pr-[76px] text-neutral-300" : "text-neutral-600"}`}>{k.name}</div>
                <div className="text-2xl font-semibold tabular-nums mt-1">{zahl(k.wert)}</div>
                <div className={`text-xs mt-0.5 ${an ? "text-neutral-300" : "text-neutral-500"}`}>{k.info}</div>
                <span className={`absolute ${an ? "top-3" : "bottom-3"} right-3 inline-flex items-center gap-1 text-[10.5px] font-semibold rounded-full px-2 py-0.5 ${an
                  ? "bg-white text-neutral-900"
                  : "bg-neutral-100 text-neutral-500 opacity-0 group-hover:opacity-100"}`}>
                  {an ? <><Check size={11} /> Gefiltert</> : "Filtern"}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      <button type="button" aria-pressed={reiter === "verdacht"} onClick={() => { setReiter("verdacht"); setStatus("alle"); setSort({ k: "punkte", ab: true }); }}
        className={`w-full text-left rounded-2xl border p-4 flex items-center gap-4 transition ${reiter === "verdacht" ? "bg-violet-600 text-white border-violet-600" : "bg-violet-50 border-violet-200 hover:bg-violet-100"}`}>
        <Sparkles size={22} className={reiter === "verdacht" ? "text-white" : "text-violet-600"} />
        <div className="flex-1">
          <div className="font-semibold">{zahl(verdacht.length)} mögliche „Undercover“-Gewerbekunden</div>
          <div className={`text-sm ${reiter === "verdacht" ? "text-violet-100" : "text-violet-700"}`}>
            Ohne Tag, aber mit Firmenadresse, vielen Bestellungen oder hohem Umsatz · {zahl(verdacht.filter((z) => z.punkte >= 5).length)} starke Verdachtsfälle · {eur(summe12(verdacht))} Umsatz in 12 Monaten
          </div>
        </div>
        <span className="text-sm font-medium">{reiter === "verdacht" ? "Wird angezeigt" : "Ansehen →"}</span>
      </button>

      <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm">
        <div className="flex flex-wrap items-center gap-3 p-4 border-b border-neutral-100">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
            <input value={suche} onChange={(e) => setSuche(e.target.value)} placeholder="Name, Firma, E-Mail, Ort, PLZ oder Notiz"
              className="w-full rounded-lg border border-neutral-300 pl-9 pr-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900 outline-none" />
          </div>
          <label className="text-xs font-medium text-neutral-600 uppercase tracking-wide flex items-center gap-2">
            Sortieren
            <select value={sort.k} onChange={(e) => { const k = e.target.value as Sorte; setSort({ k, ab: SORTEN[k].ab }); }} className="rounded-lg border border-neutral-300 px-3 py-2 text-sm normal-case font-normal text-neutral-900">
              {(Object.keys(SORTEN) as Sorte[]).filter((k) => k !== "punkte" || reiter === "verdacht").map((k) => <option key={k} value={k}>{SORTEN[k].name}</option>)}
            </select>
            <button type="button" onClick={() => setSort({ ...sort, ab: !sort.ab })} className="rounded-lg border border-neutral-300 p-2 text-neutral-700 hover:bg-neutral-100" title={sort.ab ? "Absteigend – klicken für aufsteigend" : "Aufsteigend – klicken für absteigend"}>
              {sort.ab ? <ArrowDown size={14} /> : <ArrowUp size={14} />}
            </button>
          </label>
          <div className="inline-flex rounded-lg border border-neutral-300 p-0.5" role="radiogroup" aria-label="Ansicht">
            {([["liste", "Liste"], ["ort", "Nach Ort"]] as const).map(([a, n]) => (
              <button key={a} type="button" role="radio" aria-checked={ansicht === a} onClick={() => setAnsicht(a)}
                className={`px-3 py-1.5 text-sm rounded-md inline-flex items-center gap-1.5 ${ansicht === a ? "bg-neutral-900 text-white" : "text-neutral-600 hover:bg-neutral-100"}`}>
                {a === "ort" && <MapPin size={13} />}{n}
              </button>
            ))}
          </div>
          {(reiter === "verdacht" || status !== "alle") && (
            <button type="button" onClick={() => { setReiter("markiert"); setStatus("alle"); }}
              className="inline-flex items-center gap-1.5 rounded-full bg-neutral-900 text-white text-xs font-medium px-3 py-1.5" title="Filter aufheben">
              Filter: {reiter === "verdacht" ? "Undercover-Verdacht" : STATUS[status as GewerbeStatus].name} <X size={12} />
            </button>
          )}
          <div className="text-sm text-neutral-500">{zahl(sichtbar.length)} Kunden · {eur(summe12(sichtbar))} in 12 M</div>
        </div>

        {ansicht === "liste" ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <Kopf sort={sort} setSort={setSort} verdacht={reiter === "verdacht"} />
              <tbody>{sichtbar.map((z) => <Zeile key={z.id} z={z} notiz={notizVon(z.id)} setNotiz={setNotiz} />)}</tbody>
            </table>
            {!sichtbar.length && <div className="p-8 text-center text-sm text-neutral-500">Keine Kunden für diese Auswahl.</div>}
          </div>
        ) : (
          <div className="divide-y divide-neutral-100">
            {orte.map((o) => {
              const auf = offen.includes(o.ort);
              return (
                <div key={o.ort}>
                  <button type="button" onClick={() => setOffen(auf ? offen.filter((x) => x !== o.ort) : [...offen, o.ort])}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-neutral-50 text-left">
                    <ChevronDown size={16} className={`text-neutral-400 transition ${auf ? "" : "-rotate-90"}`} />
                    <MapPin size={15} className="text-neutral-400" />
                    <span className="font-medium text-neutral-900 flex-1">{o.ort}</span>
                    <span className="text-sm text-neutral-600 tabular-nums w-28 text-right">{zahl(o.l.length)} Kunde{o.l.length === 1 ? "" : "n"}</span>
                    <span className="text-sm text-emerald-700 tabular-nums w-20 text-right">{zahl(o.aktiv)} aktiv</span>
                    <span className="text-sm font-medium text-neutral-900 tabular-nums w-28 text-right">{eur(o.umsatz12)}</span>
                  </button>
                  {auf && (
                    <div className="overflow-x-auto bg-neutral-50/50">
                      <table className="w-full text-sm"><Kopf sort={sort} setSort={setSort} verdacht={reiter === "verdacht"} /><tbody>{o.l.map((z) => <Zeile key={z.id} z={z} notiz={notizVon(z.id)} setNotiz={setNotiz} />)}</tbody></table>
                    </div>
                  )}
                </div>
              );
            })}
            {!orte.length && <div className="p-8 text-center text-sm text-neutral-500">Keine Kunden für diese Auswahl.</div>}
          </div>
        )}
      </div>

      {reiter === "verdacht" && (
        <p className="text-xs text-neutral-500">
          Punkte: Firma in der Adresse +2 · ab 5 Bestellungen in 12 Monaten +2, ab 8 +3 · Umsatz 12 Monate ab 1.500 € +2, ab 3.000 € +3. Ab 3 Punkten erscheint ein Kunde hier, ab 5 gilt er als starker Verdacht.
          „Markieren“ öffnet den Kunden in Shopify – dort das Tag „B2B“ setzen, dann zählt er beim nächsten Laden mit.
        </p>
      )}
    </div>
  );
}
