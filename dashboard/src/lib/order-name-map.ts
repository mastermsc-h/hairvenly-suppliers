import { createClient } from "@/lib/supabase/server";

/**
 * Build a map from stock-sheet order name → order id in our DB.
 *
 * Stock sheets use names like "Amanda 07.04.2026", "China 10.03.2026".
 * Our order.label usually matches exactly, but sometimes with different
 * separators ("07-04-2026" vs "07.04.2026"). We try a few normalizations.
 */
export async function fetchOrderIdByName(): Promise<Record<string, string>> {
  const supabase = await createClient();
  const { data } = await supabase.from("orders").select("id, label");
  const map: Record<string, string> = {};
  if (!data) return map;
  for (const o of data as { id: string; label: string }[]) {
    if (!o.label) continue;
    const normalized = normalize(o.label);
    map[o.label] = o.id;
    map[normalized] = o.id;
  }
  // Also build a normalized lookup proxy — callers pass the sheet name,
  // we look up both the original AND the normalized form.
  return new Proxy(map, {
    get(target, prop: string) {
      if (typeof prop !== "string") return undefined;
      return target[prop] ?? target[normalize(prop)];
    },
  }) as Record<string, string>;
}

function normalize(s: string) {
  return s.trim().toLowerCase().replace(/[.\-\s]/g, "");
}
