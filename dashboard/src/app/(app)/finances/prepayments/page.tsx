import { requireFeature } from "@/lib/auth";
import { type Locale } from "@/lib/i18n";
import { fetchSteuerPosten, fetchSteuerJahre } from "@/lib/actions/steuer";
import SteuerLedger from "./steuer-ledger";
import UstMonate from "../ust-monate";
import { ladeUstMonate } from "@/lib/steuer/ust-monate";

export default async function PrepaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ jahr?: string }>;
}) {
  const profile = await requireFeature("finances");
  const locale = (profile.language ?? "de") as Locale;

  const sp = await searchParams;
  const jahr = Number(sp.jahr) || new Date().getFullYear();

  const [posten, jahre, ustMonate] = await Promise.all([
    fetchSteuerPosten(jahr),
    fetchSteuerJahre(),
    ladeUstMonate(jahr).catch((e) => {
      console.error("[steuer] USt je Monat", e);
      return [];
    }),
  ]);

  return (
    <>
      <SteuerLedger locale={locale} jahr={jahr} jahre={jahre} posten={posten} />
      <div className="px-4 md:px-8 pb-8 max-w-5xl mx-auto">
        <UstMonate jahr={jahr} monate={ustMonate} />
      </div>
    </>
  );
}
