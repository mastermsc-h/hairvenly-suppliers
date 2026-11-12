import Link from "next/link";
import { requireProfile } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { Mail, MessageSquare, Clock, CheckCircle2, XCircle, Bot } from "lucide-react";
import ReservationRow from "./reservation-row";
import StockCheckButton from "./stock-check-button";
import { parseAutoNotifyMode } from "@/lib/reservations/auto-notify";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ status?: string }>;
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  waiting:   { label: "Wartet",          color: "bg-amber-100 text-amber-800" },
  notified:  { label: "Benachrichtigt",  color: "bg-green-100 text-green-800" },
  cancelled: { label: "Storniert",       color: "bg-neutral-100 text-neutral-500" },
};

export default async function ReservationsPage({ searchParams }: PageProps) {
  await requireProfile();
  const params = await searchParams;
  const filter = params.status || "waiting";

  const svc = createServiceClient();
  let q = svc.from("chat_reservations").select("*").order("requested_at", { ascending: false }).limit(200);
  if (filter === "in_stock") q = q.eq("status", "waiting").eq("last_stock_status", "in_stock");
  else if (filter !== "all") q = q.eq("status", filter);
  const { data: rawReservations } = await q;
  // Wieder vorrätige wartende Reservierungen nach oben (sonst Reihenfolge wie bisher)
  const isReady = (r: { status: string; last_stock_status: string | null }) => r.status === "waiting" && r.last_stock_status === "in_stock";
  const reservations = [...(rawReservations ?? [])].sort((a, b) => Number(isReady(b)) - Number(isReady(a)));

  // Counts pro Status
  const { count: cntWaiting } = await svc.from("chat_reservations").select("id", { count: "exact", head: true }).eq("status", "waiting");
  const { count: cntNotified } = await svc.from("chat_reservations").select("id", { count: "exact", head: true }).eq("status", "notified");
  const { count: cntCancelled } = await svc.from("chat_reservations").select("id", { count: "exact", head: true }).eq("status", "cancelled");
  const { count: cntInStock } = await svc.from("chat_reservations").select("id", { count: "exact", head: true }).eq("status", "waiting").eq("last_stock_status", "in_stock");
  const { data: lastCheck } = await svc.from("chat_reservations").select("last_checked_at").not("last_checked_at", "is", null).order("last_checked_at", { ascending: false }).limit(1).maybeSingle();
  const { count: cntWouldSend } = await svc.from("chat_reservations").select("id", { count: "exact", head: true }).eq("status", "waiting").eq("auto_notify_decision", "would_send");
  const { data: settingsRow } = await svc.from("chatbot_settings").select("reservation_auto_notify").eq("id", 1).maybeSingle();
  const autoMode = parseAutoNotifyMode(settingsRow?.reservation_auto_notify);
  const lastCheckedAt = lastCheck?.last_checked_at ? new Date(lastCheck.last_checked_at) : null;
  const lastCheckedStr = lastCheckedAt
    ? `${lastCheckedAt.toLocaleDateString("de-DE", { timeZone: "Europe/Berlin" })} ${lastCheckedAt.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" })}`
    : null;

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2">
          <Mail size={20} className="text-neutral-700" />
          <h1 className="text-xl font-semibold text-neutral-900">Reservierungen / Warteliste</h1>
          <span className="text-sm text-neutral-500 ml-2">Kundinnen warten auf Wareneingang — 1-Klick-Benachrichtigung wenn da</span>
        </div>
        <StockCheckButton />
      </div>

      <div className="grid grid-cols-3 gap-4">
        <KPI label="Wartet auf Benachrichtigung" count={cntWaiting ?? 0} color="text-amber-700" icon={<Clock size={16} />} />
        <KPI label="Benachrichtigt" count={cntNotified ?? 0} color="text-green-700" icon={<CheckCircle2 size={16} />} />
        <KPI label="Storniert" count={cntCancelled ?? 0} color="text-neutral-500" icon={<XCircle size={16} />} />
      </div>

      {(cntInStock ?? 0) > 0 && (
        <div className="rounded-2xl border border-green-200 bg-green-50 p-4 text-sm text-green-900 flex items-center gap-2 flex-wrap">
          <CheckCircle2 size={16} className="text-green-700" />
          <strong>{cntInStock} wartende Reservierung{cntInStock === 1 ? " ist" : "en sind"} wieder auf Lager</strong>
          <span className="text-green-800">— Kundinnen per 1-Klick benachrichtigen (grün markierte Zeilen).</span>
        </div>
      )}
      {lastCheckedStr && (
        <div className="text-xs text-neutral-500 -mt-3">Letzter Lager-Check: {lastCheckedStr} · läuft automatisch jeden Morgen</div>
      )}

      {autoMode !== "off" && (
        <div className={`rounded-2xl border p-3 text-xs flex items-center gap-2 flex-wrap ${autoMode === "live" ? "border-green-200 bg-white text-green-900" : "border-blue-200 bg-blue-50 text-blue-900"}`}>
          {autoMode === "live" ? (
            <span>📨 <strong>Automatische Benachrichtigung: LIVE</strong> — Ava schreibt Mo–Sa gegen 11 Uhr alle eindeutigen Treffer an ({cntWouldSend ?? 0} vorgemerkt).</span>
          ) : (
            <span>🧪 <strong>Automatische Benachrichtigung: Probelauf</strong> — es wird nichts gesendet. {cntWouldSend ?? 0} Reservierung{cntWouldSend === 1 ? " würde" : "en würden"} automatisch benachrichtigt (🤖 in der Zeile).</span>
          )}
          <Link href="/chatbot/bot-settings" className="ml-auto text-blue-700 hover:underline">Schalter in Bot-Einstellungen →</Link>
        </div>
      )}

      {/* Filter-Buttons */}
      <div className="flex gap-2 flex-wrap">
        {[
          { v: "waiting",   label: `⏳ Offen (${cntWaiting ?? 0})` },
          { v: "in_stock",  label: `✅ Wieder auf Lager (${cntInStock ?? 0})` },
          { v: "notified",  label: `✓ Benachrichtigt (${cntNotified ?? 0})` },
          { v: "cancelled", label: `✗ Storniert (${cntCancelled ?? 0})` },
          { v: "all",       label: "Alle" },
        ].map(opt => (
          <Link
            key={opt.v}
            href={`/chatbot/reservations?status=${opt.v}`}
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

      {/* Liste */}
      <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
        {(reservations ?? []).length === 0 ? (
          <div className="p-12 text-center text-neutral-400">
            <Mail size={32} className="mx-auto mb-2 text-neutral-300" />
            Keine Reservierungen in diesem Filter
          </div>
        ) : (
          <ul className="divide-y divide-neutral-100">
            {(reservations ?? []).map(r => (
              <ReservationRow
                key={r.id}
                reservation={r}
                statusBadge={STATUS_LABELS[r.status] || STATUS_LABELS.waiting}
                autoMode={autoMode}
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

// Re-exports für ReservationRow client component
export type { Reservation } from "./reservation-row";
