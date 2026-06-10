/**
 * REGRESSION-GATE RUNNER — führt ALLE Smoke-Suiten aus (scripts/smoke/*.spec.mjs).
 *
 * Zweck (User-Anweisung 09.06): "Dinge, die gefixt waren, dürfen nie wieder
 * still kaputtgehen." Jede historische Kundenbeschwerde ist als Testfall in
 * einer Spec einzementiert. Dieser Runner ist das Gate:
 *   - manuell:    npm run smoke   (im dashboard/-Ordner)
 *   - erzwungen:  .githooks/pre-push (blockiert den Push bei rotem Test)
 *
 * Neue Bug-Klasse? → neue *.spec.mjs in diesem Ordner ablegen — der Runner
 * findet sie automatisch, nichts registrieren.
 *
 * Exit-Code: 0 = alles grün, 1 = mindestens eine Suite rot.
 */
import { readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = dirname(fileURLToPath(import.meta.url));
// Specs laden Quell-Dateien relativ zum CWD (z.B. src/lib/chatbot/…) — daher
// CWD fest auf den dashboard-Ordner pinnen, egal von wo der Runner startet
// (npm run smoke ODER .githooks/pre-push aus dem Repo-Root).
const dashboardRoot = join(dir, "..", "..");
const specs = readdirSync(dir).filter((f) => f.endsWith(".spec.mjs")).sort();

if (specs.length === 0) {
  console.error("⚠️  Keine *.spec.mjs in scripts/smoke/ gefunden — Gate wirkungslos!");
  process.exit(1);
}

console.log(`\n🛡️  REGRESSION-GATE — ${specs.length} Suiten\n`);
let failed = 0;
const t0 = Date.now();
for (const spec of specs) {
  const r = spawnSync(process.execPath, [join(dir, spec)], { encoding: "utf8", timeout: 60_000, cwd: dashboardRoot });
  const out = (r.stdout || "") + (r.stderr || "");
  const passLine = out.split("\n").find((l) => /PASS:/i.test(l)) || "";
  if (r.status === 0) {
    console.log(`  ✅ ${spec}  ${passLine.trim()}`);
  } else {
    failed++;
    console.log(`  ❌ ${spec} — FEHLGESCHLAGEN:\n`);
    console.log(out.split("\n").map((l) => `     ${l}`).join("\n"));
  }
}
console.log(`\n${failed === 0 ? "✅ ALLE SUITEN GRÜN" : `❌ ${failed} SUITE(N) ROT`} (${((Date.now() - t0) / 1000).toFixed(1)}s)\n`);
process.exit(failed === 0 ? 0 : 1);
