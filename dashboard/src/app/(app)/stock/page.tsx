import { requireProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { t, type Locale } from "@/lib/i18n";
import { readDashboardAlerts, readInventorySheet, readTopseller } from "@/lib/stock-sheets";
import { fetchOrderIdByName } from "@/lib/order-name-map";
import { filterArchivedFromStock, filterArchivedFromTopseller } from "@/lib/filter-archived-orders";
import StockOverviewClient, { type InsightProduct, type StockSnapshot } from "./stock-overview";

export const revalidate = 60;

export default async function StockIndexPage() {
  const profile = await requireProfile();
  if (!profile.is_admin) return <div className="p-8 text-neutral-500">Nur für Admins.</div>;
  const locale = (profile.language ?? "de") as Locale;

  const supabase = await createClient();
  const [alertsRaw, wellig, glatt, topsellerRaw, orderIdByName, snapshotRes] = await Promise.all([
    readDashboardAlerts(),
    readInventorySheet("Usbekisch - WELLIG"),
    readInventorySheet("Russisch - GLATT"),
    readTopseller(),
    fetchOrderIdByName(),
    supabase
      .from("stock_snapshots")
      .select("taken_on, total_kg, wellig_kg, glatt_kg")
      .order("taken_on", { ascending: true })
      .limit(400),
  ]);
  const history = (snapshotRes.data ?? []) as StockSnapshot[];

  // Drop archived orders (stocked / cancelled) from all alert lists + topseller
  const alerts = {
    ...alertsRaw,
    unterwegs: filterArchivedFromStock(alertsRaw.unterwegs, orderIdByName).filter((d) => d.unterwegsG > 0),
    nullbestand: filterArchivedFromStock(alertsRaw.nullbestand, orderIdByName),
    kritisch: filterArchivedFromStock(alertsRaw.kritisch, orderIdByName),
  };
  const topseller = { ...topsellerRaw, sections: filterArchivedFromTopseller(topsellerRaw.sections, orderIdByName) };

  // Build insights from topseller data
  const insights = buildInsights(topseller.sections);

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

  // Opportunistischer Tages-Snapshot für den Entwicklungs-Chart: der Cron
  // (04:00) schreibt ihn primär, aber so wächst die Historie auch bei
  // Cron-Ausfällen. Fehler bewusst geschluckt — die Seite darf daran nie
  // scheitern.
  const today = new Date().toISOString().slice(0, 10);
  if (welligProducts > 0 && glattProducts > 0) {
    await supabase.from("stock_snapshots").upsert(
      {
        taken_on: today,
        total_kg: Math.round(totalKg * 100) / 100,
        wellig_kg: Math.round(welligTotalKg * 100) / 100,
        glatt_kg: Math.round(glattTotalKg * 100) / 100,
        wellig_products: welligProducts,
        glatt_products: glattProducts,
        zero_count: welligZero + glattZero,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "taken_on" },
    ).then(() => {});
    // Heutigen Punkt auch in der Chart-Serie zeigen, falls er gerade erst entstand
    if (!history.some((h) => h.taken_on === today)) {
      history.push({
        taken_on: today,
        total_kg: Math.round(totalKg * 100) / 100,
        wellig_kg: Math.round(welligTotalKg * 100) / 100,
        glatt_kg: Math.round(glattTotalKg * 100) / 100,
      });
    }
  }

  return (
    <StockOverviewClient
      locale={locale}
      history={history}
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
        insights,
      }}
    />
  );
}

