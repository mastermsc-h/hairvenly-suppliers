import { requireProfile, hasFeature } from "@/lib/auth";
import { redirect } from "next/navigation";
import { t, type Locale } from "@/lib/i18n";
import { fetchUnfulfilledPaidOrders, type PackOrder } from "@/lib/shopify";
import { createClient } from "@/lib/supabase/server";
import PackList from "./pack-list";
import BackfillButton from "./backfill-button";
import OrderQrScanner from "./order-qr-scanner";

export const dynamic = "force-dynamic";

export interface PackOrderWithStatus extends PackOrder {
  packStatus: "open" | "in_progress" | "verified" | "shipped";
  packedBy: string | null;
  startedAt: string | null;
  finishedAt: string | null;
}

export default async function PackPage() {
  const profile = await requireProfile();
  if (!hasFeature(profile, "shipping")) redirect("/");
  const locale = (profile.language ?? "de") as Locale;

  let orders: PackOrder[] = [];
  let errorMessage: string | null = null;
  let fetchedCount = 0;
  try {
    orders = await fetchUnfulfilledPaidOrders(100);
    fetchedCount = orders.length;
  } catch (e) {
    errorMessage = e instanceof Error ? e.message : String(e);
  }

  // Pack-Status aus Supabase laden und mit Shopify-Orders mergen
  const supabase = await createClient();
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

  const ordersWithStatus: PackOrderWithStatus[] = orders.map((o) => {
    const session = sessionMap.get(o.name);
    return {
      ...o,
      packStatus: (session?.status as PackOrderWithStatus["packStatus"]) ?? "open",
      packedBy: session?.packedBy ?? null,
      startedAt: session?.startedAt ?? null,
      finishedAt: session?.finishedAt ?? null,
    };
  });

  // Anzahl orders ohne QR (von der aktuellen Liste) — Hinweis für Backfill-Button
  const ordersWithoutQrInList = orders.filter((o) => !o.hasPackQr).length;

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
          <OrderQrScanner />
          <BackfillButton />
        </div>
      </header>

      {errorMessage ? (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-2xl p-4 text-sm">
          <div className="font-medium mb-1">Fehler beim Laden:</div>
          <pre className="whitespace-pre-wrap">{errorMessage}</pre>
        </div>
      ) : (
        <PackList orders={ordersWithStatus} locale={locale} />
      )}
    </div>
  );
}
