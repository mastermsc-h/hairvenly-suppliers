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
 *   - "China 10.03.2026"
 *   - "Amanda 03.02" (abbreviated, no year — assume current year)
 *
 * Primary matching: by (supplier family + order_date) — not by label string.
 * This is robust regardless of how the user named the order in our DB.
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

  // Supplier lookup: id → family keys (china|eyfel|ebru or amanda)
  const supplierFamilies = new Map<string, Set<string>>();
  for (const s of suppliers ?? []) {
    const lname = (s.name ?? "").toLowerCase();
    const families = new Set<string>();
    if (lname.includes("amanda")) families.add("amanda");
    if (lname.includes("eyfel") || lname.includes("ebru")) {
      families.add("eyfel");
      families.add("ebru");
      // Eyfel = China in stock sheet
      families.add("china");
    }
    // Region-based hints
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

  // Build keys: "family|DD.MM.YYYY" → OrderMeta
  type Row = {
    id: string;
    label: string | null;
    supplier_id: string;
    order_date: string | null;
    tracking_number: string | null;
    tracking_url: string | null;
  };
  for (const o of orders as Row[]) {
    const meta: OrderMeta = {
      id: o.id,
      trackingNumber: o.tracking_number,
      trackingUrl: o.tracking_url,
    };

    if (o.order_date) {
      const [yyyy, mm, dd] = o.order_date.split("-");
      if (yyyy && mm && dd) {
        const families = supplierFamilies.get(o.supplier_id) ?? new Set<string>();
        for (const fam of families) {
          map[`${fam}|${dd}.${mm}.${yyyy}`] = meta;
          map[`${fam}|${dd}.${mm}`] = meta;
        }
      }
    }

    if (o.label) {
      map[o.label] = meta;
      map[normalize(o.label)] = meta;
    }
  }

  // Proxy: parse "Supplier DD.MM.YYYY" from the sheet name and look up.
  return new Proxy(map, {
    get(target, prop: string) {
      if (typeof prop !== "string") return undefined;

      if (target[prop]) return target[prop];
      const n = normalize(prop);
      if (target[n]) return target[n];

      const m = prop.match(/^([\wÀ-ÿ]+)\s+(\d{1,2})[.\-\/](\d{1,2})(?:[.\-\/](\d{2,4}))?/i);
      if (!m) return undefined;

      const [, supplierRaw, dd, mm, yyyy] = m;
      const fam = supplierRaw.toLowerCase();
      const ddN = dd.padStart(2, "0");
      const mmN = mm.padStart(2, "0");

      if (yyyy) {
        const yyyyN = yyyy.length === 2 ? `20${yyyy}` : yyyy;
        const key = `${fam}|${ddN}.${mmN}.${yyyyN}`;
        if (target[key]) return target[key];
      }

      const thisYear = new Date().getFullYear();
      for (const y of [thisYear, thisYear - 1, thisYear + 1]) {
        const key = `${fam}|${ddN}.${mmN}.${y}`;
        if (target[key]) return target[key];
      }

      const noYear = `${fam}|${ddN}.${mmN}`;
      if (target[noYear]) return target[noYear];

      return undefined;
    },
  }) as Record<string, OrderMeta>;
}

function normalize(s: string) {
  return s.trim().toLowerCase().replace(/[.\-\s/()+]/g, "");
}
