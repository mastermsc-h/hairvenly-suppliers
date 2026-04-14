import { requireProfile } from "@/lib/auth";
import { t, type Locale } from "@/lib/i18n";
import { readDashboardAlerts } from "@/lib/stock-sheets";
import AlertsClient from "../../alerts-client";

export const revalidate = 120;

export default async function CriticalRussianPage() {
  const profile = await requireProfile();
  if (!profile.is_admin) return <div className="p-8 text-neutral-500">Nur für Admins.</div>;
  const locale = (profile.language ?? "de") as Locale;
  const { kritisch, lastUpdated } = await readDashboardAlerts();
  return (
    <AlertsClient
      data={kritisch.filter((d) => d.sheetKey === "glatt")}
      title={`${t(locale, "stock.title.critical")} — Russisch Glatt`}
      subtitle="Produkte mit niedrigem Bestand (Amanda)"
      mode="critical"
      lastUpdated={lastUpdated}
    />
  );
}
