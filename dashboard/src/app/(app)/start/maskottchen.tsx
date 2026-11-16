// Maskottchen für den Startbildschirm. Alle teilen dieselbe Bühne (160 × 170), dieselben
// Stimmungen (froh = winkt, normal, sturm = Regenschirm) und sind immer gut gelaunt.
export const MASKOTTCHEN = [
  { id: "hailey", name: "Hailey" },
  { id: "max", name: "Max" },
  { id: "fuchs", name: "Finn, der Fuchs" },
  { id: "biber", name: "Bruno, der Biber" },
  { id: "faultier", name: "Lotti, das Faultier" },
] as const;
export type MaskottchenId = (typeof MASKOTTCHEN)[number]["id"];
export type Stimmung = "froh" | "normal" | "sturm";

function Augen({ y = 86, abstand = 10, farbe = "#2b2238" }: { y?: number; abstand?: number; farbe?: string }) {
  return (
    <g className="hl-augen" style={{ transformOrigin: `80px ${y}px` }}>
      <ellipse cx={80 - abstand} cy={y} rx="3.4" ry="4.2" fill={farbe} />
      <ellipse cx={80 + abstand} cy={y} rx="3.4" ry="4.2" fill={farbe} />
      <circle cx={80 - abstand + 1.1} cy={y - 1.6} r="1.1" fill="#fff" />
      <circle cx={80 + abstand + 1.1} cy={y - 1.6} r="1.1" fill="#fff" />
    </g>
  );
}
/** Immer ein Lächeln – bei froh ein breites, offenes. */
function Mund({ y = 99, froh, farbe = "#b23a5a" }: { y?: number; froh: boolean; farbe?: string }) {
  return froh
    ? <path d={`M70 ${y} Q80 ${y + 11} 90 ${y} Q80 ${y + 4} 70 ${y} Z`} fill={farbe} stroke={farbe} strokeWidth="1.5" strokeLinejoin="round" />
    : <path d={`M71 ${y} Q80 ${y + 8} 89 ${y}`} fill="none" stroke={farbe} strokeWidth="2.6" strokeLinecap="round" />;
}
function Wangen({ y = 96 }: { y?: number }) {
  return <><circle cx="62" cy={y} r="4.6" fill="#ff8fa8" opacity="0.45" /><circle cx="98" cy={y} r="4.6" fill="#ff8fa8" opacity="0.45" /></>;
}
function Schirm() {
  return (
    <g className="hl-schirm">
      <path d="M18 50 Q80 -8 142 50 Q126 42 111 50 Q96 42 80 50 Q64 42 49 50 Q34 42 18 50 Z" fill="#7c5cff" />
      <path d="M80 48 V94" stroke="#3b3355" strokeWidth="3" strokeLinecap="round" />
      {[30, 58, 104, 132].map((x, k) => <line key={k} className="hl-tropfen" x1={x} y1={58} x2={x - 3} y2={68} stroke="#7cc8ff" strokeWidth="2" strokeLinecap="round" style={{ animationDelay: `${k * 0.3}s` }} />)}
    </g>
  );
}
function Winken({ farbe }: { farbe: string }) {
  return (
    <g className="hl-hand">
      <path d="M118 150 C128 136 132 122 134 110" fill="none" stroke={farbe} strokeWidth="9" strokeLinecap="round" />
      <circle cx="135" cy="104" r="7.5" fill={farbe} />
    </g>
  );
}

