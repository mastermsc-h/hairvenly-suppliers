/**
 * DB-Stammdaten-Audit für product_colors.
 *
 * Findet:
 *   A) Slug↔Name-Mismatches (name_hairvenly = "ESPRESSO BROWN" aber
 *      shopify_url-Slug zeigt auf andere Farbe wie "caramel-fudge-…")
 *   B) Name↔Description-Mismatches (z.B. name_shopify = "DUNKELBLONDE"
 *      aber description sagt "Mokkabraun")
 *   C) Tippfehler in name_shopify (z.B. "MOKKABFAUNE")
 *
 * Output: stdout-Tabelle + JSON in scripts/tmp/product-colors-audit.json
 *
 * Nutzung:
 *   npx tsx scripts/audit-product-colors.ts
 */
import { createClient } from "@supabase/supabase-js";
import fs from "node:fs";

const env = fs.readFileSync(".env.local", "utf8");
const url = env.match(/NEXT_PUBLIC_SUPABASE_URL=(.+)/)![1].trim();
const key = env.match(/SUPABASE_SERVICE_ROLE_KEY=(.+)/)![1].trim();
const sb = createClient(url, key);

const COLOR_SYNONYMS: Array<[string, string]> = [
  ["braun", "brown"], ["schwarz", "black"], ["blond", "blonde"], ["rot", "red"],
  ["aschbraun", "ash"], ["asch", "ash"], ["mokka", "mocha"], ["mokkabraun", "mocha"],
  ["espresso", "espresso"], ["dunkel", "dark"], ["hell", "light"], ["kupfer", "copper"],
  ["karamell", "caramel"], ["honig", "honey"], ["pearl", "pearl"], ["snowy", "snowy"],
  ["smoky", "smoky"], ["taupe", "taupe"], ["champagner", "champagne"],
];
const STOPWORDS = new Set([
  "tape", "tapes", "bondings", "bonding", "weft", "wefts", "tressen", "ponytail",
  "extensions", "extension", "mini", "standard", "classic", "invisible", "genius",
  "clip", "clips", "keratin", "butterfly", "russisch", "russisches", "russischen",
  "russische", "usbekisch", "usbekische", "wellig", "wellige", "glatt", "glatte",
  "haar", "haare", "echthaar",
]);

function expand(t: string): Set<string> {
  const s = new Set([t]);
  for (const [a, b] of COLOR_SYNONYMS) {
    if (t === a || t.includes(a)) s.add(b);
    if (t === b || t.includes(b)) s.add(a);
  }
  return s;
}

function tokens(s: string): Set<string> {
  return new Set(
    s.toLowerCase()
      .replace(/[^a-zäöüß0-9\s\-/]/g, " ")
      .split(/[\s\-/]+/)
      .filter(t => t.length >= 3)
      .filter(t => !STOPWORDS.has(t))
      .filter(t => !/^\d+(cm|g)?$/.test(t))
      .filter(t => !/^[0-9]+[a-z]?$/.test(t))
      .flatMap(t => Array.from(expand(t)))
  );
}

function hasOverlap(a: Set<string>, b: Set<string>): boolean {
  for (const x of a) for (const y of b) if (x === y || x.includes(y) || y.includes(x)) return true;
  return false;
}

function extractSlug(u: string | null): string | null {
  if (!u) return null;
  const m = u.match(/\/products\/([a-z0-9\-_/]+)/i);
  return m ? m[1].toLowerCase() : null;
}

