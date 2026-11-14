"use client";

import "./hi.css";
import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowUp, Maximize2, RotateCcw, Square, X } from "lucide-react";
import HiGehirn, { type HiZustand } from "./hi-gehirn";
import HiMarkdown from "./hi-markdown";

/** Ein Eintrag der sichtbaren Unterhaltung. */
interface Anzeige {
  rolle: "du" | "hi";
  text: string;
  schritte?: string[];
  fehler?: boolean;
}

// Verlauf für die API (inkl. Denk- und Werkzeugblöcke) und Anzeige — geteilt zwischen Seite und Widget
const SPEICHER_VERLAUF = "hi:verlauf";
const SPEICHER_ANZEIGE = "hi:anzeige";
const MAX_ZEICHEN = 1_500_000;

const VORSCHLAEGE = [
  "Wie können wir unsere Schulden schneller abbauen?",
  "Was müssen wir bei der nächsten Bestellung wirklich bestellen?",
  "Welche Mitarbeiter waren dieses Jahr am häufigsten krank?",
  "Wie lief die Black Week im Vergleich zum Vorjahr?",
  "Wo verlieren wir gerade am meisten Geld?",
  "Welche Produkte werden am häufigsten retourniert und warum?",
];

type ApiMessage = { role: "user" | "assistant"; content: string | Array<{ type: string; [k: string]: unknown }> };

function lies<T>(key: string, std: T): T {
  try {
    const s = localStorage.getItem(key);
    return s ? (JSON.parse(s) as T) : std;
  } catch {
    return std;
  }
}
function schreib(key: string, wert: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(wert));
  } catch {
    /* Speicher voll oder gesperrt — Gespräch läuft trotzdem */
  }
}

/**
 * Zu langer Verlauf: ältere Fragen fallen weg. Dabei werden ALLE Denkblöcke entfernt — Denkblöcke
 * sind an den genauen Verlauf gebunden, ein gekürzter Anfang mit alten Denkblöcken würde abgelehnt.
 */
function kuerzen(verlauf: ApiMessage[]): ApiMessage[] {
  if (JSON.stringify(verlauf).length <= MAX_ZEICHEN) return verlauf;
  const fragen = verlauf.map((m, i) => (m.role === "user" && typeof m.content === "string" ? i : -1)).filter((i) => i >= 0);
  const ab = fragen.length > 4 ? fragen[fragen.length - 4] : fragen.at(-1) ?? 0;
  return verlauf.slice(ab).map((m) => (typeof m.content === "string" ? m : { ...m, content: m.content.filter((b) => b.type !== "thinking" && b.type !== "redacted_thinking") }));
}

