import HairvenlyLoader from "./hairvenly-loader";

/**
 * Automatischer Loading-State für alle Routen unter /(app)/.
 * Wird von Next.js gerendert während der Server noch Daten holt.
 * Die Sidebar bleibt sichtbar (kommt aus layout.tsx).
 */
export default function AppLoading() {
  return (
    <>
      {/* Thin top progress bar */}
      <div className="fixed top-0 left-0 right-0 z-50 h-[3px] bg-indigo-100 pointer-events-none">
        <div className="h-full w-1/3 bg-indigo-600 shadow-[0_0_8px_rgba(79,70,229,0.6)] progress-bar-active" />
      </div>

      {/* Centered loader overlay — always visible regardless of scroll position */}
      <div className="fixed inset-0 md:left-60 flex flex-col items-center justify-center pointer-events-none z-40">
        <HairvenlyLoader size={120} />
        <div className="mt-6 text-sm text-neutral-400 tracking-wide">Lädt…</div>
      </div>

      {/* Empty block to occupy layout (prevents content flash) */}
      <div className="p-4 md:p-8 h-screen" />
    </>
  );
}
