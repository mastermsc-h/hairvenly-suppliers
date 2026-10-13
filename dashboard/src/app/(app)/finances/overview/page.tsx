import { requireFeature } from "@/lib/auth";
import { type Locale } from "@/lib/i18n";
import { fetchFinanzJahr, fetchStaffGehaelter } from "@/lib/actions/finanzen";
import { fetchSteuerPosten } from "@/lib/actions/steuer";
import FinanceOverview from "./finance-overview";

export default async function FinanceOverviewPage() {
  const profile = await requireFeature("finances");
  const locale = (profile.language ?? "de") as Locale;
  const now = new Date();
  const jahr = now.getFullYear();
  const [rows, posten, staffEmployees] = await Promise.all([
    fetchFinanzJahr(jahr),
    fetchSteuerPosten(jahr),
    fetchStaffGehaelter(), // liefert [] für Nicht-Admins (Gehälter sind Admin-only)
  ]);

  return (
    <FinanceOverview
      locale={locale}
      initialJahr={jahr}
      initialMonat={now.getMonth() + 1}
      initialRows={rows}
      initialSteuerPosten={posten}
      staffEmployees={staffEmployees}
    />
  );
}
