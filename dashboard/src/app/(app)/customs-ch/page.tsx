import { requireProfile, hasFeature } from "@/lib/auth";
import { redirect } from "next/navigation";
import { t, type Locale } from "@/lib/i18n";
import {
  fetchOrdersByCountry,
  type ShopifyCustomsOrder,
  type FetchOrdersByCountryDiagnostics,
} from "@/lib/shopify";
import CustomsList from "./customs-list";

export default async function CustomsCHPage() {
  const profile = await requireProfile();
  if (!hasFeature(profile, "customs_ch")) redirect("/");
  const locale = (profile.language ?? "de") as Locale;

  const diagnostics: FetchOrdersByCountryDiagnostics = {
    totalFetched: 0,
    countryBreakdown: {},
    sampleAddresses: [],
  };

  let orders: ShopifyCustomsOrder[] = [];
  let errorMessage: string | null = null;
  try {
    orders = await fetchOrdersByCountry("CH", 180, 20, diagnostics);
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

      {!errorMessage && orders.length === 0 && (
        <div className="bg-white rounded-2xl border border-neutral-200 p-4 shadow-sm text-xs text-neutral-600 space-y-3">
          <div className="font-medium text-neutral-900">Diagnose</div>
          <div>
            Shopify hat <strong>{diagnostics.totalFetched}</strong> Bestellungen aus den letzten
            180 Tagen geliefert, davon keine mit Lieferland = CH.
          </div>
          <div className="text-neutral-500">
            Pages fetched: <code>{diagnostics.pagesFetched ?? 0}</code> · First page edges:{" "}
            <code>{diagnostics.firstPageEdgeCount ?? 0}</code> · Query:{" "}
            <code>{diagnostics.rawQuery ?? "-"}</code>
          </div>
          {diagnostics.graphqlErrors && diagnostics.graphqlErrors.length > 0 && (
            <div className="bg-red-50 border border-red-200 text-red-800 rounded p-2">
              <div className="font-medium">GraphQL-Errors:</div>
              <ul className="list-disc ml-5">
                {diagnostics.graphqlErrors.map((m, i) => (
                  <li key={i}>{m}</li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <div className="font-medium text-neutral-800 mb-1">Länder-Verteilung:</div>
            <div className="flex flex-wrap gap-2">
              {Object.entries(diagnostics.countryBreakdown)
                .sort(([, a], [, b]) => b - a)
                .map(([cc, n]) => (
                  <span key={cc} className="bg-neutral-100 rounded px-2 py-0.5">
                    {cc}: {n}
                  </span>
                ))}
            </div>
          </div>
          {diagnostics.sampleAddresses.length > 0 && (
            <div>
              <div className="font-medium text-neutral-800 mb-1">Erste 10 Bestellungen:</div>
              <ul className="space-y-0.5">
                {diagnostics.sampleAddresses.map((s) => (
                  <li key={s.orderName}>
                    {s.orderName} → countryCode=<code>{s.countryCode ?? "null"}</code>, country=
                    <code>{s.country ?? "null"}</code>, city=<code>{s.city ?? "null"}</code>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
