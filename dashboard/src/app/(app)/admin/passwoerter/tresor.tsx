"use client";

// Passwort-Tresor: alle Zugänge an einem Ort, geschützt durch ein gemeinsames Master-Passwort.
// Entschlüsselt wird nur hier im Browser; nach 5 Minuten ohne Aktivität sperrt der Tresor wieder.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  KeyRound, Lock, Unlock, Plus, Search, Copy, Check, Eye, EyeOff, ExternalLink, Pencil, Trash2,
  Wand2, ShieldCheck, X, Loader2,
} from "lucide-react";
import {
  ladeTresor, richteTresorEin, speichereEintrag, loescheEintrag, aendereMasterPasswort,
  type TresorMeta, type TresorEintragRoh,
} from "@/lib/actions/passwort-tresor";
import {
  PRUEFTEXT, ITERATIONEN, zuB64, zufall, leiteSchluesselAb, verschluessele, entschluessele, erzeugePasswort,
} from "./krypto";

type Inhalt = {
  titel: string;
  kategorie: string;
  benutzer: string;
  passwort: string;
  url: string;
  notiz: string;
};

type Eintrag = Inhalt & { id: string; geaendert_am: string };

const LEER: Inhalt = { titel: "", kategorie: "", benutzer: "", passwort: "", url: "", notiz: "" };
const AUTO_SPERRE_MS = 5 * 60 * 1000;
const ZWISCHENABLAGE_LEEREN_MS = 30 * 1000;

const inputCls =
  "w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900";
const labelCls = "text-xs font-medium text-neutral-600 uppercase tracking-wide";
const karteCls = "bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm";
const btnPrimaer =
  "inline-flex items-center justify-center gap-2 bg-neutral-900 text-white font-medium rounded-lg px-4 py-2 text-sm hover:bg-neutral-800 disabled:opacity-50";
const btnSekundaer =
  "inline-flex items-center justify-center gap-2 border border-neutral-300 text-neutral-800 font-medium rounded-lg px-3 py-2 text-sm hover:bg-neutral-50 disabled:opacity-50";

async function neueMeta(passwort: string): Promise<{ meta: TresorMeta; schluessel: CryptoKey }> {
  const salt = zuB64(zufall(16));
  const schluessel = await leiteSchluesselAb(passwort, salt, ITERATIONEN);
  const p = await verschluessele(schluessel, PRUEFTEXT);
  return { meta: { salt, iterationen: ITERATIONEN, pruef_iv: p.iv, pruef_chiffre: p.chiffre }, schluessel };
}

function passwortStaerke(pw: string): string | null {
  if (pw.length < 12) return "Mindestens 12 Zeichen.";
  return null;
}

