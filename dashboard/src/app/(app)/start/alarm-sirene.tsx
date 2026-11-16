// Deko für "Totes Kapital" (Alternative zum Lava-Riss): eine moderne rote Rundumleuchte –
// Glaskuppel auf Metallsockel, kreisender Lichtkegel, pulsierender Schein und kleine rote
// Sterne, die auf einer schrägen Bahn um die Sirene kreisen (vorne groß/hell, hinten klein/blass).
export default function AlarmSirene() {
  return (
    <div className="sr" aria-hidden>
      <div className="sr-schein" />
      <div className="sr-kegel" />
      <div className="sr-bahn sr-bahn-hinten">
        <div className="sr-kreis">
          {[0, 1, 2, 3, 4].map((i) => <span key={i} className="sr-stern" style={{ ["--i" as string]: i }}><span className="sr-tiefe"><Stern /></span></span>)}
        </div>
      </div>
      <svg className="sr-lampe" viewBox="0 0 80 84" width="80" height="84">
        <defs>
          <radialGradient id="sr-glas" cx="0.38" cy="0.3" r="0.8">
            <stop offset="0" stopColor="#ffd2d8" />
            <stop offset="0.25" stopColor="#ff4d63" />
            <stop offset="0.7" stopColor="#d4102e" />
            <stop offset="1" stopColor="#7a0619" />
          </radialGradient>
          <linearGradient id="sr-sockel" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#f4f5f8" />
            <stop offset="0.45" stopColor="#b9bdc8" />
            <stop offset="1" stopColor="#6d7180" />
          </linearGradient>
          <linearGradient id="sr-glanz" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0" stopColor="#fff" stopOpacity="0" />
            <stop offset="0.5" stopColor="#fff" stopOpacity="0.75" />
            <stop offset="1" stopColor="#fff" stopOpacity="0" />
          </linearGradient>
          <clipPath id="sr-kuppel"><path d="M16 60 V38 a24 24 0 0 1 48 0 V60 Z" /></clipPath>
        </defs>
        {/* Kuppel */}
        <path d="M16 60 V38 a24 24 0 0 1 48 0 V60 Z" fill="url(#sr-glas)" />
        {/* innere Leuchte, die im Takt aufblitzt */}
        <g clipPath="url(#sr-kuppel)">
          <ellipse className="sr-kern" cx="40" cy="44" rx="11" ry="15" fill="#fff1f2" />
          <rect className="sr-wandert" x="-30" y="10" width="26" height="60" fill="url(#sr-glanz)" />
        </g>
        {/* Glanzlicht und feine Rippen */}
        <path d="M24 36 a17 17 0 0 1 12 -14" fill="none" stroke="#fff" strokeOpacity="0.8" strokeWidth="3" strokeLinecap="round" />
        <path d="M30 60 V40 M40 60 V34 M50 60 V40" stroke="#7a0619" strokeOpacity="0.25" strokeWidth="1" />
        {/* Metallsockel */}
        <rect x="10" y="59" width="60" height="9" rx="3" fill="url(#sr-sockel)" />
        <rect x="6" y="67" width="68" height="10" rx="4" fill="url(#sr-sockel)" />
        <rect x="6" y="67" width="68" height="2" rx="1" fill="#fff" opacity="0.7" />
      </svg>
      <div className="sr-bahn sr-bahn-vorne">
        <div className="sr-kreis">
          {[0, 1, 2, 3, 4].map((i) => <span key={i} className="sr-stern" style={{ ["--i" as string]: i }}><span className="sr-tiefe"><Stern /></span></span>)}
        </div>
      </div>
    </div>
  );
}

function Stern() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12">
      <path d="M12 0 C13 8 16 11 24 12 C16 13 13 16 12 24 C11 16 8 13 0 12 C8 11 11 8 12 0 Z" fill="#ff2e4d" />
    </svg>
  );
}
