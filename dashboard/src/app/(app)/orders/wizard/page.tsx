import { requireFeature } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { t, type Locale } from "@/lib/i18n";
import { loadAllCatalogs } from "@/lib/actions/catalog";
import WizardForm from "./wizard-form";
import type { Supplier } from "@/lib/types";

export default async function WizardPage() {
  const profile = await requireFeature("wizard");
  const locale = (profile.language ?? "de") as Locale;

  const supabase = await createClient();
  const { data: suppliers } = await supabase
    .from("suppliers")
    .select("*")
    .order("sort_order")
    .order("name");

  const catalogs = await loadAllCatalogs();

  return (
    <div className="p-4 md:p-8 max-w-6xl">
      <WizardForm
        suppliers={(suppliers ?? []) as Supplier[]}
        catalogs={catalogs}
        locale={locale}
      />
    </div>
  );
}
