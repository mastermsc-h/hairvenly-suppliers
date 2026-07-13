import { requireProfile, hasFeature } from "@/lib/auth";
import { redirect } from "next/navigation";
import { t, type Locale } from "@/lib/i18n";
import { fetchUnfulfilledPaidOrders, fetchUnfulfilledUnpaidOrders, fetchOrderForPack, type PackOrder } from "@/lib/shopify";
import { createClient } from "@/lib/supabase/server";
import PackList from "./pack-list";
import UnpaidList from "./unpaid-list";
import BackfillButton from "./backfill-button";
import DemoButton from "./demo-button";
import OrderQrScanner from "./order-qr-scanner";
import { CheckCircle2, Clock } from "lucide-react";

export const dynamic = "force-dynamic";

export interface PackOrderWithStatus extends PackOrder {
  packStatus: "open" | "in_progress" | "verified" | "shipped";
  packedBy: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  slipPrintedAt: string | null;
  slipPrintedBy: string | null;
}

export default async function PackPage() {
  const profile = await requireProfile();
  if (!hasFeature(profile, "shipping")) redirect("/");
  const locale = (profile.language ?? "de") as Locale;

  let orders: PackOrder[] = [];
  let unpaidOrders: PackOrder[] = [];
  let errorMessage: string | null = null;
  let fetchedCount = 0;
  try {
    [orders, unpaidOrders] = await Promise.all([
      fetchUnfulfilledPaidOrders(100),
      fetchUnfulfilledUnpaidOrders(250),
    ]);
    fetchedCount = orders.length;
  } catch (e) {
    errorMessage = e instanceof Error ? e.message : String(e);
  }

  // Pack-Status aus Supabase laden und mit Shopify-Orders mergen
  const supabase = await createClient();

  // Reopened-Ausnahmefälle: Sessions die lokal wieder aktiv sind (in_progress/
  // verified), aber in Shopify schon 'fulfilled' → fallen aus der unfulfilled-
  // Query raus. Diese explizit nachladen, damit "erneut bearbeitete"
  // Bestellungen in der Liste sichtbar bleiben.
  try {
    const shopifyNameSet = new Set(orders.map((o) => o.name));
    const reopenCutoff = new Date(Date.now() - 7 * 86_400_000).toISOString();
    const { data: activeSessions } = await supabase
      .from("pack_sessions")
      .select("order_name")
      .in("status", ["in_progress", "verified"])
      .gt("updated_at", reopenCutoff);
    const reopenedNames = (activeSessions ?? [])
      .map((s) => s.order_name)
      .filter((n) => !shopifyNameSet.has(n) && !n.startsWith("#DEMO-"));
    if (reopenedNames.length > 0) {
      const fetched = await Promise.all(
        reopenedNames.map((n) => fetchOrderForPack(n).catch(() => null)),
      );
      for (const o of fetched) if (o) orders.push(o);
    }
  } catch {
    // Reopened-Nachladung ist optional — bei Fehler bleibt die Hauptliste intakt
  }

  const orderNames = orders.map((o) => o.name);
  const { data: sessions } = await supabase
    .from("pack_sessions")
    .select("order_name, status, packed_by, started_at, finished_at, profiles:packed_by(display_name, username)")
    .in("order_name", orderNames.length > 0 ? orderNames : [""]);

  const sessionMap = new Map<string, {
    status: string;
    packedBy: string | null;
    startedAt: string | null;
    finishedAt: string | null;
  }>();
  for (const s of sessions ?? []) {
    const profileRel = (s as { profiles?: { display_name?: string | null; username?: string | null } | null }).profiles;
    sessionMap.set(s.order_name, {
      status: s.status,
      packedBy: profileRel?.display_name || profileRel?.username || null,
      startedAt: s.started_at,
      finishedAt: s.finished_at,
    });
  }

  // Lieferschein-Druck-Status (letzter Druck pro Order)
  const { data: printedSlips } = await supabase
    .from("v_printed_slips_latest")
    .select("order_name, printed_at, printed_by_name")
    .in("order_name", orderNames.length > 0 ? orderNames : [""]);
  const slipMap = new Map<string, { printedAt: string; printedBy: string | null }>();
  for (const p of printedSlips ?? []) {
    slipMap.set(p.order_name, { printedAt: p.printed_at, printedBy: p.printed_by_name });
  }

  const ordersWithStatus: PackOrderWithStatus[] = orders.map((o) => {
    const session = sessionMap.get(o.name);
    const slip = slipMap.get(o.name);
    return {
      ...o,
      packStatus: (session?.status as PackOrderWithStatus["packStatus"]) ?? "open",
      packedBy: session?.packedBy ?? null,
      startedAt: session?.startedAt ?? null,
      finishedAt: session?.finishedAt ?? null,
      slipPrintedAt: slip?.printedAt ?? null,
      slipPrintedBy: slip?.printedBy ?? null,
    };
  });

  // Anzahl orders ohne QR (von der aktuellen Liste) — Hinweis für Backfill-Button
  const ordersWithoutQrInList = orders.filter((o) => !o.hasPackQr).length;

  // Anzahl aktueller unbezahlter (≤14 Tage) — für den Sektions-Chip
  const nowMs = Date.now();
  const unpaidRecentCount = unpaidOrders.filter(
    (o) => Math.floor((nowMs - new Date(o.createdAt).getTime()) / 86_400_000) <= 14,
  ).length;

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-7xl">
      <header className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">
            {t(locale, "shipping.title")}
          </h1>
          <p className="text-sm text-neutral-500 mt-1">{t(locale, "shipping.subtitle")}</p>
          <p className="text-xs text-neutral-400 mt-1">
            Shopify-Fetch: <strong>{fetchedCount}</strong> Bestellungen geladen
            {ordersWithoutQrInList > 0 ? ` · ${ordersWithoutQrInList} ohne QR-Metafield` : " · alle haben QR"}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {fetchedCount > 0 && (
            <a
              href="/pack/print-all"
              target="_blank"
              rel="noopener"
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-neutral-300 text-neutral-900 text-sm font-medium hover:bg-neutral-50 transition"
              title="Druckansicht aller offenen Lieferscheine — automatisches Druckfenster"
            >
              🧾 Alle Lieferscheine drucken
            </a>
          )}
          <a
            href="/pack/zubehoer-code"
            target="_blank"
            rel="noopener"
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white border border-neutral-300 text-neutral-900 text-sm font-medium hover:bg-neutral-50 transition"
            title="Universellen Zubehör-Scan-Code drucken (für Zubehör/Pflege/Schulungen)"
          >
            🏷️ Zubehör-Code
          </a>
          <OrderQrScanner />
          <BackfillButton />
          <DemoButton />
        </div>
      </header>

      {errorMessage ? (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-2xl p-4 text-sm">
          <div className="font-medium mb-1">Fehler beim Laden:</div>
          <pre className="whitespace-pre-wrap">{errorMessage}</pre>
        </div>
      ) : (
        <>
          {/* Sektion 1: bezahlt & versandbereit */}
          <section className="space-y-3">
            <div className="flex items-center gap-2">
              <CheckCircle2 size={18} className="text-emerald-600" />
              <h2 className="text-lg font-semibold text-neutral-900">
                Bezahlt &amp; versandbereit
              </h2>
              <span className="text-xs font-medium text-neutral-500 bg-neutral-100 rounded-full px-2 py-0.5">
                {ordersWithStatus.length}
              </span>
            </div>
            <p className="text-sm text-neutral-500 -mt-1">
              Diese Bestellungen sind <strong>bezahlt</strong>, aber noch <strong>nicht versendet</strong> — sie können jetzt gepackt werden.
            </p>
            <PackList orders={ordersWithStatus} locale={locale} />
          </section>

          {/* Sektion 2: noch nicht bezahlt */}
          <section className="space-y-3 pt-4">
            <div className="flex items-center gap-2">
              <Clock size={18} className="text-amber-500" />
              <h2 className="text-lg font-semibold text-neutral-900">
                Noch nicht bezahlt
              </h2>
              <span className="text-xs font-medium text-neutral-500 bg-neutral-100 rounded-full px-2 py-0.5">
                {unpaidRecentCount} aktuell
              </span>
            </div>
            <p className="text-sm text-neutral-500 -mt-1">
              Offene Bestellungen die noch <strong>auf Zahlung warten</strong> (z.B. Vorkasse) — noch nicht versandbereit. Ältere als 14 Tage sind eingeklappt; überfällige farblich markiert.
            </p>
            <UnpaidList orders={unpaidOrders} locale={locale} />
          </section>
        </>
      )}
    </div>
  );
}
