import { requireProfile, hasFeature } from "@/lib/auth";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BarChart3, Users, Camera, AlertTriangle, RotateCcw, Clock, Package2 } from "lucide-react";
import StatsChart from "./stats-chart";
import ResetStatsButton from "./reset-button";
import Link from "next/link";
import { classifyItem, type ItemKind } from "@/lib/item-classify";
import { lookupTitlesByBarcodes } from "@/lib/shopify";

export const dynamic = "force-dynamic";

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return startOfDay(d);
}

export default async function StatsPage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string; extSort?: string; misSort?: string }>;
}) {
  const profile = await requireProfile();
  if (!hasFeature(profile, "shipping")) redirect("/");
  const sp = await searchParams;
  const days = Math.max(1, Math.min(365, parseInt(sp.days ?? "30", 10) || 30));
  // Sortierung der Detail-Tabellen per URL (bleibt beim Neuladen, kein Client-JS):
  // "count" = häufigste zuerst (Standard), "last" = zuletzt passiert zuerst.
  type SortKey = "count" | "last";
  const extSort: SortKey = sp.extSort === "last" ? "last" : "count";
  const misSort: SortKey = sp.misSort === "last" ? "last" : "count";
  const sortHref = (table: "ext" | "mis", key: SortKey) => {
    const q = new URLSearchParams({ days: String(days) });
    const e = table === "ext" ? key : extSort;
    const m = table === "mis" ? key : misSort;
    if (e !== "count") q.set("extSort", e);
    if (m !== "count") q.set("misSort", m);
    return `/pack/stats?${q.toString()}#${table === "ext" ? "manuell-extensions" : "fehlscans"}`;
  };

  const supabase = await createClient();
  const fromIso = daysAgo(days).toISOString();

  // Sessions im Zeitraum (verified + shipped als "fertig gepackt")
  const { data: sessions } = await supabase
    .from("pack_sessions")
    .select("id, status, started_at, finished_at, packed_by, profiles:packed_by(display_name, username)")
    .in("status", ["verified", "shipped"])
    .gte("finished_at", fromIso);

  // Scans im Zeitraum (alle Status) — PAGINIERT: Supabase liefert pro Abfrage
  // max. 1000 Zeilen. Vorher wurden bei längeren Zeiträumen (z.B. 365 Tage)
  // alle Kennzahlen dieser Seite still abgeschnitten.
  type ScanRow = {
    status: string;
    scan_method: string;
    scanned_barcode: string;
    matched_title: string | null;
    scanned_at: string;
    profiles: { display_name: string | null; username: string | null } | null;
    pack_sessions: { order_name: string } | null;
  };
  const scans: ScanRow[] = [];
  for (let from = 0; ; from += 1000) {
    const { data: page } = await supabase
      .from("pack_scans")
      .select(
        "status, scan_method, scanned_barcode, matched_title, scanned_at, profiles:scanned_by(display_name, username), pack_sessions:session_id(order_name)",
      )
      .gte("scanned_at", fromIso)
      .order("scanned_at", { ascending: true })
      .range(from, from + 999);
    const rows = (page ?? []) as unknown as ScanRow[];
    scans.push(...rows);
    if (rows.length < 1000) break;
  }

  const totalSessions = sessions?.length ?? 0;
  const totalScans = scans?.length ?? 0;
  const matchScans = (scans ?? []).filter((s) => s.status === "match").length;
  const mismatchScans = (scans ?? []).filter((s) => s.status === "mismatch").length;
  const overflowScans = (scans ?? []).filter((s) => s.status === "overflow").length;
  const resetScans = (scans ?? []).filter((s) => s.status === "reset").length;
  const manualConfirms = (scans ?? []).filter((s) => s.scan_method === "manual" && s.status === "match").length;

  // Pack-Zeit pro Session (in Sekunden)
  const packTimes: number[] = [];
  for (const s of sessions ?? []) {
    if (s.started_at && s.finished_at) {
      const ms = new Date(s.finished_at).getTime() - new Date(s.started_at).getTime();
      if (ms > 0 && ms < 1000 * 60 * 60 * 6) packTimes.push(Math.round(ms / 1000));
    }
  }
  packTimes.sort((a, b) => a - b);
  const avgPackSec = packTimes.length > 0 ? Math.round(packTimes.reduce((a, b) => a + b, 0) / packTimes.length) : 0;
  const medPackSec = packTimes.length > 0 ? packTimes[Math.floor(packTimes.length / 2)] : 0;

  // Pro Mitarbeiter: Anzahl + Avg Pack-Zeit
  const byOperator = new Map<string, { count: number; totalSec: number; samples: number }>();
  for (const s of sessions ?? []) {
    const profileRel = (s as { profiles?: { display_name?: string | null; username?: string | null } | null }).profiles;
    const name = profileRel?.display_name || profileRel?.username || "—";
    const cur = byOperator.get(name) ?? { count: 0, totalSec: 0, samples: 0 };
    cur.count++;
    if (s.started_at && s.finished_at) {
      const ms = new Date(s.finished_at).getTime() - new Date(s.started_at).getTime();
      if (ms > 0 && ms < 1000 * 60 * 60 * 6) {
        cur.totalSec += Math.round(ms / 1000);
        cur.samples++;
      }
    }
    byOperator.set(name, cur);
  }
  const operatorRows = Array.from(byOperator.entries())
    .map(([name, v]) => ({
      name,
      count: v.count,
      avgSec: v.samples > 0 ? Math.round(v.totalSec / v.samples) : null,
    }))
    .sort((a, b) => b.count - a.count);

  // Häufigste Mismatches (was wird oft falsch gegriffen)
  // Fehlscans: In der DB steht nur der GESCANNTE Barcode (er passte zu keiner
  // Position, daher kein matched_title). Früher wurde nach matched_title
  // gruppiert → alles landete in EINER Zeile "(unbekannter Barcode)".
  // Jetzt pro Barcode sammeln und den Artikel in Shopify nachschlagen.
  const mismatchByCode = new Map<
    string,
    { count: number; last: string; people: Map<string, number>; orders: Set<string> }
  >();
  for (const s of scans) {
    if (s.status !== "mismatch") continue;
    const code = (s.scanned_barcode ?? "").trim() || "(leer)";
    const who = s.profiles?.display_name || s.profiles?.username || "—";
    const e = mismatchByCode.get(code) ?? { count: 0, last: s.scanned_at, people: new Map(), orders: new Set() };
    e.count++;
    if (s.scanned_at > e.last) e.last = s.scanned_at;
    e.people.set(who, (e.people.get(who) ?? 0) + 1);
    if (s.pack_sessions?.order_name) e.orders.add(s.pack_sessions.order_name);
    mismatchByCode.set(code, e);
  }
  let codeTitles: Record<string, { productTitle: string; variantTitle: string | null }> = {};
  try {
    codeTitles = await lookupTitlesByBarcodes(Array.from(mismatchByCode.keys()));
  } catch {
    // Shopify nicht erreichbar → Seite trotzdem anzeigen, nur ohne Namen
  }
  const mismatchLabel = (code: string): { name: string; known: boolean; hint: string | null } => {
    const t = codeTitles[code];
    if (t) return { name: t.variantTitle ? `${t.productTitle} · ${t.variantTitle}` : t.productTitle, known: true, hint: null };
    // Hairvenly-Barcodes sind 8-stellig — kürzer = abgebrochener/vertippter Scan
    if (!/^\d{8,}$/.test(code)) return { name: `„${code}"`, known: false, hint: "abgeschnitten / Tippfehler" };
    return { name: `„${code}"`, known: false, hint: "Barcode nicht in Shopify" };
  };
  const mismatchRows = Array.from(mismatchByCode.entries())
    .map(([code, e]) => ({ code, ...e, ...mismatchLabel(code) }))
    .sort((a, b) => (misSort === "last" ? b.last.localeCompare(a.last) : b.count - a.count || b.last.localeCompare(a.last)));
  // Top-10-Karte bleibt nach Häufigkeit, unabhängig von der Tabellen-Sortierung
  const mismatchByCount = [...mismatchRows].sort((a, b) => b.count - a.count);
  const mismatchByTitle = new Map<string, number>();
  for (const r of mismatchByCount) mismatchByTitle.set(r.name, (mismatchByTitle.get(r.name) ?? 0) + r.count);
  const topMismatches = Array.from(mismatchByTitle.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10);

  // Manuelle Bestätigungen nach Art (zentrale Regel aus item-classify.ts).
  // "manual" umfasst den Knopf "manuell bestätigen" UND den Zubehör-Code.
  // Bei Extensions ist das kritisch: der Barcode-Scan prüft Farbe/Länge/
  // Methode — manuelles Bestätigen umgeht genau diese Kontrolle.
  const manualByKind: Record<ItemKind, number> = { extension: 0, accessory: 0, care: 0, digital: 0 };
  const manualExt = new Map<
    string,
    { count: number; last: string; people: Map<string, number>; orders: Set<string> }
  >();
  const manualExtByPerson = new Map<string, number>();
  for (const s of scans) {
    if (s.scan_method !== "manual" || s.status !== "match") continue;
    const title = s.matched_title ?? "(ohne Titel)";
    const kind = classifyItem({ title });
    manualByKind[kind]++;
    if (kind !== "extension") continue;
    const who = s.profiles?.display_name || s.profiles?.username || "—";
    manualExtByPerson.set(who, (manualExtByPerson.get(who) ?? 0) + 1);
    const e = manualExt.get(title) ?? { count: 0, last: s.scanned_at, people: new Map(), orders: new Set() };
    e.count++;
    if (s.scanned_at > e.last) e.last = s.scanned_at;
    e.people.set(who, (e.people.get(who) ?? 0) + 1);
    if (s.pack_sessions?.order_name) e.orders.add(s.pack_sessions.order_name);
    manualExt.set(title, e);
  }
  const manualExtRows = Array.from(manualExt.entries()).sort((a, b) =>
    extSort === "last" ? b[1].last.localeCompare(a[1].last) : b[1].count - a[1].count || b[1].last.localeCompare(a[1].last),
  );
  const manualExtPeople = Array.from(manualExtByPerson.entries()).sort((a, b) => b[1] - a[1]);

  // Bestellungen pro Tag (für Chart)
  const dayBuckets = new Map<string, number>();
  for (let i = 0; i < days; i++) {
    const d = daysAgo(days - 1 - i);
    dayBuckets.set(d.toISOString().slice(0, 10), 0);
  }
  for (const s of sessions ?? []) {
    if (!s.finished_at) continue;
    const k = s.finished_at.slice(0, 10);
    if (dayBuckets.has(k)) dayBuckets.set(k, (dayBuckets.get(k) ?? 0) + 1);
  }
  const chartData = Array.from(dayBuckets.entries()).map(([date, count]) => ({ date, count }));

  function fmtSec(sec: number): string {
    if (sec === 0) return "—";
    if (sec < 60) return `${sec}s`;
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}m ${s}s`;
  }

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-7xl">
      <header className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900 flex items-center gap-2">
            <BarChart3 size={24} /> Versand-Statistik
          </h1>
          <p className="text-sm text-neutral-500 mt-1">Pack-Performance der letzten {days} Tage</p>
        </div>
        <div className="flex items-center gap-1.5 flex-wrap">
          {[7, 30, 90, 365].map((d) => (
            <a
              key={d}
              href={`/pack/stats?days=${d}${extSort !== "count" ? `&extSort=${extSort}` : ""}${misSort !== "count" ? `&misSort=${misSort}` : ""}`}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${
                d === days
                  ? "bg-neutral-900 text-white border-neutral-900"
                  : "bg-white border-neutral-300 hover:bg-neutral-50"
              }`}
            >
              {d === 365 ? "1 Jahr" : `${d} Tage`}
            </a>
          ))}
          {profile.role === "admin" && <ResetStatsButton />}
        </div>
      </header>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4">
        <KPI label="Bestellungen verpackt" value={totalSessions.toString()} icon={<Package2 size={18} />} />
        <KPI label="Ø Pack-Zeit" value={fmtSec(avgPackSec)} sub={`Median ${fmtSec(medPackSec)}`} icon={<Clock size={18} />} />
        <KPI
          label="Fehlscan-Rate"
          value={totalScans > 0 ? `${((mismatchScans / totalScans) * 100).toFixed(1)}%` : "—"}
          sub={`${mismatchScans} von ${totalScans} Scans`}
          icon={<AlertTriangle size={18} className="text-red-500" />}
        />
        <KPI
          label="Manuell bestätigt"
          value={matchScans > 0 ? `${((manualConfirms / matchScans) * 100).toFixed(0)}%` : "—"}
          sub={`${manualConfirms} von ${matchScans} Matches · davon ${manualByKind.extension} Extensions`}
          icon={<Camera size={18} className="text-amber-500" />}
        />
      </div>

      {/* Chart */}
      <div className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm">
        <div className="text-xs font-medium text-neutral-600 uppercase tracking-wide mb-3">
          Bestellungen pro Tag
        </div>
        <StatsChart data={chartData} />
      </div>

      {/* Pro Mitarbeiter */}
      <div className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm">
        <div className="text-xs font-medium text-neutral-600 uppercase tracking-wide mb-3 flex items-center gap-1">
          <Users size={14} /> Pack-Performance pro Mitarbeiter
        </div>
        {operatorRows.length === 0 ? (
          <div className="text-sm text-neutral-400 italic">Keine Daten im Zeitraum.</div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-neutral-500 border-b border-neutral-200">
                <th className="text-left py-2 font-medium">Bearbeiter</th>
                <th className="text-right py-2 font-medium">Bestellungen</th>
                <th className="text-right py-2 font-medium">Ø Pack-Zeit</th>
              </tr>
            </thead>
            <tbody>
              {operatorRows.map((r, idx) => (
                <tr key={r.name} className={`border-b border-neutral-100 ${idx % 2 === 1 ? "bg-neutral-50/40" : ""}`}>
                  <td className="py-2 font-medium text-neutral-900">{r.name}</td>
                  <td className="py-2 text-right text-neutral-700">{r.count}</td>
                  <td className="py-2 text-right text-neutral-700">{r.avgSec ? fmtSec(r.avgSec) : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Häufigste Fehlscans */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm">
          <div className="text-xs font-medium text-neutral-600 uppercase tracking-wide mb-3 flex items-center gap-1">
            <AlertTriangle size={14} className="text-red-500" /> Häufigste Fehlscans (Top 10)
          </div>
          {topMismatches.length === 0 ? (
            <div className="text-sm text-neutral-400 italic">Keine Fehlscans im Zeitraum 🎉</div>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {topMismatches.map(([title, count]) => (
                <li key={title} className="flex items-center justify-between gap-2 py-1.5 border-b border-neutral-100 last:border-0">
                  <span className="text-neutral-700 truncate flex-1">{title}</span>
                  <span className="text-red-700 font-bold shrink-0">{count}×</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm">
          <div className="text-xs font-medium text-neutral-600 uppercase tracking-wide mb-3">
            Zusammenfassung Scans
          </div>
          <div className="space-y-2 text-sm">
            <Row label="Total Scans" value={totalScans} />
            <Row label="✓ Korrekt (Match)" value={matchScans} cls="text-emerald-700" />
            <Row label="⚠ Falscher Artikel (Mismatch)" value={mismatchScans} cls="text-red-700" />
            <Row label="Überzählig (Overflow)" value={overflowScans} cls="text-amber-700" />
            <Row label="Zurückgesetzt (Reset)" value={resetScans} cls="text-neutral-500" />
            <div className="border-t border-neutral-200 pt-2 mt-2">
              <Row
                label="Manuell bestätigt"
                value={manualConfirms}
                cls="text-amber-700"
                icon={<RotateCcw size={12} />}
              />
              <div className="mt-1.5 ml-4 pl-3 border-l-2 border-neutral-200 space-y-1 text-xs">
                <Row label="davon Extensions (Barcode umgangen)" value={manualByKind.extension} cls="text-red-700 font-semibold" />
                <Row label="davon Zubehör (inkl. Zubehör-Code)" value={manualByKind.accessory} cls="text-neutral-600" />
                <Row label="davon Pflege" value={manualByKind.care} cls="text-neutral-600" />
                {manualByKind.digital > 0 && (
                  <Row label="davon Digital/Schulung" value={manualByKind.digital} cls="text-neutral-600" />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Fehlscans im Detail: welcher Artikel wurde fälschlich gescannt, von wem,
          in welcher Bestellung. Barcodes in Shopify nachgeschlagen. */}
      <div id="fehlscans" className="scroll-mt-4 bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
          <div className="text-xs font-medium text-neutral-600 uppercase tracking-wide flex items-center gap-1">
            <AlertTriangle size={14} className="text-red-500" /> Fehlscans im Detail (falscher Artikel)
          </div>
          <div className="text-sm">
            <span className="font-bold text-red-700">{mismatchScans}</span>
            <span className="text-neutral-500"> Fehlscans · {mismatchRows.length} verschiedene Codes</span>
          </div>
        </div>
        <p className="text-xs text-neutral-500 mb-3 leading-relaxed">
          Gescannt wurde ein Artikel, der in dieser Bestellung nicht vorkommt. Er wurde nicht gezählt — das System hat
          den Fehlgriff abgefangen. Häufen sich einzelne Artikel, liegen sie vermutlich verwechselbar nebeneinander im Lager.
        </p>
        {mismatchRows.length === 0 ? (
          <div className="text-sm text-emerald-700">Keine Fehlscans im Zeitraum. 🎉</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-neutral-500 border-b border-neutral-200">
                  <th className="text-left py-2 font-medium">Gescannter Artikel</th>
                  <th className="text-right py-2 font-medium">
                    <SortLink href={sortHref("mis", "count")} active={misSort === "count"}>Anzahl</SortLink>
                  </th>
                  <th className="text-left py-2 pl-4 font-medium">Wer</th>
                  <th className="text-left py-2 pl-4 font-medium">
                    <SortLink href={sortHref("mis", "last")} active={misSort === "last"}>Zuletzt</SortLink>
                  </th>
                  <th className="text-left py-2 pl-4 font-medium">In Bestellung</th>
                </tr>
              </thead>
              <tbody>
                {mismatchRows.map((r, idx) => (
                  <tr key={r.code} className={`border-b border-neutral-100 align-top ${idx % 2 === 1 ? "bg-neutral-50/40" : ""}`}>
                    <td className="py-2 pr-2">
                      <div className={r.known ? "text-neutral-800" : "text-neutral-500"}>{r.name}</div>
                      <div className="text-[11px] text-neutral-400 font-mono">
                        {r.known ? `EAN ${r.code}` : r.hint}
                      </div>
                    </td>
                    <td className="py-2 text-right font-bold text-red-700">{r.count}</td>
                    <td className="py-2 pl-4 text-neutral-700 whitespace-nowrap">
                      {Array.from(r.people.entries())
                        .sort((a, b) => b[1] - a[1])
                        .map(([w, n]) => `${w} (${n})`)
                        .join(", ")}
                    </td>
                    <td className="py-2 pl-4 text-neutral-500 whitespace-nowrap">
                      {new Date(r.last).toLocaleDateString("de-DE", {
                        day: "2-digit",
                        month: "2-digit",
                        year: "2-digit",
                        timeZone: "Europe/Berlin",
                      })}
                    </td>
                    <td className="py-2 pl-4">
                      <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                        {Array.from(r.orders)
                          .slice(0, 6)
                          .map((o) => (
                            <Link
                              key={o}
                              href={`/pack/archive/${o.replace(/^#/, "")}`}
                              className="text-blue-700 hover:underline text-xs"
                            >
                              {o}
                            </Link>
                          ))}
                        {r.orders.size > 6 && <span className="text-xs text-neutral-400">+{r.orders.size - 6}</span>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Manuell bestätigte Extensions — hier wurde die Barcode-Kontrolle
          (Farbe/Länge/Methode) umgangen. Pro Produkt: wie oft, wer, wann, wo. */}
      <div id="manuell-extensions" className="scroll-mt-4 bg-white rounded-2xl border border-neutral-200 p-4 md:p-6 shadow-sm">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-1">
          <div className="text-xs font-medium text-neutral-600 uppercase tracking-wide flex items-center gap-1">
            <AlertTriangle size={14} className="text-red-500" /> Manuell bestätigte Extensions
          </div>
          <div className="text-sm">
            <span className="font-bold text-red-700">{manualByKind.extension}</span>
            <span className="text-neutral-500"> von {manualConfirms} manuellen Bestätigungen</span>
          </div>
        </div>
        <p className="text-xs text-neutral-500 mb-3 leading-relaxed">
          Bei Extensions prüft der Barcode-Scan Farbe, Länge und Methode. Diese Positionen wurden per Klick
          bestätigt — die Prüfung wurde also umgangen. Zubehör und Pflege (inkl. Zubehör-Code) sind hier
          bewusst nicht enthalten.
        </p>

        {manualExtRows.length === 0 ? (
          <div className="text-sm text-emerald-700">Im Zeitraum wurden alle Extensions per Barcode bestätigt. 🎉</div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 mb-4">
              {manualExtPeople.map(([who, n]) => (
                <span
                  key={who}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-50 border border-red-200 text-xs"
                >
                  <span className="font-medium text-neutral-800">{who}</span>
                  <span className="font-bold text-red-700">{n}×</span>
                </span>
              ))}
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs uppercase tracking-wide text-neutral-500 border-b border-neutral-200">
                    <th className="text-left py-2 font-medium">Produkt</th>
                    <th className="text-right py-2 font-medium">
                    <SortLink href={sortHref("ext", "count")} active={extSort === "count"}>Anzahl</SortLink>
                  </th>
                    <th className="text-left py-2 pl-4 font-medium">Wer</th>
                    <th className="text-left py-2 pl-4 font-medium">
                    <SortLink href={sortHref("ext", "last")} active={extSort === "last"}>Zuletzt</SortLink>
                  </th>
                    <th className="text-left py-2 pl-4 font-medium">Bestellungen</th>
                  </tr>
                </thead>
                <tbody>
                  {manualExtRows.map(([title, e], idx) => (
                    <tr
                      key={title}
                      className={`border-b border-neutral-100 align-top ${idx % 2 === 1 ? "bg-neutral-50/40" : ""}`}
                    >
                      <td className="py-2 pr-2 text-neutral-800">{title}</td>
                      <td className="py-2 text-right font-bold text-red-700">{e.count}</td>
                      <td className="py-2 pl-4 text-neutral-700 whitespace-nowrap">
                        {Array.from(e.people.entries())
                          .sort((a, b) => b[1] - a[1])
                          .map(([w, n]) => `${w} (${n})`)
                          .join(", ")}
                      </td>
                      <td className="py-2 pl-4 text-neutral-500 whitespace-nowrap">
                        {new Date(e.last).toLocaleDateString("de-DE", {
                          day: "2-digit",
                          month: "2-digit",
                          year: "2-digit",
                          timeZone: "Europe/Berlin",
                        })}
                      </td>
                      <td className="py-2 pl-4">
                        <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                          {Array.from(e.orders)
                            .slice(0, 6)
                            .map((o) => (
                              <Link
                                key={o}
                                href={`/pack/archive/${o.replace(/^#/, "")}`}
                                className="text-blue-700 hover:underline text-xs"
                              >
                                {o}
                              </Link>
                            ))}
                          {e.orders.size > 6 && (
                            <span className="text-xs text-neutral-400">+{e.orders.size - 6}</span>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SortLink({ href, active, children }: { href: string; active: boolean; children: React.ReactNode }) {
  return (
    <a
      href={href}
      className={`inline-flex items-center gap-1 hover:text-neutral-900 ${active ? "text-neutral-900 font-semibold" : ""}`}
      title="Sortieren"
    >
      {children}
      <span className={active ? "" : "text-neutral-300"}>↓</span>
    </a>
  );
}

function KPI({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm">
      <div className="flex items-start justify-between mb-1">
        <div className="text-xs font-medium text-neutral-600 uppercase tracking-wide">{label}</div>
        {icon && <div className="text-neutral-400">{icon}</div>}
      </div>
      <div className="text-2xl font-bold text-neutral-900 mt-1">{value}</div>
      {sub && <div className="text-xs text-neutral-500 mt-1">{sub}</div>}
    </div>
  );
}

function Row({
  label,
  value,
  cls,
  icon,
}: {
  label: string;
  value: number;
  cls?: string;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className={`flex items-center gap-1 ${cls ?? "text-neutral-700"}`}>
        {icon}
        {label}
      </span>
      <span className={`font-semibold ${cls ?? "text-neutral-900"}`}>{value}</span>
    </div>
  );
}
