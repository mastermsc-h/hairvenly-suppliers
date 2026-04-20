import { requireProfile } from "@/lib/auth";
import { t, type Locale } from "@/lib/i18n";
import { readInventorySheet, readDashboardAlerts } from "@/lib/stock-sheets";
import { loadCatalogLookup, extractShopifyColorKey } from "@/lib/catalog-lookup";
import InventoryPageClient, { type InventoryWithTransit } from "../inventory-page";

export const revalidate = 120;

export default async function UzbekStockPage() {
  const profile = await requireProfile();
  if (!profile.is_admin) return <div className="p-8 text-neutral-500">Nur für Admins.</div>;
  const locale = (profile.language ?? "de") as Locale;

  const [inventoryResult, alerts, catalog] = await Promise.all([
    readInventorySheet("Usbekisch - WELLIG"),
    readDashboardAlerts(),
    loadCatalogLookup(),
  ]);

  const transitByShopifyKey = buildTransitLookup(
    alerts.unterwegs.filter((u) => u.sheetKey === "wellig"),
  );

  const catalogBridge = new Map<string, Set<string>>();
  for (const entry of catalog.all) {
    if (!entry.shopifyName) continue;
    const shopifyKey = extractShopifyColorKey(entry.shopifyName);
    const hKey = entry.hairvenlyName.toUpperCase();
    if (!catalogBridge.has(hKey)) catalogBridge.set(hKey, new Set());
    catalogBridge.get(hKey)!.add(shopifyKey);
  }

  const data: InventoryWithTransit[] = inventoryResult.rows.map((row) => {
    const invKey = extractShopifyColorKey(row.product);
    let entries = transitByShopifyKey.get(invKey);

    if (!entries) {
      const catalogEntries = catalog.byShopify.get(invKey);
      if (catalogEntries) {
        for (const ce of catalogEntries) {
          const hKey = ce.hairvenlyName.toUpperCase();
          const allKeys = catalogBridge.get(hKey);
          if (allKeys) {
            for (const altKey of allKeys) {
              entries = transitByShopifyKey.get(altKey);
              if (entries) break;
            }
          }
          if (entries) break;
          entries = transitByShopifyKey.get("#" + hKey);
          if (entries) break;
        }
      }
    }

    const matched = entries ?? [];
    return {
      ...row,
      transitOrders: matched,
      transitTotal: matched.reduce((s, e) => s + e.quantity, 0),
    };
  });

  return (
    <InventoryPageClient
      data={data}
      title={t(locale, "stock.title.uzbek")}
      subtitle={t(locale, "stock.subtitle.uzbek")}
      locale={locale}
      lastUpdated={inventoryResult.lastUpdated}
    />
  );
}

function buildTransitLookup(unterwegs: { product: string; perOrder: { name: string; ankunft: string; menge: number }[] }[]) {
  const map = new Map<string, { label: string; eta: string | null; quantity: number }[]>();
  for (const u of unterwegs) {
    const fullKey = u.product.toUpperCase();
    const colorKey = extractShopifyColorKey(u.product);
    const entries = u.perOrder.map((o) => ({ label: o.name, eta: o.ankunft || null, quantity: o.menge }));
    if (!map.has(fullKey)) map.set(fullKey, []);
    map.get(fullKey)!.push(...entries);
    if (colorKey !== fullKey) {
      if (!map.has(colorKey)) map.set(colorKey, []);
      map.get(colorKey)!.push(...entries);
    }
  }
  return map;
}
