import { RefreshCw, AlertTriangle, CheckCircle2 } from "lucide-react";
import { METHOD_LABELS, type Method } from "@/lib/chatbot/pricing";
import type { PriceSyncReport } from "@/lib/chatbot/price-sync-run";

const LINE: Record<string, string> = { amanda: "RU glatt", ebru: "US wellig" };
const eur = (n: number | null) => (n === null ? "–" : n.toLocaleString("de-DE", { style: "currency", currency: "EUR" }));

function rowLabel(r: { method: string; supplier_line: string; length_cm: number | null; gram_label: string | null }) {
  const m = METHOD_LABELS[r.method as Method] ?? r.method;
  return `${m} ${r.gram_label ?? (r.length_cm ? `${r.length_cm} cm` : "")} · ${LINE[r.supplier_line] ?? r.supplier_line}`;
}

/** Status des täglichen Preis-Abgleichs mit Shopify (Cron /api/cron/chatbot-price-sync). */
export default function PriceSyncStatus({ syncedAt, report }: { syncedAt: string | null; report: PriceSyncReport | null }) {
  const ageH = syncedAt ? (Date.now() - new Date(syncedAt).getTime()) / 3_600_000 : null;
  const stale = ageH === null || ageH > 48;
  const checks = report?.rows.filter((r) => r.status === "check") ?? [];
  const changed = report?.rows.filter((r) => r.status === "update") ?? [];
  const faqs = report?.stale_faqs ?? [];
  const training = report?.stale_training ?? [];
  const ok = !stale && checks.length === 0 && faqs.length === 0;

  return (
    <div className={`rounded-2xl border p-4 md:p-5 shadow-sm ${ok ? "bg-white border-neutral-200" : "bg-amber-50 border-amber-200"}`}>
      <div className="flex items-center gap-2">
        {ok ? <CheckCircle2 size={16} className="text-emerald-600" /> : <AlertTriangle size={16} className="text-amber-600" />}
        <span className="text-sm font-medium text-neutral-900">Preise automatisch aus Shopify</span>
        <RefreshCw size={12} className="text-neutral-400 ml-1" />
        <span className="text-xs text-neutral-500">
          {syncedAt
            ? `zuletzt abgeglichen ${new Date(syncedAt).toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "short" })}`
            : "noch nie abgeglichen"}
          {stale && syncedAt && " — älter als 2 Tage, Abgleich läuft nicht!"}
        </span>
      </div>

      {changed.length > 0 && (
        <p className="text-xs text-neutral-600 mt-2">
          Beim letzten Lauf übernommen:{" "}
          {changed.map((r) => `${rowLabel(r)} ${eur(r.old_price)} → ${eur(r.new_price)}`).join(" · ")}
        </p>
      )}

      {checks.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-medium text-amber-800 uppercase tracking-wide mb-1">Nicht automatisch übernommen — bitte prüfen</div>
          <ul className="text-sm text-neutral-800 space-y-0.5">
            {checks.map((r) => (
              <li key={`${r.method}${r.supplier_line}${r.length_cm}${r.gram_label}`}>
                {rowLabel(r)}: Bot {eur(r.old_price)}, Shopify {eur(r.new_price)} — {r.reason}
              </li>
            ))}
          </ul>
        </div>
      )}

      {faqs.length > 0 && (
        <div className="mt-3">
          <div className="text-xs font-medium text-amber-800 uppercase tracking-wide mb-1">FAQ-Antworten mit alten Preisen</div>
          <ul className="text-sm text-neutral-800 space-y-0.5">
            {faqs.map((f) => (
              <li key={f.id}>„{f.question}" — enthält {f.prices.join(", ")} €</li>
            ))}
          </ul>
        </div>
      )}

      {training.length > 0 && (
        <p className="text-xs text-neutral-500 mt-3">
          {training.length} Trainings-Beispiel{training.length > 1 ? "e" : ""} nennen Beträge, die alten Preisen entsprechen
          (kann auch Zufall sein, z.B. Salon-Preise) — unter Chatbot → Training prüfen:{" "}
          {training.slice(0, 5).map((t) => `„${t.question.slice(0, 40)}…" (${t.prices.join(", ")} €)`).join(" · ")}
        </p>
      )}
    </div>
  );
}