export default function Tresor() {
  const [zustand, setZustand] = useState<"laden" | "einrichten" | "gesperrt" | "offen">("laden");
  const [meta, setMeta] = useState<TresorMeta | null>(null);
  const [roh, setRoh] = useState<TresorEintragRoh[]>([]);
  const [schluessel, setSchluessel] = useState<CryptoKey | null>(null);
  const [eintraege, setEintraege] = useState<Eintrag[]>([]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [beschaeftigt, setBeschaeftigt] = useState(false);

  const [suche, setSuche] = useState("");
  const [kategorie, setKategorie] = useState("");
  const [bearbeiten, setBearbeiten] = useState<(Inhalt & { id?: string }) | null>(null);
  const [masterAendern, setMasterAendern] = useState(false);

  const laden = useCallback(async () => {
    setFehler(null);
    try {
      const r = await ladeTresor();
      setMeta(r.meta);
      setRoh(r.eintraege);
      return r;
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e));
      return null;
    }
  }, []);

  useEffect(() => {
    laden().then((r) => {
      if (r) setZustand(r.meta ? "gesperrt" : "einrichten");
    });
  }, [laden]);

  const sperren = useCallback(() => {
    setSchluessel(null);
    setEintraege([]);
    setBearbeiten(null);
    setMasterAendern(false);
    setZustand("gesperrt");
  }, []);

  // Auto-Sperre bei Inaktivität.
  const letzteAktivitaet = useRef(Date.now());
  useEffect(() => {
    if (zustand !== "offen") return;
    const aktiv = () => (letzteAktivitaet.current = Date.now());
    const events = ["mousemove", "keydown", "click", "scroll", "touchstart"];
    events.forEach((e) => window.addEventListener(e, aktiv, { passive: true }));
    const t = setInterval(() => {
      if (Date.now() - letzteAktivitaet.current > AUTO_SPERRE_MS) sperren();
    }, 10_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, aktiv));
      clearInterval(t);
    };
  }, [zustand, sperren]);

  const entschluesseleAlle = useCallback(async (k: CryptoKey, liste: TresorEintragRoh[]) => {
    const out: Eintrag[] = [];
    for (const r of liste) {
      try {
        const inhalt = JSON.parse(await entschluessele(k, r.iv, r.chiffre)) as Inhalt;
        out.push({ ...LEER, ...inhalt, id: r.id, geaendert_am: r.geaendert_am });
      } catch {
        out.push({ ...LEER, titel: "⚠ Nicht lesbar", id: r.id, geaendert_am: r.geaendert_am });
      }
    }
    out.sort((a, b) => a.titel.localeCompare(b.titel, "de"));
    return out;
  }, []);

  async function entsperren(passwort: string) {
    if (!meta) return;
    setBeschaeftigt(true);
    setFehler(null);
    try {
      const k = await leiteSchluesselAb(passwort, meta.salt, meta.iterationen);
      try {
        const t = await entschluessele(k, meta.pruef_iv, meta.pruef_chiffre);
        if (t !== PRUEFTEXT) throw new Error();
      } catch {
        setFehler("Falsches Master-Passwort.");
        return;
      }
      const frisch = await laden();
      setEintraege(await entschluesseleAlle(k, frisch?.eintraege ?? roh));
      setSchluessel(k);
      letzteAktivitaet.current = Date.now();
      setZustand("offen");
    } finally {
      setBeschaeftigt(false);
    }
  }

  async function einrichten(passwort: string) {
    setBeschaeftigt(true);
    setFehler(null);
    try {
      const { meta: m, schluessel: k } = await neueMeta(passwort);
      await richteTresorEin(m);
      setMeta(m);
      setSchluessel(k);
      setEintraege([]);
      letzteAktivitaet.current = Date.now();
      setZustand("offen");
    } catch (e) {
      setFehler(e instanceof Error ? e.message : String(e));
    } finally {
      setBeschaeftigt(false);
    }
  }

  async function speichern(e: Inhalt & { id?: string }) {
    if (!schluessel) return;
    setBeschaeftigt(true);
    setFehler(null);
    try {
      const inhalt: Inhalt = {
        titel: e.titel.trim(), kategorie: e.kategorie.trim(), benutzer: e.benutzer.trim(),
        passwort: e.passwort, url: e.url.trim(), notiz: e.notiz,
      };
      const blob = await verschluessele(schluessel, JSON.stringify(inhalt));
      await speichereEintrag({ id: e.id, ...blob });
      const r = await laden();
      if (r) setEintraege(await entschluesseleAlle(schluessel, r.eintraege));
      setBearbeiten(null);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : String(err));
    } finally {
      setBeschaeftigt(false);
    }
  }

  async function loeschen(e: Eintrag) {
    if (!schluessel) return;
    if (!confirm(`„${e.titel}“ endgültig löschen? Das lässt sich nicht rückgängig machen.`)) return;
    setBeschaeftigt(true);
    try {
      await loescheEintrag(e.id);
      const r = await laden();
      if (r) setEintraege(await entschluesseleAlle(schluessel, r.eintraege));
    } catch (err) {
      setFehler(err instanceof Error ? err.message : String(err));
    } finally {
      setBeschaeftigt(false);
    }
  }

  async function masterWechseln(altPw: string, neuPw: string) {
    if (!meta) return;
    setBeschaeftigt(true);
    setFehler(null);
    try {
      const altK = await leiteSchluesselAb(altPw, meta.salt, meta.iterationen);
      try {
        if ((await entschluessele(altK, meta.pruef_iv, meta.pruef_chiffre)) !== PRUEFTEXT) throw new Error();
      } catch {
        setFehler("Aktuelles Master-Passwort ist falsch.");
        return;
      }
      const r = await laden();
      if (!r) return;
      const { meta: m, schluessel: neuK } = await neueMeta(neuPw);
      const neu: { id: string; iv: string; chiffre: string }[] = [];
      for (const e of r.eintraege) {
        // Ein Eintrag, der sich nicht entschlüsseln lässt, würde verloren gehen → abbrechen.
        const klar = await entschluessele(altK, e.iv, e.chiffre);
        neu.push({ id: e.id, ...(await verschluessele(neuK, klar)) });
      }
      await aendereMasterPasswort(m, neu);
      const r2 = await laden();
      setMeta(m);
      setSchluessel(neuK);
      if (r2) setEintraege(await entschluesseleAlle(neuK, r2.eintraege));
      setMasterAendern(false);
      alert("Master-Passwort geändert. Bitte dem anderen Admin das neue Passwort mitteilen.");
    } catch (err) {
      setFehler(err instanceof Error ? err.message : String(err));
    } finally {
      setBeschaeftigt(false);
    }
  }

  const kategorien = useMemo(
    () => [...new Set(eintraege.map((e) => e.kategorie).filter(Boolean))].sort((a, b) => a.localeCompare(b, "de")),
    [eintraege],
  );

  const gefiltert = useMemo(() => {
    const q = suche.trim().toLowerCase();
    return eintraege.filter(
      (e) =>
        (!kategorie || e.kategorie === kategorie) &&
        (!q || [e.titel, e.benutzer, e.url, e.notiz, e.kategorie].some((f) => f.toLowerCase().includes(q))),
    );
  }, [eintraege, suche, kategorie]);

  // ---------- Ansichten ----------

  if (zustand === "laden") {
    return (
      <div className="flex items-center gap-2 text-neutral-500 text-sm">
        <Loader2 size={16} className="animate-spin" /> Lade Tresor …
        {fehler && <span className="text-red-600">{fehler}</span>}
      </div>
    );
  }

  if (zustand === "einrichten") {
    return <Einrichten fehler={fehler} beschaeftigt={beschaeftigt} onFertig={einrichten} />;
  }

  if (zustand === "gesperrt") {
    return <Entsperren fehler={fehler} beschaeftigt={beschaeftigt} onEntsperren={entsperren} />;
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900 flex items-center gap-2">
            <KeyRound size={20} /> Passwörter
          </h1>
          <p className="text-sm text-neutral-500">
            {eintraege.length} Zugänge · verschlüsselt, sperrt sich nach 5 Min. ohne Aktivität
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className={btnSekundaer} onClick={() => setMasterAendern(true)}>
            <ShieldCheck size={15} /> Master-Passwort ändern
          </button>
          <button className={btnSekundaer} onClick={sperren}>
            <Lock size={15} /> Sperren
          </button>
          <button className={btnPrimaer} onClick={() => setBearbeiten({ ...LEER, kategorie })}>
            <Plus size={15} /> Neuer Zugang
          </button>
        </div>
      </div>

      {fehler && <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{fehler}</div>}

      <div className="flex flex-wrap gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" />
          <input
            className={`${inputCls} pl-9`}
            placeholder="Suchen (Name, Benutzer, URL, Notiz) …"
            value={suche}
            onChange={(e) => setSuche(e.target.value)}
            autoFocus
          />
        </div>
        {kategorien.length > 0 && (
          <select className={`${inputCls} w-auto`} value={kategorie} onChange={(e) => setKategorie(e.target.value)}>
            <option value="">Alle Kategorien</option>
            {kategorien.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        )}
      </div>

      {gefiltert.length === 0 ? (
        <div className={`${karteCls} text-sm text-neutral-500 text-center`}>
          {eintraege.length === 0 ? "Noch keine Zugänge gespeichert." : "Nichts gefunden."}
        </div>
      ) : (
        <div className="space-y-2">
          {gefiltert.map((e) => (
            <EintragZeile
              key={e.id}
              e={e}
              onBearbeiten={() => setBearbeiten(e)}
              onLoeschen={() => loeschen(e)}
            />
          ))}
        </div>
      )}

      {bearbeiten && (
        <EintragFormular
          start={bearbeiten}
          kategorien={kategorien}
          beschaeftigt={beschaeftigt}
          fehler={fehler}
          onAbbrechen={() => { setBearbeiten(null); setFehler(null); }}
          onSpeichern={speichern}
        />
      )}

      {masterAendern && (
        <MasterAendern
          beschaeftigt={beschaeftigt}
          fehler={fehler}
          onAbbrechen={() => { setMasterAendern(false); setFehler(null); }}
          onAendern={masterWechseln}
        />
      )}
    </div>
  );
}

