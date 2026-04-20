import { requireFeature } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { t, type Locale } from "@/lib/i18n";
import { loadAllCatalogs } from "@/lib/actions/catalog";
import CatalogEditor from "./catalog-editor";
import type { Supplier } from "@/lib/types";

export default async function CatalogPage() {
  const profile = await requireFeature("catalog");
  const locale = (profile.language ?? "de") as Locale;

  const supabase = await createClient();
  const { data: suppliers } = await supabase
    .from("suppliers")
    .select("*")
    .order("sort_order")
    .order("name");

  const catalogs = await loadAllCatalogs();

  return (
    <div className="p-4 md:p-8 max-w-6xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-neutral-900">{t(locale, "catalog.title")}</h1>
        <p className="text-sm text-neutral-500 mt-1">{t(locale, "catalog.subtitle")}</p>
      </div>

      <CatalogEditor
        suppliers={(suppliers ?? []) as Supplier[]}
        catalogs={catalogs}
        locale={locale}
      />
    </div>
  );
}
