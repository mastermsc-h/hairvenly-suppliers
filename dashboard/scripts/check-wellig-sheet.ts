/** Prüft ob die neuen Kollektionen im Usbekisch-WELLIG-Tab angekommen sind. */
import { config } from "dotenv";
config({ path: ".env.local" });

async function main() {
  const { readInventorySheet } = await import("../src/lib/stock-sheets");
  const { rows, lastUpdated } = await readInventorySheet("Usbekisch - WELLIG");
  console.log("lastUpdated:", lastUpdated, "| rows:", rows.length);
  const colls = new Map<string, number>();
  for (const r of rows) colls.set(r.collection, (colls.get(r.collection) ?? 0) + 1);
  for (const [c, n] of colls) console.log("  " + c + ": " + n);
  const nb = rows.filter((r) => /butterfly|invisible tape/i.test(r.collection + " " + r.product));
  console.log("Butterfly/Invisible-Tape-Zeilen:", nb.length);
  if (nb.length > 0) {
    for (const r of nb.slice(0, 5)) console.log("  " + r.collection + " | " + r.product.slice(0, 45) + " | " + r.unitWeight + "g/Stk × " + r.quantity);
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
