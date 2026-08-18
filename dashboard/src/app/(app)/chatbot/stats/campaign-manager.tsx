"use client";

import { useState } from "react";
import { Plus, Trash2, Pencil, X, Check, Megaphone } from "lucide-react";
import { createCampaign, updateCampaign, deleteCampaign } from "@/lib/actions/chatbot-campaigns";

export interface CampaignRow {
  id: string;
  name: string;
  starts_on: string;      // YYYY-MM-DD
  ends_on: string | null;
  color: string;
  note: string | null;
  upliftPct: number | null; // +% vs. 14 Tage davor (null = nicht berechenbar)
  totalDuring: number;       // Nachrichten im Zeitraum
}

const COLORS = ["#ec4899", "#8b5cf6", "#f59e0b", "#10b981", "#0ea5e9", "#ef4444", "#14b8a6"];

function fmtDe(iso: string): string {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]}` : iso;
}

export default function CampaignManager({ campaigns }: { campaigns: CampaignRow[] }) {
  const [adding, setAdding] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-neutral-800 flex items-center gap-2">
          <Megaphone size={16} /> Aktionen &amp; Kampagnen
        </h2>
        {!adding && (
          <button
            onClick={() => { setAdding(true); setEditId(null); }}
            className="inline-flex items-center gap-1 text-sm bg-neutral-900 text-white font-medium rounded-lg px-3 py-1.5"
          >
            <Plus size={14} /> Aktion eintragen
          </button>
        )}
      </div>

      {adding && <CampaignForm onDone={() => setAdding(false)} />}

      <div className="mt-3 divide-y divide-neutral-100">
        {campaigns.length === 0 && !adding && (
          <p className="text-sm text-neutral-500 py-4">
            Noch keine Aktion eingetragen. Trag z.B. dein aktuelles Gewinnspiel ein — dann siehst du im Chart, ob es zu mehr Nachrichten geführt hat.
          </p>
        )}
        {campaigns.map((c) =>
          editId === c.id ? (
            <div className="py-3" key={c.id}>
              <CampaignForm row={c} onDone={() => setEditId(null)} />
            </div>
          ) : (
            <div key={c.id} className="flex items-center gap-3 py-3">
              <span className="w-3 h-3 rounded-full shrink-0" style={{ background: c.color }} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-medium text-neutral-800 truncate">{c.name}</div>
                <div className="text-xs text-neutral-500">
                  {fmtDe(c.starts_on)}{c.ends_on ? ` – ${fmtDe(c.ends_on)}` : " – (laufend)"}
                  {c.note ? ` · ${c.note}` : ""}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-sm font-semibold text-neutral-800">{c.totalDuring} Nachr.</div>
                {c.upliftPct != null && (
                  <div className={`text-xs font-medium ${c.upliftPct >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                    {c.upliftPct >= 0 ? "▲" : "▼"} {Math.abs(c.upliftPct)}% vs. davor
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <button onClick={() => { setEditId(c.id); setAdding(false); }} className="p-1.5 text-neutral-400 hover:text-neutral-700" title="Bearbeiten">
                  <Pencil size={15} />
                </button>
                <form action={deleteCampaign}>
                  <input type="hidden" name="id" value={c.id} />
                  <button type="submit" className="p-1.5 text-neutral-400 hover:text-red-600" title="Löschen">
                    <Trash2 size={15} />
                  </button>
                </form>
              </div>
            </div>
          )
        )}
      </div>
    </div>
  );
}

function CampaignForm({ row, onDone }: { row?: CampaignRow; onDone: () => void }) {
  const [color, setColor] = useState(row?.color ?? COLORS[0]);
  return (
    <form
      action={row ? updateCampaign : createCampaign}
      onSubmit={() => setTimeout(onDone, 50)}
      className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 flex flex-col gap-2"
    >
      {row && <input type="hidden" name="id" value={row.id} />}
      <input type="hidden" name="color" value={color} />
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-neutral-600 uppercase tracking-wide">Name</span>
          <input name="name" defaultValue={row?.name ?? ""} required placeholder="z.B. Gewinnspiel August"
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-neutral-600 uppercase tracking-wide">Notiz (optional)</span>
          <input name="note" defaultValue={row?.note ?? ""} placeholder="z.B. Story + Feed, Reichweite 12k"
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-neutral-600 uppercase tracking-wide">Start</span>
          <input type="date" name="starts_on" defaultValue={row?.starts_on ?? ""} required
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900" />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium text-neutral-600 uppercase tracking-wide">Ende (optional)</span>
          <input type="date" name="ends_on" defaultValue={row?.ends_on ?? ""}
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900" />
        </label>
      </div>
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-neutral-600 uppercase tracking-wide">Farbe</span>
        {COLORS.map((c) => (
          <button type="button" key={c} onClick={() => setColor(c)}
            className={`w-5 h-5 rounded-full ${color === c ? "ring-2 ring-offset-1 ring-neutral-900" : ""}`}
            style={{ background: c }} />
        ))}
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={onDone} className="inline-flex items-center gap-1 text-sm text-neutral-600 px-3 py-1.5">
            <X size={14} /> Abbrechen
          </button>
          <button type="submit" className="inline-flex items-center gap-1 text-sm bg-neutral-900 text-white font-medium rounded-lg px-3 py-1.5">
            <Check size={14} /> Speichern
          </button>
        </div>
      </div>
    </form>
  );
}
