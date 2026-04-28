import { requireProfile } from "@/lib/auth";
import { t, type Locale } from "@/lib/i18n";
import { readTopseller } from "@/lib/stock-sheets";
import { fetchOrderIdByName } from "@/lib/order-name-map";
import { filterArchivedFromTopseller } from "@/lib/filter-archived-orders";
import TopsellerClient from "../topseller-client";

export const revalidate = 120;

export default async function TopsellerRussianPage() {
  const profile = await requireProfile();
  if (!profile.is_admin) return <div className="p-8 text-neutral-500">Nur für Admins.</div>;
  const locale = (profile.language ?? "de") as Locale;

  const [{ sections: all, lastUpdated }, orderIdByName] = await Promise.all([
    readTopseller(),
    fetchOrderIdByName(),
  ]);
  const sections = filterArchivedFromTopseller(
    all.filter((s) => s.quality === "Russisch Glatt"),
    orderIdByName,
  );

  return (
    <TopsellerClient
      sections={sections}
      title={`${t(locale, "stock.title.topseller")} — Russisch Glatt`}
      subtitle="Ranking nach Verkaufsvolumen (Amanda)"
      lastUpdated={lastUpdated}
    />
  );
}