async function main() {
  const { data, error } = await sb
    .from("product_colors")
    .select("id, name_hairvenly, name_shopify, description, shopify_url, bot_active")
    .limit(2000);
  if (error) {
    console.error("DB error:", error.message);
    process.exit(1);
  }
  const rows = data || [];
  console.log(`Audit ${rows.length} product_colors rows...\n`);

  const issues: Array<{
    id: string;
    type: "slug_color_mismatch" | "name_desc_mismatch" | "typo_suspect" | "missing_url";
    severity: "high" | "medium" | "low";
    name_hairvenly: string;
    name_shopify: string | null;
    description: string | null;
    shopify_url: string | null;
    detail: string;
  }> = [];

  // Known typo patterns
  const TYPO_PATTERNS: Array<[RegExp, string]> = [
    [/mokkabfaune/i, "MOKKABFAUNE → MOKKABRAUNE"],
    [/aschbfaune/i, "ASCHBFAUNE → ASCHBRAUNE"],
    [/dunkelblune/i, "DUNKELBLUNE → DUNKELBLONDE"],
  ];

  for (const r of rows) {
    const nameH = (r.name_hairvenly as string) || "";
    const nameS = (r.name_shopify as string) || "";
    const desc = (r.description as string) || "";
    const slug = extractSlug(r.shopify_url as string | null);

    // C) Typos in name_shopify
    for (const [pat, msg] of TYPO_PATTERNS) {
      if (pat.test(nameS)) {
        issues.push({
          id: r.id, type: "typo_suspect", severity: "low",
          name_hairvenly: nameH, name_shopify: nameS, description: desc, shopify_url: r.shopify_url,
          detail: msg,
        });
      }
    }

    // missing URL
    if (!slug && r.bot_active) {
      issues.push({
        id: r.id, type: "missing_url", severity: "medium",
        name_hairvenly: nameH, name_shopify: nameS, description: desc, shopify_url: r.shopify_url,
        detail: "bot_active=true aber keine shopify_url",
      });
    }

    // A) Slug ↔ name_hairvenly mismatch
    if (slug && nameH) {
      const tH = tokens(nameH);
      const tSlug = tokens(slug);
      if (tH.size > 0 && tSlug.size > 0 && !hasOverlap(tH, tSlug)) {
        issues.push({
          id: r.id, type: "slug_color_mismatch", severity: "high",
          name_hairvenly: nameH, name_shopify: nameS, description: desc, shopify_url: r.shopify_url,
          detail: `name="${nameH}" hat keine Token-Überlappung mit URL-Slug "${slug}"`,
        });
      }
    }

    // B) name_shopify ↔ description mismatch (nur wenn beide Farb-Wörter haben)
    if (nameS && desc) {
      const tS = tokens(nameS);
      const tD = tokens(desc);
      if (tS.size >= 2 && tD.size >= 2 && !hasOverlap(tS, tD)) {
        issues.push({
          id: r.id, type: "name_desc_mismatch", severity: "high",
          name_hairvenly: nameH, name_shopify: nameS, description: desc, shopify_url: r.shopify_url,
          detail: `name_shopify-Tokens und description-Tokens haben keine Überlappung`,
        });
      }
    }
  }

  // Dedup by (id, type)
  const seen = new Set<string>();
  const dedup = issues.filter(i => {
    const k = i.id + "::" + i.type;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  // Summary
  const byType: Record<string, number> = {};
  const bySev: Record<string, number> = {};
  for (const i of dedup) {
    byType[i.type] = (byType[i.type] || 0) + 1;
    bySev[i.severity] = (bySev[i.severity] || 0) + 1;
  }

  console.log("=== Summary ===");
  console.log("Total issues:", dedup.length);
  console.log("By type:", byType);
  console.log("By severity:", bySev);
  console.log();

  // Print HIGH severity in detail
  console.log("=== HIGH severity (top 25) ===");
  const high = dedup.filter(i => i.severity === "high").slice(0, 25);
  for (const i of high) {
    console.log(`\n[${i.type}] id=${i.id.slice(0, 8)}`);
    console.log(`  name_hairvenly : ${i.name_hairvenly}`);
    console.log(`  name_shopify   : ${i.name_shopify}`);
    console.log(`  description    : ${(i.description || "").slice(0, 100)}`);
    console.log(`  shopify_url    : ${i.shopify_url}`);
    console.log(`  → ${i.detail}`);
  }

  fs.writeFileSync("scripts/tmp/product-colors-audit.json", JSON.stringify(dedup, null, 2));
  console.log(`\nFull list: scripts/tmp/product-colors-audit.json (${dedup.length} issues)`);
}

main().catch(e => { console.error(e); process.exit(1); });
