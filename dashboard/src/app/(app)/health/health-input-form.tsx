"use client";

import { useState, useTransition } from "react";
import { Save, Loader2, Check, AlertCircle, Pencil } from "lucide-react";
import { saveHealthSnapshot } from "@/lib/actions/health";

interface Defaults {
  weitere_schulden_eur: number;
  steuer_rueckstellung_eur: number;
}

export default function HealthInputForm({ defaults }: { defaults: Defaults }) {
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok?: boolean; error?: string } | null>(null);

  function submit(formData: FormData) {
    setMsg(null);
    startTransition(async () => {
      const res = await saveHealthSnapshot(formData);
      setMsg(res);
      if (res.ok) setOpen(false);
      setTimeout(() => setMsg(null), 8000);
    });
  }

  if (!open) {
    return (
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800 transition"
        >
          <Pencil size={14} /> Ergänzungen / Eintrag speichern
        </button>
        {msg?.ok && (
          <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
            <Check size={13} /> Gespeichert — Eintrag im Verlauf
          </span>
        )}
      </div>
    );
  }

  return (
    <section className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm">
      <h2 className="text-sm font-medium text-neutral-700 mb-4">Ergänzungen (fließen in die Schulden ein)</h2>
      <form action={submit} className="space-y-4">
        <p className="text-xs text-neutral-500">
          Konten, Lieferanten-Schulden und offene Steuern kommen automatisch. Hier nur, was das System nicht kennt.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <Field
            label="Steuer-Rückstellung (€)"
            name="steuer_rueckstellung_eur"
            defaultValue={defaults.steuer_rueckstellung_eur}
            hint="z.B. erwartete ESt-/GewSt-Nachzahlung"
            accent="rose"
          />
          <Field
            label="Weitere Schulden (€)"
            name="weitere_schulden_eur"
            defaultValue={defaults.weitere_schulden_eur}
            hint="z.B. Darlehen, offene Rechnungen außerhalb der Bestellungen"
            accent="rose"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-neutral-600 uppercase tracking-wide mb-1">Notiz (optional)</label>
          <input
            name="note"
            type="text"
            placeholder="z.B. nach Steuerzahlung Q2"
            className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900"
          />
        </div>
        {msg?.error && (
          <div className="px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-red-700 text-xs inline-flex items-center gap-1.5">
            <AlertCircle size={13} /> {msg.error}
          </div>
        )}
        <div className="flex items-center gap-2">
          <button
            type="submit"
            disabled={pending}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-neutral-900 text-white text-sm font-medium hover:bg-neutral-800 disabled:opacity-50 transition"
          >
            {pending ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}
            Speichern
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="px-4 py-2 rounded-lg text-sm font-medium bg-neutral-100 hover:bg-neutral-200 text-neutral-700 transition"
          >
            Abbrechen
          </button>
        </div>
        <p className="text-[11px] text-neutral-400">
          Jedes Speichern erzeugt einen Verlaufs-Eintrag. Zusätzlich speichert das System jeden Morgen automatisch einen Eintrag — die Ergänzungen gelten weiter, bis du sie änderst.
        </p>
      </form>
    </section>
  );
}

function Field({ label, name, defaultValue, accent, hint }: { label: string; name: string; defaultValue: number; accent?: "rose"; hint?: string }) {
  return (
    <div>
      <label className={`block text-xs font-medium uppercase tracking-wide mb-1 ${accent === "rose" ? "text-rose-600" : "text-neutral-600"}`}>
        {label}
      </label>
      <input
        name={name}
        type="number"
        step="0.01"
        defaultValue={defaultValue || ""}
        placeholder="0"
        className="w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm text-right focus:ring-2 focus:ring-neutral-900"
      />
      {hint && <p className="text-[11px] text-neutral-400 mt-1">{hint}</p>}
    </div>
  );
}
