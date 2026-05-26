/**
 * Shopify-Live-Availability-Check.
 *
 * Liest das öffentliche `/products/<handle>.js` Endpoint, um zu erfahren ob
 * ein Produkt aktuell auf hairvenly.de verkäuflich ist. Notwendig weil das
 * Stock Calculation Google Sheet (Bot-Datenquelle) und Shopify (Kundinnen-
 * Sicht) divergieren können:
 *   - Sheet zählt physischen Lagerbestand in Bremen
 *   - Shopify zählt sellable inventory (− Reservierungen − Pending Orders)
 *
 * User-Bug 2026-05-26: Bot sagte "auf Lager", Shopify zeigte "Ausverkauft" auf
 * derselben Produktseite. Kundin verliert Vertrauen.
 *
 * Architektur:
 *   - Public endpoint, kein Auth nötig
 *   - In-Memory-Cache mit 5min TTL (per Vercel-Function-Instance)
 *   - Timeout 1.5s, bei Fehler null zurück → Caller fällt auf Sheet-Logik zurück
 */

const CACHE_TTL_MS = 5 * 60 * 1000; // 5 Minuten
const FETCH_TIMEOUT_MS = 1500;

type CacheEntry = { available: boolean | null; checkedAt: number };
const cache = new Map<string, CacheEntry>();

/**
 * Returns the Shopify availability for a product URL.
 *
 * @returns
 *   true  → Shopify says product is sellable
 *   false → Shopify says product is sold out
 *   null  → Check failed (network, timeout, no URL, parse error) — Caller
 *           should fall back to Sheet-only logic
 */
export async function checkShopifyAvailability(
  productUrl: string | null | undefined,
): Promise<boolean | null> {
  if (!productUrl) return null;
  // URL muss auf /products/<handle> zeigen
  const m = productUrl.match(/\/products\/([a-z0-9\-_]+)/i);
  if (!m) return null;
  const handle = m[1];

  // Cache-Check
  const cacheKey = handle.toLowerCase();
  const cached = cache.get(cacheKey);
  const now = Date.now();
  if (cached && now - cached.checkedAt < CACHE_TTL_MS) {
    return cached.available;
  }

  const jsUrl = `https://hairvenly.de/products/${handle}.js`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(jsUrl, {
      signal: controller.signal,
      headers: { "User-Agent": "Hairvenly-Bot/1.0" },
    });
    if (!res.ok) {
      cache.set(cacheKey, { available: null, checkedAt: now });
      return null;
    }
    const data: { available?: boolean; variants?: { available?: boolean }[] } = await res.json();
    // Produkt-Level: `available` ist true wenn IRGENDEINE Variante verkäuflich ist.
    let available: boolean | null = null;
    if (typeof data.available === "boolean") {
      available = data.available;
    } else if (Array.isArray(data.variants)) {
      available = data.variants.some(v => v?.available === true);
    }
    cache.set(cacheKey, { available, checkedAt: now });
    return available;
  } catch (e) {
    // AbortError, network error, JSON parse error → Caller-Fallback
    console.warn(`[shopify-availability] check failed for ${handle}:`, (e as Error).message);
    // NICHT cachen bei Fehler — beim nächsten Request neu versuchen
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Bulk-Variante — parallele Checks. Bei vielen Produkten effizienter als
 * einzelne sequentielle Calls. Liefert eine Map<url, boolean|null>.
 */
export async function checkShopifyAvailabilityBulk(
  urls: (string | null | undefined)[],
): Promise<Map<string, boolean | null>> {
  const unique = Array.from(new Set(urls.filter((u): u is string => !!u)));
  const results = await Promise.all(
    unique.map(async u => [u, await checkShopifyAvailability(u)] as const),
  );
  return new Map(results);
}
