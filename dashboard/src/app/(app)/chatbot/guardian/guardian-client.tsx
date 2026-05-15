"use client";

import { useState, useEffect, useCallback } from "react";
import Link from "next/link";
import { Shield, AlertTriangle, AlertCircle, Info, Check, X, RefreshCw, Play, ExternalLink } from "lucide-react";

interface Alert {
  id: string;
  session_id: string;
  severity: "critical" | "warning" | "info";
  alert_type: string;
  team_member: string | null;
  description: string;
  suggestion: string;
  status: string;
  created_at: string;
  session?: { channel?: string; bot_signature_name?: string };
}

const TYPE_LABELS: Record<string, string> = {
  unhappy_customer:    "😡 Unzufriedener Kunde",
  lost_deal_risk:      "🔥 Lost Deal Risiko",
  missed_followup:     "⏳ Nicht nachgefragt",
  bad_phrase_used:     "🤐 Abwürgende Antwort",
  rude_or_dismissive:  "❄️ Unhöflich/Abgewimmelt",
  no_effort:           "💤 Keine Mühe",
  info_inkorrekt_risk: "⚠️ Mögliche Falschinfo",
};

const SEVERITY_STYLE: Record<string, { color: string; icon: typeof Shield }> = {
  critical: { color: "border-red-300 bg-red-50",   icon: AlertTriangle },
  warning:  { color: "border-amber-300 bg-amber-50", icon: AlertCircle },
  info:     { color: "border-blue-300 bg-blue-50", icon: Info },
};

