/**
 * URL-VALIDATOR — Dauerhafter, deterministischer Schutz gegen erfundene
 * Produkt-URLs.
 *
 * ────────────────────────────────────────────────────────────────────────
 * PROBLEM (mehrfach beobachtet, zuletzt 2026-05-28):
 *   Bot generiert plausibel klingende Slugs aus Wörtern, die in der
 *   Beschreibung vorkamen (z.B. „usbekisch-wellig-tapes-5p18a-dark-ash-…"),
 *   aber die URL existiert in der Shopify-Datenbank nicht. Kundinnen
 *   klicken → 404 → Vertrauensbruch.
 *
 *   LLM-Prompting hat über Wochen versagt — Bot erfindet weiter. Auch
 *   stripColorUrlMismatch (regex-basiert) deckt nur ein paar bekannte
 *   Mismatch-Paare ab.
 *
 * LÖSUNG:
 *   Source-of-Truth ist die `product_colors.shopify_url` Spalte.
 *   Jede ausgehende Bot-Nachricht wird gegen diese Menge validiert.
 *   URLs, die NICHT existieren, werden STRIPPT.
 *
 * ARCHITEKTUR-PRINZIP:
 *   - Deterministisch (kann nicht durch LLM-Token-Druck ignoriert werden)
 *   - Cached (5 min in-Memory) → kein DB-Roundtrip pro Antwort
 *   - Defensive (bei DB-Fehler → KEINE URL stippen, lieber durchlassen
 *     als falsch positive Strips)
 *   - Single Source of Truth (product_colors-Tabelle, kein zweiter Index)
 *
 * INTEGRATION:
 *   Wird als finaler async Schritt NACH applyPostLlmSanitizers aufgerufen
 *   in respond.ts, /api/chat/route.ts, refine.ts. Eigene async Funktion,
 *   damit applyPostLlmSanitizers synchron bleiben kann (kein Cascade).
 *
 * SIBLING-SWEEP:
 *   - Collection-URLs (hairvenly.de/collections/…) auch validieren? → NEIN,
 *     wir haben keinen Collection-Index in der DB; Bot soll lieber gar
 *     keine Collection-Links posten (separate Regel). Diese Schicht
 *     validiert nur /products/-URLs.
 *   - Andere Domains (instagram.com/hairvenly etc.)? → durchlassen.
 *   - URL-Tracking-Parameter (?utm_…)? → vor Vergleich strippen.
 *   - Trailing Slash? → normalisieren.
 *   - Variant-IDs (?variant=…)? → vor Vergleich strippen, aber URL behalten
 *     (Variant-IDs sind valide Shopify-Form).
 */

import { createServiceClient } from "@/lib/supabase/server";

// ── In-Memory-Cache ─────────────────────────────────────────────────
let urlSetCache: Set<string> | null = null;
let urlSetCachedAt = 0;
const URL_CACHE_TTL_MS = 5 * 60 * 1000; // 5 Minuten

/**
 * Normalisiert eine Shopify-Produkt-URL für den Vergleich:
 *   - Lower-case host + path
 *   - Strip trailing slash
 *   - Strip query string (?variant=…, ?utm_…)
 *   - Strip fragment (#…)
 *   - Behält nur `/products/<slug>` (case-insensitive Path → lower)
 *
 * Returns: canonical slug (e.g. "5p18a-tape-extensions-55cm") or null
 *          wenn keine gültige Produkt-URL-Form.
 */
function extractProductSlug(rawUrl: string): string | null {
  try {
    // URLs mit/ohne Protokoll abfangen — manche Bot-Outputs vergessen https
    const normalizedRaw = /^https?:\/\//i.test(rawUrl)
      ? rawUrl
      : `https://${rawUrl.replace(/^\/+/, "")}`;
    const u = new URL(normalizedRaw);
    if (!/(^|\.)hairvenly\.de$/i.test(u.hostname)) return null;
    const path = u.pathname.toLowerCase().replace(/\/+$/, "");
    const m = path.match(/^\/products\/([a-z0-9\-_/]+)$/);
    if (!m) return null;
    return m[1];
  } catch {
    return null;
  }
}

/**
 * Lädt alle Shopify-Produkt-Slugs aus product_colors.shopify_url.
 * Gecacht für URL_CACHE_TTL_MS Millisekunden.
 *
 * Returns: Set von canonical Slugs (z.B. "5p18a-tape-extensions-55cm").
 */
