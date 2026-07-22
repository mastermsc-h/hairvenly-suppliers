import { requireFeature } from "@/lib/auth";
import { type Locale } from "@/lib/i18n";
import { fetchSteuerPosten, fetchSteuerJahre } from "@/lib/actions/steuer";
import SteuerLedger from "./steuer-ledger";

export default async function PrepaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ jahr?: string }>;
}) {
  const profile = await requireFeature("finances");
  const locale = (profile.language ?? "de") as Locale;

  const sp = await searchParams;
  const jahr = Number(sp.jahr) || new Date().getFullYear();

  const [posten, jahre] = await Promise.all([
    fetchSteuerPosten(jahr),
    fetchSteuerJahre(),
  ]);

  return <SteuerLedger locale={locale} jahr={jahr} jahre={jahre} posten={posten} />;
}
