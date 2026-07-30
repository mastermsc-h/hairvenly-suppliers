/**
 * Diagnose: warum zeigen die Akut/Knapp-Filter auf /stock/critical 0 Produkte?
 * Repliziert enrichAlertsWithTier + calcReichweite mit echten Sheet-Daten.
 *
 * Lauf: npx tsx scripts/debug-critical-reichweite.ts
 */
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { readDashboardAlerts, readTopseller, enrichAlertsWithTier } = await import("../src/lib/stock-sheets");

  const [{ kritisch }, { sections: topseller }] = await Promise.all([
    readDashboardAlerts(),
    readTopseller(),
  ]);

  console.log(`Kritische Produkte: ${kritisch.length}`);
  const enriched = enrichAlertsWithTier(kritisch, topseller);

  const withMeta = enriched.filter((a) => a.verkauft30d !== undefined || a.verkauft90d !== undefined);
  const withTier = enriched.filter((a) => a.tier);
  console.log(`  davon mit verkauft30d/90d: ${withMeta.length}`);
  console.log(`  davon mit tier:            ${withTier.length}`);

  // Reichweite-Verteilung (Logik aus alerts-client kopiert)
  const LEAD: Record<string, number> = { glatt: 42, wellig: 56 };
  const buckets: Record<string, number> = { akut: 0, knapp: 0, ok: 0, unbekannt: 0 };
  for (const d of enriched) {
    const v30 = (d.verkauft30d ?? 0) / 30;
    const v90 = (d.verkauft90d ?? 0) / 90;
    const daily = Math.max(v30, v90);
    if (daily <= 0) { buckets.unbekannt++; continue; }
    const rangeWithOrder = Math.round((d.lagerG + d.unterwegsG) / daily);
    const lead = LEAD[d.sheetKey];
    if (rangeWithOrder < lead) buckets.akut++;
    else if (rangeWithOrder < lead * 1.5) buckets.knapp++;
    else buckets.ok++;
  }
  console.log(`\nReichweite-Verteilung:`, buckets);

  // Beispiele: 10 unbekannte + ihre Match-Keys
  console.log(`\n--- 10 Beispiele OHNE Meta-Match (Match-Key-Analyse) ---`);
  const misses = enriched.filter((a) => a.verkauft30d === undefined && a.verkauft90d === undefined);
  for (const a of misses.slice(0, 10)) {
    console.log(`  [${a.sheetKey}] collection="${a.collection}" product="${a.product}" variant="${a.variant}"`);
  }

  // Was steht im Topseller als Key-Material?
  console.log(`\n--- 10 Topseller-Items (Key-Material) ---`);
  let shown = 0;
  outer: for (const sec of topseller) {
    for (const g of sec.sections) {
      for (const it of g.items) {
        console.log(`  [${sec.quality}] farbe="${it.farbe}" laenge="${it.laenge}" group="${g.label}"`);
        if (++shown >= 10) break outer;
      }
    }
  }
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
