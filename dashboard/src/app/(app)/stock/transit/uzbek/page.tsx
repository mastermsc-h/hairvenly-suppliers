import { requireProfile } from "@/lib/auth";
import { t, type Locale } from "@/lib/i18n";
import { readDashboardAlerts } from "@/lib/stock-sheets";
import AlertsClient from "../../alerts-client";

export const revalidate = 120;

export default async function TransitUzbekPage() {
  const profile = await requireProfile();
  if (!profile.is_admin) return <div className="p-8 text-neutral-500">Nur für Admins.</div>;
  const locale = (profile.language ?? "de") as Locale;

  const { unterwegs, lastUpdated } = await readDashboardAlerts();

  return (
    <AlertsClient
      data={unterwegs.filter((d) => d.sheetKey === "wellig")}
      title={`${t(locale, "stock.title.transit")} — Usbekisch Wellig`}
      subtitle="Bestellte Ware unterwegs (China/Eyfel)"
      mode="transit"
      lastUpdated={lastUpdated}
    />
  );
}
