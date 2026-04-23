import { createClient } from "@/lib/supabase/server";

/**
 * Meta info we expose per order for sheet-mapped lookups.
 */
export interface OrderMeta {
  id: string;
  trackingNumber: string | null;
  trackingUrl: string | null;
}

/**
 * Build a map from stock-sheet order name → order meta (id + tracking).
 *
 * Stock sheets use names like:
 *   - "Amanda 07.04.2026"
 *   - "Amanda 07-04-2026"
 *   - "China 10/03/2026"
 *   - "Amanda 03.02" (abbreviated, no year — assume current year)
 *
 * Primary matching: by (supplier family + canonical date YYYY-MM-DD).
 * Separator-agnostic: accepts `.`, `-`, `/`, ` ` between date parts.
 */
export async function fetchOrderIdByName(): Promise<Record<string, OrderMeta>> {
  const supabase = await createClient();

  // Include ALL orders (not just active) — sheet transit data may lag behind
  // DB status changes. We want to link badges even for delivered/cancelled orders.
  const [{ data: orders }, { data: suppliers }] = await Promise.all([
    supabase
      .from("orders")
      .select("id, label, supplier_id, order_date, tracking_number, tracking_url, status")
      .order("order_date", { ascending: false }),
    supabase.from("suppliers").select("id, name, regions"),
  ]);

  const map: Record<string, OrderMeta> = {};
  if (!orders || orders.length === 0) return map;

  // Supplier lookup: id → family keys
  const supplierFamilies = new Map<string, Set<string>>();
  for (const s of suppliers ?? []) {
    const lname = (s.name ?? "").toLowerCase();
    const families = new Set<string>();
    if (lname.includes("amanda")) families.add("amanda");
    if (lname.includes("eyfel") || lname.includes("ebru")) {
      families.add("eyfel");
      families.add("ebru");
      families.add("china"); // Eyfel = China in stock sheet
    }
    if (lname.includes("aria")) families.add("aria");
    for (const r of s.regions ?? []) {
      const lr = String(r).toLowerCase();
      if (lr === "cn" || lr === "china") families.add("china");
      if (lr === "tr" || lr === "turkey") families.add("turkey");
    }
    if (families.size === 0) {
      const first = lname.split(/\s+/)[0];
      if (first) families.add(first);
    }
    supplierFamilies.set(s.id, families);
  }

  type Row = {
    id: string;
    label: string | null;
    supplier_id: string;
    order_date: string | null;
    tracking_number: string | null;
    tracking_url: string | null;
  };

  // Build keys: "family|YYYY-MM-DD" → OrderMeta (canonical date = ISO).
  // Orders are sorted DESC, so first occurrence of a key wins (= newest order).
  for (const o of orders as Row[]) {
    const meta: OrderMeta = {
      id: o.id,
      trackingNumber: o.tracking_number,
      trackingUrl: o.tracking_url,
    };

    const iso = toIsoDate(o.order_date);
    if (iso) {
      const families = supplierFamilies.get(o.supplier_id) ?? new Set<string>();
      for (const fam of families) {
        const kFull = `${fam}|${iso}`;
        if (!map[kFull]) map[kFull] = meta;
        // Also short key (no year) for abbreviated sheet names
        const [, mm, dd] = iso.split("-");
        const kShort = `${fam}|${mm}-${dd}`;
        if (!map[kShort]) map[kShort] = meta;
      }
    }

    if (o.label) {
      if (!map[o.label]) map[o.label] = meta;
      const nkey = normalize(o.label);
      if (!map[nkey]) map[nkey] = meta;
    }
  }

  // Proxy: extract family + date from ANY position in the string, then look up.
  return new Proxy(map, {
    get(target, prop: string) {
      if (typeof prop !== "string") return undefined;

      // 1) Direct hit (label or normalized label)
      if (target[prop]) return target[prop];
      const n = normalize(prop);
      if (target[n]) return target[n];

      // 2) Extract family: first "word-ish" token from the string.
      //    Accept anything up to the first whitespace or digit.
      const famMatch = prop.trim().match(/^([^\d\s.\-\/]+)/);
      const fam = famMatch ? famMatch[1].toLowerCase() : "";

      // 3) Extract date: find "DD<sep>MM(<sep>YYYY)?" anywhere in the string.
      //    Separators: . - / (any combination, even mixed).
      const dateMatch = prop.match(
        /(\d{1,2})[.\-\/](\d{1,2})(?:[.\-\/](\d{2,4}))?/,
      );
      if (!dateMatch || !fam) return undefined;

      const [, dd, mm, yyyy] = dateMatch;
      const ddN = dd.padStart(2, "0");
      const mmN = mm.padStart(2, "0");

      const tryYears: string[] = [];
      if (yyyy) {
        tryYears.push(yyyy.length === 2 ? `20${yyyy}` : yyyy);
      } else {
        const y = new Date().getFullYear();
        tryYears.push(String(y), String(y - 1), String(y + 1));
      }

      // Primary: DD.MM interpretation (German format)
      for (const y of tryYears) {
        const key = `${fam}|${y}-${mmN}-${ddN}`;
        if (target[key]) return target[key];
      }

      // No-year fallback
      const noYear = `${fam}|${mmN}-${ddN}`;
      if (target[noYear]) return target[noYear];

      // DD/MM swap fallback (only if both ≤ 12 and not equal)
      if (parseInt(ddN, 10) <= 12 && parseInt(mmN, 10) <= 12 && ddN !== mmN) {
        for (const y of tryYears) {
          const key = `${fam}|${y}-${ddN}-${mmN}`;
          if (target[key]) return target[key];
        }
        const noYearSwap = `${fam}|${ddN}-${mmN}`;
        if (target[noYearSwap]) return target[noYearSwap];
      }

      // Last resort: match by date alone, ignoring family (in case supplier
      // is named differently in DB vs sheet)
      for (const y of tryYears) {
        // Scan all keys for any family with this date
        for (const k of Object.keys(target)) {
          if (k.endsWith(`|${y}-${mmN}-${ddN}`)) return target[k];
        }
      }

      return undefined;
    },
  }) as Record<string, OrderMeta>;
}

/**
 * Convert any date string to ISO "YYYY-MM-DD".
 * Accepts:
 *   - "2026-03-03" (ISO from Postgres — passthrough)
 *   - "03.03.2026" / "03-03-2026" / "03/03/2026" (DE format)
 *   - "3.3.26" (short)
 */
function toIsoDate(input: string | null): string | null {
  if (!input) return null;
  const s = input.trim();

  // Already ISO: "YYYY-MM-DD..."
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;

  // DE format: "DD<sep>MM<sep>YYYY" or "DD<sep>MM<sep>YY"
  const de = s.match(/^(\d{1,2})[.\-\/](\d{1,2})[.\-\/](\d{2,4})/);
  if (de) {
    const dd = de[1].padStart(2, "0");
    const mm = de[2].padStart(2, "0");
    const yyyy = de[3].length === 2 ? `20${de[3]}` : de[3];
    return `${yyyy}-${mm}-${dd}`;
  }

  return null;
}

function normalize(s: string) {
  return s.trim().toLowerCase().replace(/[.\-\s/()+]/g, "");
}