export default function GuardianClient() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [statusFilter, setStatusFilter] = useState<"open" | "all" | "resolved">("open");
  const [severityFilter, setSeverityFilter] = useState<string>("all");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/chat/guardian?status=${statusFilter}`);
      const data = await res.json();
      setAlerts(data.alerts || []);
    } finally { setLoading(false); }
  }, [statusFilter]);

  useEffect(() => { load(); }, [load]);

  async function scan() {
    if (!confirm("Wächter scannen aller Sessions aus den letzten 24h? Kann 1-2 Min dauern.")) return;
    setScanning(true);
    try {
      const res = await fetch("/api/chat/guardian?hours=24&limit=100", { method: "POST" });
      const data = await res.json();
      alert(`Scan fertig: ${data.scanned} Sessions geprüft, ${data.alerts_created} neue Alerts.`);
      load();
    } finally { setScanning(false); }
  }

  async function setStatus(id: string, newStatus: string) {
    await fetch("/api/chat/guardian", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, status: newStatus }),
    });
    setAlerts(alerts.filter(a => a.id !== id));
  }

  const filtered = severityFilter === "all" ? alerts : alerts.filter(a => a.severity === severityFilter);
  const counts = {
    critical: alerts.filter(a => a.severity === "critical").length,
    warning:  alerts.filter(a => a.severity === "warning").length,
    info:     alerts.filter(a => a.severity === "info").length,
  };

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2">
          <Shield size={20} className="text-purple-600" />
          <h1 className="text-xl font-semibold text-neutral-900">Wächter</h1>
          <span className="text-sm text-neutral-500 ml-2">
            Erkennt kritische Chats automatisch
          </span>
        </div>
        <div className="flex gap-2">
          <button
            onClick={load}
            className="text-xs px-3 py-1.5 rounded-lg border border-neutral-300 hover:bg-neutral-50 inline-flex items-center gap-1"
          >
            <RefreshCw size={11} /> Neu laden
          </button>
          <button
            onClick={scan}
            disabled={scanning}
            className="text-xs px-3 py-1.5 rounded-lg bg-purple-600 text-white hover:bg-purple-700 disabled:opacity-40 inline-flex items-center gap-1"
          >
            <Play size={11} /> {scanning ? "Scanne…" : "Jetzt scannen"}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-3">
        <div className="border border-red-200 bg-red-50 rounded-xl p-3">
          <div className="text-xs text-red-900 font-medium">🔴 Kritisch</div>
          <div className="text-2xl font-bold text-red-900 mt-0.5">{counts.critical}</div>
        </div>
        <div className="border border-amber-200 bg-amber-50 rounded-xl p-3">
          <div className="text-xs text-amber-900 font-medium">🟡 Warnung</div>
          <div className="text-2xl font-bold text-amber-900 mt-0.5">{counts.warning}</div>
        </div>
        <div className="border border-blue-200 bg-blue-50 rounded-xl p-3">
          <div className="text-xs text-blue-900 font-medium">🔵 Info</div>
          <div className="text-2xl font-bold text-blue-900 mt-0.5">{counts.info}</div>
        </div>
      </div>

      <div className="flex gap-2 flex-wrap">
        <div className="text-xs text-neutral-500 self-center">Status:</div>
        {(["open", "resolved", "all"] as const).map(s => (
          <button
            key={s}
            onClick={() => setStatusFilter(s)}
            className={`text-xs px-3 py-1.5 rounded-full ${
              statusFilter === s ? "bg-neutral-900 text-white" : "bg-white border border-neutral-300"
            }`}
          >
            {s === "open" ? "Offen" : s === "resolved" ? "Erledigt" : "Alle"}
          </button>
        ))}
        <span className="w-2"></span>
        <div className="text-xs text-neutral-500 self-center">Schweregrad:</div>
        {["all", "critical", "warning", "info"].map(s => (
          <button
            key={s}
            onClick={() => setSeverityFilter(s)}
            className={`text-xs px-3 py-1.5 rounded-full ${
              severityFilter === s ? "bg-neutral-900 text-white" : "bg-white border border-neutral-300"
            }`}
          >
            {s === "all" ? "Alle" : s}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="text-center py-12 text-neutral-400">Lade…</div>
      ) : filtered.length === 0 ? (
        <div className="bg-green-50 border border-green-200 rounded-xl p-8 text-center">
          <Check size={32} className="mx-auto mb-2 text-green-600" />
          <div className="font-medium text-green-900">Alles im grünen Bereich</div>
          <div className="text-xs text-green-700 mt-1">Keine offenen Alerts. Klick &ldquo;Jetzt scannen&rdquo; für eine neue Prüfung.</div>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(a => {
            const style = SEVERITY_STYLE[a.severity] || SEVERITY_STYLE.info;
            const Icon = style.icon;
            return (
              <div key={a.id} className={`border rounded-xl p-4 ${style.color}`}>
                <div className="flex items-start gap-3">
                  <Icon size={18} className="flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className="font-semibold text-sm">
                        {TYPE_LABELS[a.alert_type] || a.alert_type}
                      </span>
                      <span className="text-xs text-neutral-500">·</span>
                      <span className="text-xs text-neutral-600">
                        {a.session?.channel === "web" ? "🌐" : a.session?.channel === "instagram" ? "📷" : "💬"}{" "}
                        Ava von {a.session?.bot_signature_name || "?"}
                      </span>
                      {a.team_member && (
                        <>
                          <span className="text-xs text-neutral-500">·</span>
                          <span className="text-xs font-medium text-neutral-700">{a.team_member}</span>
                        </>
                      )}
                      <span className="ml-auto text-xs text-neutral-400">
                        {new Date(a.created_at).toLocaleString("de-DE")}
                      </span>
                    </div>
                    <div className="text-sm text-neutral-800 mb-2">{a.description}</div>
                    <div className="text-xs bg-white/70 rounded-lg px-3 py-2 mb-2 text-neutral-700">
                      💡 <strong>Empfehlung:</strong> {a.suggestion}
                    </div>
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/chatbot/inbox/${a.session_id}`}
                        className="text-xs text-blue-600 hover:underline inline-flex items-center gap-1"
                      >
                        <ExternalLink size={11} /> Chat öffnen
                      </Link>
                      <button
                        onClick={() => setStatus(a.id, "resolved")}
                        className="text-xs px-2 py-1 rounded-lg bg-green-100 text-green-800 hover:bg-green-200 inline-flex items-center gap-1"
                      >
                        <Check size={11} /> Erledigt
                      </button>
                      <button
                        onClick={() => setStatus(a.id, "dismissed")}
                        className="text-xs px-2 py-1 rounded-lg bg-neutral-100 text-neutral-700 hover:bg-neutral-200 inline-flex items-center gap-1"
                      >
                        <X size={11} /> Verwerfen
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
