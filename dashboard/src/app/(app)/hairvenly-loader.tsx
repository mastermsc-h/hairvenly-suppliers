/**
 * Animated Hairvenly logo loader.
 *
 * Uses CSS radial-gradient masks to split the single /logo.png into:
 *   - inner layer: "H" (pulses in/out)
 *   - outer layer: text ring (slowly rotates around the H)
 *
 * Adjust INNER_CUT / OUTER_CUT if the cropping doesn't look right.
 */
export default function HairvenlyLoader({ size = 80 }: { size?: number }) {
  // Where the inner layer stops being visible (0–100)
  const INNER_CUT = 48;
  // Where the outer layer starts being visible (0–100)
  const OUTER_CUT = 52;

  return (
    <div
      style={{ width: size, height: size }}
      className="relative inline-block select-none"
      aria-label="Wird geladen"
    >
      {/* Outer ring (text) — slowly rotates */}
      <div
        className="absolute inset-0 hairvenly-spin"
        style={{
          backgroundImage: "url(/logo.png)",
          backgroundSize: "contain",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "center",
          WebkitMaskImage: `radial-gradient(circle at center, transparent ${OUTER_CUT}%, black ${OUTER_CUT + 1}%)`,
          maskImage: `radial-gradient(circle at center, transparent ${OUTER_CUT}%, black ${OUTER_CUT + 1}%)`,
        }}
      />
      {/* Inner "H" — pulses */}
      <div
        className="absolute inset-0 hairvenly-pulse"
        style={{
          backgroundImage: "url(/logo.png)",
          backgroundSize: "contain",
          backgroundRepeat: "no-repeat",
          backgroundPosition: "center",
          WebkitMaskImage: `radial-gradient(circle at center, black ${INNER_CUT}%, transparent ${INNER_CUT + 1}%)`,
          maskImage: `radial-gradient(circle at center, black ${INNER_CUT}%, transparent ${INNER_CUT + 1}%)`,
        }}
      />
    </div>
  );
}
