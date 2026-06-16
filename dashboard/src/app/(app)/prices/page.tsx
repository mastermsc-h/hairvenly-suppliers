import { requireFeature } from "@/lib/auth";
import { loadPriceLists } from "@/lib/actions/prices";
import { loadAllCatalogs } from "@/lib/actions/catalog";
import { loadSupplierColors } from "@/lib/actions/prices";
import PriceTables from "./price-tables";
import type { Locale } from "@/lib/i18n";

export default async function PricesPage() {
  const profile = await requireFeature("prices");
  const locale = (profile.language ?? "de") as Locale;
  const rawPriceLists = await loadPriceLists();

  // Nur echte Admins (role==='admin') sehen Einkaufspreise. Mitarbeiter
  // (role==='employee', auch wenn is_admin=true in DB) sehen die Preistabelle
  // ohne EK / Zoll / Aufschlag / Marge — nur Verkaufspreise + Farb-Mappings.
  const canSeeCostPrices = profile.role === "admin";

  // Sanitize: EK-Werte serverseitig leeren wenn keine Berechtigung — so kommen
  // die Einkaufspreise gar nicht erst im Client-JS an (kein Reverse-Engineering
  // über Browser Dev Tools möglich).
  const priceLists = canSeeCostPrices
    ? rawPriceLists
    : rawPriceLists.map((pl) => ({
        ...pl,
        length_groups: pl.length_groups.map((lg) => ({
          ...lg,
          entries: lg.entries.map((e) => ({ ...e, prices: {} })),
        })),
      }));

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
        canSeeCostPrices={canSeeCostPrices}
      />
    </div>
  );
}
