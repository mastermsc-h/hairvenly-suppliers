import { requireProfile } from "@/lib/auth";
import { t, type Locale } from "@/lib/i18n";
import { readDashboardAlerts } from "@/lib/stock-sheets";
import AlertsClient from "../alerts-client";

export const revalidate = 120;

export default async function ZeroStockPage() {
  const profile = await requireProfile();
  if (!profile.is_admin) return <div className="p-8 text-neutral-500">Nur für Admins.</div>;
  const locale = (profile.language ?? "de") as Locale;

  const { nullbestand, lastUpdated } = await readDashboardAlerts();

  return (
    <AlertsClient
      data={nullbestand}
      title={t(locale, "stock.title.zero")}
      subtitle={t(locale, "stock.subtitle.zero")}
      mode="zero"
      lastUpdated={lastUpdated}
    />
  );
}
