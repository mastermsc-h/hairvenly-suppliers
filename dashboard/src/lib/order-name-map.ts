import { createClient } from "@/lib/supabase/server";

/**
 * Build a map from stock-sheet order name → order id in our DB.
 *
 * Stock sheets use names like "Amanda 07.04.2026", "China 10.03.2026",
 * or even abbreviated "Amanda 03.02" (no year).
 * Our order.label may be "Amanda 07-04-2026" or "Eyfel Ebru (CN + TR) 07-04-2026".
 *
 * We build multiple normalized lookup keys per order and expose a Proxy
 * that tries several variants when looked up.
 */
export async function fetchOrderIdByName(): Promise<Record<string, string>> {
  const supabase = await createClient();
  const { data } = await supabase.from("orders").select("id, label");
  const map: Record<string, string> = {};
  if (!data) return map;

  for (const o of data as { id: string; label: string }[]) {
    if (!o.label) continue;
    // 1) Full normalized label: "amanda07042026" / "eyfelebru(cn+tr)07042026"
    const full = normalize(o.label);
    map[o.label] = o.id;
    map[full] = o.id;

    // 2) Extract date parts from label → build date-only and shortdate keys
    const dateMatch = o.label.match(/(\d{1,2})[.\-\/](\d{1,2})(?:[.\-\/](\d{2,4}))?/);
    if (dateMatch) {
      const [, dd, mm, yyyy] = dateMatch;
      const ddN = dd.padStart(2, "0");
      const mmN = mm.padStart(2, "0");
      // Try to pick a supplier "family" prefix from the label:
      //   "Amanda 07-04-2026" → "amanda"
      //   "Eyfel Ebru (CN + TR) 07-04-2026" → also register as "china" and "eyfel"
      const lowerLabel = o.label.toLowerCase();
      const supplierKeys: string[] = [];
      if (lowerLabel.startsWith("amanda")) supplierKeys.push("amanda");
      if (lowerLabel.includes("eyfel") || lowerLabel.includes("ebru") || lowerLabel.includes("cn")) {
        supplierKeys.push("china", "eyfel", "ebru");
      }
      if (supplierKeys.length === 0) {
        // Fallback: first word
        supplierKeys.push(lowerLabel.split(/\s+/)[0] ?? "");
      }
      for (const sk of supplierKeys) {
        // Long key (with year): "amanda07042026"
        if (yyyy) {
          const yyyyN = yyyy.length === 2 ? `20${yyyy}` : yyyy;
          const withYear = `${sk}${ddN}${mmN}${yyyyN}`;
          if (!map[withYear]) map[withYear] = o.id;
        }
        // Short key (no year): "amanda0302"
        const noYear = `${sk}${ddN}${mmN}`;
        if (!map[noYear]) map[noYear] = o.id;
      }
    }
  }

  // Proxy: on lookup, try several normalizations of the requested name.
  return new Proxy(map, {
    get(target, prop: string) {
      if (typeof prop !== "string") return undefined;
      // Direct hit
      if (target[prop]) return target[prop];
      const n = normalize(prop);
      if (target[n]) return target[n];
      // Try to extract date + supplier prefix from the query
      const dateMatch = prop.match(/(\d{1,2})[.\-\/](\d{1,2})(?:[.\-\/](\d{2,4}))?/);
      if (dateMatch) {
        const [, dd, mm, yyyy] = dateMatch;
        const ddN = dd.padStart(2, "0");
        const mmN = mm.padStart(2, "0");
        const first = prop.toLowerCase().split(/\s+/)[0];
        if (yyyy) {
          const yyyyN = yyyy.length === 2 ? `20${yyyy}` : yyyy;
          const k1 = `${first}${ddN}${mmN}${yyyyN}`;
          if (target[k1]) return target[k1];
        }
        const k2 = `${first}${ddN}${mmN}`;
        if (target[k2]) return target[k2];
      }
      return undefined;
    },
  }) as Record<string, string>;
}

function normalize(s: string) {
  return s.trim().toLowerCase().replace(/[.\-\s/()+]/g, "");
}
