import { requireProfile } from "@/lib/auth";
import { t, type Locale } from "@/lib/i18n";
import { readTopseller } from "@/lib/stock-sheets";
import { fetchOrderIdByName } from "@/lib/order-name-map";
import { filterArchivedFromTopseller } from "@/lib/filter-archived-orders";
import TopsellerClient from "./topseller-client";

export const revalidate = 120;

export default async function TopsellerPage() {
  const profile = await requireProfile();
  if (!profile.is_admin) return <div className="p-8 text-neutral-500">Nur für Admins.</div>;
  const locale = (profile.language ?? "de") as Locale;

  const [{ sections, lastUpdated }, orderIdByName] = await Promise.all([
    readTopseller(),
    fetchOrderIdByName(),
  ]);

  const filtered = filterArchivedFromTopseller(sections, orderIdByName);

  return (
    <TopsellerClient
      sections={filtered}
      title={t(locale, "stock.title.topseller")}
      subtitle={t(locale, "stock.subtitle.topseller")}
      lastUpdated={lastUpdated}
    />
  );
}
