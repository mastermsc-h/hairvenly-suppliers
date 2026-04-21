import { requireProfile, hasFeature } from "@/lib/auth";
import { redirect } from "next/navigation";
import { t, type Locale } from "@/lib/i18n";
import { fetchOrdersByCountry, type ShopifyCustomsOrder } from "@/lib/shopify";
import CustomsList from "./customs-list";

export default async function CustomsCHPage() {
  const profile = await requireProfile();
  if (!hasFeature(profile, "customs_ch")) redirect("/");
  const locale = (profile.language ?? "de") as Locale;

  let orders: ShopifyCustomsOrder[] = [];
  let errorMessage: string | null = null;
  try {
    orders = await fetchOrdersByCountry("CH", 60, 100);
  } catch (e) {
    errorMessage = e instanceof Error ? e.message : String(e);
  }

  // Default-Filter: nur unerfüllte Bestellungen zeigen — die, die noch
  // verschickt werden müssen. Erfüllte bleiben versteckt (können per Toggle
  // in der Client-Komponente sichtbar gemacht werden).
  const unfulfilled = orders.filter(
    (o) => o.displayFulfillmentStatus !== "FULFILLED",
  );

  return (
    <div className="p-4 md:p-8 space-y-6 max-w-7xl">
      <header>
        <h1 className="text-2xl font-semibold text-neutral-900">
          {t(locale, "customs_ch.title")}
        </h1>
        <p className="text-sm text-neutral-500 mt-1">
          {t(locale, "customs_ch.subtitle")}
        </p>
      </header>

      {errorMessage ? (
        <div className="bg-red-50 border border-red-200 text-red-800 rounded-2xl p-4 text-sm">
          {errorMessage}
        </div>
      ) : (
        <CustomsList orders={unfulfilled} allOrders={orders} locale={locale} />
      )}
    </div>
  );
}
