import { requireFeature } from "@/lib/auth";
import { type Locale } from "@/lib/i18n";
import { fetchFinanzJahr, fetchSalonUmsatzJahr, fetchShopifyUmsatzJahr, fetchStaffGehaelter, fetchStaffGehaltsVerlauf } from "@/lib/actions/finanzen";
import { fetchSteuerPosten } from "@/lib/actions/steuer";
import FinanceOverview from "./finance-overview";

export default async function FinanceOverviewPage() {
  const profile = await requireFeature("finances");
  const locale = (profile.language ?? "de") as Locale;
  const now = new Date();
  const jahr = now.getFullYear();
  const [rows, posten, shopify, salon, staffEmployees, staffVerlauf] = await Promise.all([
    fetchFinanzJahr(jahr),
    fetchSteuerPosten(jahr),
    fetchShopifyUmsatzJahr(jahr),
    fetchSalonUmsatzJahr(jahr),
    fetchStaffGehaelter(), // liefert [] für Nicht-Admins (Gehälter sind Admin-only)
    fetchStaffGehaltsVerlauf(), // ebenso nur Admin
  ]);

  return (
    <FinanceOverview
      locale={locale}
      initialJahr={jahr}
      initialMonat={now.getMonth() + 1}
      initialRows={rows}
      initialSteuerPosten={posten}
      initialShopify={shopify}
      initialSalon={salon}
      staffEmployees={staffEmployees}
      staffVerlauf={staffVerlauf}
    />
  );
}
