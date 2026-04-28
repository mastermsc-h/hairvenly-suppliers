import { requireFeature } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { t, type Locale } from "@/lib/i18n";
import { loadAllCatalogs } from "@/lib/actions/catalog";
import CatalogEditor from "./catalog-editor";
import type { Supplier } from "@/lib/types";
import Link from "next/link";
import { Printer } from "lucide-react";

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
      <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-neutral-900">{t(locale, "catalog.title")}</h1>
          <p className="text-sm text-neutral-500 mt-1">{t(locale, "catalog.subtitle")}</p>
        </div>
        <Link
          href="/catalog/barcodes"
          className="inline-flex items-center gap-2 px-3 py-2 rounded-lg bg-white border border-neutral-300 text-neutral-900 text-sm font-medium hover:bg-neutral-50 transition self-start"
        >
          <Printer size={14} /> Barcode-Etiketten drucken
        </Link>
      </div>

      <CatalogEditor
        suppliers={(suppliers ?? []) as Supplier[]}
        catalogs={catalogs}
        locale={locale}
      />
    </div>
  );
}