async function getKnownProductSlugs(): Promise<Set<string> | null> {
  const now = Date.now();
  if (urlSetCache && now - urlSetCachedAt < URL_CACHE_TTL_MS) {
    return urlSetCache;
  }
  try {
    const supa = createServiceClient();
    // Pagination — product_colors kann mehrere tausend Zeilen haben
    const set = new Set<string>();
    let from = 0;
    const pageSize = 1000;
    for (let i = 0; i < 20; i++) {
      const { data, error } = await supa
        .from("product_colors")
        .select("shopify_url")
        .not("shopify_url", "is", null)
        .range(from, from + pageSize - 1);
      if (error) {
        console.warn("[url-validator] DB error loading product_colors:", error.message);
        // Bei DB-Fehler: bisher gesammelte URLs verwenden ODER null
        // (= keine Validation diesmal). Wir wählen null → defensive.
        return null;
      }
      if (!data || data.length === 0) break;
      for (const row of data) {
        const slug = extractProductSlug(row.shopify_url as string);
        if (slug) set.add(slug);
      }
      if (data.length < pageSize) break;
      from += pageSize;
    }
    if (set.size === 0) {
      console.warn("[url-validator] DB returned 0 URLs — skipping validation (defensive)");
      return null;
    }
    urlSetCache = set;
    urlSetCachedAt = now;
    console.log(`[url-validator] cached ${set.size} product slugs (TTL 5min)`);
    return set;
  } catch (e) {
    console.warn("[url-validator] load error:", (e as Error).message);
    return null;
  }
}

/**
 * Invalidiert den Cache manuell (z.B. nach Shopify-Sync).
 */
export function invalidateUrlCache(): void {
  urlSetCache = null;
  urlSetCachedAt = 0;
}

/**
 * Findet alle hairvenly.de/products/-URLs im Text und prüft jede
 * gegen die Source-of-Truth (product_colors.shopify_url).
 *
 * Strippt:
 *   - Markdown-Link-Form  [Label](URL)
 *   - URLs in Klammern    (https://hairvenly.de/products/…)
 *   - URLs auf eigener Zeile (mit optionalem Bullet/Prefix)
 *   - Inline-URLs        … schau mal hier: URL …
 *
 * Defensive:
 *   - DB-Fehler → unverändert zurückgeben (keine false-positive Strips)
 *   - Cache leer → unverändert zurückgeben
 *   - URL exists in DB → unverändert
 *
 * Returns: { text, strippedCount, invalidUrls }
 */
export async function stripNonexistentProductUrls(
  text: string
): Promise<{ text: string; strippedCount: number; invalidUrls: string[] }> {
  if (!text || !text.includes("hairvenly.de/products")) {
    return { text, strippedCount: 0, invalidUrls: [] };
  }

  const known = await getKnownProductSlugs();
  if (!known || known.size === 0) {
    // Defensive: keine Validation möglich → durchlassen
    return { text, strippedCount: 0, invalidUrls: [] };
  }

  const urlRe = /https?:\/\/(?:www\.)?hairvenly\.de\/products\/[A-Za-z0-9_\-/]+(?:\?[^\s)\]]*)?/g;
  const matches = Array.from(text.matchAll(urlRe));
  if (matches.length === 0) return { text, strippedCount: 0, invalidUrls: [] };

  const invalid: string[] = [];
  for (const m of matches) {
    const url = m[0];
    const slug = extractProductSlug(url);
    if (!slug) {
      // URL-Form irgendwie kaputt → strip
      invalid.push(url);
      continue;
    }
    if (!known.has(slug)) {
      invalid.push(url);
    }
  }

  if (invalid.length === 0) {
    return { text, strippedCount: 0, invalidUrls: [] };
  }

  let out = text;
  // Dedup
  const uniqueInvalid = Array.from(new Set(invalid));
  for (const badUrl of uniqueInvalid) {
    const esc = badUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // (1) Markdown-Link [Label](URL) → komplett raus
    out = out.replace(new RegExp(`\\[[^\\]\\n]+\\]\\(${esc}\\)`, "g"), "");
    // (2) URL in Klammern (URL) → komplett raus
    out = out.replace(new RegExp(`\\s*\\(${esc}\\)`, "g"), "");
    // (3) Bullet+URL auf eigener Zeile → ganze Zeile raus
    //     " - URL" / " • URL" / "  URL"
    out = out.replace(
      new RegExp(`(^|\\n)[ \\t]*[•\\-*]?[ \\t]*${esc}[ \\t]*(?=\\n|$)`, "g"),
      "$1"
    );
    // (4) Inline-URL (Rest des Textes) → nur URL strippen, Satz behalten
    out = out.replace(new RegExp(esc, "g"), "");
  }

  // Aufräumen: doppelte Leerzeilen, hängende Doppelpunkte, etc.
  out = out
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/:\s*\n/g, ":\n")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\(\s*\)/g, "")
    .trim();

  console.warn(
    `[url-validator] STRIPPED ${uniqueInvalid.length} invented URL(s):`,
    uniqueInvalid.map(u => u.slice(0, 100))
  );

  return {
    text: out,
    strippedCount: uniqueInvalid.length,
    invalidUrls: uniqueInvalid,
  };
}
