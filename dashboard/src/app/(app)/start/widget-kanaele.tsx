"use client";

// Marketing-Kanäle als kleine „Kanal-Kumpel“: jeder Kanal ein Gesicht in Plattform-Farbe, das
// strahlt (Soll geschafft), nervös schaut (knapp) oder schläft (eingeschlafen). Punkte zeigen das
// Soll im Zeitfenster, gefüllt = gepostet. Kanäle ohne Schnittstelle meldet das Team mit „+1“.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Plus, RefreshCw, Undo2 } from "lucide-react";
import type { KanalStand, KanalStatus } from "@/lib/marketing-kanaele";
import { kanalBeitragMelden, kanalBeitragZuruecknehmen, kanaeleAktualisieren } from "@/lib/actions/cockpit";

const FARBE: Record<KanalStand["plattform"], { a: string; b: string; text: string }> = {
  instagram: { a: "#f58529", b: "#c13584", text: "#c13584" },
  tiktok: { a: "#25f4ee", b: "#fe2c55", text: "#111827" },
  youtube: { a: "#ff4e45", b: "#d90013", text: "#d90013" },
  pinterest: { a: "#ff5a6e", b: "#e60023", text: "#e60023" },
  google: { a: "#4285f4", b: "#34a853", text: "#1a73e8" },
  blog: { a: "#a78bfa", b: "#7c5cff", text: "#6d4cff" },
};

const SPRUECHE: Record<KanalStatus, string[]> = {
  geschafft: ["ist bestens gelaunt.", "Soll erfüllt – Applaus! 👏", "tanzt vor Freude.", "fühlt sich gesehen. 💜"],
  knapp: ["knurrt leise: {ist} von {soll}.", "braucht noch {rest} Happen.", "schaut nervös auf die Uhr.", "hätte gern noch {rest}."],
  schlaeft: ["hält seit {t} Tagen Winterschlaf.", "setzt Moos an ({t} Tage still).", "fragt, ob wir noch Freunde sind. ({t} Tage)", "schnarcht seit {t} Tagen."],
};
const NIE = ["wartet noch auf den allerersten Beitrag.", "kennt uns noch gar nicht. 👀"];

function spruch(k: KanalStand, i: number, tag: number) {
  const liste = k.status === "schlaeft" && k.tageSeit == null ? NIE : SPRUECHE[k.status];
  return liste[(i + tag) % liste.length]
    .replace("{ist}", String(k.ist)).replace("{soll}", String(k.soll))
    .replace("{rest}", String(Math.max(1, k.soll - k.ist))).replace("{t}", String(k.tageSeit ?? "viele"));
}

/** Kleines Gesicht: Stimmung je nach Status. */
function Kumpel({ k }: { k: KanalStand }) {
  const f = FARBE[k.plattform];
  const gid = `kk-${k.id}`;
  return (
    <svg className="kk-gesicht" data-status={k.status} viewBox="0 0 64 64" width="56" height="56" aria-hidden>
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={f.a} />
          <stop offset="1" stopColor={f.b} />
        </linearGradient>
      </defs>
      <circle cx="32" cy="34" r="25" fill={`url(#${gid})`} />
      <ellipse cx="24" cy="24" rx="8" ry="4" fill="#fff" opacity="0.3" />
      {k.status === "geschafft" && (
        <g>
          <path d="M19 31 q4 -5 8 0 M37 31 q4 -5 8 0" stroke="#fff" strokeWidth="3" fill="none" strokeLinecap="round" />
          <path d="M21 39 q11 11 22 0 z" fill="#fff" />
          <circle cx="17" cy="38" r="3" fill="#fff" opacity="0.35" />
          <circle cx="47" cy="38" r="3" fill="#fff" opacity="0.35" />
        </g>
      )}
      {k.status === "knapp" && (
        <g>
          <circle cx="24" cy="31" r="3" fill="#fff" />
          <circle cx="40" cy="31" r="3" fill="#fff" />
          <path d="M23 43 q4.5 -3 9 0 t9 0" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" />
          <path className="kk-tropfen" d="M50 18 q3 5 0 7 q-3 -2 0 -7 z" fill="#bfe3ff" />
        </g>
      )}
      {k.status === "schlaeft" && (
        <g>
          <path d="M19 32 q4 3 8 0 M37 32 q4 3 8 0" stroke="#fff" strokeWidth="2.6" fill="none" strokeLinecap="round" />
          <ellipse cx="32" cy="44" rx="4" ry="3" fill="#fff" opacity="0.85" />
          <text className="kk-z kk-z1" x="47" y="16" fontSize="10" fontWeight="800" fill={f.text}>z</text>
          <text className="kk-z kk-z2" x="53" y="9" fontSize="8" fontWeight="800" fill={f.text}>z</text>
        </g>
      )}
    </svg>
  );
}

