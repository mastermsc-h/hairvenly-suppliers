import { requireProfile } from "@/lib/auth";
import { toClientOrderMeta } from "@/lib/order-name-map";
import { loadDeadStock } from "@/lib/stock-deadstock";
import DeadStockClient from "./deadstock-client";

export const revalidate = 300;

export default async function DeadStockPage() {
  const profile = await requireProfile();
  if (!profile.is_admin) return <div className="p-8 text-neutral-500">Nur für Admins.</div>;

  const { items, tooNew, noData, totalLagerKg, lastUpdated, orderIdByName } = await loadDeadStock();

  return (
    <DeadStockClient
      items={items}
      tooNew={tooNew}
      noData={noData}
      totalLagerKg={totalLagerKg}
      lastUpdated={lastUpdated}
      orderIdByName={toClientOrderMeta(orderIdByName)}
    />
  );
}
