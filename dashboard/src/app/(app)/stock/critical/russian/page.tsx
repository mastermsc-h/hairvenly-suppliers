import { requireProfile } from "@/lib/auth";
import { t, type Locale } from "@/lib/i18n";
import { toClientOrderMeta } from "@/lib/order-name-map";
import { loadCriticalStock } from "@/lib/stock-critical";
import AlertsClient from "../../alerts-client";

export const revalidate = 120;

export default async function CriticalRussianPage() {
  const profile = await requireProfile();
  if (!profile.is_admin) return <div className="p-8 text-neutral-500">Nur für Admins.</div>;
  const locale = (profile.language ?? "de") as Locale;

  const { items, lastUpdated, orderIdByName } = await loadCriticalStock();
  const data = items.filter((d) => d.sheetKey === "glatt");

  return (
    <AlertsClient
      data={data}
      title={`${t(locale, "stock.title.critical")} — Russisch Glatt`}
      subtitle={`${t(locale, "stock.subtitle.critical")} · Amanda`}
      mode="critical"
      lastUpdated={lastUpdated}
      orderIdByName={toClientOrderMeta(orderIdByName)}
    />
  );
}
