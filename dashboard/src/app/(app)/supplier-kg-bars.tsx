export type SupplierKgRow = {
  name: string;
  total: number;
  transit: number;
};

export default function SupplierKgBars({ rows }: { rows: SupplierKgRow[] }) {
  if (rows.length === 0) {
    return (
      <div className="py-6 text-center text-xs text-neutral-400">
        Keine kg-Daten hinterlegt
      </div>
    );
  }

  const max = Math.max(...rows.map((r) => r.total), 0.01);
  const totalAll = rows.reduce((s, r) => s + r.total, 0);
  const transitAll = rows.reduce((s, r) => s + r.transit, 0);

  return (
    <div className="space-y-3">
      {rows.map((r) => {
        const totalPct = (r.total / max) * 100;
        const transitPct = r.total > 0 ? (r.transit / r.total) * totalPct : 0;
        return (
          <div key={r.name} className="group">
            <div className="flex justify-between text-xs mb-1">
              <span className="font-medium text-neutral-700 truncate">{r.name}</span>
              <span className="text-neutral-500 tabular-nums">
                <span className="text-indigo-700 font-semibold">{r.transit.toFixed(1)}</span>
                <span className="text-neutral-400"> / </span>
                {r.total.toFixed(1)} kg
              </span>
            </div>
            <div className="relative h-3 rounded-full bg-neutral-100 overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 bg-indigo-200 rounded-full transition-all"
                style={{ width: `${totalPct}%` }}
                title={`Bestellt: ${r.total.toFixed(1)} kg`}
              />
              <div
                className="absolute inset-y-0 left-0 bg-indigo-600 rounded-full transition-all"
                style={{ width: `${transitPct}%` }}
                title={`Unterwegs: ${r.transit.toFixed(1)} kg`}
              />
            </div>
          </div>
        );
      })}
      <div className="pt-2 mt-2 border-t border-neutral-100 flex justify-between text-xs font-medium text-neutral-700">
        <span>Gesamt</span>
        <span className="tabular-nums">
          <span className="text-indigo-700">{transitAll.toFixed(1)}</span>
          <span className="text-neutral-400"> / </span>
          {totalAll.toFixed(1)} kg unterwegs
        </span>
      </div>
    </div>
  );
}
