"use client";

import { useState, useTransition } from "react";
import { KeyRound, X, Check } from "lucide-react";
import { changeOwnPassword } from "@/lib/actions/auth";

export default function ChangePassword({ label }: { label: string }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  function reset() {
    setCurrent("");
    setNext("");
    setConfirm("");
    setError(null);
    setSuccess(false);
  }

  function handleSubmit() {
    setError(null);
    if (next !== confirm) {
      setError("Passw\u00F6rter stimmen nicht \u00FCberein.");
      return;
    }
    startTransition(async () => {
      const res = await changeOwnPassword(current, next);
      if (res?.error) setError(res.error);
      else {
        setSuccess(true);
        setTimeout(() => {
          reset();
          setOpen(false);
        }, 1500);
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => { reset(); setOpen(true); }}
        className="w-full flex items-center gap-2 px-2 py-2 text-sm text-neutral-600 hover:text-neutral-900 hover:bg-neutral-100 rounded-lg transition"
      >
        <KeyRound size={16} /> {label}
      </button>

      {open && (
        <div
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden"
          >
            <div className="px-5 py-4 border-b border-neutral-100 flex items-center justify-between">
              <h3 className="text-sm font-semibold text-neutral-900 flex items-center gap-2">
                <KeyRound size={16} /> {label}
              </h3>
              <button onClick={() => setOpen(false)} className="text-neutral-400 hover:text-neutral-600">
                <X size={16} />
              </button>
            </div>

            <div className={`px-5 py-4 space-y-3 ${pending ? "opacity-50 pointer-events-none" : ""}`}>
              <label className="block">
                <span className="text-xs font-medium text-neutral-600">Aktuelles Passwort</span>
                <input
                  type="password"
                  value={current}
                  onChange={(e) => setCurrent(e.target.value)}
                  autoComplete="current-password"
                  className="mt-1 block w-full text-sm rounded-lg border border-neutral-300 px-3 py-2 bg-white focus:ring-2 focus:ring-neutral-900"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-neutral-600">Neues Passwort</span>
                <input
                  type="password"
                  value={next}
                  onChange={(e) => setNext(e.target.value)}
                  placeholder="Mind. 6 Zeichen"
                  autoComplete="new-password"
                  className="mt-1 block w-full text-sm rounded-lg border border-neutral-300 px-3 py-2 bg-white focus:ring-2 focus:ring-neutral-900"
                />
              </label>
              <label className="block">
                <span className="text-xs font-medium text-neutral-600">Neues Passwort wiederholen</span>
                <input
                  type="password"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  autoComplete="new-password"
                  className="mt-1 block w-full text-sm rounded-lg border border-neutral-300 px-3 py-2 bg-white focus:ring-2 focus:ring-neutral-900"
                />
              </label>

              {error && <div className="text-sm text-red-600">{error}</div>}
              {success && (
                <div className="text-sm text-emerald-600 flex items-center gap-1">
                  <Check size={14} /> Passwort ge&auml;ndert!
                </div>
              )}

              <div className="flex items-center gap-2 pt-2">
                <button
                  onClick={handleSubmit}
                  disabled={pending || !current || !next || !confirm}
                  className="inline-flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium bg-neutral-900 text-white hover:bg-neutral-800 transition disabled:opacity-50"
                >
                  <Check size={14} /> Speichern
                </button>
                <button
                  onClick={() => setOpen(false)}
                  disabled={pending}
                  className="inline-flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium bg-neutral-100 text-neutral-700 hover:bg-neutral-200 transition"
                >
                  Abbrechen
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
