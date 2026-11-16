"use client";

// Verspielte Startbildschirm-Fenster ohne Rahmen: Hailey (Figur mit Sprechblase), Umsatz-Pflanze,
// Polaroid-Stapel mit eigenen Bildern, runde Wetter- und Tageskarte.
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Caveat } from "next/font/google";
import { ImagePlus, Shuffle, Trash2 } from "lucide-react";
import { bildHochladen, bildLoeschen, maskottchenSetzen } from "@/lib/actions/cockpit";
import { Figur, MASKOTTCHEN, type MaskottchenId } from "./maskottchen";
import { resizeImage } from "@/lib/image-resize";
import type { HaileyDaten, PflanzeDaten, Polaroid, WetterDaten } from "@/lib/cockpit/deko";

const handschrift = Caveat({ subsets: ["latin"], weight: ["500", "700"], display: "swap" });

// ── Maskottchen (Hailey, Max, Fuchs, Biber, Faultier) ───────────────────────

export function HaileyWidget({ d }: { d: HaileyDaten }) {
  const router = useRouter();
  const [i, setI] = useState(0);
  const [neu, setNeu] = useState(0); // löst die Einblend-Animation der Sprechblase neu aus
  const [figur, setFigur] = useState<MaskottchenId>((MASKOTTCHEN.some((m) => m.id === d.maskottchen) ? d.maskottchen : "hailey") as MaskottchenId);
  const [waehlen, setWaehlen] = useState(false);
  // alle 12 Sekunden der nächste Satz
  useEffect(() => {
    if (d.saetze.length < 2) return;
    const t = setInterval(() => { setI((x) => (x + 1) % d.saetze.length); setNeu((n) => n + 1); }, 12000);
    return () => clearInterval(t);
  }, [d.saetze.length]);
  const weiter = () => { setI((x) => (x + 1) % d.saetze.length); setNeu((n) => n + 1); };
  const aendern = (m: MaskottchenId) => {
    setFigur(m);
    setWaehlen(false);
    maskottchenSetzen(m).then(() => router.refresh());
  };
  return (
    <div className="hl" data-stimmung={d.stimmung}>
      <button type="button" key={neu} className="hl-blase" onClick={weiter} title="Nächster Satz">{d.saetze[i]}</button>
      <button type="button" className="hl-figur" onClick={weiter} aria-label={`${MASKOTTCHEN.find((m) => m.id === figur)?.name} – nächster Satz`}>
        <Figur id={figur} stimmung={d.stimmung} />
      </button>
      <div className="hl-wahl" data-offen={waehlen}>
        {waehlen ? MASKOTTCHEN.map((m) => (
          <button key={m.id} type="button" className="hl-wahl-knopf" data-an={m.id === figur} onClick={() => aendern(m.id)} title={m.name}>
            <span className="hl-mini"><Figur id={m.id} stimmung="normal" /></span>
          </button>
        )) : (
          <button type="button" className="hl-wechseln" onClick={() => setWaehlen(true)} title="Anderes Maskottchen wählen"><Shuffle size={13} /> wechseln</button>
        )}
      </div>
    </div>
  );
}

// ── Umsatz-Pflanze ──────────────────────────────────────────────────────────

