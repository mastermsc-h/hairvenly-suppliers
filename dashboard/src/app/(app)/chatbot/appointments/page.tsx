import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { Calendar, Clock, CheckCircle2, XCircle, RotateCw, Check } from "lucide-react";
import AppointmentRow from "./appointment-row";
import { SERVICE_TYPE_LABELS } from "@/lib/appointments-constants";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ status?: string }>;
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending:     { label: "Offen",         color: "bg-amber-100 text-amber-800" },
  confirmed:   { label: "Bestätigt",     color: "bg-green-100 text-green-800" },
  rescheduled: { label: "Verschoben",    color: "bg-blue-100 text-blue-800" },
  cancelled:   { label: "Storniert",     color: "bg-neutral-100 text-neutral-500" },
  completed:   { label: "Stattgefunden", color: "bg-neutral-200 text-neutral-700" },
};

export default async function AppointmentsPage({ searchParams }: PageProps) {
  await requireProfile();
  const params = await searchParams;
  const filter = params.status || "pending";

  const svc = createServiceClient();
  let q = svc.from("chat_appointment_requests").select("*").order("requested_at", { ascending: false }).limit(200);
  if (filter !== "all") q = q.eq("status", filter);
  const { data: appointments } = await q;

  // Counts
  const counts = await Promise.all([
    svc.from("chat_appointment_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
    svc.from("chat_appointment_requests").select("id", { count: "exact", head: true }).eq("status", "confirmed"),
    svc.from("chat_appointment_requests").select("id", { count: "exact", head: true }).eq("status", "rescheduled"),
    svc.from("chat_appointment_requests").select("id", { count: "exact", head: true }).eq("status", "cancelled"),
    svc.from("chat_appointment_requests").select("id", { count: "exact", head: true }).eq("status", "completed"),
  ]);
  const [cntPending, cntConfirmed, cntRescheduled, cntCancelled, cntCompleted] =
    counts.map(c => c.count ?? 0);

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Calendar size={20} className="text-neutral-700" />
          <h1 className="text-xl font-semibold text-neutral-900">Termin-Anfragen</h1>
          <span className="text-sm text-neutral-500 ml-2">Beratungs- und Service-Termine aus Chat-Anfragen</span>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <KPI label="Offen"         count={cntPending}     color="text-amber-700"   icon={<Clock size={16} />} />
        <KPI label="Bestätigt"     count={cntConfirmed}   color="text-green-700"   icon={<CheckCircle2 size={16} />} />
        <KPI label="Verschoben"    count={cntRescheduled} color="text-blue-700"    icon={<RotateCw size={16} />} />
        <KPI label="Storniert"     count={cntCancelled}   color="text-neutral-500" icon={<XCircle size={16} />} />
        <KPI label="Stattgefunden" count={cntCompleted}   color="text-neutral-700" icon={<Check size={16} />} />
      </div>

      <div className="flex gap-2 flex-wrap">
        {[
          { v: "pending",     label: `⏳ Offen (${cntPending})` },
          { v: "confirmed",   label: `✓ Bestätigt (${cntConfirmed})` },
          { v: "rescheduled", label: `↻ Verschoben (${cntRescheduled})` },
          { v: "cancelled",   label: `✗ Storniert (${cntCancelled})` },
          { v: "completed",   label: `✓ Erledigt (${cntCompleted})` },
          { v: "all",         label: "Alle" },
        ].map(opt => (
          <Link
            key={opt.v}
            href={`/chatbot/appointments?status=${opt.v}`}
            className={`text-xs px-3 py-1.5 rounded-full border ${
              filter === opt.v
                ? "bg-neutral-900 text-white border-neutral-900"
                : "bg-white text-neutral-600 border-neutral-300 hover:bg-neutral-50"
            }`}
          >
            {opt.label}
          </Link>
        ))}
      </div>

      <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
        {(appointments ?? []).length === 0 ? (
          <div className="p-12 text-center text-neutral-400">
            <Calendar size={32} className="mx-auto mb-2 text-neutral-300" />
            Keine Termin-Anfragen in diesem Filter
          </div>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {(appointments ?? []).map(a => (
              <AppointmentRow
                key={a.id}
                appointment={a}
                statusBadge={STATUS_LABELS[a.status] || STATUS_LABELS.pending}
                serviceLabels={SERVICE_TYPE_LABELS}
              />
            ))}
          </ul>
        )}
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
