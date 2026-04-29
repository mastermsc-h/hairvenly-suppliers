import { requireProfile } from "@/lib/auth";
import { t, type Locale } from "@/lib/i18n";
import { readInventorySheet, readDashboardAlerts } from "@/lib/stock-sheets";
import { fetchOrderIdByName } from "@/lib/order-name-map";
import { filterArchivedFromStock } from "@/lib/filter-archived-orders";
import { enrichInventoryWithBarcodes } from "@/lib/stock-barcodes";
import { getPrintedSummary } from "@/lib/actions/printed-labels";
import InventoryPageClient, { type InventoryWithTransit } from "../inventory-page";

export const revalidate = 60;

export default async function UzbekStockPage() {
  const profile = await requireProfile();
  if (!profile.is_admin) return <div className="p-8 text-neutral-500">Nur für Admins.</div>;
  const locale = (profile.language ?? "de") as Locale;

  const [inventoryResult, alerts, orderIdByName, printedSummary] = await Promise.all([
    readInventorySheet("Usbekisch - WELLIG"),
    readDashboardAlerts(),
    fetchOrderIdByName(),
    getPrintedSummary(),
  ]);

  const filteredUnterwegs = filterArchivedFromStock(
    alerts.unterwegs.filter((u) => u.sheetKey === "wellig"),
    orderIdByName,
  );
  const transitByShopifyKey = buildTransitLookup(filteredUnterwegs);

  const enrichedRows = await enrichInventoryWithBarcodes(inventoryResult.rows);

  const data: InventoryWithTransit[] = enrichedRows.map((row) => {
    const isClipIn = row.collection.toUpperCase().includes("CLIP");
    const fullKey = row.product.toUpperCase();
    const variantKey = isClipIn && row.unitWeight > 0 ? `${fullKey}|${row.unitWeight}` : null;

    let entries = variantKey ? transitByShopifyKey.get(variantKey) : undefined;
    if (!entries) entries = transitByShopifyKey.get(fullKey);

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
      printedSummary={printedSummary}
    />
  );
}

function buildTransitLookup(unterwegs: { product: string; variant: string | null; perOrder: { name: string; ankunft: string; menge: number }[] }[]) {
  const map = new Map<string, { label: string; eta: string | null; quantity: number }[]>();
  for (const u of unterwegs) {
    const entries = u.perOrder.map((o) => ({ label: o.name, eta: o.ankunft || null, quantity: o.menge }));
    const cleanProduct = u.product.replace(/\s*\[\d+g\]\s*$/, "").trim().toUpperCase();

    if (u.variant) {
      const vKey = `${cleanProduct}|${u.variant}`;
      if (!map.has(vKey)) map.set(vKey, []);
      map.get(vKey)!.push(...entries);
    } else {
      if (!map.has(cleanProduct)) map.set(cleanProduct, []);
      map.get(cleanProduct)!.push(...entries);
    }
  }
  return map;
}
