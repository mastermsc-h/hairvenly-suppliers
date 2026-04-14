import { requireProfile } from "@/lib/auth";
import { t, type Locale } from "@/lib/i18n";
import { readTopseller } from "@/lib/stock-sheets";
import TopsellerClient from "./topseller-client";

export const revalidate = 120;

export default async function TopsellerPage() {
  const profile = await requireProfile();
  if (!profile.is_admin) return <div className="p-8 text-neutral-500">Nur für Admins.</div>;
  const locale = (profile.language ?? "de") as Locale;

  const { sections, lastUpdated } = await readTopseller();

  return (
    <TopsellerClient
      sections={sections}
      title={t(locale, "stock.title.topseller")}
      subtitle={t(locale, "stock.subtitle.topseller")}
      lastUpdated={lastUpdated}
    />
  );
}
