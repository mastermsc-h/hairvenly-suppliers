"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Plus, Pencil, Trash2, Check, AlertTriangle, TrendingDown, TrendingUp,
  Wallet, HandCoins, X,
} from "lucide-react";
import { t, type Locale } from "@/lib/i18n";
import type { SteuerPosten, SteuerArt, SteuerRichtung } from "@/lib/types";
import {
  createSteuerPosten, updateSteuerPosten, deleteSteuerPosten, markSteuerBezahlt,
} from "@/lib/actions/steuer";

// ---- Helpers ----
function fmt(n: number) {
  return n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}
function todayISO() {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Berlin" });
}
function fmtDate(iso: string | null) {
  if (!iso) return "—";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

const ART_ORDER: SteuerArt[] = [
  "ust_va", "est_vz", "gewst_vz",
  "ust_nachzahlung", "est_nachzahlung", "gewst_nachzahlung", "sonstige",
];

type StatusKey =
  | "offen" | "teilbezahlt" | "bezahlt"
  | "erstattung_offen" | "erstattung_teil" | "erstattung_erhalten";

function deriveStatus(p: SteuerPosten): { key: StatusKey; overdue: boolean } {
  const soll = Number(p.soll_betrag) || 0;
  const ist = Number(p.ist_betrag) || 0;
  if (p.richtung === "erstattung") {
    if (ist <= 0) return { key: "erstattung_offen", overdue: false };
    if (soll > 0 && ist < soll) return { key: "erstattung_teil", overdue: false };
    return { key: "erstattung_erhalten", overdue: false };
  }
  let key: StatusKey;
  if (ist <= 0) key = "offen";
  else if (soll > 0 && ist < soll) key = "teilbezahlt";
  else key = "bezahlt";
  const open = key === "offen" || key === "teilbezahlt";
  const overdue = open && !!p.faellig_am && p.faellig_am < todayISO();
  return { key, overdue };
}

const STATUS_STYLE: Record<StatusKey, string> = {
  offen: "bg-neutral-100 text-neutral-600",
  teilbezahlt: "bg-amber-100 text-amber-800",
  bezahlt: "bg-emerald-100 text-emerald-800",
  erstattung_offen: "bg-blue-100 text-blue-800",
  erstattung_teil: "bg-amber-100 text-amber-800",
  erstattung_erhalten: "bg-emerald-100 text-emerald-800",
};

export default function SteuerLedger({
  locale, jahr, jahre, posten,
}: {
  locale: Locale;
  jahr: number;
  jahre: number[];
  posten: SteuerPosten[];
}) {
  const router = useRouter();
  const [editing, setEditing] = useState<SteuerPosten | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [pending, startTransition] = useTransition();

  const tl = (k: string) => t(locale, `finance.tax_ledger.${k}`);
  const artLabel = (a: SteuerArt) => t(locale, `finance.tax_ledger.art.${a}`);

  // KPIs
  const kpi = useMemo(() => {
    let offen = 0, bezahlt = 0, erstOffen = 0, erstErhalten = 0;
    for (const p of posten) {
      const soll = Number(p.soll_betrag) || 0;
      const ist = Number(p.ist_betrag) || 0;
      if (p.richtung === "erstattung") {
        erstOffen += Math.max(0, soll - ist);
        erstErhalten += ist;
      } else {
        offen += Math.max(0, soll - ist);
        bezahlt += ist;
      }
    }
    return { offen, bezahlt, erstOffen, erstErhalten };
  }, [posten]);

  const overdueCount = useMemo(
    () => posten.filter((p) => deriveStatus(p).overdue).length,
    [posten],
  );

  // Group by art in fixed order
  const groups = useMemo(() => {
    return ART_ORDER
      .map((art) => ({ art, rows: posten.filter((p) => p.art === art) }))
      .filter((g) => g.rows.length > 0);
  }, [posten]);

  function openNew() { setEditing(null); setShowForm(true); }
  function openEdit(p: SteuerPosten) { setEditing(p); setShowForm(true); }

  function handleDelete(p: SteuerPosten) {
    if (!confirm(tl("confirm_delete"))) return;
    startTransition(async () => { await deleteSteuerPosten(p.id); router.refresh(); });
  }
  function handleMarkPaid(p: SteuerPosten) {
    startTransition(async () => {
      await markSteuerBezahlt(p.id, Number(p.soll_betrag) || 0, todayISO());
      router.refresh();
    });
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-neutral-900">{tl("title")}</h1>
          <p className="text-sm text-neutral-500 mt-1">{tl("subtitle")}</p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={jahr}
            onChange={(e) => router.push(`/finances/prepayments?jahr=${e.target.value}`)}
            className="rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900"
          >
            {[...new Set([jahr, ...jahre])].sort((a, b) => b - a).map((y) => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
          <button
            onClick={openNew}
            className="flex items-center gap-1.5 bg-neutral-900 text-white font-medium rounded-lg px-4 py-2 text-sm"
          >
            <Plus size={16} /> {tl("add")}
          </button>
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <KpiTile
          icon={<Wallet size={18} />} tone="red"
          label={tl("open")} value={fmt(kpi.offen)}
          sub={overdueCount > 0 ? `${overdueCount} ${tl("overdue")}` : tl("open_sub")}
          subWarn={overdueCount > 0}
        />
        <KpiTile
          icon={<TrendingDown size={18} />} tone="green"
          label={tl("paid_year").replace("{year}", String(jahr))} value={fmt(kpi.bezahlt)}
          sub={tl("paid_sub")}
        />
        <KpiTile
          icon={<HandCoins size={18} />} tone="blue"
          label={tl("refund_pending")} value={fmt(kpi.erstOffen)}
          sub={tl("refund_pending_sub")}
        />
        <KpiTile
          icon={<TrendingUp size={18} />} tone="green"
          label={tl("refund_received")} value={fmt(kpi.erstErhalten)}
          sub={tl("refund_received_sub")}
        />
      </div>

      {/* Ledger table */}
      {groups.length === 0 ? (
        <div className="bg-white rounded-2xl border border-neutral-200 p-8 shadow-sm text-center text-neutral-500">
          {tl("empty")}
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[720px]">
              <thead>
                <tr className="border-b border-neutral-200 bg-neutral-50">
                  <Th>{tl("col.period")}</Th>
                  <Th>{tl("col.due")}</Th>
                  <Th right>{tl("col.soll")}</Th>
                  <Th right>{tl("col.ist")}</Th>
                  <Th right>{tl("col.rest")}</Th>
                  <Th>{tl("col.status")}</Th>
                  <Th right>{tl("col.actions")}</Th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => {
                  const soll = g.rows.reduce((s, r) => s + (Number(r.soll_betrag) || 0), 0);
                  const ist = g.rows.reduce((s, r) => s + (Number(r.ist_betrag) || 0), 0);
                  return (
                    <FragmentGroup
                      key={g.art}
                      title={artLabel(g.art)}
                      soll={soll} ist={ist}
                    >
                      {g.rows.map((p) => {
                        const st = deriveStatus(p);
                        const sollN = Number(p.soll_betrag) || 0;
                        const istN = Number(p.ist_betrag) || 0;
                        const rest = p.richtung === "erstattung"
                          ? Math.max(0, sollN - istN)
                          : Math.max(0, sollN - istN);
                        return (
                          <tr key={p.id} className="border-b border-neutral-100 hover:bg-neutral-50">
                            <td className="py-2 px-3">
                              <span className="text-neutral-800">{p.zeitraum}</span>
                              {p.richtung === "erstattung" && (
                                <span className="ml-1.5 text-xs text-blue-600">↩ {tl("erstattung")}</span>
                              )}
                              {p.bescheid_ref && (
                                <span className="block text-xs text-neutral-400">{p.bescheid_ref}</span>
                              )}
                            </td>
                            <td className="py-2 px-3 whitespace-nowrap text-neutral-600">
                              {fmtDate(p.faellig_am)}
                            </td>
                            <td className="py-2 px-3 text-right tabular-nums">{sollN ? fmt(sollN) : "—"}</td>
                            <td className="py-2 px-3 text-right tabular-nums text-neutral-600">
                              {istN ? fmt(istN) : "—"}
                              {p.bezahlt_am && <span className="block text-xs text-neutral-400">{fmtDate(p.bezahlt_am)}</span>}
                            </td>
                            <td className="py-2 px-3 text-right tabular-nums font-medium">
                              {rest > 0 ? fmt(rest) : "—"}
                            </td>
                            <td className="py-2 px-3">
                              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ${st.overdue ? "bg-red-100 text-red-800" : STATUS_STYLE[st.key]}`}>
                                {st.overdue && <AlertTriangle size={11} />}
                                {st.overdue ? tl("status.overdue") : tl(`status.${st.key}`)}
                              </span>
                            </td>
                            <td className="py-2 px-3">
                              <div className="flex items-center justify-end gap-1">
                                {p.richtung === "zahlung" && st.key !== "bezahlt" && sollN > 0 && (
                                  <IconBtn title={tl("mark_paid")} onClick={() => handleMarkPaid(p)} disabled={pending}>
                                    <Check size={15} className="text-emerald-600" />
                                  </IconBtn>
                                )}
                                <IconBtn title={tl("edit")} onClick={() => openEdit(p)}>
                                  <Pencil size={15} className="text-neutral-500" />
                                </IconBtn>
                                <IconBtn title={tl("delete")} onClick={() => handleDelete(p)} disabled={pending}>
                                  <Trash2 size={15} className="text-red-500" />
                                </IconBtn>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </FragmentGroup>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="text-xs text-neutral-400 leading-relaxed">
        {tl("hint")}
      </p>

      {showForm && (
        <PostenForm
          locale={locale}
          jahr={jahr}
          editing={editing}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); router.refresh(); }}
        />
      )}
    </div>
  );
}

// ---- Sub-components ----

function FragmentGroup({ title, soll, ist, children }: { title: string; soll: number; ist: number; children: React.ReactNode }) {
  return (
    <>
      <tr className="bg-neutral-50/70">
        <td colSpan={2} className="py-1.5 px-3 text-xs font-semibold text-neutral-700 uppercase tracking-wide">{title}</td>
        <td className="py-1.5 px-3 text-right text-xs font-semibold text-neutral-500 tabular-nums">{soll ? fmt(soll) : ""}</td>
        <td className="py-1.5 px-3 text-right text-xs font-semibold text-neutral-500 tabular-nums">{ist ? fmt(ist) : ""}</td>
        <td colSpan={3} />
      </tr>
      {children}
    </>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return (
    <th className={`py-2 px-3 text-xs font-medium text-neutral-500 uppercase tracking-wide ${right ? "text-right" : "text-left"}`}>
      {children}
    </th>
  );
}

function IconBtn({ children, title, onClick, disabled }: { children: React.ReactNode; title: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" title={title} onClick={onClick} disabled={disabled}
      className="p-1.5 rounded-lg hover:bg-neutral-200 disabled:opacity-40">
      {children}
    </button>
  );
}

function KpiTile({ icon, label, value, sub, tone, subWarn }: {
  icon: React.ReactNode; label: string; value: string; sub: string;
  tone: "red" | "green" | "blue"; subWarn?: boolean;
}) {
  const toneMap = {
    red: "text-red-600 bg-red-50",
    green: "text-emerald-600 bg-emerald-50",
    blue: "text-blue-600 bg-blue-50",
  };
  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
      <div className="flex items-center gap-2">
        <span className={`p-1.5 rounded-lg ${toneMap[tone]}`}>{icon}</span>
        <span className="text-xs font-medium text-neutral-500 uppercase tracking-wide">{label}</span>
      </div>
      <div className="text-2xl font-bold text-neutral-900 mt-2 tabular-nums">{value}</div>
      <div className={`text-xs mt-0.5 ${subWarn ? "text-red-600 font-medium" : "text-neutral-400"}`}>{sub}</div>
    </div>
  );
}

const ART_OPTIONS: SteuerArt[] = [
  "ust_va", "est_vz", "gewst_vz",
  "ust_nachzahlung", "est_nachzahlung", "gewst_nachzahlung", "sonstige",
];

function PostenForm({ locale, jahr, editing, onClose, onSaved }: {
  locale: Locale; jahr: number; editing: SteuerPosten | null;
  onClose: () => void; onSaved: () => void;
}) {
  const tl = (k: string) => t(locale, `finance.tax_ledger.${k}`);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [richtung, setRichtung] = useState<SteuerRichtung>(editing?.richtung ?? "zahlung");

  function handleSubmit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const res = editing
        ? await updateSteuerPosten(editing.id, formData)
        : await createSteuerPosten(null, formData);
      if (res?.ok) onSaved();
      else setError(res?.error ?? "Fehler");
    });
  }

  const inputCls = "w-full rounded-lg border border-neutral-300 px-3 py-2 text-sm focus:ring-2 focus:ring-neutral-900 focus:outline-none";
  const labelCls = "text-xs font-medium text-neutral-600 uppercase tracking-wide";

  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-3 border-b border-neutral-200 sticky top-0 bg-white">
          <h2 className="font-semibold text-neutral-900">{editing ? tl("edit") : tl("add")}</h2>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-neutral-100"><X size={18} /></button>
        </div>
        <form action={handleSubmit} className="p-5 space-y-4">
          <input type="hidden" name="jahr" value={jahr} />
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>{tl("field.art")}</label>
              <select name="art" defaultValue={editing?.art ?? "ust_va"} className={inputCls}>
                {ART_OPTIONS.map((a) => (
                  <option key={a} value={a}>{t(locale, `finance.tax_ledger.art.${a}`)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelCls}>{tl("field.richtung")}</label>
              <select name="richtung" value={richtung} onChange={(e) => setRichtung(e.target.value as SteuerRichtung)} className={inputCls}>
                <option value="zahlung">{tl("zahlung")}</option>
                <option value="erstattung">{tl("erstattung")}</option>
              </select>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>{tl("field.zeitraum")}</label>
              <input name="zeitraum" defaultValue={editing?.zeitraum ?? ""} placeholder="2026-07 / Q3 2026" className={inputCls} required />
            </div>
            <div>
              <label className={labelCls}>{tl("field.faellig")}</label>
              <input type="date" name="faellig_am" defaultValue={editing?.faellig_am ?? ""} className={inputCls} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>{richtung === "erstattung" ? tl("field.soll_refund") : tl("field.soll")}</label>
              <input name="soll_betrag" inputMode="decimal" defaultValue={editing?.soll_betrag ? String(editing.soll_betrag) : ""} placeholder="0,00" className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>{richtung === "erstattung" ? tl("field.ist_refund") : tl("field.ist")}</label>
              <input name="ist_betrag" inputMode="decimal" defaultValue={editing?.ist_betrag ? String(editing.ist_betrag) : ""} placeholder="0,00" className={inputCls} />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>{richtung === "erstattung" ? tl("field.received_on") : tl("field.paid_on")}</label>
              <input type="date" name="bezahlt_am" defaultValue={editing?.bezahlt_am ?? ""} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>{tl("field.bescheid")}</label>
              <input name="bescheid_ref" defaultValue={editing?.bescheid_ref ?? ""} placeholder="Bescheid-Nr." className={inputCls} />
            </div>
          </div>
          <div>
            <label className={labelCls}>{tl("field.notiz")}</label>
            <input name="notiz" defaultValue={editing?.notiz ?? ""} className={inputCls} />
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-neutral-300 text-sm font-medium">{tl("cancel")}</button>
            <button type="submit" disabled={pending} className="px-4 py-2 rounded-lg bg-neutral-900 text-white text-sm font-medium disabled:opacity-50">
              {pending ? "…" : tl("save")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
