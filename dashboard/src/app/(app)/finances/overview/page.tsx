import { requireFeature } from "@/lib/auth";
import { t, type Locale } from "@/lib/i18n";
import FinanceOverview from "./finance-overview";

export default async function FinanceOverviewPage() {
  const profile = await requireFeature("finances");
  const locale = (profile.language ?? "de") as Locale;

  return <FinanceOverview locale={locale} />;
}
