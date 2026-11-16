// Deko für "Totes Kapital": ein gezackter Riss oben rechts im Fenster, in dem Lava glüht,
// darüber steigt Rauch auf und es fliegen Funken. Rein dekorativ (aria-hidden),
// liegt über dem Fenster, fängt keine Klicks ab.
export default function LavaRiss() {
  return (
    <div className="lv" aria-hidden>
      <svg className="lv-riss" viewBox="0 0 140 150" width="140" height="150">
        <defs>
          <linearGradient id="lv-glut" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stopColor="#fff6b0">
              <animate attributeName="stop-color" values="#fff6b0;#ffd65a;#fff6b0" dur="3.2s" repeatCount="indefinite" />
            </stop>
            <stop offset="0.35" stopColor="#ffab2e">
              <animate attributeName="offset" values="0.3;0.45;0.3" dur="4.5s" repeatCount="indefinite" />
            </stop>
            <stop offset="0.75" stopColor="#ff4a1c" />
            <stop offset="1" stopColor="#8a1406" />
          </linearGradient>
          <radialGradient id="lv-russ">
            <stop offset="0" stopColor="#3b2318" stopOpacity="0.32" />
            <stop offset="0.55" stopColor="#5a3524" stopOpacity="0.12" />
            <stop offset="1" stopColor="#5a3524" stopOpacity="0" />
          </radialGradient>
          <filter id="lv-schein" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="5" />
          </filter>
          <filter id="lv-wabern">
            <feTurbulence type="fractalNoise" baseFrequency="0.06" numOctaves="2" seed="3">
              <animate attributeName="baseFrequency" values="0.05;0.08;0.05" dur="6s" repeatCount="indefinite" />
            </feTurbulence>
            <feDisplacementMap in="SourceGraphic" scale="3" />
          </filter>
        </defs>
        {/* Ruß / verbrannter Rand */}
        <ellipse cx="80" cy="72" rx="44" ry="78" transform="rotate(28 80 72)" fill="url(#lv-russ)" />
        {/* Wärmeschein rund um den Riss */}
        <path className="lv-schein" d="M112 0 L96 26 L106 30 L84 62 L95 66 L64 104 L74 108 L44 150 L62 104 L52 100 L78 64 L67 60 L88 30 L77 26 L92 0 Z" fill="#ff6a1f" filter="url(#lv-schein)" />
        {/* Bruchkante: dunkler, etwas breiter als die Lava */}
        <path d="M113 0 L97 26 L108 31 L85 62 L97 67 L65 104 L76 109 L44 150 L60 105 L50 100 L76 65 L65 60 L86 30 L75 26 L90 0 Z" fill="#2b1712" opacity="0.92" />
        {/* Lava */}
        <path className="lv-lava" d="M108 0 L94 26 L103 30 L81 62 L91 66 L61 104 L70 107 L46 146 L60 104 L53 100 L78 64 L69 60 L89 29 L80 26 L95 0 Z" fill="url(#lv-glut)" filter="url(#lv-wabern)" />
        {/* helle Adern in der Glut */}
        <path className="lv-ader" d="M101 4 L91 27 L97 30 L79 61 L85 64 L60 101 L64 103 L50 136" fill="none" stroke="#fffbe0" strokeWidth="1.2" strokeLinecap="round" opacity="0.8" />
        {/* feine Seitenrisse */}
        <path d="M86 30 L72 36 L64 34 M65 60 L52 58 L44 62 M60 105 L47 110 M97 67 L110 74 L118 72" fill="none" stroke="#3a1f17" strokeWidth="1.4" strokeLinecap="round" opacity="0.7" />
      </svg>
      <div className="lv-rauch">
        {Array.from({ length: 6 }, (_, i) => <i key={i} style={{ ["--i" as string]: i }} />)}
      </div>
      <div className="lv-funken">
        {Array.from({ length: 7 }, (_, i) => <b key={i} style={{ ["--i" as string]: i }} />)}
      </div>
    </div>
  );
}
