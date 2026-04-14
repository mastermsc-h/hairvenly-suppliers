import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { t, type Locale } from "@/lib/i18n";
import { readInventorySheet } from "@/lib/stock-sheets";
import InventoryPageClient, { type InventoryWithTransit } from "../inventory-page";

export const revalidate = 120;

export default async function RussianStockPage() {
  const profile = await requireProfile();
  if (!profile.is_admin) return <div className="p-8 text-neutral-500">Nur für Admins.</div>;
  const locale = (profile.language ?? "de") as Locale;

  const [inventoryResult, transitMap] = await Promise.all([
    readInventorySheet("Russisch - GLATT"),
    loadTransitOrders("Amanda"),
  ]);

  const data: InventoryWithTransit[] = inventoryResult.rows.map((row) => {
    const key = normalizeProductKey(row.product);
    const orders = transitMap.get(key) ?? [];
    return {
      ...row,
      transitOrders: orders,
      transitTotal: orders.reduce((s, o) => s + o.quantity, 0),
    };
  });

  return (
    <InventoryPageClient
      data={data}
      title={t(locale, "stock.title.russian")}
      subtitle={t(locale, "stock.subtitle.russian")}
      locale={locale}
      lastUpdated={inventoryResult.lastUpdated}
    />
  );
}

function normalizeProductKey(product: string): string {
  const upper = product.toUpperCase();
  const hashIdx = upper.indexOf("#");
  if (hashIdx >= 0) return upper.substring(hashIdx).split(" ")[0];
  return upper.split(" ")[0];
}

async function loadTransitOrders(supplierNameFragment: string) {
  const supabase = await createClient();
  const { data: orders } = await supabase
    .from("orders_with_totals")
    .select("id, label, eta, status, supplier_id")
    .not("status", "in", '("delivered","cancelled")')
    .order("created_at", { ascending: false });

  const { data: suppliers } = await supabase
    .from("suppliers")
    .select("id, name");

  const supplierIds = (suppliers ?? [])
    .filter((s) => s.name.toLowerCase().includes(supplierNameFragment.toLowerCase()))
    .map((s) => s.id);

  const activeOrders = (orders ?? []).filter((o) => supplierIds.includes(o.supplier_id));
  if (activeOrders.length === 0) return new Map<string, { label: string; eta: string | null; quantity: number }[]>();

  const orderIds = activeOrders.map((o) => o.id);
  const { data: items } = await supabase
    .from("order_items")
    .select("order_id, color_name, quantity")
    .in("order_id", orderIds);

  const map = new Map<string, { label: string; eta: string | null; quantity: number }[]>();
  for (const item of items ?? []) {
    const order = activeOrders.find((o) => o.id === item.order_id);
    if (!order) continue;
    const key = "#" + item.color_name.toUpperCase();
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push({
      label: order.label,
      eta: order.eta,
      quantity: item.quantity,
    });
  }
  return map;
}