function buildInsights(sections: Awaited<ReturnType<typeof readTopseller>>["sections"]) {
  type Item = {
    farbe: string;
    laenge: string;
    quality: string;
    group: string;
    tier: string;
    lagerG: number;
    verkauftG: number;     // 90T
    verkauft30d: number;
    prognose: number;      // 45T or 60T forecast
    unterwegsG: number;
  };
  const all: Item[] = [];
  for (const sec of sections) {
    for (const g of sec.sections) {
      for (const it of g.items) {
        all.push({
          farbe: it.farbe,
          laenge: it.laenge,
          quality: sec.quality,
          group: g.label,
          tier: it.tier,
          lagerG: it.lagerG,
          verkauftG: it.verkauftG,
          verkauft30d: it.verkauft30d,
          prognose: it.prognose,
          unterwegsG: it.unterwegsG,
        });
      }
    }
  }

  const toProduct = (i: Item, value: string): InsightProduct => ({
    farbe: i.farbe,
    quality: i.quality,
    group: i.group,
    laenge: i.laenge,
    lagerG: i.lagerG,
    verkauftG: i.verkauftG,
    verkauft30d: i.verkauft30d,
    unterwegsG: i.unterwegsG,
    tier: i.tier,
    value,
  });

  // 1. Slow Movers: Lager > 150g, KAUM-Tier (in 90T fast nichts verkauft)
  const slowMovers = all
    .filter((i) => i.lagerG > 150 && (i.tier === "KAUM" || i.verkauftG < 50))
    .sort((a, b) => b.lagerG - a.lagerG)
    .map((i) => toProduct(i, `${i.lagerG}g · ${i.verkauftG}g 90T`));

  // 2. Topseller mit niedrigem Lager. Frueher: nur < 200g UND nichts
  // unterwegs — sobald alles bestellt war, blieb die Karte leer und
  // versteckte die eigentlich spannende Info. Jetzt: alle TOP7 < 600g,
  // nicht-bestellte zuerst (⚠), Bestellmenge sichtbar.
  const hotMissing = all
    .filter((i) => i.tier === "TOP7" && i.lagerG < 600)
    .sort((a, b) => {
      const aOrdered = a.unterwegsG > 0 ? 1 : 0;
      const bOrdered = b.unterwegsG > 0 ? 1 : 0;
      if (aOrdered !== bOrdered) return aOrdered - bOrdered; // ⚠ nicht bestellt zuerst
      if (a.lagerG !== b.lagerG) return a.lagerG - b.lagerG;
      return b.verkauft30d - a.verkauft30d;
    })
    .map((i) => toProduct(i, i.unterwegsG > 0
      ? `${i.lagerG}g · 30T ${i.verkauft30d}g · ✈ ${i.unterwegsG}g`
      : `${i.lagerG}g · 30T ${i.verkauft30d}g · ⚠ nicht bestellt`));

  // 3. Überbestellt: Unterwegs deutlich größer als Bedarfsprognose
  const overOrdered = all
    .filter((i) => i.unterwegsG > 0 && i.prognose > 0 && i.unterwegsG > i.prognose * 2)
    .sort((a, b) => b.unterwegsG - a.unterwegsG)
    .map((i) => toProduct(i, `${i.unterwegsG}g unterwegs · Bedarf ${i.prognose}g`));

  // 4. Dead Stock: hoher Lagerbestand, aber 0 Verkäufe in 90T
  const deadStock = all
    .filter((i) => i.lagerG >= 500 && i.verkauftG === 0)
    .sort((a, b) => b.lagerG - a.lagerG)
    .map((i) => toProduct(i, `${i.lagerG}g Lager · 0 Verkauf`));

  // 5. Wachsend: 30T-Verkauf hochgerechnet (×3) ist > 130% des 90T
  const trendingUp = all
    .filter((i) => i.verkauft30d > 50 && i.verkauft30d * 3 > i.verkauftG * 1.3)
    .sort((a, b) => b.verkauft30d * 3 - b.verkauftG - (a.verkauft30d * 3 - a.verkauftG))
    .map((i) => toProduct(i, `30T: ${i.verkauft30d}g · 90T: ${i.verkauftG}g ↑`));

  // 6. Nicht bestellt obwohl kritisch: TOP7/MID mit Lager < Prognose, kein Nachschub
  const needsReorder = all
    .filter((i) => (i.tier === "TOP7" || i.tier === "MID") && i.lagerG < i.prognose && i.unterwegsG === 0)
    .sort((a, b) => (b.prognose - b.lagerG) - (a.prognose - a.lagerG))
    .map((i) => toProduct(i, `Lager ${i.lagerG}g · Bedarf ${i.prognose}g`));

  return { slowMovers, hotMissing, overOrdered, deadStock, trendingUp, needsReorder };
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