// ---------- Teilkomponenten ----------

function Einrichten({
  fehler, beschaeftigt, onFertig,
}: { fehler: string | null; beschaeftigt: boolean; onFertig: (pw: string) => void }) {
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const hinweis = passwortStaerke(pw) ?? (pw2 && pw !== pw2 ? "Die Passwörter stimmen nicht überein." : null);
  return (
    <div className={`${karteCls} max-w-md mx-auto space-y-4`}>
      <div className="flex items-center gap-2 text-lg font-semibold"><ShieldCheck size={20} /> Tresor einrichten</div>
      <p className="text-sm text-neutral-600">
        Lege ein Master-Passwort fest. Damit werden alle Zugänge verschlüsselt — nur wer es kennt, kann sie lesen.
      </p>
      <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm px-3 py-2">
        <strong>Wichtig:</strong> Das Master-Passwort wird nirgends gespeichert. Geht es verloren, sind alle
        gespeicherten Passwörter weg — auch wir können sie nicht wiederherstellen. Schreib es sicher auf.
      </div>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!hinweis && pw === pw2) onFertig(pw);
        }}
      >
        <div className="space-y-1">
          <label className={labelCls}>Master-Passwort</label>
          <input type="password" className={inputCls} value={pw} onChange={(e) => setPw(e.target.value)} autoFocus autoComplete="new-password" />
        </div>
        <div className="space-y-1">
          <label className={labelCls}>Wiederholen</label>
          <input type="password" className={inputCls} value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" />
        </div>
        {pw && hinweis && <div className="text-xs text-neutral-500">{hinweis}</div>}
        {fehler && <div className="text-sm text-red-600">{fehler}</div>}
        <button className={`${btnPrimaer} w-full`} disabled={!!hinweis || pw !== pw2 || beschaeftigt}>
          {beschaeftigt ? <Loader2 size={15} className="animate-spin" /> : <Lock size={15} />} Tresor anlegen
        </button>
      </form>
    </div>
  );
}