export default function HiChat({
  variante = "seite",
  startFrage,
  onSchliessen,
}: {
  variante?: "seite" | "widget";
  /** Wird nach dem Laden des Verlaufs sofort gefragt (aus der Kugel im Startbildschirm). */
  startFrage?: string;
  /** Vollbild über dem Startbildschirm: Knopf zum Schließen. */
  onSchliessen?: () => void;
}) {
  const [anzeige, setAnzeige] = useState<Anzeige[]>([]);
  const [verlauf, setVerlauf] = useState<ApiMessage[]>([]);
  const [eingabe, setEingabe] = useState("");
  const [zustand, setZustand] = useState<HiZustand>("ruhig");
  const [impuls, setImpuls] = useState(0);
  const abbruch = useRef<AbortController | null>(null);
  const listeRef = useRef<HTMLDivElement>(null);
  const feldRef = useRef<HTMLTextAreaElement>(null);
  const widget = variante === "widget";
  const [geladen, setGeladen] = useState(false);
  const startGefragt = useRef(false);

  useEffect(() => {
    setAnzeige(lies<Anzeige[]>(SPEICHER_ANZEIGE, []));
    setVerlauf(lies<ApiMessage[]>(SPEICHER_VERLAUF, []));
    setGeladen(true);
  }, []);

  useEffect(() => {
    const el = listeRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [anzeige]);

  const fragen = useCallback(
    async (frage: string) => {
      frage = frage.trim();
      if (!frage || zustand !== "ruhig") return;
      setEingabe("");
      const basis = kuerzen(verlauf);
      const neu: Anzeige[] = [...anzeige, { rolle: "du", text: frage }, { rolle: "hi", text: "", schritte: [] }];
      setAnzeige(neu);
      setZustand("denkt");
      const ctrl = new AbortController();
      abbruch.current = ctrl;
      const aendereLetzte = (f: (a: Anzeige) => Anzeige) => setAnzeige((alt) => [...alt.slice(0, -1), f(alt[alt.length - 1])]);

      try {
        const res = await fetch("/api/hi", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ verlauf: basis, frage }), signal: ctrl.signal });
        if (!res.ok || !res.body) throw new Error(res.status === 403 ? "Hi ist nur für Admins freigeschaltet." : `Hi ist gerade nicht erreichbar (${res.status}).`);
        // Abgelaufene Anmeldung: die Middleware leitet auf die Login-Seite um (HTML statt Antwort-Stream)
        if (!(res.headers.get("content-type") ?? "").includes("ndjson")) throw new Error("Bitte neu anmelden — die Sitzung ist abgelaufen.");
        const reader = res.body.getReader();
        const dec = new TextDecoder();
        let puffer = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          puffer += dec.decode(value, { stream: true });
          const teile = puffer.split("\n");
          puffer = teile.pop() ?? "";
          for (const zeile of teile) {
            if (!zeile.trim()) continue;
            const ev = JSON.parse(zeile) as { t: string; d?: string; label?: string; verlauf?: ApiMessage[]; text?: string };
            if (ev.t === "text" && ev.d) {
              setZustand("spricht");
              setImpuls((x) => x + 1);
              aendereLetzte((a) => ({ ...a, text: a.text + ev.d }));
            } else if (ev.t === "werkzeug" && ev.label) {
              setZustand("denkt");
              aendereLetzte((a) => ({ ...a, schritte: [...(a.schritte ?? []), ev.label as string], text: a.text && !a.text.endsWith("\n") ? a.text + "\n\n" : a.text }));
            } else if (ev.t === "denkt") {
              setZustand("denkt");
            } else if (ev.t === "fertig" && ev.verlauf) {
              setVerlauf(ev.verlauf);
              schreib(SPEICHER_VERLAUF, ev.verlauf);
            } else if (ev.t === "fehler") {
              aendereLetzte((a) => ({ ...a, text: a.text || (ev.text ?? "Fehler"), fehler: true }));
            }
          }
        }
      } catch (e) {
        const abgebrochen = e instanceof DOMException && e.name === "AbortError";
        aendereLetzte((a) => ({ ...a, text: a.text || (abgebrochen ? "Abgebrochen." : e instanceof Error ? e.message : "Fehler"), fehler: !abgebrochen }));
      } finally {
        abbruch.current = null;
        setZustand("ruhig");
        setAnzeige((a) => {
          schreib(SPEICHER_ANZEIGE, a);
          return a;
        });
        feldRef.current?.focus();
      }
    },
    [anzeige, verlauf, zustand],
  );

  useEffect(() => {
    if (!geladen || !startFrage || startGefragt.current) return;
    startGefragt.current = true;
    fragen(startFrage);
  }, [geladen, startFrage, fragen]);

  useEffect(() => {
    if (!onSchliessen) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onSchliessen();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onSchliessen]);

  const neuesGespraech = () => {
    if (zustand !== "ruhig") abbruch.current?.abort();
    setAnzeige([]);
    setVerlauf([]);
    schreib(SPEICHER_ANZEIGE, []);
    schreib(SPEICHER_VERLAUF, []);
  };

  const leer = anzeige.length === 0;
  const sichtbar = widget ? anzeige.slice(-2) : anzeige;
  const statusText = zustand === "denkt" ? "denkt nach" : zustand === "spricht" ? "antwortet" : "bereit";

  return (
    <div className={`hi ${widget ? "hi-widget" : "hi-seite"} ${leer ? "hi-leer" : ""}`} data-zustand={zustand}>
      {!widget && <div className="hi-hintergrund" aria-hidden />}
      <div className="hi-kopf">
        <div className="hi-gehirn-rahmen">
          <HiGehirn zustand={zustand} impuls={impuls} groesse={widget ? 84 : leer ? 300 : 120} />
        </div>
        <div className="hi-marke">
          <div className="hi-name">Hi<span className="hi-punkt">.</span></div>
          <div className="hi-unter">Hairvenly Intelligence · <span className="hi-status">{statusText}</span></div>
        </div>
        <div className="hi-kopf-aktionen">
          {!leer && (
            <button type="button" className="hi-knopf-klein" onClick={neuesGespraech} title="Neues Gespräch">
              <RotateCcw size={14} /> {!widget && "Neu"}
            </button>
          )}
          {widget && (
            <Link href="/hi" className="hi-knopf-klein" title="Im großen Fenster öffnen">
              <Maximize2 size={14} />
            </Link>
          )}
          {onSchliessen && (
            <button type="button" className="hi-knopf-klein hi-zu" onClick={onSchliessen} title="Schließen (Esc)">
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {leer && !widget && <p className="hi-begruessung">Frag mich alles über Hairvenly — Finanzen, Lager, Bestellungen, Team, Kunden, Retouren. Ich schaue in den echten Daten nach.</p>}

      <div className="hi-liste" ref={listeRef}>
        {sichtbar.map((a, i) =>
          a.rolle === "du" ? (
            <div key={i} className="hi-du">{a.text}</div>
          ) : (
            <div key={i} className={`hi-antwort ${a.fehler ? "hi-fehler" : ""}`}>
              {!!a.schritte?.length && (
                <div className="hi-schritte">
                  {a.schritte.map((s, j) => (
                    <div key={j} className="hi-schritt" data-aktiv={zustand !== "ruhig" && i === sichtbar.length - 1 && j === a.schritte!.length - 1}>
                      <span className="hi-schritt-punkt" /> {s}
                    </div>
                  ))}
                </div>
              )}
              {a.text ? <HiMarkdown text={a.text} /> : zustand !== "ruhig" && i === sichtbar.length - 1 ? <div className="hi-tippt"><span /><span /><span /></div> : null}
            </div>
          ),
        )}
      </div>

      {leer && (
        <div className="hi-vorschlaege">
          {(widget ? VORSCHLAEGE.slice(0, 2) : VORSCHLAEGE).map((v) => (
            <button key={v} type="button" className="hi-vorschlag" onClick={() => fragen(v)}>{v}</button>
          ))}
        </div>
      )}

      <form className="hi-eingabe" onSubmit={(e) => { e.preventDefault(); fragen(eingabe); }}>
        <textarea
          ref={feldRef}
          value={eingabe}
          rows={1}
          placeholder={widget ? "Frag Hi …" : "Frag Hi irgendetwas …"}
          onChange={(e) => setEingabe(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); fragen(eingabe); }
          }}
        />
        {zustand === "ruhig" ? (
          <button type="submit" className="hi-senden" disabled={!eingabe.trim()} aria-label="Fragen"><ArrowUp size={18} /></button>
        ) : (
          <button type="button" className="hi-senden hi-stop" onClick={() => abbruch.current?.abort()} aria-label="Stoppen"><Square size={14} /></button>
        )}
      </form>
    </div>
  );
}
