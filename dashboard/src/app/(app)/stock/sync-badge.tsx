import { RefreshCw } from "lucide-react";

export default function SyncBadge({ lastUpdated }: { lastUpdated: string | null }) {
  return (
    <div className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-neutral-100 text-xs text-neutral-500">
      <RefreshCw size={12} />
      <span>
        Letzte Synchronisierung:{" "}
        <span className="font-medium text-neutral-700">
          {lastUpdated ?? "Unbekannt"}
        </span>
      </span>
    </div>
  );
}
