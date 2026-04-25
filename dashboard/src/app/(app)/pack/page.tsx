import { requireProfile, hasFeature } from "@/lib/auth";
import { redirect } from "next/navigation";
import { t, type Locale } from "@/lib/i18n";
import { fetchUnfulfilledPaidOrders, fetchRecentPaidOrders, type PackOrder } from "@/lib/shopify";
import { createClient } from "@/lib/supabase/server";
import { ensureOrderPackQr } from "@/lib/actions/pack";
import PackList from "./pack-list";

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
  try {
    // Pack-Liste: nur unfulfilled+paid (FIFO)
    // QR-Backfill: alle paid orders der letzten 30 Tage (auch bereits versendete,
    // damit auch nachträgliche Lieferschein-Drucke einen QR haben).
    const [unfulfilled, recentPaid] = await Promise.all([
      fetchUnfulfilledPaidOrders(100),
      fetchRecentPaidOrders(30, 250).catch(() => [] as PackOrder[]),
    ]);
    orders = unfulfilled;

    // QR für ALLE recent paid orders ohne metafield generieren (parallel)
    const ordersWithoutQr = recentPaid.filter((o) => !o.hasPackQr);
    if (ordersWithoutQr.length > 0) {
      await Promise.allSettled(
        ordersWithoutQr.map((o) => ensureOrderPackQr(o.name, o.id)),
      );
    }
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

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-7xl">
      <header>
        <h1 className="text-2xl font-semibold text-neutral-900">
          {t(locale, "shipping.title")}
        </h1>
        <p className="text-sm text-neutral-500 mt-1">{t(locale, "shipping.subtitle")}</p>
      </header>

      {errorMessage ? (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-2xl p-4 text-sm">
          {errorMessage}
        </div>
      ) : (
        <PackList orders={ordersWithStatus} locale={locale} />
      )}
    </div>
  );
}
