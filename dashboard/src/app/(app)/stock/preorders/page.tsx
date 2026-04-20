import { requireFeature } from "@/lib/auth";
import { loadPreorderCandidates, loadShopifyPreorders } from "@/lib/actions/preorders";
import { t, type Locale } from "@/lib/i18n";
import PreordersClient from "./preorders-client";

export const revalidate = 120;

export default async function PreordersPage() {
  const profile = await requireFeature("stock");
  const locale = (profile.language ?? "de") as Locale;

  const [candidates, preorders] = await Promise.all([
    loadPreorderCandidates(),
    loadShopifyPreorders(),
  ]);

  return (
    <div className="p-4 md:p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-neutral-900">
          {t(locale, "preorders.title")}
        </h1>
        <p className="text-sm text-neutral-500 mt-1">
          {t(locale, "preorders.subtitle")}
        </p>
      </div>

      <PreordersClient
        candidates={candidates}
        preorders={preorders}
        locale={locale}
      />
    </div>
  );
}