export function PflanzeWidget({ d }: { d: PflanzeDaten }) {
  const v = d.verhaeltnis ?? 1;
  const blaetter = Math.max(2, Math.min(9, Math.round(2 + (v - 0.6) * 10)));
  const welk = v < 0.9;
  const bluete = v >= 1.05;
  const hoehe = 46 + Math.min(1.4, v) * 48; // Stängellänge
  return (
    <div className="pf" data-welk={welk} title={d.prozent != null ? `Umsatz ${d.prozent >= 0 ? "+" : ""}${d.prozent} % zum Vorjahr (1.–${d.bisTag}.)` : "Kein Vorjahresvergleich"}>
      <svg viewBox="0 0 140 190" width="130" height="176" aria-hidden>
        <defs>
          <linearGradient id="pf-topf" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#7c5cff" /><stop offset="1" stopColor="#b06cff" />
          </linearGradient>
          <linearGradient id="pf-blatt" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={welk ? "#b9c48a" : "#4cd38f"} /><stop offset="1" stopColor={welk ? "#8a9a5b" : "#12a36a"} />
          </linearGradient>
        </defs>
        <g className="pf-pflanze" style={{ transformOrigin: "70px 150px" }}>
          <path d={`M70 150 C70 ${150 - hoehe * 0.5} ${welk ? 80 : 66} ${150 - hoehe * 0.8} ${welk ? 86 : 70} ${150 - hoehe}`} fill="none" stroke="#2f9e64" strokeWidth="4" strokeLinecap="round" />
          {Array.from({ length: blaetter }, (_, k) => {
            const y = 146 - ((k + 1) / (blaetter + 1)) * hoehe;
            const links = k % 2 === 0;
            const dreh = (links ? -1 : 1) * (welk ? 62 : 32);
            return (
              <g key={k} className="pf-blatt" style={{ transformOrigin: `70px ${y}px`, animationDelay: `${k * 0.4}s` }}>
                <path d={`M70 ${y} q${links ? -26 : 26} -10 ${links ? -34 : 34} ${welk ? 12 : -4} q${links ? 16 : -16} 14 ${links ? 34 : -34} ${welk ? -12 : 4} z`} fill="url(#pf-blatt)" transform={`rotate(${dreh / 4} 70 ${y})`} />
              </g>
            );
          })}
          {bluete && (
            <g className="pf-bluete" transform={`translate(70 ${150 - hoehe})`}>
              {[0, 60, 120, 180, 240, 300].map((w) => <ellipse key={w} cx="0" cy="-9" rx="6" ry="10" fill="#ff6fae" transform={`rotate(${w})`} />)}
              <circle r="5" fill="#ffd23f" />
            </g>
          )}
        </g>
        {/* Topf */}
        <path d="M38 148 H102 L95 184 Q94 188 89 188 H51 Q46 188 45 184 Z" fill="url(#pf-topf)" />
        <rect x="34" y="142" width="72" height="10" rx="5" fill="#6a49ef" />
        <ellipse cx="70" cy="146" rx="30" ry="3" fill="#5a3e2b" opacity="0.6" />
      </svg>
      <div className="pf-schild">{d.prozent == null ? "–" : `${d.prozent >= 0 ? "+" : ""}${d.prozent} %`}<span>Umsatz zum Vorjahr</span></div>
    </div>
  );
}

// ── Polaroids ───────────────────────────────────────────────────────────────

const DREH = [-7, 5, -3, 8, -5];

export function PolaroidWidget({ bilder }: { bilder: Polaroid[] }) {
  const router = useRouter();
  const [start, setStart] = useState(0);
  const [weg, setWeg] = useState(false);
  const [laeuft, starte] = useTransition();
  const [fehler, setFehler] = useState<string | null>(null);
  const datei = useRef<HTMLInputElement | null>(null);
  const n = bilder.length;
  // alle 7 Sekunden rutscht das oberste Foto nach hinten
  useEffect(() => {
    if (n < 2) return;
    const t = setInterval(() => {
      setWeg(true);
      setTimeout(() => { setStart((s) => (s + 1) % n); setWeg(false); }, 700);
    }, 7000);
    return () => clearInterval(t);
  }, [n]);
  const hochladen = (f: File) => starte(async () => {
    setFehler(null);
    const klein = await resizeImage(f, 1400, 1400, 0.85);
    const fd = new FormData();
    fd.set("datei", klein);
    fd.set("titel", window.prompt("Kurze Beschriftung (optional):", "") ?? "");
    const r = await bildHochladen(fd);
    if (!r.ok) setFehler(r.error);
    router.refresh();
  });
  const sichtbar = n ? [0, 1, 2].slice(0, Math.min(3, n)).map((k) => bilder[(start + k) % n]) : [];
  return (
    <div className="po">
      <div className="po-stapel">
        {sichtbar.length === 0 && (
          <button type="button" className="po-karte po-leer" onClick={() => datei.current?.click()} style={{ ["--d" as string]: "-4deg" }}>
            <span className="po-foto po-foto-leer"><ImagePlus size={28} /></span>
            <span className={`po-text ${handschrift.className}`}>Erstes Foto hinzufügen</span>
          </button>
        )}
        {[...sichtbar].reverse().map((b, k) => {
          const oben = k === sichtbar.length - 1;
          const ebene = sichtbar.length - 1 - k;
          return (
            <figure key={`${b.id}-${start}`} className="po-karte" data-oben={oben} data-weg={oben && weg} style={{ ["--d" as string]: `${DREH[(start + ebene) % DREH.length]}deg`, ["--e" as string]: ebene }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="po-foto" src={b.url} alt={b.titel || "Foto"} draggable={false} />
              <figcaption className={`po-text ${handschrift.className}`}>{b.titel || " "}</figcaption>
              {oben && (b.eigenes) && (
                <button type="button" className="po-loeschen" title="Foto entfernen" onClick={() => { if (window.confirm("Foto entfernen?")) starte(async () => { await bildLoeschen(b.id); router.refresh(); }); }}><Trash2 size={13} /></button>
              )}
            </figure>
          );
        })}
      </div>
      <button type="button" className="po-plus" onClick={() => datei.current?.click()} disabled={laeuft} title="Foto hinzufügen"><ImagePlus size={15} /></button>
      <input ref={datei} type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) hochladen(f); e.target.value = ""; }} />
      {fehler && <div className="po-fehler">{fehler}</div>}
    </div>
  );
}

