"use client";

import { useActionState, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, Check, CheckCircle2, ChevronDown, ChevronRight, CircleSlash, ExternalLink,
  Eye, Landmark, Loader2, RefreshCw, RotateCcw, Search, Upload, X, Zap,
} from "lucide-react";
import { t, type Locale } from "@/lib/i18n";
import {
  assignBankByNumberAction, confirmBankMatchAction, ignoreBankTxAction, importBankCsvAction,
  runBankMatchingAction, searchBankIncoming, setBankModeAction,
  type BankSyncState, type BankTransaction,
} from "@/lib/actions/bank";

type Mode = "off" | "shadow" | "live";

function fmt(n: number) {
  return n.toLocaleString("de-DE", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + " €";
}
function fmtDate(iso: string | null) {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${d}.${m}.${y}`;
}
function fmtDateTime(iso: string | null) {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("de-DE", {
    timeZone: "Europe/Berlin", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit",
  });
}
function numericId(gid: string) {
  return gid.split("/").pop() ?? gid;
}

const REVIEW_WITH_REF = new Set(["amount_mismatch", "order_not_open", "amount_only", "mark_failed", "mark_partial", "error"]);

export default function PaymentsBoard({
  locale, state, transactions, shopAdminBase, canChangeMode,
}: {
  locale: Locale;
  state: BankSyncState | null;
  transactions: BankTransaction[];
  shopAdminBase: string | null;
  canChangeMode: boolean;
}) {
  const tr = (k: string) => t(locale, k);
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const mode: Mode = state?.auto_mark_mode ?? "shadow";

  // Suche über ALLE Eingänge (Server, alle Zeiträume) — ab 2 Zeichen, entprellt
  const [q, setQ] = useState("");
  const [treffer, setTreffer] = useState<BankTransaction[] | null>(null);
  const [sucht, setSucht] = useState(false);
  const qRef = useRef("");
  qRef.current = q;
  async function suchen(text: string) {
    if (text.trim().length < 2) {
      setTreffer(null);
      return;
    }
    setSucht(true);
    const res = await searchBankIncoming(text);
    if (qRef.current === text) {
      setTreffer(res.transactions);
      if (!res.ok) setMsg({ ok: false, text: res.error ?? "Suche fehlgeschlagen" });
    }
    setSucht(false);
  }
  useEffect(() => {
    const text = q;
    const timer = setTimeout(() => suchen(text), 350);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const groups = useMemo(() => {
    const g = {
      review: [] as BankTransaction[], shadow: [] as BankTransaction[], unmatched: [] as BankTransaction[],
      done: [] as BankTransaction[], ignored: [] as BankTransaction[], pending: [] as BankTransaction[],
    };
    for (const tx of transactions) {
      if (tx.match_status === "review") (REVIEW_WITH_REF.has(tx.match_reason ?? "") ? g.review : g.unmatched).push(tx);
      else if (tx.match_status === "shadow") g.shadow.push(tx);
      else if (tx.match_status === "auto_paid" || tx.match_status === "manual_paid") g.done.push(tx);
      else if (tx.match_status === "ignored") g.ignored.push(tx);
      else if (tx.match_status === "pending" || tx.match_status === "processing") g.pending.push(tx);
    }
    return g;
  }, [transactions]);

  function run(fn: () => Promise<{ ok: boolean; error?: string; info?: string }>, okText?: string) {
    setMsg(null);
    startTransition(async () => {
      const res = await fn();
      if (!res.ok) setMsg({ ok: false, text: res.error ?? "Fehler" });
      else if (res.info || okText) setMsg({ ok: true, text: res.info ?? okText ?? "" });
      router.refresh();
      // Suchtreffer zeigen sonst den alten Status
      if (qRef.current.trim().length >= 2) await suchen(qRef.current);
    });
  }

  function changeMode(next: Mode) {
    if (next === mode) return;
    if (next === "live" && !window.confirm(tr("bank.mode.confirm_live"))) return;
    run(() => setBankModeAction(next));
  }

  function confirmOrders(tx: BankTransaction, orders: { gid: string; name: string; outstanding: number }[]) {
    const sum = orders.reduce((s, o) => s + Number(o.outstanding || 0), 0);
    const mismatch = Math.round(sum * 100) !== Math.round(tx.amount * 100);
    const text = `${orders.map((o) => o.name).join(" + ")} ${tr("bank.confirm.mark")}` +
      (mismatch ? `\n\n${tr("bank.confirm.mismatch")}\n${tr("bank.label.outstanding")}: ${fmt(sum)} · ${tr("bank.label.received")}: ${fmt(tx.amount)}` : "");
    if (!window.confirm(text)) return;
    run(() => confirmBankMatchAction(tx.id, orders.map((o) => o.gid)), "✓");
  }

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900">{tr("bank.title")}</h1>
        <p className="text-sm text-neutral-500 mt-1">{tr("bank.subtitle")}</p>
      </div>

      {/* Status + Modus */}
      <div className="grid gap-4 md:grid-cols-2">
        <WorkerStatus state={state} tr={tr} />
        <div className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm space-y-3">
          <div className="text-xs font-medium text-neutral-600 uppercase tracking-wide">{tr("bank.mode.title")}</div>
          <div className="inline-flex rounded-lg border border-neutral-300 overflow-hidden">
            {(["off", "shadow", "live"] as Mode[]).map((m) => (
              <button
                key={m}
                type="button"
                disabled={!canChangeMode || pending}
                onClick={() => changeMode(m)}
                className={`px-4 py-1.5 text-sm font-medium transition ${
                  mode === m
                    ? m === "live" ? "bg-emerald-600 text-white" : m === "shadow" ? "bg-amber-500 text-white" : "bg-neutral-700 text-white"
                    : "bg-white text-neutral-700 hover:bg-neutral-50"
                } disabled:cursor-not-allowed`}
              >
                {tr(`bank.mode.${m}`)}
              </button>
            ))}
          </div>
          <p className="text-sm text-neutral-600">{tr(`bank.mode.${mode}_desc`)}</p>
          {!canChangeMode && <p className="text-xs text-neutral-400">{tr("bank.mode.admin_only")}</p>}
          <button
            type="button"
            disabled={pending}
            onClick={() => run(async () => {
              const r = await runBankMatchingAction();
              const s = r.summary;
              return { ...r, info: s ? `${s.processed} geprüft · ${s.autoPaid} automatisch · ${s.shadow} Shadow · ${s.review} zu prüfen` : undefined };
            })}
            className="inline-flex items-center gap-2 bg-neutral-900 text-white font-medium rounded-lg px-4 py-2 text-sm disabled:opacity-50"
          >
            {pending ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            {tr("bank.run_now")}
          </button>
        </div>
      </div>

      {msg && (
        <div className={`rounded-lg px-4 py-2 text-sm ${msg.ok ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>
          {msg.text}
        </div>
      )}

      {/* Suche */}
      <div className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm space-y-3">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-2.5 text-neutral-400" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={tr("bank.search.placeholder")}
            className="w-full rounded-lg border border-neutral-300 pl-9 pr-9 py-2 text-sm focus:ring-2 focus:ring-neutral-900 focus:outline-none"
          />
          {sucht ? (
            <Loader2 size={16} className="absolute right-3 top-2.5 animate-spin text-neutral-400" />
          ) : q ? (
            <button type="button" onClick={() => setQ("")} className="absolute right-3 top-2.5 text-neutral-400 hover:text-neutral-900" title="Suche leeren">
              <X size={16} />
            </button>
          ) : null}
        </div>
        {treffer && (
          <>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-sm font-medium text-neutral-900">
                {tr("bank.search.title")} ({treffer.length}{treffer.length >= 200 ? "+" : ""})
              </span>
              <span className="text-xs text-neutral-400">{tr("bank.search.hint")}</span>
            </div>
            {treffer.length === 0 ? (
              <p className="text-sm text-neutral-400">{tr("bank.search.none")}</p>
            ) : (
              <div className="-mx-4 md:-mx-6 border-t border-neutral-100 divide-y divide-neutral-100">
                {treffer.map((tx) => {
                  const offen = tx.match_status === "review" || tx.match_status === "shadow";
                  return (
                    <div key={tx.id}>
                      <div className="px-4 md:px-6 pt-3">
                        <span className="rounded bg-neutral-100 px-1.5 py-0.5 text-[11px] text-neutral-600">{statusLabel(tx, tr)}</span>
                      </div>
                      <TxCard
                        tx={tx}
                        tr={tr}
                        shopAdminBase={shopAdminBase}
                        pending={pending}
                        onConfirm={offen ? (orders) => confirmOrders(tx, orders) : undefined}
                        onAssign={tx.match_status === "review" ? (nr) => run(() => assignBankByNumberAction(tx.id, nr), "✓") : undefined}
                        onIgnore={offen ? () => run(() => ignoreBankTxAction(tx.id, true)) : undefined}
                        onRestore={tx.match_status === "ignored" ? () => run(() => ignoreBankTxAction(tx.id, false)) : undefined}
                      />
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Kpi label={tr("bank.kpi.review")} value={groups.review.length} tone="amber" />
        <Kpi label={tr("bank.kpi.shadow")} value={groups.shadow.length} tone="blue" />
        <Kpi label={tr("bank.kpi.auto")} value={groups.done.filter((x) => x.match_status === "auto_paid").length} tone="emerald" />
        <Kpi label={tr("bank.kpi.manual")} value={groups.done.filter((x) => x.match_status === "manual_paid").length} tone="neutral" />
      </div>

      <Section title={tr("bank.section.review")} hint={tr("bank.section.review_hint")} count={groups.review.length} icon={<AlertTriangle size={16} className="text-amber-600" />} defaultOpen>
        {groups.review.map((tx) => (
          <TxCard key={tx.id} tx={tx} tr={tr} shopAdminBase={shopAdminBase} pending={pending}
            onConfirm={(orders) => confirmOrders(tx, orders)}
            onAssign={(nr) => run(() => assignBankByNumberAction(tx.id, nr), "✓")}
            onIgnore={() => run(() => ignoreBankTxAction(tx.id, true))} />
        ))}
      </Section>

      <Section title={tr("bank.section.shadow")} hint={tr("bank.section.shadow_hint")} count={groups.shadow.length} icon={<Eye size={16} className="text-blue-600" />} defaultOpen>
        {groups.shadow.map((tx) => (
          <TxCard key={tx.id} tx={tx} tr={tr} shopAdminBase={shopAdminBase} pending={pending}
            onConfirm={(orders) => confirmOrders(tx, orders)}
            onIgnore={() => run(() => ignoreBankTxAction(tx.id, true))} />
        ))}
      </Section>

      <Section title={tr("bank.section.unmatched")} hint={tr("bank.section.unmatched_hint")} count={groups.unmatched.length} icon={<CircleSlash size={16} className="text-neutral-500" />}>
        {groups.unmatched.map((tx) => (
          <TxCard key={tx.id} tx={tx} tr={tr} shopAdminBase={shopAdminBase} pending={pending}
            onConfirm={(orders) => confirmOrders(tx, orders)}
            onAssign={(nr) => run(() => assignBankByNumberAction(tx.id, nr), "✓")}
            onIgnore={() => run(() => ignoreBankTxAction(tx.id, true))} />
        ))}
      </Section>

      {groups.pending.length > 0 && (
        <Section title={tr("bank.section.pending")} count={groups.pending.length} icon={<Loader2 size={16} className="text-neutral-500" />}>
          {groups.pending.map((tx) => <TxCard key={tx.id} tx={tx} tr={tr} shopAdminBase={shopAdminBase} pending={pending} />)}
        </Section>
      )}

      <Section title={tr("bank.section.done")} count={groups.done.length} icon={<CheckCircle2 size={16} className="text-emerald-600" />}>
        {groups.done.map((tx) => <TxCard key={tx.id} tx={tx} tr={tr} shopAdminBase={shopAdminBase} pending={pending} />)}
      </Section>

      <Section title={tr("bank.section.ignored")} count={groups.ignored.length} icon={<CircleSlash size={16} className="text-neutral-400" />}>
        {groups.ignored.map((tx) => (
          <TxCard key={tx.id} tx={tx} tr={tr} shopAdminBase={shopAdminBase} pending={pending}
            onRestore={() => run(() => ignoreBankTxAction(tx.id, false))} />
        ))}
      </Section>

      <CsvImport tr={tr} />
    </div>
  );
}

// ── Bausteine ────────────────────────────────────────────────────────────────

/** Status eines Suchtreffers als kurzes Etikett (gleiche Gruppen wie die Abschnitte). */
function statusLabel(tx: BankTransaction, tr: (k: string) => string): string {
  if (tx.match_status === "review") return REVIEW_WITH_REF.has(tx.match_reason ?? "") ? tr("bank.section.review") : tr("bank.section.unmatched");
  if (tx.match_status === "shadow") return tr("bank.section.shadow");
  if (tx.match_status === "auto_paid" || tx.match_status === "manual_paid") return tr("bank.section.done");
  if (tx.match_status === "ignored") return tr("bank.section.ignored");
  return tr("bank.section.pending");
}

function WorkerStatus({ state, tr }: { state: BankSyncState | null; tr: (k: string) => string }) {
  let tone = "neutral", icon = <Landmark size={18} />, text = tr("bank.worker.never");
  if (state?.last_fetch_at) {
    if (state.last_fetch_code === "auth_failed") { tone = "red"; icon = <AlertTriangle size={18} />; text = tr("bank.worker.auth_failed"); }
    else if (state.last_fetch_code === "needs_tan") { tone = "amber"; icon = <AlertTriangle size={18} />; text = tr("bank.worker.needs_tan"); }
    else if (state.last_fetch_ok === false) { tone = "red"; icon = <AlertTriangle size={18} />; text = tr("bank.worker.error"); }
    else { tone = "emerald"; icon = <Check size={18} />; text = tr("bank.worker.ok"); }
  }
  const toneCls: Record<string, string> = {
    neutral: "text-neutral-600 bg-neutral-100", amber: "text-amber-800 bg-amber-100",
    red: "text-red-700 bg-red-100", emerald: "text-emerald-800 bg-emerald-100",
  };
  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm space-y-3">
      <div className="text-xs font-medium text-neutral-600 uppercase tracking-wide">{tr("bank.worker.title")}</div>
      <div className={`inline-flex items-center gap-2 rounded-lg px-3 py-1.5 text-sm font-medium ${toneCls[tone]}`}>
        {icon} {text}
      </div>
      {state?.last_fetch_message && state.last_fetch_code !== "ok" && (
        <p className="text-xs text-neutral-500 break-words">{state.last_fetch_message}</p>
      )}
      <dl className="grid grid-cols-2 gap-2 text-sm">
        <dt className="text-neutral-500">{tr("bank.worker.last_fetch")}</dt>
        <dd className="text-neutral-900">{fmtDateTime(state?.last_fetch_at ?? null)}</dd>
        <dt className="text-neutral-500">{tr("bank.worker.last_success")}</dt>
        <dd className="text-neutral-900">{fmtDateTime(state?.last_success_at ?? null)}</dd>
      </dl>
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: number; tone: "amber" | "blue" | "emerald" | "neutral" }) {
  const cls = {
    amber: "text-amber-700", blue: "text-blue-700", emerald: "text-emerald-700", neutral: "text-neutral-800",
  }[tone];
  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
      <div className="text-xs text-neutral-500">{label}</div>
      <div className={`text-2xl font-semibold mt-1 ${cls}`}>{value}</div>
    </div>
  );
}

function Section({
  title, hint, count, icon, defaultOpen = false, children,
}: {
  title: string; hint?: string; count: number; icon: React.ReactNode; defaultOpen?: boolean; children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen && count > 0);
  return (
    <div className="bg-white rounded-2xl border border-neutral-200 shadow-sm">
      <button type="button" onClick={() => setOpen(!open)} className="w-full flex items-center gap-2 p-4 md:px-6 text-left">
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        {icon}
        <span className="font-medium text-neutral-900">{title}</span>
        <span className="ml-1 rounded-full bg-neutral-100 px-2 py-0.5 text-xs text-neutral-600">{count}</span>
        {hint && <span className="hidden md:inline text-xs text-neutral-400 ml-2 truncate">{hint}</span>}
      </button>
      {open && (
        <div className="border-t border-neutral-100 divide-y divide-neutral-100">
          {count === 0 ? <p className="p-4 md:px-6 text-sm text-neutral-400">—</p> : children}
        </div>
      )}
    </div>
  );
}

function TxCard({
  tx, tr, shopAdminBase, pending, onConfirm, onAssign, onIgnore, onRestore,
}: {
  tx: BankTransaction;
  tr: (k: string) => string;
  shopAdminBase: string | null;
  pending: boolean;
  onConfirm?: (orders: { gid: string; name: string; outstanding: number }[]) => void;
  onAssign?: (orderNumber: string) => void;
  onIgnore?: () => void;
  onRestore?: () => void;
}) {
  const [nr, setNr] = useState("");
  const orderLink = (gid: string, name: string) =>
    shopAdminBase ? (
      <a href={`${shopAdminBase}${numericId(gid)}`} target="_blank" rel="noreferrer"
        className="inline-flex items-center gap-1 font-medium text-neutral-900 hover:underline">
        {name} <ExternalLink size={12} />
      </a>
    ) : <span className="font-medium">{name}</span>;

  return (
    <div className="p-4 md:px-6 space-y-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-sm text-neutral-500 tabular-nums">{fmtDate(tx.booking_date)}</span>
        <span className="text-base font-semibold text-emerald-700 tabular-nums">{fmt(tx.amount)}</span>
        <span className="text-sm text-neutral-900">{tx.counterparty_name ?? "—"}</span>
        {tx.source === "csv" && <span className="rounded bg-neutral-100 px-1.5 text-[10px] text-neutral-500">CSV</span>}
        {tx.match_status === "auto_paid" && <span className="rounded bg-emerald-100 px-1.5 text-[11px] text-emerald-800 inline-flex items-center gap-1"><Zap size={10} />{tr("bank.status.auto_paid")}</span>}
        {tx.match_status === "manual_paid" && <span className="rounded bg-neutral-100 px-1.5 text-[11px] text-neutral-700">{tr("bank.status.manual_paid")}</span>}
      </div>
      {tx.purpose && <p className="text-xs font-mono text-neutral-600 break-words">{tx.purpose}</p>}
      {tx.match_detail && <p className="text-sm text-neutral-700">{tx.match_detail}</p>}

      {/* Bereits zugeordnete / sichere Treffer */}
      {tx.matched_orders.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          {tx.matched_orders.map((o) => (
            <span key={o.gid} className="inline-flex items-center gap-1 rounded-lg border border-neutral-200 px-2 py-1">
              {orderLink(o.gid, o.name)}
              {o.outstanding ? <span className="text-neutral-500">· {fmt(Number(o.outstanding))}</span> : null}
            </span>
          ))}
          {tx.match_status === "shadow" && onConfirm && (
            <button type="button" disabled={pending} onClick={() => onConfirm(tx.matched_orders)}
              className="bg-neutral-900 text-white font-medium rounded-lg px-3 py-1 text-sm disabled:opacity-50">
              {tx.matched_orders.length > 1 ? tr("bank.action.mark_all") : tr("bank.action.mark_paid")}
            </button>
          )}
        </div>
      )}

      {/* Vorschläge */}
      {tx.match_status !== "shadow" && tx.candidates.length > 0 && onConfirm && (
        <div className="space-y-1.5">
          {tx.candidates.slice(0, 6).map((c) => (
            <div key={c.gid} className="flex flex-wrap items-center gap-2 text-sm">
              {orderLink(c.gid, c.name)}
              <span className="text-neutral-500">{tr("bank.label.outstanding")} {fmt(Number(c.outstanding))}</span>
              <span className="rounded bg-neutral-100 px-1.5 text-[11px] text-neutral-600">
                {c.via === "number" ? tr("bank.label.via_number") : tr("bank.label.via_amount")}
              </span>
              {c.nameMatch && <span className="rounded bg-emerald-100 px-1.5 text-[11px] text-emerald-800">{tr("bank.label.name_match")}</span>}
              <button type="button" disabled={pending} onClick={() => onConfirm([c])}
                className="ml-auto border border-neutral-300 rounded-lg px-3 py-1 text-sm hover:bg-neutral-50 disabled:opacity-50">
                {tr("bank.action.mark_paid")}
              </button>
            </div>
          ))}
          {tx.candidates.length > 1 && tx.candidates.every((c) => c.via === "number") && (
            <button type="button" disabled={pending} onClick={() => onConfirm(tx.candidates)}
              className="border border-neutral-300 rounded-lg px-3 py-1 text-sm hover:bg-neutral-50 disabled:opacity-50">
              {tr("bank.action.mark_all")}
            </button>
          )}
        </div>
      )}

      {(onAssign || onIgnore || onRestore) && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {onAssign && (
            <form
              className="flex items-center gap-2"
              onSubmit={(e) => { e.preventDefault(); if (nr.trim()) onAssign(nr.trim()); }}
            >
              <input
                value={nr}
                onChange={(e) => setNr(e.target.value)}
                placeholder={tr("bank.action.order_number")}
                inputMode="numeric"
                className="w-28 rounded-lg border border-neutral-300 px-2 py-1 text-sm focus:ring-2 focus:ring-neutral-900"
              />
              <button type="submit" disabled={pending || !nr.trim()}
                className="border border-neutral-300 rounded-lg px-3 py-1 text-sm hover:bg-neutral-50 disabled:opacity-50">
                {tr("bank.action.assign")}
              </button>
            </form>
          )}
          {onIgnore && (
            <button type="button" disabled={pending} onClick={onIgnore}
              className="text-sm text-neutral-500 hover:text-neutral-800 px-2 py-1 disabled:opacity-50">
              {tr("bank.action.ignore")}
            </button>
          )}
          {onRestore && (
            <button type="button" disabled={pending} onClick={onRestore}
              className="inline-flex items-center gap-1 text-sm text-neutral-600 hover:text-neutral-900 px-2 py-1 disabled:opacity-50">
              <RotateCcw size={12} /> {tr("bank.action.restore")}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function CsvImport({ tr }: { tr: (k: string) => string }) {
  const [state, formAction, isPending] = useActionState(importBankCsvAction, null);
  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm space-y-3">
      <div className="text-xs font-medium text-neutral-600 uppercase tracking-wide">{tr("bank.csv.title")}</div>
      <p className="text-sm text-neutral-600">{tr("bank.csv.hint")}</p>
      <form action={formAction} className="flex flex-wrap items-center gap-3">
        <input type="file" name="file" accept=".csv,text/csv,text/plain" className="text-sm" required />
        <button type="submit" disabled={isPending}
          className="inline-flex items-center gap-2 bg-neutral-900 text-white font-medium rounded-lg px-4 py-2 text-sm disabled:opacity-50">
          {isPending ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
          {tr("bank.csv.button")}
        </button>
      </form>
      {state && (
        <p className={`text-sm ${state.ok ? "text-emerald-700" : "text-red-600"}`}>{state.ok ? state.info : state.error}</p>
      )}
    </div>
  );
}
