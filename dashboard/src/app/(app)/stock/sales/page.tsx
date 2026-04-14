import { requireProfile } from "@/lib/auth";
import { t, type Locale } from "@/lib/i18n";
import { readVerkaufsanalyse } from "@/lib/stock-sheets";
import SalesClient from "./sales-client";

export const revalidate = 120;

export default async function SalesPage() {
  const profile = await requireProfile();
  if (!profile.is_admin) return <div className="p-8 text-neutral-500">Nur für Admins.</div>;
  const locale = (profile.language ?? "de") as Locale;

  const { rows, lastUpdated } = await readVerkaufsanalyse();

  return (
    <SalesClient
      data={rows}
      title={t(locale, "stock.title.sales")}
      subtitle={t(locale, "stock.subtitle.sales")}
      lastUpdated={lastUpdated}
    />
  );
}
