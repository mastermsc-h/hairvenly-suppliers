import HairvenlyLoader from "./hairvenly-loader";

/**
 * Automatischer Loading-State für alle Routen unter /(app)/.
 * Wird von Next.js gerendert während der Server noch Daten holt.
 * Die Sidebar bleibt sichtbar (kommt aus layout.tsx).
 */
export default function AppLoading() {
  return (
    <div className="p-4 md:p-8 space-y-6 max-w-7xl">
      {/* Thin top progress bar */}
      <div className="fixed top-0 left-0 right-0 z-50 h-[3px] bg-indigo-100">
        <div className="h-full w-1/3 bg-indigo-600 shadow-[0_0_8px_rgba(79,70,229,0.6)] progress-bar-active" />
      </div>

      {/* Center animated Hairvenly logo */}
      <div className="flex flex-col items-center justify-center py-16 md:py-24">
        <HairvenlyLoader size={120} />
        <div className="mt-6 text-sm text-neutral-400 tracking-wide">Lädt…</div>
      </div>
    </div>
  );
}
