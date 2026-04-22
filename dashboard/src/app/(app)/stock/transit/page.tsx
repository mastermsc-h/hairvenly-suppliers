import { requireProfile } from "@/lib/auth";
import { t, type Locale } from "@/lib/i18n";
import { readDashboardAlerts } from "@/lib/stock-sheets";
import { fetchOrderIdByName } from "@/lib/order-name-map";
import AlertsClient from "../alerts-client";

export const revalidate = 120;

export default async function TransitStockPage() {
  const profile = await requireProfile();
  if (!profile.is_admin) return <div className="p-8 text-neutral-500">Nur für Admins.</div>;
  const locale = (profile.language ?? "de") as Locale;

  const [{ unterwegs, lastUpdated }, orderIdByName] = await Promise.all([
    readDashboardAlerts(),
    fetchOrderIdByName(),
  ]);

  return (
    <AlertsClient
      data={unterwegs}
      title={t(locale, "stock.title.transit")}
      subtitle={t(locale, "stock.subtitle.transit")}
      mode="transit"
      lastUpdated={lastUpdated}
      orderIdByName={orderIdByName}
    />
  );
}