export default function KanaeleWidget({ d }: { d: { kanaele: KanalStand[]; stand: string | null; heute: string } }) {
  const router = useRouter();
  const [laeuft, start] = useTransition();
  const [fehler, setFehler] = useState<string | null>(null);
  const tag = Number(d.heute.slice(8, 10));
  const happy = d.kanaele.filter((k) => k.status === "geschafft").length;
  const schlafen = d.kanaele.filter((k) => k.status === "schlaeft").length;
  const knapp = d.kanaele.length - happy - schlafen;
  const titel =
    happy === d.kanaele.length ? "Alle Kanäle sind glücklich – Party! 🎉"
      : schlafen >= 5 ? `${schlafen} Kanäle schlafen tief und fest 😴`
        : schlafen > 0 ? `${happy} von ${d.kanaele.length} Kanälen happy – ${schlafen} schnarchen`
          : `${happy} von ${d.kanaele.length} Kanälen happy – der Rest hat Hunger`;
  const tu = (f: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      setFehler(null);
      const r = await f();
      if (!r.ok) setFehler(r.error ?? "Hat nicht geklappt");
      router.refresh();
    });

  return (
    <div className="kk">
      <div className="kk-kopf">
        <div>
          <div className="kk-titel">{titel}</div>
          <div className="kk-leiste" role="img" aria-label={`${happy} geschafft, ${knapp} knapp, ${schlafen} eingeschlafen`}>
            <span style={{ flex: happy }} data-s="geschafft" />
            <span style={{ flex: knapp }} data-s="knapp" />
            <span style={{ flex: schlafen }} data-s="schlaeft" />
          </div>
          <div className="kk-legende"><span data-s="geschafft">😄 {happy} geschafft</span><span data-s="knapp">😬 {knapp} knapp</span><span data-s="schlaeft">😴 {schlafen} eingeschlafen</span></div>
        </div>
        <button type="button" className="kk-knopf ck-kein-zug" onClick={() => tu(kanaeleAktualisieren)} disabled={laeuft} title="Instagram, YouTube und Blog jetzt neu abrufen">
          <RefreshCw size={13} className={laeuft ? "kk-dreht" : ""} /> Aktualisieren
        </button>
      </div>
      {fehler && <div className="kk-fehler">{fehler}</div>}

      <div className="kk-raster">
        {d.kanaele.map((k, i) => {
          const f = FARBE[k.plattform];
          const punkte = Math.max(k.soll, Math.min(k.ist, k.soll + 4));
          return (
            <article key={k.id} className="kk-karte" data-status={k.status} style={{ ["--kk-farbe" as string]: f.text, ["--kk-i" as string]: i }}>
              <div className="kk-oben">
                <Kumpel k={k} />
                <div className="kk-name">
                  <b>{k.name}</b>
                  <small>{k.rhythmus}</small>
                </div>
              </div>
              <div className="kk-punkte" title={`${k.ist} von ${k.soll} in den letzten ${k.fenster} Tagen`}>
                {Array.from({ length: punkte }, (_, j) => <i key={j} data-voll={j < k.ist} data-extra={j >= k.soll} />)}
                <span>{k.ist}/{k.soll} · {k.fenster} T</span>
              </div>
              <p className="kk-spruch"><b>{k.kurz}</b> {spruch(k, i, tag)}</p>
              <div className="kk-unten">
                <span className="kk-zuletzt">{k.tageSeit == null ? "noch nie" : k.tageSeit === 0 ? "heute gepostet" : k.tageSeit === 1 ? "gestern" : `vor ${k.tageSeit} Tagen`}</span>
                {!k.auto ? (
                  <span className="kk-aktionen">
                    {k.letzteManuell && (
                      <button type="button" className="kk-mini ck-kein-zug" onClick={() => tu(() => kanalBeitragZuruecknehmen(k.letzteManuell!.id))} disabled={laeuft} title="Letzte Meldung zurücknehmen"><Undo2 size={12} /></button>
                    )}
                    <button type="button" className="kk-plus ck-kein-zug" onClick={() => tu(() => kanalBeitragMelden(k.id))} disabled={laeuft} title="Heute einen Beitrag gepostet"><Plus size={12} /> gepostet</button>
                  </span>
                ) : (
                  <a className="kk-mini ck-kein-zug" href={k.link} target="_blank" rel="noopener noreferrer" title="Kanal öffnen"><ExternalLink size={12} /></a>
                )}
              </div>
            </article>
          );
        })}
      </div>
      <div className="kk-fuss">Automatisch: Instagram, YouTube, Blog (zweimal täglich, Storys erst ab heute gesammelt) · TikTok, Pinterest, Google: per „+1 gepostet“</div>
    </div>
  );
}
