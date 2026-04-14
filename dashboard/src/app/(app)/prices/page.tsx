import { requireAdmin } from "@/lib/auth";
import { loadPriceLists } from "@/lib/actions/prices";
import { loadAllCatalogs } from "@/lib/actions/catalog";
import { loadSupplierColors } from "@/lib/actions/prices";
import PriceTables from "./price-tables";
import type { Locale } from "@/lib/i18n";

export default async function PricesPage() {
  const profile = await requireAdmin();
  const locale = (profile.language ?? "de") as Locale;
  const priceLists = await loadPriceLists();

  // Load available colors for each supplier that has a price list
  const supplierColors: Record<string, Awaited<ReturnType<typeof loadSupplierColors>>> = {};
  for (const pl of priceLists) {
    if (!supplierColors[pl.supplier_id]) {
      supplierColors[pl.supplier_id] = await loadSupplierColors(pl.supplier_id);
    }
  }

  return (
    <div className="p-4 md:p-8 max-w-[1400px] mx-auto space-y-6">
      <h1 className="text-xl font-semibold text-neutral-900">
        {locale === "de" ? "Preistabellen" : locale === "tr" ? "Fiyat Tabloları" : "Price Tables"}
      </h1>
      <PriceTables
        priceLists={priceLists}
        supplierColors={supplierColors}
        locale={locale}
      />
    </div>
  );
}
