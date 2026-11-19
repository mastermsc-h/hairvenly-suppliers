import { requireFeature } from "@/lib/auth";
import { type Locale } from "@/lib/i18n";
import { fetchBankOverview } from "@/lib/actions/bank";
import PaymentsBoard from "./payments-board";

export const dynamic = "force-dynamic";
// Server Actions dieser Seite (Abgleich, CSV-Import) dürfen bis 60 s laufen.
export const maxDuration = 60;

export default async function PaymentsPage() {
  const profile = await requireFeature("finances");
  const locale = (profile.language ?? "de") as Locale;
  const { state, transactions } = await fetchBankOverview(60);

  const shopDomain = process.env.SHOPIFY_SHOP_DOMAIN ?? "";
  const shopHandle = shopDomain.replace(/\.myshopify\.com$/, "");
  const shopAdminBase = shopHandle ? `https://admin.shopify.com/store/${shopHandle}/orders/` : null;

  return (
    <PaymentsBoard
      locale={locale}
      state={state}
      transactions={transactions}
      shopAdminBase={shopAdminBase}
      canChangeMode={profile.role === "admin"}
    />
  );
}
