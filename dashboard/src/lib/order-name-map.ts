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

  const [{ data: orders }, { data: suppliers }] = await Promise.all([
    supabase
      .from("orders")
      .select("id, label, supplier_id, order_date, tracking_number, tracking_url")
      .not("status", "in", '("delivered","cancelled")'),
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

  // Build keys: "family|YYYY-MM-DD" → OrderMeta (canonical date = ISO)
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
        map[`${fam}|${iso}`] = meta;
        // Also short key (no year) for abbreviated sheet names
        const [, mm, dd] = iso.split("-");
        map[`${fam}|${mm}-${dd}`] = meta;
      }
    }

    if (o.label) {
      map[o.label] = meta;
      map[normalize(o.label)] = meta;
    }
  }

  // Proxy: parse sheet name into (family + canonical date) and look up.
  return new Proxy(map, {
    get(target, prop: string) {
      if (typeof prop !== "string") return undefined;

      // 1) Direct hit (label or normalized label)
      if (target[prop]) return target[prop];
      const n = normalize(prop);
      if (target[n]) return target[n];

      // 2) Parse "Supplier DD<sep>MM<sep>YYYY" or "Supplier DD<sep>MM"
      //    separators: . - / (any combination)
      const m = prop.match(
        /^([\wÀ-ÿ]+(?:\s+[\wÀ-ÿ()+-]+)*?)\s+(\d{1,2})[.\-\/\s](\d{1,2})(?:[.\-\/\s](\d{2,4}))?/i,
      );
      if (!m) return undefined;

      const [, supplierRaw, dd, mm, yyyy] = m;
      const fam = supplierRaw.trim().split(/\s+/)[0].toLowerCase();
      const ddN = dd.padStart(2, "0");
      const mmN = mm.padStart(2, "0");

      const tryYears: string[] = [];
      if (yyyy) {
        tryYears.push(yyyy.length === 2 ? `20${yyyy}` : yyyy);
      } else {
        // No year — try current year ± 1 (orders might span year boundary)
        const y = new Date().getFullYear();
        tryYears.push(String(y), String(y - 1), String(y + 1));
      }

      for (const y of tryYears) {
        const iso = `${y}-${mmN}-${ddN}`;
        const key = `${fam}|${iso}`;
        if (target[key]) return target[key];
      }

      // 3) No-year fallback key
      const noYear = `${fam}|${mmN}-${ddN}`;
      if (target[noYear]) return target[noYear];

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
