"use client";

import { useState, useTransition, useEffect } from "react";
import { X, Check, Pencil } from "lucide-react";
import { updateSupplierProfile } from "@/lib/actions/suppliers";
import type { Supplier } from "@/lib/types";

export default function SupplierProfile({
  supplier,
  isAdmin,
  children,
}: {
  supplier: Supplier;
  isAdmin: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open]);

  function save(fd: FormData) {
    setError(null);
    start(async () => {
      const res = await updateSupplierProfile(supplier.id, fd);
      if (res?.error) setError(res.error);
      else setEditing(false);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-left hover:text-indigo-700 transition cursor-pointer"
      >
        {children}
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          onClick={() => {
            setOpen(false);
            setEditing(false);
          }}
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-100">
              <div>
                <h3 className="text-lg font-semibold text-neutral-900">{supplier.name}</h3>
                <p className="text-xs text-neutral-500">Lieferanten-Profil</p>
              </div>
              <div className="flex items-center gap-3">
                {isAdmin && !editing && (
                  <button
                    onClick={() => setEditing(true)}
                    className="inline-flex items-center gap-1 text-xs text-neutral-600 hover:text-indigo-700"
                  >
                    <Pencil size={12} /> Bearbeiten
                  </button>
                )}
                <button
                  onClick={() => {
                    setOpen(false);
                    setEditing(false);
                  }}
                  className="text-neutral-400 hover:text-neutral-700"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div className="px-6 py-5">
              {!editing ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 text-sm">
                  <Row label="Adresse" value={supplier.address} multiline />
                  <Row label="E-Mail" value={supplier.email} />
                  <Row label="Telefon" value={supplier.phone} />
                  <Row label="Bankname" value={supplier.bank_name} />
                  <Row label="Kontoinhaber" value={supplier.bank_account_holder} />
                  <Row label="Bankadresse" value={supplier.bank_address} multiline />
                  <Row label="IBAN / Konto" value={supplier.iban} mono />
                  <Row label="SWIFT / BIC" value={supplier.swift_bic} mono />
                  <Row label="Notizen" value={supplier.profile_notes} multiline full />
                </div>
              ) : (
                <form action={save} className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                  <div className="md:col-span-2">
                    <Field label="Adresse" name="address" value={supplier.address} textarea />
                  </div>
                  <Field label="E-Mail" name="email" value={supplier.email} type="email" />
                  <Field label="Telefon" name="phone" value={supplier.phone} />
                  <Field label="Bankname" name="bank_name" value={supplier.bank_name} />
                  <Field
                    label="Kontoinhaber"
                    name="bank_account_holder"
                    value={supplier.bank_account_holder}
                  />
                  <Field
                    label="Bankadresse"
                    name="bank_address"
                    value={supplier.bank_address}
                    textarea
                  />
                  <Field label="IBAN / Konto" name="iban" value={supplier.iban} mono />
                  <Field label="SWIFT / BIC" name="swift_bic" value={supplier.swift_bic} mono />
                  <div className="md:col-span-2">
                    <Field
                      label="Notizen"
                      name="profile_notes"
                      value={supplier.profile_notes}
                      textarea
                    />
                  </div>
                  {error && <p className="md:col-span-2 text-xs text-red-600">{error}</p>}
                  <div className="md:col-span-2 flex gap-2 pt-2">
                    <button
                      type="submit"
                      disabled={pending}
                      className="inline-flex items-center gap-1 rounded-lg bg-neutral-900 text-white text-sm font-medium px-4 py-2 disabled:opacity-50"
                    >
                      <Check size={14} /> Speichern
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditing(false)}
                      className="inline-flex items-center gap-1 rounded-lg border border-neutral-300 text-sm px-4 py-2"
                    >
                      <X size={14} /> Abbrechen
                    </button>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Row({
  label,
  value,
  multiline,
  mono,
  full,
}: {
  label: string;
  value: string | null;
  multiline?: boolean;
  mono?: boolean;
  full?: boolean;
}) {
  return (
    <div className={full ? "md:col-span-2" : ""}>
      <div className="text-[10px] uppercase tracking-wide text-neutral-500">{label}</div>
      <div
        className={`text-neutral-900 ${mono ? "font-mono text-xs" : ""} ${
          multiline ? "whitespace-pre-line" : ""
        }`}
      >
        {value || <span className="text-neutral-400">—</span>}
      </div>
    </div>
  );
}

function Field({
  label,
  name,
  value,
  textarea,
  type = "text",
  mono,
}: {
  label: string;
  name: string;
  value: string | null;
  textarea?: boolean;
  type?: string;
  mono?: boolean;
}) {
  const base = `w-full rounded-lg border border-neutral-300 px-2 py-1.5 text-sm ${
    mono ? "font-mono text-xs" : ""
  }`;
  return (
    <div>
      <label className="block text-[10px] uppercase tracking-wide text-neutral-500 mb-1">
        {label}
      </label>
      {textarea ? (
        <textarea name={name} defaultValue={value ?? ""} rows={3} className={base} />
      ) : (
        <input name={name} type={type} defaultValue={value ?? ""} className={base} />
      )}
    </div>
  );
}
