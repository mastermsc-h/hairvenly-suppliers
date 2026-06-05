import { createClient } from "@/lib/supabase/server";

/**
 * Meta info we expose per order for sheet-mapped lookups.
 */
export interface OrderMeta {
  id: string;
  trackingNumber: string | null;
  trackingUrl: string | null;
  status: string | null;
  eta: string | null; // ISO YYYY-MM-DD from orders.eta
  /**
   * ETAs of all partial shipments that have not arrived yet, sorted ascending.
   * If non-empty, replaces the order-level ETA for stock display.
   */
  shipmentEtas: string[];
  /**
   * Per-position ETAs keyed by the Shopify product name (which matches
   * AlertProduct.product / Stock-Calc product name).
   * Map: shopify_name → set of distinct ETAs (ISO YYYY-MM-DD, sorted asc).
   * Used by stock views to show a product-specific ETA when one is set.
   */
  itemEtasByShopify: Map<string, string[]>;
}

/** Statuses where the order is considered archived and should be hidden everywhere. */
export const ARCHIVED_STATUS = new Set(["stocked", "cancelled"]);

export function isArchived(meta: OrderMeta | undefined | null): boolean {
  return !!meta && !!meta.status && ARCHIVED_STATUS.has(meta.status);
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
  const [{ data: orders }, { data: suppliers }, { data: shipmentRows }, { data: itemRows }] = await Promise.all([
    supabase
      .from("orders")
      .select("id, label, supplier_id, order_date, tracking_number, tracking_url, status, eta")
      .order("order_date", { ascending: false }),
    supabase.from("suppliers").select("id, name, regions"),
    supabase.from("order_shipments").select("id, order_id, eta, arrived_at"),
    // Items + shipment_id, damit wir per-Item das ETA aus dem zugehörigen
    // Shipment ableiten können wenn item.eta selbst null ist.
    supabase
      .from("order_items")
      .select("order_id, eta, shipment_id, product_colors!color_id(name_shopify)"),
  ]);

  // Map: shipment_id → eta (nur nicht-angekommene Shipments)
  const shipmentEtaById = new Map<string, string>();
  const shipmentsByOrder = new Map<string, string[]>();
  for (const s of (shipmentRows ?? []) as { id: string; order_id: string; eta: string | null; arrived_at: string | null }[]) {
    if (s.arrived_at) continue;
    if (!s.eta) continue;
    shipmentEtaById.set(s.id, s.eta);
    if (!shipmentsByOrder.has(s.order_id)) shipmentsByOrder.set(s.order_id, []);
    shipmentsByOrder.get(s.order_id)!.push(s.eta);
  }
  for (const arr of shipmentsByOrder.values()) arr.sort();

  // Per-order, per-Shopify-name ETA index.
  // KORREKTUR Teillieferungen: wenn item.eta NULL ist aber das Item in einem
  // Shipment liegt, nehmen wir das Shipment-ETA als per-Position-ETA. So bekommt
  // jedes Item das ETA seiner konkreten Teillieferung — nicht das earliest aller
  // Teillieferungen, was bei mehreren parallel laufenden Teilen falsch wäre.
  type ItemRow = {
    order_id: string;
    eta: string | null;
    shipment_id: string | null;
    product_colors: { name_shopify: string | null } | { name_shopify: string | null }[] | null;
  };
  const itemEtasByOrder = new Map<string, Map<string, Set<string>>>();
  for (const it of (itemRows ?? []) as ItemRow[]) {
    const pc = Array.isArray(it.product_colors) ? it.product_colors[0] : it.product_colors;
    const shopify = pc?.name_shopify;
    if (!shopify) continue;
    // Fallback-Kette: item.eta → shipment.eta (falls in Teillieferung)
    const effectiveEta = it.eta ?? (it.shipment_id ? shipmentEtaById.get(it.shipment_id) ?? null : null);
    if (!effectiveEta) continue;
    if (!itemEtasByOrder.has(it.order_id)) itemEtasByOrder.set(it.order_id, new Map());
    const m = itemEtasByOrder.get(it.order_id)!;
    if (!m.has(shopify)) m.set(shopify, new Set());
    m.get(shopify)!.add(effectiveEta);
  }

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
    status: string | null;
    eta: string | null;
  };

  // Build keys: "family|YYYY-MM-DD" → OrderMeta (canonical date = ISO).
  // Orders are sorted DESC, so first occurrence of a key wins (= newest order).
  for (const o of orders as Row[]) {
    // Build per-Shopify-name ETA list
    const itemMap = itemEtasByOrder.get(o.id);
    const itemEtasByShopify = new Map<string, string[]>();
    if (itemMap) {
      for (const [shopify, etaSet] of itemMap.entries()) {
        const arr = Array.from(etaSet).sort();
        itemEtasByShopify.set(shopify, arr);
      }
    }

    const meta: OrderMeta = {
      id: o.id,
      trackingNumber: o.tracking_number,
      trackingUrl: o.tracking_url,
      status: o.status ?? null,
      eta: o.eta ?? null,
      shipmentEtas: shipmentsByOrder.get(o.id) ?? [],
      itemEtasByShopify,
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

      // Normalize whitespace (collapse multiple spaces, trim)
      prop = prop.replace(/\s+/g, " ").trim();

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

      // Last resort A: match by date alone, ignoring family (in case supplier
      // is named differently in DB vs sheet)
      for (const y of tryYears) {
        for (const k of Object.keys(target)) {
          if (k.endsWith(`|${y}-${mmN}-${ddN}`)) return target[k];
          if (k.endsWith(`|${y}-${ddN}-${mmN}`)) return target[k];
        }
      }

      // Last resort B: ±1 day tolerance (timezone edge cases)
      for (const y of tryYears) {
        const variations = [
          shiftDay(`${y}-${mmN}-${ddN}`, -1),
          shiftDay(`${y}-${mmN}-${ddN}`, 1),
        ];
        for (const v of variations) {
          const key = `${fam}|${v}`;
          if (target[key]) return target[key];
        }
      }

      // Last resort C: label contains the date string (any format)
      const datePatterns = [
        `${ddN}.${mmN}.${tryYears[0]}`,
        `${ddN}-${mmN}-${tryYears[0]}`,
        `${ddN}/${mmN}/${tryYears[0]}`,
      ];
      for (const k of Object.keys(target)) {
        const lk = k.toLowerCase();
        if (!lk.startsWith(fam)) continue;
        if (datePatterns.some((p) => lk.includes(p))) return target[k];
      }

      return undefined;
    },
  }) as Record<string, OrderMeta>;
}

/** Shift ISO date by N days (positive or negative). Returns ISO string. */
function shiftDay(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
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
