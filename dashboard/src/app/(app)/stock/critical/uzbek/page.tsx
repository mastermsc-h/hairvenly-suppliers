import { requireProfile } from "@/lib/auth";
import { t, type Locale } from "@/lib/i18n";
import { toClientOrderMeta } from "@/lib/order-name-map";
import { loadCriticalStock } from "@/lib/stock-critical";
import AlertsClient from "../../alerts-client";

export const revalidate = 120;

export default async function CriticalUzbekPage() {
  const profile = await requireProfile();
  if (!profile.is_admin) return <div className="p-8 text-neutral-500">Nur für Admins.</div>;
  const locale = (profile.language ?? "de") as Locale;

  const { items, lastUpdated, orderIdByName } = await loadCriticalStock();
  const data = items.filter((d) => d.sheetKey === "wellig");

  return (
    <AlertsClient
      data={data}
      title={`${t(locale, "stock.title.critical")} — Usbekisch Wellig`}
      subtitle={`${t(locale, "stock.subtitle.critical")} · China/Eyfel`}
      mode="critical"
      lastUpdated={lastUpdated}
      orderIdByName={toClientOrderMeta(orderIdByName)}
    />
  );
}
