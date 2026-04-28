import { requireProfile } from "@/lib/auth";
import { t, type Locale } from "@/lib/i18n";
import { readDashboardAlerts } from "@/lib/stock-sheets";
import { fetchOrderIdByName } from "@/lib/order-name-map";
import { filterArchivedFromStock } from "@/lib/filter-archived-orders";
import AlertsClient from "../../alerts-client";

export const revalidate = 120;

export default async function CriticalUzbekPage() {
  const profile = await requireProfile();
  if (!profile.is_admin) return <div className="p-8 text-neutral-500">Nur für Admins.</div>;
  const locale = (profile.language ?? "de") as Locale;
  const [{ kritisch, lastUpdated }, orderIdByName] = await Promise.all([
    readDashboardAlerts(),
    fetchOrderIdByName(),
  ]);
  const data = filterArchivedFromStock(
    kritisch.filter((d) => d.sheetKey === "wellig"),
    orderIdByName,
  );
  return (
    <AlertsClient
      data={data}
      title={`${t(locale, "stock.title.critical")} — Usbekisch Wellig`}
      subtitle="Produkte mit niedrigem Bestand (China/Eyfel)"
      mode="critical"
      lastUpdated={lastUpdated}
      orderIdByName={orderIdByName}
    />
  );
}