// ── Wetter- und Tageskarte ─────────────────────────────────────────────────

function wetterArt(code: number): { name: string; art: "sonne" | "wolken" | "regen" | "schnee" | "nebel" | "gewitter" } {
  if (code === 0) return { name: "klar", art: "sonne" };
  if (code <= 3) return { name: code === 1 ? "heiter" : code === 2 ? "wolkig" : "bedeckt", art: code === 1 ? "sonne" : "wolken" };
  if (code === 45 || code === 48) return { name: "Nebel", art: "nebel" };
  if (code >= 95) return { name: "Gewitter", art: "gewitter" };
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return { name: "Schnee", art: "schnee" };
  return { name: code >= 61 ? "Regen" : "Niesel", art: "regen" };
}

export function WetterWidget({ d }: { d: WetterDaten | null }) {
  if (!d) return <div className="wt wt-leer">Wetter gerade nicht erreichbar</div>;
  const w = wetterArt(d.code);
  const t = (iso: string) => Date.parse(`${iso}:00`);
  const anteil = Math.max(0, Math.min(1, (t(d.jetzt) - t(d.sonnenaufgang)) / (t(d.sonnenuntergang) - t(d.sonnenaufgang))));
  // Sonne (oder Mond) auf dem Tagesbogen
  const winkel = Math.PI * (1 - anteil);
  const sx = 100 + Math.cos(winkel) * 70, sy = 112 - Math.sin(winkel) * 70;
  const uhr = (iso: string) => iso.slice(11, 16);
  return (
    <div className="wt" data-tag={d.tag} data-art={w.art}>
      <svg className="wt-bogen" viewBox="0 0 200 200" aria-hidden>
        <path d="M30 112 A70 70 0 0 1 170 112" fill="none" stroke="currentColor" strokeOpacity="0.35" strokeWidth="1.5" strokeDasharray="3 4" />
        {d.tag && <circle cx={Math.round(sx * 10) / 10} cy={Math.round(sy * 10) / 10} r="8" className="wt-sonne" />}
      </svg>
      {!d.tag && <div className="wt-sterne" />}
      {(w.art === "regen" || w.art === "gewitter") && <div className="wt-regen" />}
      {w.art === "schnee" && <div className="wt-schnee" />}
      <div className="wt-inhalt">
        <div className="wt-ort">Bremen · {d.wochentag}</div>
        <div className="wt-temp">{d.temperatur}°</div>
        <div className="wt-art">{w.name} · {d.min}° / {d.max}°</div>
        {!d.tag && <div className="wt-zeit">Sonne {uhr(d.sonnenaufgang)} – {uhr(d.sonnenuntergang)}</div>}
        <div className="wt-satz">{d.satz}</div>
      </div>
    </div>
  );
}
