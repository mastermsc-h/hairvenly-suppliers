"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition, type KeyboardEvent } from "react";
import { Search, Package2, ArrowRight, RefreshCw, ArrowDown, ArrowUp, Printer, X } from "lucide-react";
import { t, type Locale } from "@/lib/i18n";
import type { PackOrderWithStatus } from "./page";
import { extractOrderNumberFromScan } from "./scan-order";
import { useRouter } from "next/navigation";
import { resetSlipPrint, resetSlipPrintBulk } from "@/lib/actions/pack";

const SHOPIFY_STORE_HANDLE = "339520-3";

const statusBadge: Record<PackOrderWithStatus["packStatus"], string> = {
  open: "bg-neutral-100 text-neutral-700 border-neutral-300",
  in_progress: "bg-amber-50 text-amber-800 border-amber-300",
  verified: "bg-emerald-50 text-emerald-800 border-emerald-300",
  shipped: "bg-blue-50 text-blue-800 border-blue-300",
};

export default function PackList({
  orders,
  locale,
}: {
  orders: PackOrderWithStatus[];
  locale: Locale;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  // Standard: neueste oben (descending). Klick auf Datum-Header toggelt.
  const [sortDesc, setSortDesc] = useState(true);
  const [isPending, startTransition] = useTransition();
  const [isRefreshing, startRefresh] = useTransition();

  function handleRefresh() {
    startRefresh(() => {
      router.refresh();
    });
  }

  function handleResetPrint(orderNumberClean: string) {
    startTransition(async () => {
      const res = await resetSlipPrint(orderNumberClean);
      if (res.success) router.refresh();
      else alert(`Fehler: ${res.error ?? "unbekannt"}`);
    });
  }

  // Wie viele der aktuellen Bestellungen haben einen Druck-Status?
  const printedNames = orders.filter((o) => o.slipPrintedAt).map((o) => o.name);

  function handleResetAllPrints() {
    if (printedNames.length === 0) return;
    if (!confirm(`Druck-Status von ${printedNames.length} Bestellung(en) zurücksetzen?`)) return;
    startTransition(async () => {
      const res = await resetSlipPrintBulk(printedNames);
      if (res.success) router.refresh();
      else alert(`Fehler: ${res.error ?? "unbekannt"}`);
    });
  }

  const filtered = useMemo(() => {
    const sorted = [...orders].sort((a, b) => {
      const diff = new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
      return sortDesc ? -diff : diff;
    });
    const q = query.trim().toLowerCase();
    if (!q) return sorted;
    return sorted.filter((o) => {
      const haystack = [
        o.name,
        o.numberClean,
        o.customerName ?? "",
        o.customerEmail ?? "",
        o.shippingAddress?.city ?? "",
      ].join(" ").toLowerCase();
      return haystack.includes(q);
    });
  }, [orders, query, sortDesc]);

  const localeStr = locale === "de" ? "de-DE" : locale === "tr" ? "tr-TR" : "en-US";

  // Scanner-Einstieg am iMac: Der Handscanner tippt den Lieferschein-QR ins
  // Suchfeld — auf deutscher Tastatur VERWÜRFELT ("httpsÖ--…-pack-27449",
  // siehe scan-order.ts). Erkennung daher layout-unabhängig. Navigiert wird
  // NIE mitten im Tippen (sonst "/pack/274" statt 27449), sondern bei Enter
  // (Scanner sendet das meist) oder nach 400ms Ruhe.
  const SCAN_IDLE_MS = 400;
  const searchIdleRef = useRef<number | null>(null);
  function resolveScan(raw: string): string | null {
    const fromUrl = extractOrderNumberFromScan(raw);
    if (fromUrl) return fromUrl;
    const num = raw.trim().replace(/^#/, "");
    return /^\d{3,}$/.test(num) ? num : null;
  }
  function openOrder(num: string) {
    setQuery("");
    router.push(`/pack/${num}`);
  }
  function handleSearchChange(value: string) {
    setQuery(value);
    if (searchIdleRef.current) window.clearTimeout(searchIdleRef.current);
    // Nur URL-artige Scans per Idle öffnen — eine nackte Nummer könnte auch
    // eine Suche nach Bestellnummer sein; die öffnet erst bei Enter.
    if (extractOrderNumberFromScan(value)) {
      searchIdleRef.current = window.setTimeout(() => {
        const n = extractOrderNumberFromScan(value);
        if (n) openOrder(n);
      }, SCAN_IDLE_MS);
    }
  }
  function handleSearchKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (e.key !== "Enter") return;
    if (searchIdleRef.current) window.clearTimeout(searchIdleRef.current);
    const n = resolveScan(query);
    if (n) {
      e.preventDefault();
      openOrder(n);
    }
  }

  // "Einfach scannen" ohne vorher irgendwo reinzuklicken: Tastatur-Scanner
  // tippen nur in ein fokussiertes Feld. Liegt der Fokus auf keinem Eingabe-
  // element (z.B. nach Klick ins Leere), fängt dieser globale Listener die
  // Zeichen ab, puffert sie und öffnet bei Enter oder nach 400ms Ruhe.
  // Scanner tippen schnell; menschliches Tippen leert den Puffer ebenfalls
  // nach 400ms (und matcht ohnehin kein URL-Muster).
  const scanBufRef = useRef("");
  const scanTimerRef = useRef<number | null>(null);
  // Suchfeld nur am Desktop (md+) automatisch fokussieren — am iPhone würde
  // das beim Öffnen die Tastatur hochklappen und die Liste verdecken.
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (window.matchMedia("(min-width: 768px)").matches) searchRef.current?.focus();
  }, []);
  useEffect(() => {
    function isEditable(el: Element | null): boolean {
      if (!el) return false;
      return !!el.closest("input, textarea, select, [contenteditable]");
    }
    function finish(raw: string) {
      scanBufRef.current = "";
      const n = extractOrderNumberFromScan(raw);
      if (n) {
        router.push(`/pack/${n}`);
        return;
      }
      const num = raw.trim().replace(/^#/, "");
      if (/^\d{3,}$/.test(num)) router.push(`/pack/${num}`);
    }
    function onKey(e: globalThis.KeyboardEvent) {
      if (isEditable(document.activeElement)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (scanTimerRef.current) window.clearTimeout(scanTimerRef.current);
      if (e.key === "Enter") {
        finish(scanBufRef.current);
        return;
      }
      if (e.key.length !== 1) return;
      scanBufRef.current += e.key;
      scanTimerRef.current = window.setTimeout(() => {
        // Idle: nur URL-artige Scans öffnen (nackte Nummern brauchen Enter,
        // sonst würde zufälliges Tippen von Ziffern navigieren)
        const raw = scanBufRef.current;
        scanBufRef.current = "";
        const n = extractOrderNumberFromScan(raw);
        if (n) router.push(`/pack/${n}`);
      }, SCAN_IDLE_MS);
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      if (scanTimerRef.current) window.clearTimeout(scanTimerRef.current);
    };
  }, [router]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-neutral-400" size={16} />
          <input
            type="text"
            value={query}
            onChange={(e) => handleSearchChange(e.target.value)}
            onKeyDown={handleSearchKeyDown}
            autoComplete="off"
            ref={searchRef}
            placeholder={`${t(locale, "shipping.col_order")}, ${t(locale, "shipping.col_customer")} — oder Lieferschein-QR scannen`}
            className="w-full pl-9 pr-3 py-2 rounded-lg border border-neutral-300 text-sm focus:outline-none focus:ring-2 focus:ring-neutral-900"
          />
        </div>
        <button
          onClick={handleRefresh}
          disabled={isRefreshing}
          className="flex items-center gap-2 px-4 py-2 rounded-lg border border-neutral-300 text-sm hover:bg-neutral-50 disabled:opacity-60"
        >
          <RefreshCw size={14} className={isRefreshing ? "animate-spin" : ""} />
          {isRefreshing ? "Lädt…" : t(locale, "shipping.refresh")}
        </button>
        <div className="text-sm text-neutral-500 whitespace-nowrap">
          {filtered.length} {t(locale, "shipping.col_order").toLowerCase()}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-neutral-200 p-10 text-center text-neutral-500 shadow-sm">
          <Package2 className="mx-auto mb-3 text-neutral-300" size={40} />
          <div>{t(locale, "shipping.empty")}</div>
        </div>
      ) : (
        <>
        {/* MOBIL (iPhone/iPad hochkant): Karten statt Tabelle. Die Tabelle war
            breiter als der Bildschirm — "Pack starten" lag rechts außerhalb
            und niemand sah, dass man scrollen kann. Jetzt: Button in voller
            Breite, alles Wichtige auf einen Blick. */}
        <div className="md:hidden space-y-3">
          {filtered.map((o) => {
            const stockMissing = o.tags?.includes("Ware nicht vorhanden");
            return (
              <div
                key={o.id}
                className={`rounded-2xl border-2 p-4 shadow-sm ${
                  stockMissing ? "bg-red-50 border-red-300" : "bg-white border-neutral-200"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-lg font-bold text-neutral-900 leading-tight">{o.name}</div>
                    <div className="text-sm text-neutral-700 truncate">
                      {o.customerName ?? "—"}
                      {o.shippingAddress?.city ? ` · ${o.shippingAddress.city}` : ""}
                    </div>
                    <div className="text-xs text-neutral-500 mt-0.5">
                      {new Date(o.createdAt).toLocaleDateString(localeStr, { day: "2-digit", month: "2-digit" })}
                      {" "}
                      {new Date(o.createdAt).toLocaleTimeString(localeStr, { hour: "2-digit", minute: "2-digit" })}
                    </div>
                  </div>
                  <span
                    className={`shrink-0 inline-block px-2 py-1 text-xs font-medium rounded border ${statusBadge[o.packStatus]}`}
                  >
                    {t(locale, `shipping.status_${o.packStatus}`)}
                  </span>
                </div>
                {stockMissing && (
                  <div className="mt-2 inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-red-600 text-white">
                    ⚠ Ware fehlt
                  </div>
                )}
                <div className="mt-2 text-sm text-neutral-800">
                  <span className="font-semibold">{o.totalQuantity} ×</span>{" "}
                  <span className="text-neutral-600">
                    {o.lineItems.slice(0, 2).map((li) => li.title).join(", ")}
                    {o.lineItems.length > 2 ? "…" : ""}
                  </span>
                </div>
                {(o.packedBy || o.slipPrintedAt) && (
                  <div className="mt-1 text-xs text-neutral-500 flex flex-wrap gap-x-3">
                    {o.packedBy && <span>{o.packedBy}</span>}
                    {o.slipPrintedAt && (
                      <span className="inline-flex items-center gap-1 text-emerald-700">
                        <Printer size={11} /> gedruckt
                        {o.slipPrintedBy ? ` · ${o.slipPrintedBy}` : ""}
                      </span>
                    )}
                  </div>
                )}
                <div className="mt-3 flex items-center gap-2">
                  <Link
                    href={`/pack/${o.numberClean}`}
                    className="flex-1 inline-flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-neutral-900 text-white text-base font-semibold active:scale-[0.98] transition"
                  >
                    {o.packStatus === "in_progress"
                      ? t(locale, "shipping.continue_pack")
                      : t(locale, "shipping.start_pack")}
                    <ArrowRight size={18} />
                  </Link>
                  <a
                    href={`/pack/print-all?order=${o.numberClean}`}
                    target="_blank"
                    rel="noopener"
                    className="inline-flex items-center justify-center w-12 h-12 rounded-xl border border-neutral-300 text-neutral-700"
                    title="Lieferschein einzeln drucken"
                    aria-label="Lieferschein drucken"
                  >
                    <Printer size={18} />
                  </a>
                </div>
              </div>
            );
          })}
        </div>

        {/* DESKTOP: Tabelle */}
        <div className="hidden md:block bg-white rounded-2xl border border-neutral-200 shadow-sm overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-neutral-50 text-neutral-600 text-xs uppercase tracking-wide">
                  <th className="text-left px-4 py-3 font-medium">{t(locale, "shipping.col_order")}</th>
                  <th className="text-left px-4 py-3 font-medium">
                    <button
                      onClick={() => setSortDesc((d) => !d)}
                      className="flex items-center gap-1 hover:text-neutral-900 transition uppercase tracking-wide"
                    >
                      {t(locale, "shipping.col_date")}
                      {sortDesc ? <ArrowDown size={12} /> : <ArrowUp size={12} />}
                    </button>
                  </th>
                  <th className="text-left px-4 py-3 font-medium">{t(locale, "shipping.col_customer")}</th>
                  <th className="text-left px-4 py-3 font-medium">{t(locale, "shipping.col_items")}</th>
                  <th className="text-left px-4 py-3 font-medium">
                    <div className="flex items-center gap-2">
                      <span>{t(locale, "shipping.col_status")}</span>
                      {printedNames.length > 0 && (
                        <button
                          type="button"
                          onClick={handleResetAllPrints}
                          disabled={isPending}
                          title="Druck-Status aller Bestellungen zurücksetzen"
                          className="normal-case tracking-normal font-normal text-[11px] text-neutral-400 hover:text-red-600 disabled:opacity-40"
                        >
                          Druck reset
                        </button>
                      )}
                    </div>
                  </th>
                  <th className="text-right px-4 py-3 font-medium">{t(locale, "shipping.col_action")}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((o, idx) => {
                  const stockMissing = o.tags?.includes("Ware nicht vorhanden");
                  return (
                  <tr
                    key={o.id}
                    className={`border-t border-neutral-100 transition hover:bg-amber-50 ${
                      stockMissing
                        ? "bg-red-50 hover:bg-red-100"
                        : idx % 2 === 1
                        ? "bg-neutral-50/60"
                        : "bg-white"
                    }`}
                  >
                    <td className="px-4 py-3 font-medium">
                      <div className="flex items-center gap-2 flex-wrap">
                        <a
                          href={`https://admin.shopify.com/store/${SHOPIFY_STORE_HANDLE}/orders/${o.numericId}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-neutral-900 hover:text-blue-700 hover:underline transition"
                          title="In Shopify öffnen"
                        >
                          {o.name}
                        </a>
                        {stockMissing && (
                          <span
                            className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wide bg-red-600 text-white"
                            title="Ware ist im Lager nicht vorhanden — sobald da, neu packen"
                          >
                            ⚠ Ware fehlt
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-neutral-700">
                      <div>
                        {new Date(o.createdAt).toLocaleDateString(localeStr, {
                          day: "2-digit",
                          month: "2-digit",
                          year: "numeric",
                        })}
                      </div>
                      <div className="text-xs text-neutral-500">
                        {new Date(o.createdAt).toLocaleTimeString(localeStr, {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-neutral-700">
                      <div>{o.customerName ?? "—"}</div>
                      {o.shippingAddress?.city && (
                        <div className="text-xs text-neutral-500">{o.shippingAddress.city}</div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-neutral-700">
                      <div>{o.totalQuantity} ×</div>
                      <div className="text-xs text-neutral-500 truncate max-w-xs">
                        {o.lineItems.slice(0, 2).map((li) => li.title).join(", ")}
                        {o.lineItems.length > 2 ? "…" : ""}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-block px-2 py-1 text-xs font-medium rounded border ${statusBadge[o.packStatus]}`}
                      >
                        {t(locale, `shipping.status_${o.packStatus}`)}
                      </span>
                      {o.packedBy && (
                        <div className="text-xs text-neutral-500 mt-1">{o.packedBy}</div>
                      )}
                      {o.slipPrintedAt && (
                        <div className="mt-1.5 inline-flex items-center gap-1 text-[11px] text-emerald-700">
                          <Printer size={11} />
                          <span>
                            {new Date(o.slipPrintedAt).toLocaleDateString(localeStr, {
                              day: "2-digit",
                              month: "2-digit",
                              timeZone: "Europe/Berlin",
                            })}
                            {o.slipPrintedBy ? ` · ${o.slipPrintedBy}` : ""}
                          </span>
                          <button
                            type="button"
                            onClick={() => handleResetPrint(o.numberClean)}
                            disabled={isPending}
                            title="Druck-Status zurücksetzen"
                            className="ml-0.5 text-neutral-400 hover:text-red-600 disabled:opacity-40"
                          >
                            <X size={12} />
                          </button>
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-2">
                        <a
                          href={`/pack/print-all?order=${o.numberClean}`}
                          target="_blank"
                          rel="noopener"
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-neutral-300 text-neutral-700 text-xs font-medium hover:bg-neutral-50 transition"
                          title="Lieferschein einzeln drucken"
                        >
                          <Printer size={14} />
                        </a>
                        <Link
                          href={`/pack/${o.numberClean}`}
                          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-neutral-900 text-white text-xs font-medium hover:bg-neutral-700 transition"
                        >
                          {o.packStatus === "in_progress"
                            ? t(locale, "shipping.continue_pack")
                            : t(locale, "shipping.start_pack")}
                          <ArrowRight size={14} />
                        </Link>
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
        </>
      )}
    </div>
  );
}
