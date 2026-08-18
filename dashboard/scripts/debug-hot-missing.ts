/** Diagnose: warum ist die Insight-Karte "Topseller mit niedrigem Lager" leer? */
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { readTopseller } = await import("../src/lib/stock-sheets");
  const { sections } = await readTopseller();

  type Item = { tier: string; lagerG: number; unterwegsG: number; verkauft30d: number; farbe: string };
  const all: Item[] = [];
  for (const sec of sections) for (const g of sec.sections) for (const it of g.items) all.push(it);

  console.log("Topseller-Items gesamt:", all.length);
  const tiers: Record<string, number> = {};
  for (const i of all) tiers[i.tier || "(leer)"] = (tiers[i.tier || "(leer)"] || 0) + 1;
  console.log("Tier-Verteilung:", JSON.stringify(tiers));

  const top7 = all.filter((i) => i.tier === "TOP7");
  console.log("\nTOP7 gesamt:", top7.length);
  console.log("TOP7 lagerG < 200:", top7.filter((i) => i.lagerG < 200).length);
  console.log("TOP7 lagerG < 200 && unterwegs 0 (= Karte aktuell):", top7.filter((i) => i.lagerG < 200 && i.unterwegsG === 0).length);
  console.log("TOP7 lagerG < 600:", top7.filter((i) => i.lagerG < 600).length);
  console.log("TOP7 lagerG < 600 && unterwegs 0:", top7.filter((i) => i.lagerG < 600 && i.unterwegsG === 0).length);

  console.log("\n--- TOP7 mit Lager < 600g (sortiert), egal ob bestellt: ---");
  for (const i of top7.filter((i) => i.lagerG < 600).sort((a, b) => a.lagerG - b.lagerG).slice(0, 15)) {
    console.log(
      `  lager=${String(i.lagerG).padStart(5)}g  unterwegs=${String(i.unterwegsG).padStart(5)}g  30T=${String(i.verkauft30d).padStart(5)}g  ${i.farbe.slice(0, 48)}`,
    );
  }
}

main().catch((e) => { console.error("Fatal:", e); process.exit(1); });