export function Figur({ id, stimmung }: { id: MaskottchenId; stimmung: Stimmung }) {
  const froh = stimmung !== "normal"; // auch im Sturm gut gelaunt
  const g = `mk-${id}`;
  return (
    <svg viewBox="0 0 160 170" width="150" height="160" aria-hidden>
      <defs>
        <linearGradient id={`${g}-haar`} x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#5b3a2a" /><stop offset="0.55" stopColor="#9a6a43" /><stop offset="1" stopColor="#e6c38f" /></linearGradient>
        <linearGradient id={`${g}-shirt`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#7c5cff" /><stop offset="1" stopColor="#ff6fae" /></linearGradient>
        <linearGradient id={`${g}-shirt2`} x1="0" y1="0" x2="1" y2="1"><stop offset="0" stopColor="#0fb5ba" /><stop offset="1" stopColor="#2f9bff" /></linearGradient>
      </defs>
      {stimmung === "sturm" && <Schirm />}

      {id === "hailey" && (<>
        <path className="hl-haare" d="M44 70 C38 40 56 22 80 22 C104 22 122 40 116 70 C122 100 126 128 116 150 L44 150 C34 128 38 100 44 70 Z" fill={`url(#${g}-haar)`} />
        <path d="M42 170 C42 140 58 128 80 128 C102 128 118 140 118 170 Z" fill={`url(#${g}-shirt)`} />
        <rect x="72" y="112" width="16" height="20" rx="7" fill="#f2c9a8" />
        <ellipse cx="80" cy="82" rx="27" ry="31" fill="#f6d2b4" />
        <path d="M53 76 C54 52 72 46 88 50 C100 53 108 62 108 76 C98 64 82 60 66 66 C60 68 56 72 53 76 Z" fill="#6b4530" />
        <Augen /><Wangen /><Mund froh={froh} />
        <path className="hl-straehne" d="M52 78 C46 104 50 126 44 148" fill="none" stroke={`url(#${g}-haar)`} strokeWidth="9" strokeLinecap="round" />
        <path className="hl-straehne hl-straehne-2" d="M108 78 C114 104 110 126 116 148" fill="none" stroke={`url(#${g}-haar)`} strokeWidth="9" strokeLinecap="round" />
        {stimmung === "froh" && <Winken farbe="#f6d2b4" />}
      </>)}

      {id === "max" && (<>
        <path d="M40 170 C40 138 58 126 80 126 C102 126 120 138 120 170 Z" fill={`url(#${g}-shirt2)`} />
        <rect x="71" y="110" width="18" height="20" rx="7" fill="#e8b994" />
        <ellipse cx="52" cy="86" rx="5" ry="7" fill="#e8b994" /><ellipse cx="108" cy="86" rx="5" ry="7" fill="#e8b994" />
        <ellipse cx="80" cy="84" rx="27" ry="30" fill="#f0c6a3" />
        <path className="hl-haare" d="M52 78 C50 52 66 44 82 44 C100 44 112 54 108 78 C104 66 96 60 84 62 C74 58 62 62 52 78 Z" fill="#3b2a20" />
        <path d="M58 98 Q80 122 102 98 Q100 112 80 114 Q60 112 58 98 Z" fill="#3b2a20" opacity="0.18" />
        <path d="M66 78 l9 -2 M85 76 l9 2" stroke="#3b2a20" strokeWidth="2.4" strokeLinecap="round" />
        <Augen y={88} /><Wangen y={98} /><Mund y={101} froh={froh} farbe="#9c3b3b" />
        {stimmung === "froh" && <Winken farbe="#f0c6a3" />}
      </>)}

      {id === "fuchs" && (<>
        <path className="hl-haare" d="M118 160 C150 150 156 112 136 96 C146 120 132 140 112 146 Z" fill="#f08a2c" />
        <path d="M128 104 C140 112 142 126 136 134 C134 122 130 112 128 104 Z" fill="#fff" opacity="0.9" />
        <path d="M44 170 C44 138 60 126 80 126 C100 126 116 138 116 170 Z" fill="#f08a2c" />
        <path d="M66 170 C66 146 72 134 80 134 C88 134 94 146 94 170 Z" fill="#fff6ec" />
        <path d="M48 74 L54 36 L72 58 Q80 55 88 58 L106 36 L112 74 Q114 110 80 114 Q46 110 48 74 Z" fill="#f59a3c" />
        <path d="M55 44 L58 62 L68 58 Z M105 44 L102 62 L92 58 Z" fill="#7a3d12" />
        <path d="M50 86 Q64 92 80 112 Q96 92 110 86 Q112 108 80 116 Q48 108 50 86 Z" fill="#fff6ec" />
        <Augen y={82} abstand={12} /><ellipse cx="80" cy="97" rx="4.5" ry="3.4" fill="#2b2238" />
        <Mund y={102} froh={froh} farbe="#7a3d12" />
        {stimmung === "froh" && <Winken farbe="#f59a3c" />}
      </>)}

      {id === "biber" && (<>
        <ellipse className="hl-haare" cx="40" cy="150" rx="18" ry="11" fill="#6b4630" transform="rotate(-25 40 150)" />
        <path d="M40 150 l10 -6 M34 146 l12 -2 M44 156 l8 -8" stroke="#4e3222" strokeWidth="1.5" />
        <path d="M44 170 C44 136 60 124 80 124 C100 124 116 136 116 170 Z" fill="#9a6a43" />
        <ellipse cx="80" cy="150" rx="18" ry="16" fill="#c49a6c" />
        <circle cx="56" cy="58" r="8" fill="#9a6a43" /><circle cx="104" cy="58" r="8" fill="#9a6a43" />
        <circle cx="56" cy="58" r="4" fill="#6b4630" /><circle cx="104" cy="58" r="4" fill="#6b4630" />
        <ellipse cx="80" cy="84" rx="30" ry="30" fill="#a8774d" />
        <ellipse cx="80" cy="99" rx="17" ry="12" fill="#e2c19a" />
        <Augen y={80} abstand={12} /><ellipse cx="80" cy="92" rx="5.5" ry="3.8" fill="#3a2418" />
        <rect x="75" y="104" width="5" height="8" rx="1.2" fill="#fff" stroke="#d8cbb8" strokeWidth="0.6" />
        <rect x="80" y="104" width="5" height="8" rx="1.2" fill="#fff" stroke="#d8cbb8" strokeWidth="0.6" />
        <path d="M68 100 Q80 108 92 100" fill="none" stroke="#6b4630" strokeWidth="2" strokeLinecap="round" />
        <Wangen y={96} />
        {stimmung === "froh" && <Winken farbe="#a8774d" />}
      </>)}

      {id === "faultier" && (<>
        <path className="hl-haare" d="M14 34 Q80 20 146 34" fill="none" stroke="#7a5a3a" strokeWidth="6" strokeLinecap="round" />
        <ellipse cx="34" cy="28" rx="8" ry="4" fill="#4cd38f" transform="rotate(-20 34 28)" /><ellipse cx="124" cy="26" rx="8" ry="4" fill="#4cd38f" transform="rotate(20 124 26)" />
        <path d="M58 132 C50 100 46 70 52 36" fill="none" stroke="#a89582" strokeWidth="11" strokeLinecap="round" />
        <path d="M102 132 C110 100 114 70 108 36" fill="none" stroke="#a89582" strokeWidth="11" strokeLinecap="round" />
        <path d="M44 170 C44 136 60 124 80 124 C100 124 116 136 116 170 Z" fill="#a89582" />
        <ellipse cx="80" cy="84" rx="30" ry="29" fill="#b6a390" />
        <ellipse cx="80" cy="88" rx="24" ry="20" fill="#eadfcf" />
        <path d="M60 80 Q66 74 74 82 Q70 92 62 90 Q56 86 60 80 Z M100 80 Q94 74 86 82 Q90 92 98 90 Q104 86 100 80 Z" fill="#5b4636" />
        <g className="hl-augen" style={{ transformOrigin: "80px 84px" }}>
          <circle cx="67" cy="84" r="3" fill="#1f1610" /><circle cx="93" cy="84" r="3" fill="#1f1610" />
          <circle cx="68" cy="83" r="0.9" fill="#fff" /><circle cx="94" cy="83" r="0.9" fill="#fff" />
        </g>
        <ellipse cx="80" cy="93" rx="4" ry="3" fill="#3a2a20" />
        <Mund y={99} froh={froh} farbe="#6b3a2a" />
        <Wangen y={95} />
      </>)}
    </svg>
  );
}
