import { requireProfile } from "@/lib/auth";
import { t, type Locale } from "@/lib/i18n";
import { readDashboardAlerts, readInventorySheet } from "@/lib/stock-sheets";
import StockOverviewClient from "./stock-overview";

export const revalidate = 120;

export default async function StockIndexPage() {
  const profile = await requireProfile();
  if (!profile.is_admin) return <div className="p-8 text-neutral-500">Nur für Admins.</div>;
  const locale = (profile.language ?? "de") as Locale;

  const [alerts, wellig, glatt] = await Promise.all([
    readDashboardAlerts(),
    readInventorySheet("Usbekisch - WELLIG"),
    readInventorySheet("Russisch - GLATT"),
  ]);

  // Compute collection-level stats
  const welligByCollection = groupByCollection(wellig.rows);
  const glattByCollection = groupByCollection(glatt.rows);

  const welligTotalKg = wellig.rows.reduce((s, r) => s + r.totalWeight, 0) / 1000;
  const glattTotalKg = glatt.rows.reduce((s, r) => s + r.totalWeight, 0) / 1000;
  const totalKg = welligTotalKg + glattTotalKg;

  const welligProducts = wellig.rows.length;
  const glattProducts = glatt.rows.length;
  const welligZero = wellig.rows.filter((r) => r.quantity === 0).length;
  const glattZero = glatt.rows.filter((r) => r.quantity === 0).length;

  return (
    <StockOverviewClient
      locale={locale}
      stats={{
        totalKg,
        welligKg: welligTotalKg,
        glattKg: glattTotalKg,
        welligProducts,
        glattProducts,
        welligZero,
        glattZero,
        nullbestandCount: alerts.nullbestand.length,
        kritischCount: alerts.kritisch.length,
        unterwegsCount: alerts.unterwegs.length,
        welligCollections: welligByCollection,
        glattCollections: glattByCollection,
        lastUpdated: wellig.lastUpdated ?? alerts.lastUpdated ?? null,
      }}
    />
  );
}

function groupByCollection(rows: { collection: string; totalWeight: number }[]) {
  const map = new Map<string, number>();
  for (const r of rows) {
    map.set(r.collection, (map.get(r.collection) ?? 0) + r.totalWeight);
  }
  return Array.from(map.entries())
    .map(([name, weightG]) => ({ name, kg: weightG / 1000 }))
    .sort((a, b) => b.kg - a.kg);
}