function Entsperren({
  fehler, beschaeftigt, onEntsperren,
}: { fehler: string | null; beschaeftigt: boolean; onEntsperren: (pw: string) => void }) {
  const [pw, setPw] = useState("");
  return (
    <div className={`${karteCls} max-w-sm mx-auto mt-10 space-y-4 text-center`}>
      <div className="mx-auto w-12 h-12 rounded-full bg-neutral-900 text-white flex items-center justify-center">
        <Lock size={22} />
      </div>
      <div>
        <div className="text-lg font-semibold">Passwörter</div>
        <div className="text-sm text-neutral-500">Master-Passwort eingeben zum Entsperren</div>
      </div>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (pw) onEntsperren(pw);
        }}
      >
        <input
          type="password"
          className={inputCls}
          value={pw}
          onChange={(e) => setPw(e.target.value)}
          placeholder="Master-Passwort"
          autoFocus
          autoComplete="current-password"
        />
        {fehler && <div className="text-sm text-red-600">{fehler}</div>}
        <button className={`${btnPrimaer} w-full`} disabled={!pw || beschaeftigt}>
          {beschaeftigt ? <Loader2 size={15} className="animate-spin" /> : <Unlock size={15} />} Entsperren
        </button>
      </form>
    </div>
  );
}

function KopierKnopf({ wert, titel }: { wert: string; titel: string }) {
  const [ok, setOk] = useState(false);
  if (!wert) return null;
  return (
    <button
      type="button"
      title={titel}
      className="p-1.5 rounded-md text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100"
      onClick={async () => {
        await navigator.clipboard.writeText(wert);
        setOk(true);
        setTimeout(() => setOk(false), 1500);
        // Zwischenablage nach 30 s leeren, falls noch unser Wert drin ist.
        setTimeout(async () => {
          try {
            if ((await navigator.clipboard.readText()) === wert) await navigator.clipboard.writeText("");
          } catch {
            /* Browser erlaubt Lesen nicht — egal */
          }
        }, ZWISCHENABLAGE_LEEREN_MS);
      }}
    >
      {ok ? <Check size={15} className="text-green-600" /> : <Copy size={15} />}
    </button>
  );
}

