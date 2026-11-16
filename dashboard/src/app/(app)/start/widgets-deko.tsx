"use client";

// Verspielte Startbildschirm-Fenster ohne Rahmen: Hailey (Figur mit Sprechblase), Umsatz-Pflanze,
// Polaroid-Stapel mit eigenen Bildern, runde Wetter- und Tageskarte.
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Caveat } from "next/font/google";
import { ImagePlus, Trash2 } from "lucide-react";
import { bildHochladen, bildLoeschen } from "@/lib/actions/cockpit";
import { resizeImage } from "@/lib/image-resize";
import type { HaileyDaten, PflanzeDaten, Polaroid, WetterDaten } from "@/lib/cockpit/deko";

const handschrift = Caveat({ subsets: ["latin"], weight: ["500", "700"], display: "swap" });

// ── Hailey ──────────────────────────────────────────────────────────────────

export function HaileyWidget({ d }: { d: HaileyDaten }) {
  const [i, setI] = useState(0);
  const [neu, setNeu] = useState(0); // löst die Einblend-Animation der Sprechblase neu aus
  // alle 12 Sekunden der nächste Satz
  useEffect(() => {
    if (d.saetze.length < 2) return;
    const t = setInterval(() => { setI((x) => (x + 1) % d.saetze.length); setNeu((n) => n + 1); }, 12000);
    return () => clearInterval(t);
  }, [d.saetze.length]);
  const weiter = () => { setI((x) => (x + 1) % d.saetze.length); setNeu((n) => n + 1); };
  const s = d.stimmung;
  return (
    <div className="hl" data-stimmung={s}>
      <button type="button" key={neu} className="hl-blase" onClick={weiter} title="Nächster Satz">{d.saetze[i]}</button>
      <button type="button" className="hl-figur" onClick={weiter} aria-label="Hailey – nächster Satz">
        <svg viewBox="0 0 160 170" width="150" height="160" aria-hidden>
          <defs>
            <linearGradient id="hl-haar" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#5b3a2a" />
              <stop offset="0.55" stopColor="#9a6a43" />
              <stop offset="1" stopColor="#e6c38f" />
            </linearGradient>
            <linearGradient id="hl-shirt" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#7c5cff" /><stop offset="1" stopColor="#ff6fae" />
            </linearGradient>
          </defs>
          {/* Schirm bei Sturm */}
          {s === "sturm" && (
            <g className="hl-schirm">
              <path d="M18 52 Q80 -6 142 52 Q126 44 111 52 Q96 44 80 52 Q64 44 49 52 Q34 44 18 52 Z" fill="#7c5cff" />
              <path d="M80 50 V96" stroke="#3b3355" strokeWidth="3" strokeLinecap="round" />
              {[30, 58, 104, 132].map((x, k) => <line key={k} className="hl-tropfen" x1={x} y1={60} x2={x - 3} y2={70} stroke="#7cc8ff" strokeWidth="2" strokeLinecap="round" style={{ animationDelay: `${k * 0.3}s` }} />)}
            </g>
          )}
          {/* Haare hinten (schwingen leicht) */}
          <path className="hl-haare" d="M44 70 C38 40 56 22 80 22 C104 22 122 40 116 70 C122 100 126 128 116 150 L44 150 C34 128 38 100 44 70 Z" fill="url(#hl-haar)" />
          {/* Körper */}
          <path d="M42 170 C42 140 58 128 80 128 C102 128 118 140 118 170 Z" fill="url(#hl-shirt)" />
          <rect x="72" y="112" width="16" height="20" rx="7" fill="#f2c9a8" />
          {/* Kopf */}
          <ellipse cx="80" cy="82" rx="27" ry="31" fill="#f6d2b4" />
          {/* Pony */}
          <path d="M53 76 C54 52 72 46 88 50 C100 53 108 62 108 76 C98 64 82 60 66 66 C60 68 56 72 53 76 Z" fill="#6b4530" />
          {/* Augen (blinzeln) */}
          <g className="hl-augen">
            <ellipse cx="70" cy="86" rx="3.2" ry="4" fill="#2b2238" />
            <ellipse cx="90" cy="86" rx="3.2" ry="4" fill="#2b2238" />
            <circle cx="71" cy="84.5" r="1" fill="#fff" /><circle cx="91" cy="84.5" r="1" fill="#fff" />
          </g>
          {/* Wangen + Mund je Stimmung */}
          <circle cx="63" cy="96" r="4.5" fill="#ff8fa8" opacity="0.45" /><circle cx="97" cy="96" r="4.5" fill="#ff8fa8" opacity="0.45" />
          {s === "froh" && <path d="M71 99 Q80 108 89 99" fill="none" stroke="#b23a5a" strokeWidth="2.6" strokeLinecap="round" />}
          {s === "normal" && <path d="M73 101 Q80 105 87 101" fill="none" stroke="#b23a5a" strokeWidth="2.4" strokeLinecap="round" />}
          {s === "sturm" && <path d="M73 104 Q80 99 87 104" fill="none" stroke="#b23a5a" strokeWidth="2.4" strokeLinecap="round" />}
          {/* Haarsträhnen vorne über die Schultern */}
          <path className="hl-straehne" d="M52 78 C46 104 50 126 44 148" fill="none" stroke="url(#hl-haar)" strokeWidth="9" strokeLinecap="round" />
          <path className="hl-straehne hl-straehne-2" d="M108 78 C114 104 110 126 116 148" fill="none" stroke="url(#hl-haar)" strokeWidth="9" strokeLinecap="round" />
          {/* winkende Hand, wenn es gut läuft */}
          {s === "froh" && (
            <g className="hl-hand">
              <path d="M118 150 C128 136 132 122 134 110" fill="none" stroke="#f6d2b4" strokeWidth="9" strokeLinecap="round" />
              <circle cx="135" cy="104" r="7.5" fill="#f6d2b4" />
            </g>
          )}
        </svg>
      </button>
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
