/**
 * TREATWELL SCRAPER — holt Salon-Service-Preise direkt von der Treatwell-Seite.
 *
 * Architektur:
 *   - Treatwell ist eine SPA mit SSR-Daten in `window.__state__` (großes
 *     JSON-Blob am Ende des HTML). Wir fetchen die Seite, extrahieren das
 *     JSON via Regex und parsen es.
 *   - Pro Treatment gibt es `optionGroups` mit den konkreten Varianten
 *     (z.B. "50g", "75g", …) inkl. priceRange + durationRange.
 *
 * Stabilität:
 *   - Treatwell könnte das Markup oder die JSON-Struktur ändern. Wir loggen
 *     ausführlich, was wir gefunden haben, und werfen sprechende Errors
 *     wenn die erwarteten Pfade fehlen.
 *
 * Nutzung:
 *   const { services } = await scrapeTreatwellServices();
 *   → services ist ein Array<TreatwellService>
 */

const DEFAULT_URL =
  "https://buchung.treatwell.de/ort/hairvenly-extensions-hair-studio/";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export interface TreatwellService {
  /** Treatwell-Group ("Haarverlängerung", "Damen - Farbe & Coloration", …) */
  group: string;
  /** Treatwell-Treatment-ID (z.B. "TR7016428") */
  treatment_id: string;
  /** Treatment-Name ("Tape Extensions welliges Haar 45 - 65cm") */
  treatment_name: string;
  /** Optional Treatment-Beschreibung (gestripped HTML) */
  description: string | null;
  /** Konkrete Variante ("50g", "Komplett", null wenn keine Optionen) */
  variant_name: string | null;
  /** Preis-Min in EUR */
  price_min: number | null;
  /** Preis-Max in EUR */
  price_max: number | null;
  /** Dauer-Min in Minuten */
  duration_min: number | null;
  /** Dauer-Max in Minuten */
  duration_max: number | null;
}

interface TreatwellMenuItem {
  type?: string;
  data?: {
    id?: string;
    name?: string;
    description?: string | null;
    priceRange?: {
      minSalePriceAmount?: string;
      maxSalePriceAmount?: string;
    };
    durationRange?: {
      minDurationMinutes?: number;
      maxDurationMinutes?: number;
    };
    optionGroups?: Array<{
      name?: string;
      priceRange?: {
        minSalePriceAmount?: string;
        maxSalePriceAmount?: string;
      };
      durationRange?: {
        minDurationMinutes?: number;
        maxDurationMinutes?: number;
      };
    }>;
  };
}

interface TreatwellMenuGroup {
  name?: string;
  menuItems?: TreatwellMenuItem[];
}

interface TreatwellState {
  venue?: {
    venue?: {
      menu?: {
        menuGroups?: TreatwellMenuGroup[];
      };
    };
  };
}

/**
 * Holt das Treatwell-HTML.
 */
export async function fetchTreatwellHtml(url: string = DEFAULT_URL): Promise<string> {
  const res = await fetch(url, {
    headers: { "User-Agent": UA, "Accept-Language": "de-DE,de;q=0.9" },
    // Treatwell hat oft Cache-Header — wir wollen IMMER frisch.
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Treatwell HTTP ${res.status} ${res.statusText}`);
  }
  return await res.text();
}

/**
 * Extrahiert das `window.__state__`-JSON aus dem HTML.
 */
export function parseTreatwellState(html: string): TreatwellState {
  const m = html.match(/window\.__state__\s*=\s*(\{[\s\S]+?\});\s*<\/script>/);
  if (!m) {
    throw new Error("Treatwell: konnte window.__state__ JSON nicht finden im HTML");
  }
  try {
    return JSON.parse(m[1]) as TreatwellState;
  } catch (e) {
    throw new Error(`Treatwell: __state__ JSON parse error: ${(e as Error).message}`);
  }
}

/**
 * Wandelt einen Preis-String ("231.00") in eine Zahl um oder null.
 */
function toNum(s: string | number | undefined | null): number | null {
  if (s === null || s === undefined) return null;
  const n = typeof s === "number" ? s : parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

/**
 * Strip einfaches HTML aus dem Description-Feld (Treatwell escaped Sonderzeichen).
 */
function stripDescription(s: string | null | undefined): string | null {
  if (!s) return null;
  const decoded = s
    .replace(/&ouml;/g, "ö").replace(/&auml;/g, "ä").replace(/&uuml;/g, "ü")
    .replace(/&Ouml;/g, "Ö").replace(/&Auml;/g, "Ä").replace(/&Uuml;/g, "Ü")
    .replace(/&szlig;/g, "ß").replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ").replace(/&quot;/g, "\"")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return decoded.length > 0 ? decoded.slice(0, 400) : null;
}

/**
 * Aus dem State-JSON die flache Liste an Services bauen.
 * Pro Treatment mit optionGroups → ein Eintrag pro Option.
 * Pro Treatment ohne optionGroups → ein Eintrag mit variant_name=null.
 */
export function extractTreatwellServices(state: TreatwellState): TreatwellService[] {
  const groups = state.venue?.venue?.menu?.menuGroups;
  if (!Array.isArray(groups) || groups.length === 0) {
    throw new Error("Treatwell: keine menuGroups im State gefunden");
  }
  const out: TreatwellService[] = [];
  for (const group of groups) {
    if (!group.name || !Array.isArray(group.menuItems)) continue;
    for (const item of group.menuItems) {
      if (item.type !== "treatment" || !item.data) continue;
      const t = item.data;
      const treatmentName = t.name || "";
      if (!treatmentName) continue;
      const description = stripDescription(t.description);
      const options = Array.isArray(t.optionGroups) ? t.optionGroups : [];
      if (options.length === 0) {
        out.push({
          group: group.name,
          treatment_id: t.id || treatmentName,
          treatment_name: treatmentName,
          description,
          variant_name: null,
          price_min: toNum(t.priceRange?.minSalePriceAmount),
          price_max: toNum(t.priceRange?.maxSalePriceAmount),
          duration_min: t.durationRange?.minDurationMinutes ?? null,
          duration_max: t.durationRange?.maxDurationMinutes ?? null,
        });
      } else {
        for (const opt of options) {
          out.push({
            group: group.name,
            treatment_id: t.id || treatmentName,
            treatment_name: treatmentName,
            description,
            variant_name: opt.name || null,
            price_min: toNum(opt.priceRange?.minSalePriceAmount),
            price_max: toNum(opt.priceRange?.maxSalePriceAmount),
            duration_min: opt.durationRange?.minDurationMinutes ?? null,
            duration_max: opt.durationRange?.maxDurationMinutes ?? null,
          });
        }
      }
    }
  }
  return out;
}

/**
 * One-Shot-Helper: HTML holen, parsen, Services extrahieren.
 */
export async function scrapeTreatwellServices(
  url: string = DEFAULT_URL
): Promise<{ services: TreatwellService[]; scrapedAt: string; sourceUrl: string }> {
  const html = await fetchTreatwellHtml(url);
  const state = parseTreatwellState(html);
  const services = extractTreatwellServices(state);
  return {
    services,
    scrapedAt: new Date().toISOString(),
    sourceUrl: url,
  };
}
