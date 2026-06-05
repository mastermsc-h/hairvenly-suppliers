"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { FileSpreadsheet, Upload, X, Loader2, CheckCircle2, AlertTriangle, XCircle, Package, ChevronRight } from "lucide-react";
import { analyzeLieferschein, commitLieferschein, type ParsedRow, type AnalyzeResult } from "@/lib/actions/lieferschein";

interface SupplierOpt { id: string; name: string; }

export default function LieferscheinCheck({ suppliers, compact }: { suppliers: SupplierOpt[]; compact?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [supplierId, setSupplierId] = useState(suppliers[0]?.id ?? "");
  const [file, setFile] = useState<File | null>(null);
  const [analysis, setAnalysis] = useState<AnalyzeResult | null>(null);
  const [rows, setRows] = useState<ParsedRow[] | null>(null);
  const [pending, startTransition] = useTransition();
  // meta inputs for commit
  const [label, setLabel] = useState("");
  const [trackingNumber, setTrackingNumber] = useState("");
  const [trackingUrl, setTrackingUrl] = useState("");
  const [eta, setEta] = useState("");
  const [shippedAt, setShippedAt] = useState("");
  const [arrivedAt, setArrivedAt] = useState("");
  const [notes, setNotes] = useState("");
  const [createShipments, setCreateShipments] = useState(true);

  function close() {
    setOpen(false);
    setFile(null);
    setAnalysis(null);
    setRows(null);
  }

  const [clientError, setClientError] = useState<string | null>(null);

  function runAnalysis() {
    setClientError(null);
    if (!file || !supplierId) {
      setClientError(!supplierId ? "Lieferant fehlt" : "Datei fehlt");
      return;
    }
    startTransition(async () => {
      try {
        const fd = new FormData();
        fd.set("supplier_id", supplierId);
        fd.set("file", file);
        const result = await analyzeLieferschein(fd);
        if (!result.ok) {
          setClientError(result.error || "Unbekannter Fehler bei der Analyse");
        }
        setAnalysis(result);
        setRows(result.rows ?? null);
      } catch (e) {
        setClientError(e instanceof Error ? e.message : String(e));
      }
    });
  }

  function commit() {
    if (!analysis || !rows) return;
    startTransition(async () => {
      const res = await commitLieferschein({
        supplier_id: supplierId,
        label: label || null,
        tracking_number: trackingNumber || null,
        tracking_url: trackingUrl || null,
        eta: eta || null,
        shipped_at: shippedAt || null,
        arrived_at: arrivedAt || null,
        notes: notes || null,
        create_shipments: createShipments,
        rows,
      });
      if (res.ok && res.inbound_delivery_id) {
        close();
        router.push(`/inbound-deliveries/${res.inbound_delivery_id}`);
      } else {
        alert(`Fehler: ${res.error}`);
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={
          compact
            ? "inline-flex items-center gap-1 text-xs text-neutral-500 hover:text-green-700"
            : "inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-green-600 hover:bg-green-700 text-white text-sm font-medium"
        }
      >
        <FileSpreadsheet size={compact ? 14 : 16} /> Lieferschein-Check
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={close}>
          <div className="bg-white rounded-2xl shadow-xl max-w-5xl w-full max-h-[92vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-3 border-b border-neutral-200 sticky top-0 bg-white z-10">
              <h3 className="font-semibold text-neutral-900 inline-flex items-center gap-2">
                <FileSpreadsheet size={18} /> Lieferschein-Check
              </h3>
              <button type="button" onClick={close} className="p-1 rounded hover:bg-neutral-100">
                <X size={18} className="text-neutral-500" />
              </button>
            </div>

            <div className="p-5 space-y-5">
              {/* Step 1: Upload */}
              {!analysis && (
                <>
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-neutral-600 uppercase tracking-wide mb-1">Lieferant</label>
                      <select
                        value={supplierId}
                        onChange={(e) => setSupplierId(e.target.value)}
                        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900"
                      >
                        {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                      </select>
                    </div>
                    <div className="md:col-span-2">
                      <label className="block text-xs font-medium text-neutral-600 uppercase tracking-wide mb-1">Lieferschein-Datei (.xlsx)</label>
                      <input
                        type="file"
                        accept=".xlsx,.xls"
                        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
                        className="w-full text-sm"
                      />
                    </div>
                  </div>
                  <p className="text-xs text-neutral-500">
                    Der Parser nutzt die Lieferanten-Aliase aus dem Farbcode-Katalog. Chinesisch/türkisch werden auf eure Methoden/Längen/Farben gemappt.
                    Stand: nur xlsx — PDF/Bild-OCR folgt.
                  </p>
                  {clientError && (
                    <div className="px-3 py-2 rounded bg-red-50 border border-red-200 text-red-700 text-sm">
                      Fehler: {clientError}
                    </div>
                  )}
                  <div className="flex justify-end gap-2">
                    <button type="button" onClick={close} className="px-4 py-2 rounded-lg text-sm font-medium bg-neutral-100 hover:bg-neutral-200 text-neutral-700">
                      Abbrechen
                    </button>
                    <button
                      type="button"
                      onClick={runAnalysis}
                      disabled={!file || !supplierId || pending}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-neutral-900 hover:bg-neutral-800 text-white disabled:opacity-50"
                    >
                      {pending && <Loader2 size={14} className="animate-spin" />}
                      <Upload size={14} /> Analysieren
                    </button>
                  </div>
                </>
              )}

              {/* Step 2: Result + Confirm */}
              {analysis && !analysis.ok && (
                <div className="px-3 py-2 rounded bg-red-50 border border-red-200 text-red-700 text-sm">
                  Fehler: {analysis.error}
                </div>
              )}

              {analysis && analysis.ok && rows && (
                <>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-xs">
                    <Kpi label="Positionen" value={String(analysis.total_positions)} />
                    <Kpi label="Gemappt" value={`${analysis.matched} / ${analysis.total_positions}`} kind="ok" />
                    <Kpi label="Gewicht ges." value={`${analysis.total_grams} g`} />
                    <Kpi label="Gewicht ok" value={`${analysis.matched_grams} g`} kind="ok" />
                  </div>

                  {/* Meta inputs for the Wareneingang */}
                  <div className="bg-neutral-50 rounded-lg p-3 space-y-2">
                    <div className="text-xs font-medium text-neutral-600 uppercase tracking-wide">Wareneingang-Daten</div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                      <input placeholder="Bezeichnung (optional)" value={label} onChange={(e) => setLabel(e.target.value)} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm" />
                      <input placeholder="Tracking-Nummer" value={trackingNumber} onChange={(e) => setTrackingNumber(e.target.value)} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm" />
                      <input placeholder="Tracking-URL" value={trackingUrl} onChange={(e) => setTrackingUrl(e.target.value)} className="rounded-lg border border-neutral-300 px-3 py-1.5 text-sm" />
                    </div>
                    <div className="grid grid-cols-3 gap-2">
                      <label className="text-[10px] text-neutral-500 uppercase">ETA<input type="date" value={eta} onChange={(e) => setEta(e.target.value)} className="w-full rounded-lg border border-neutral-300 px-2 py-1 text-sm mt-0.5" /></label>
                      <label className="text-[10px] text-neutral-500 uppercase">Verschickt<input type="date" value={shippedAt} onChange={(e) => setShippedAt(e.target.value)} className="w-full rounded-lg border border-neutral-300 px-2 py-1 text-sm mt-0.5" /></label>
                      <label className="text-[10px] text-neutral-500 uppercase">Angekommen<input type="date" value={arrivedAt} onChange={(e) => setArrivedAt(e.target.value)} className="w-full rounded-lg border border-neutral-300 px-2 py-1 text-sm mt-0.5" /></label>
                    </div>
                    <textarea placeholder="Notiz" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className="w-full rounded-lg border border-neutral-300 px-3 py-1.5 text-sm" />
                    <label className="flex items-center gap-2 text-sm text-neutral-700 pt-1">
                      <input type="checkbox" checked={createShipments} onChange={(e) => setCreateShipments(e.target.checked)} className="rounded" />
                      Teillieferungen in betroffenen Bestellungen automatisch erzeugen
                    </label>
                  </div>

                  {/* Rows preview */}
                  <div className="border border-neutral-200 rounded-lg overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-neutral-50 text-neutral-600 sticky top-0">
                        <tr className="text-left">
                          <th className="px-2 py-1.5 font-medium w-5"></th>
                          <th className="px-2 py-1.5 font-medium">Lieferschein-Original</th>
                          <th className="px-2 py-1.5 font-medium">Erkannt</th>
                          <th className="px-2 py-1.5 font-medium text-right">Menge</th>
                          <th className="px-2 py-1.5 font-medium">Zuordnung</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-neutral-100">
                        {rows.map((r, idx) => (
                          <RowItem key={idx} row={r} />
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex items-center justify-between gap-2 pt-3 border-t border-neutral-100">
                    <button type="button" onClick={() => { setAnalysis(null); setRows(null); }} className="px-3 py-2 rounded-lg text-sm bg-neutral-100 hover:bg-neutral-200 text-neutral-700">
                      ← Zurück
                    </button>
                    <div className="flex gap-2">
                      <button type="button" onClick={close} className="px-4 py-2 rounded-lg text-sm font-medium bg-neutral-100 hover:bg-neutral-200 text-neutral-700">
                        Abbrechen
                      </button>
                      <button
                        type="button"
                        onClick={commit}
                        disabled={pending || analysis.matched === 0}
                        className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-green-600 hover:bg-green-700 text-white disabled:opacity-50"
                      >
                        {pending && <Loader2 size={14} className="animate-spin" />}
                        Wareneingang anlegen ({analysis.matched} Positionen)
                      </button>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Kpi({ label, value, kind }: { label: string; value: string; kind?: "ok" | "warn" }) {
  const cls = kind === "ok" ? "bg-emerald-50 border-emerald-200 text-emerald-800"
           : kind === "warn" ? "bg-amber-50 border-amber-200 text-amber-800"
           : "bg-neutral-50 border-neutral-200 text-neutral-700";
  return (
    <div className={`px-2 py-1.5 rounded border ${cls}`}>
      <div className="font-semibold text-sm">{value}</div>
      <div className="text-[10px] uppercase tracking-wide">{label}</div>
    </div>
  );
}

function RowItem({ row }: { row: ParsedRow }) {
  const icon =
    row.status === "matched" ? <CheckCircle2 size={14} className="text-emerald-600 shrink-0" />
    : row.status === "color_unknown" || row.status === "method_unknown" || row.status === "length_unknown" ? <AlertTriangle size={14} className="text-amber-500 shrink-0" />
    : <XCircle size={14} className="text-red-600 shrink-0" />;

  return (
    <tr className={row.status !== "matched" ? "bg-amber-50/40" : ""}>
      <td className="px-2 py-1.5 align-top">{icon}</td>
      <td className="px-2 py-1.5 text-neutral-700 align-top">
        <div className="font-mono text-[10px] whitespace-pre">{row.raw_method.replace(/\n/g, " ")} · {row.raw_length} · {row.raw_color}</div>
      </td>
      <td className="px-2 py-1.5 align-top">
        {row.status === "matched" ? (
          <span className="text-neutral-900">
            {row.method_name} · {row.length_value} · <strong>#{row.color_name}</strong>
          </span>
        ) : (
          <span className="text-amber-700 text-[10px] uppercase">{row.status.replace("_", " ")}</span>
        )}
      </td>
      <td className="px-2 py-1.5 text-right align-top text-neutral-700">{row.grams} g</td>
      <td className="px-2 py-1.5 align-top">
        {row.allocations && row.allocations.length > 0 ? (
          <div className="space-y-0.5">
            {row.allocations.map((a, i) => (
              <div key={i} className="inline-flex items-center gap-1 text-[10px] bg-purple-50 border border-purple-200 text-purple-800 px-1.5 py-0.5 rounded mr-1">
                <Package size={9} /> {a.order_label}
                <ChevronRight size={9} className="opacity-50" />
                <span className="font-medium">{a.allocate_g}g</span>
              </div>
            ))}
            {row.excess_grams && row.excess_grams > 0 && (
              <div className="inline-flex items-center gap-1 text-[10px] bg-orange-50 border border-orange-200 text-orange-800 px-1.5 py-0.5 rounded">
                Überschuss → lose Ware: <strong>{row.excess_grams}g</strong>
              </div>
            )}
          </div>
        ) : row.status === "matched" ? (
          <span className="text-[10px] text-neutral-500">keine offene Bestellposition · lose Ware</span>
        ) : (
          <span className="text-[10px] text-neutral-400">—</span>
        )}
      </td>
    </tr>
  );
}
