/**
 * Automatischer Loading-State für alle Routen unter /(app)/.
 * Wird von Next.js gerendert während der Server noch Daten holt.
 * Die Sidebar bleibt sichtbar (kommt aus layout.tsx).
 */
export default function AppLoading() {
  return (
    <div className="p-4 md:p-8 space-y-6 max-w-7xl animate-pulse">
      {/* Top progress bar (pulsing) */}
      <div className="fixed top-0 left-0 right-0 z-50 h-[3px] bg-indigo-100">
        <div className="h-full w-1/3 bg-indigo-600 shadow-[0_0_8px_rgba(79,70,229,0.6)] progress-bar-active" />
      </div>

      {/* Header skeleton */}
      <div className="space-y-2">
        <div className="h-7 w-56 rounded-md bg-neutral-200" />
        <div className="h-4 w-80 rounded-md bg-neutral-100" />
      </div>

      {/* KPI cards skeleton */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-white rounded-2xl border border-neutral-200 p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div className="h-3 w-24 rounded bg-neutral-200" />
              <div className="w-8 h-8 rounded-lg bg-neutral-100" />
            </div>
            <div className="mt-3 h-8 w-32 rounded bg-neutral-200" />
          </div>
        ))}
      </div>

      {/* Content rows skeleton */}
      <div className="bg-white rounded-2xl border border-neutral-200 overflow-hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 p-4 border-b border-neutral-100 last:border-b-0">
            <div className="w-10 h-10 rounded-full bg-neutral-100" />
            <div className="flex-1 space-y-2">
              <div className="h-3 w-40 rounded bg-neutral-200" />
              <div className="h-3 w-24 rounded bg-neutral-100" />
            </div>
            <div className="h-3 w-20 rounded bg-neutral-100" />
          </div>
        ))}
      </div>
    </div>
  );
}