function EintragZeile({
  e, onBearbeiten, onLoeschen,
}: { e: Eintrag; onBearbeiten: () => void; onLoeschen: () => void }) {
  const [zeigen, setZeigen] = useState(false);
  const link = e.url && (/^https?:\/\//i.test(e.url) ? e.url : `https://${e.url}`);
  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-medium text-neutral-900 flex items-center gap-2">
            {e.titel || "(ohne Namen)"}
            {e.kategorie && (
              <span className="text-[11px] font-medium bg-neutral-100 text-neutral-600 rounded-full px-2 py-0.5">
                {e.kategorie}
              </span>
            )}
          </div>
          {link && (
            <a href={link} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1 break-all">
              {e.url} <ExternalLink size={11} />
            </a>
          )}
        </div>
        <div className="flex gap-1">
          <button className="p-1.5 rounded-md text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100" title="Bearbeiten" onClick={onBearbeiten}>
            <Pencil size={15} />
          </button>
          <button className="p-1.5 rounded-md text-neutral-400 hover:text-red-600 hover:bg-red-50" title="Löschen" onClick={onLoeschen}>
            <Trash2 size={15} />
          </button>
        </div>
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <div className="flex items-center gap-1 rounded-lg bg-neutral-50 px-3 py-1.5 min-w-0">
          <span className="text-xs text-neutral-500 w-16 shrink-0">Benutzer</span>
          <span className="text-sm font-mono truncate flex-1">{e.benutzer || "–"}</span>
          <KopierKnopf wert={e.benutzer} titel="Benutzer kopieren" />
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-neutral-50 px-3 py-1.5 min-w-0">
          <span className="text-xs text-neutral-500 w-16 shrink-0">Passwort</span>
          <span className="text-sm font-mono truncate flex-1">
            {e.passwort ? (zeigen ? e.passwort : "••••••••••") : "–"}
          </span>
          {e.passwort && (
            <button
              type="button"
              className="p-1.5 rounded-md text-neutral-400 hover:text-neutral-900 hover:bg-neutral-100"
              title={zeigen ? "Verbergen" : "Anzeigen"}
              onClick={() => setZeigen((z) => !z)}
            >
              {zeigen ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
          )}
          <KopierKnopf wert={e.passwort} titel="Passwort kopieren" />
        </div>
      </div>
      {e.notiz && <div className="mt-2 text-sm text-neutral-600 whitespace-pre-wrap">{e.notiz}</div>}
    </div>
  );
}

function Modal({ titel, fehler, onSchliessen, children }: { titel: string; fehler?: string | null; onSchliessen: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onSchliessen}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto p-5 space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <div className="text-lg font-semibold">{titel}</div>
          <button className="p-1.5 rounded-md text-neutral-400 hover:text-neutral-900" onClick={onSchliessen}>
            <X size={18} />
          </button>
        </div>
        {fehler && <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2">{fehler}</div>}
        {children}
      </div>
    </div>
  );
}

function EintragFormular({
  start, kategorien, beschaeftigt, fehler, onAbbrechen, onSpeichern,
}: {
  start: Inhalt & { id?: string };
  fehler: string | null;
  kategorien: string[];
  beschaeftigt: boolean;
  onAbbrechen: () => void;
  onSpeichern: (e: Inhalt & { id?: string }) => void;
}) {
  const [f, setF] = useState(start);
  const [zeigen, setZeigen] = useState(!start.id);
  const set = (k: keyof Inhalt) => (ev: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF((alt) => ({ ...alt, [k]: ev.target.value }));
  return (
    <Modal titel={start.id ? "Zugang bearbeiten" : "Neuer Zugang"} fehler={fehler} onSchliessen={onAbbrechen}>
      <form
        className="space-y-3"
        autoComplete="off"
        onSubmit={(e) => {
          e.preventDefault();
          if (f.titel.trim()) onSpeichern(f);
        }}
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <label className={labelCls}>Name *</label>
            <input className={inputCls} value={f.titel} onChange={set("titel")} placeholder="z. B. Shopify Admin" autoFocus />
          </div>
          <div className="space-y-1">
            <label className={labelCls}>Kategorie</label>
            <input className={inputCls} value={f.kategorie} onChange={set("kategorie")} list="tresor-kategorien" placeholder="z. B. Shop, Bank, Social" />
            <datalist id="tresor-kategorien">
              {kategorien.map((k) => <option key={k} value={k} />)}
            </datalist>
          </div>
        </div>
        <div className="space-y-1">
          <label className={labelCls}>Webseite</label>
          <input className={inputCls} value={f.url} onChange={set("url")} placeholder="https://…" />
        </div>
        <div className="space-y-1">
          <label className={labelCls}>Benutzer / E-Mail</label>
          <input className={inputCls} value={f.benutzer} onChange={set("benutzer")} autoComplete="off" />
        </div>
        <div className="space-y-1">
          <label className={labelCls}>Passwort</label>
          <div className="flex gap-2">
            <input
              className={`${inputCls} font-mono`}
              type={zeigen ? "text" : "password"}
              value={f.passwort}
              onChange={set("passwort")}
              autoComplete="new-password"
            />
            <button type="button" className={btnSekundaer} title={zeigen ? "Verbergen" : "Anzeigen"} onClick={() => setZeigen((z) => !z)}>
              {zeigen ? <EyeOff size={15} /> : <Eye size={15} />}
            </button>
            <button
              type="button"
              className={btnSekundaer}
              title="Sicheres Passwort erzeugen"
              onClick={() => {
                setF((alt) => ({ ...alt, passwort: erzeugePasswort() }));
                setZeigen(true);
              }}
            >
              <Wand2 size={15} />
            </button>
          </div>
        </div>
        <div className="space-y-1">
          <label className={labelCls}>Notiz</label>
          <textarea className={inputCls} rows={3} value={f.notiz} onChange={set("notiz")} placeholder="z. B. 2FA über Handy von …" />
        </div>
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" className={btnSekundaer} onClick={onAbbrechen}>Abbrechen</button>
          <button className={btnPrimaer} disabled={!f.titel.trim() || beschaeftigt}>
            {beschaeftigt && <Loader2 size={15} className="animate-spin" />} Speichern
          </button>
        </div>
      </form>
    </Modal>
  );
}

function MasterAendern({
  beschaeftigt, fehler, onAbbrechen, onAendern,
}: { beschaeftigt: boolean; fehler: string | null; onAbbrechen: () => void; onAendern: (alt: string, neu: string) => void }) {
  const [alt, setAlt] = useState("");
  const [neu, setNeu] = useState("");
  const [neu2, setNeu2] = useState("");
  const hinweis = passwortStaerke(neu) ?? (neu2 && neu !== neu2 ? "Die neuen Passwörter stimmen nicht überein." : null);
  return (
    <Modal titel="Master-Passwort ändern" fehler={fehler} onSchliessen={onAbbrechen}>
      <p className="text-sm text-neutral-600">
        Alle Einträge werden mit dem neuen Passwort neu verschlüsselt. Danach gilt es für alle Admins.
      </p>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (alt && !hinweis && neu === neu2) onAendern(alt, neu);
        }}
      >
        <div className="space-y-1">
          <label className={labelCls}>Aktuelles Master-Passwort</label>
          <input type="password" className={inputCls} value={alt} onChange={(e) => setAlt(e.target.value)} autoComplete="current-password" />
        </div>
        <div className="space-y-1">
          <label className={labelCls}>Neues Master-Passwort</label>
          <input type="password" className={inputCls} value={neu} onChange={(e) => setNeu(e.target.value)} autoComplete="new-password" />
        </div>
        <div className="space-y-1">
          <label className={labelCls}>Neues wiederholen</label>
          <input type="password" className={inputCls} value={neu2} onChange={(e) => setNeu2(e.target.value)} autoComplete="new-password" />
        </div>
        {neu && hinweis && <div className="text-xs text-neutral-500">{hinweis}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" className={btnSekundaer} onClick={onAbbrechen}>Abbrechen</button>
          <button className={btnPrimaer} disabled={!alt || !!hinweis || neu !== neu2 || beschaeftigt}>
            {beschaeftigt && <Loader2 size={15} className="animate-spin" />} Ändern
          </button>
        </div>
      </form>
    </Modal>
  );
}
