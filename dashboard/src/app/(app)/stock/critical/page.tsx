import { requireProfile } from "@/lib/auth";
import { t, type Locale } from "@/lib/i18n";
import { readDashboardAlerts, readTopseller, enrichAlertsWithTier } from "@/lib/stock-sheets";
import { fetchOrderIdByName } from "@/lib/order-name-map";
import { filterArchivedFromStock } from "@/lib/filter-archived-orders";
import AlertsClient from "../alerts-client";

export const revalidate = 120;

export default async function CriticalStockPage() {
  const profile = await requireProfile();
  if (!profile.is_admin) return <div className="p-8 text-neutral-500">Nur für Admins.</div>;
  const locale = (profile.language ?? "de") as Locale;

  const [{ kritisch, lastUpdated }, { sections: topseller }, orderIdByName] = await Promise.all([
    readDashboardAlerts(),
    readTopseller(),
    fetchOrderIdByName(),
  ]);

  const enriched = enrichAlertsWithTier(kritisch, topseller);
  const data = filterArchivedFromStock(enriched, orderIdByName);

  return (
    <AlertsClient
      data={data}
      title={t(locale, "stock.title.critical")}
      subtitle={t(locale, "stock.subtitle.critical")}
      mode="critical"
      lastUpdated={lastUpdated}
      orderIdByName={orderIdByName}
    />
  );
}
