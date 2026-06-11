/**
 * Einmaliges Backfill-Script: generiert SKUs für alle bestehenden
 * product_colors-Einträge.
 *
 * Lauf mit:
 *   npx tsx scripts/backfill-skus.ts
 *
 * - Liest alle product_methods + product_lengths + product_colors + suppliers
 * - Generiert pro Farbe eine eindeutige SKU
 * - Schreibt sie in product_colors.sku
 * - Skippt rows die bereits eine SKU haben (idempotent)
 */

import { Client } from "pg";
import { generateUniqueSku } from "../src/lib/sku-generator";

const CONNECTION_STRING = "postgresql://postgres.xzisnlkqiomvmbslwhvg:yPa1PNWr0KozQlPP@aws-1-eu-central-1.pooler.supabase.com:5432/postgres";

interface Row {
  color_id: string;
  color_name: string;
  current_sku: string | null;
  length_value: string;
  method_name: string;
  supplier_name: string;
}

async function main() {
  const client = new Client({ connectionString: CONNECTION_STRING });
  await client.connect();
  console.log("Connected.");

  try {
    // Hole alle Farben mit ihren Beziehungen
    const { rows } = await client.query<Row>(`
      SELECT
        pc.id AS color_id,
        pc.name_hairvenly AS color_name,
        pc.sku AS current_sku,
        pl.value AS length_value,
        pm.name AS method_name,
        s.name AS supplier_name
      FROM product_colors pc
      JOIN product_lengths pl ON pl.id = pc.length_id
      JOIN product_methods pm ON pm.id = pl.method_id
      JOIN suppliers s        ON s.id = pm.supplier_id
      ORDER BY s.name, pm.name, pl.value, pc.name_hairvenly
    `);

    console.log(`Loaded ${rows.length} product_colors.`);

    // Set der bereits vergebenen SKUs (auch die existierenden, um Kollisionen
    // beim Re-Backfill zu vermeiden)
    const existingSkus = new Set<string>(
      rows.map((r) => r.current_sku).filter((s): s is string => !!s),
    );

    const updates: Array<{ id: string; sku: string; name: string }> = [];
    let skipped = 0;

    for (const r of rows) {
      if (r.current_sku) {
        skipped++;
        continue;
      }
      const sku = generateUniqueSku(
        r.supplier_name,
        r.method_name,
        r.length_value,
        r.color_name,
        existingSkus,
      );
      updates.push({ id: r.color_id, sku, name: r.color_name });
    }

    console.log(`Generated ${updates.length} new SKUs (${skipped} already had one).`);

    if (updates.length === 0) {
      console.log("Nothing to update.");
      return;
    }

    // Beispiele zeigen
    console.log("\nFirst 20 examples:");
    for (const u of updates.slice(0, 20)) {
      console.log(`  ${u.sku.padEnd(28)} ← ${u.name}`);
    }

    // Batch-Update
    await client.query("BEGIN");
    for (const u of updates) {
      await client.query("UPDATE product_colors SET sku = $1 WHERE id = $2", [u.sku, u.id]);
    }
    await client.query("COMMIT");
    console.log(`\n✓ Updated ${updates.length} rows.`);

    // Statistik
    const { rows: stats } = await client.query<{ supplier: string; total: number; with_sku: number }>(`
      SELECT s.name AS supplier, COUNT(*)::int AS total, COUNT(pc.sku)::int AS with_sku
      FROM product_colors pc
      JOIN product_lengths pl ON pl.id = pc.length_id
      JOIN product_methods pm ON pm.id = pl.method_id
      JOIN suppliers s ON s.id = pm.supplier_id
      GROUP BY s.name
      ORDER BY s.name
    `);
    console.log("\nCoverage:");
    for (const s of stats) {
      console.log(`  ${s.supplier.padEnd(20)} ${s.with_sku}/${s.total}`);
    }
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("Fatal:", e);
  process.exit(1);
});
