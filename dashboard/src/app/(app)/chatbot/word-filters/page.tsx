import { requireProfile } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { Filter, AlertTriangle, CheckCircle2 } from "lucide-react";
import WordFilterRow from "./row";

export const dynamic = "force-dynamic";

export default async function WordFiltersPage() {
  const profile = await requireProfile();
  if (!profile.is_admin) return <div className="p-8 text-neutral-500">Nur für Admins.</div>;

  const svc = createServiceClient();
  const { data: filters } = await svc
    .from("chatbot_word_filters")
    .select("*")
    .order("active", { ascending: false })
    .order("occurrences", { ascending: false });

  const activeCount = (filters ?? []).filter(f => f.active).length;
  const pendingCount = (filters ?? []).filter(f => !f.active).length;

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto space-y-6">
      <div className="flex items-center gap-2">
        <Filter size={20} className="text-neutral-700" />
        <h1 className="text-xl font-semibold text-neutral-900">Auto-Lern-Wortfilter</h1>
      </div>

      <div className="text-sm text-neutral-600 max-w-3xl">
        Wörter und Phrasen die der Bot wiederholt im Entwurf hatte und die du beim Editieren entfernt hast.
        <br />
        <span className="text-neutral-500">
          Ab <b>3 Vorkommen</b> wird ein Filter automatisch aktiviert und vom Sanitizer beim nächsten Bot-Call angewendet.
          Du kannst Filter auch manuell aktivieren oder den Ersatz-Text anpassen.
        </span>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <KPI label="Aktive Filter" count={activeCount} color="text-green-700" icon={<CheckCircle2 size={16} />} />
        <KPI label="Beobachtet (noch nicht aktiv)" count={pendingCount} color="text-amber-700" icon={<AlertTriangle size={16} />} />
      </div>

      <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-neutral-50 text-xs text-neutral-500 uppercase tracking-wide">
            <tr>
              <th className="text-left px-4 py-3 font-medium">Wort/Phrase</th>
              <th className="text-left px-4 py-3 font-medium">Wird ersetzt durch</th>
              <th className="text-right px-4 py-3 font-medium w-24">Vorkommen</th>
              <th className="text-center px-4 py-3 font-medium w-24">Status</th>
              <th className="text-right px-4 py-3 font-medium w-32">Aktionen</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-100">
            {(filters ?? []).length === 0 ? (
              <tr><td colSpan={5} className="px-4 py-12 text-center text-neutral-400">Noch keine Wortfilter — sobald du Drafts editierst, werden Vorkommen hier gesammelt.</td></tr>
            ) : (filters ?? []).map(f => (
              <WordFilterRow key={f.id} filter={{
                id: f.id,
                pattern: f.pattern,
                replacement: f.replacement ?? "",
                occurrences: f.occurrences ?? 0,
                active: !!f.active,
                auto_added: !!f.auto_added,
                last_seen_at: f.last_seen_at,
                notes: f.notes ?? "",
              }} />
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function KPI({ label, count, color, icon }: { label: string; count: number; color: string; icon: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
      <div className="text-xs font-medium text-neutral-500 uppercase tracking-wide flex items-center gap-1">{icon} {label}</div>
      <div className={`text-2xl font-bold mt-1 ${color}`}>{count}</div>
    </div>
  );
}
