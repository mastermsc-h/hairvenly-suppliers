import { createServiceClient } from "@/lib/supabase/server";
import type { createClient } from "@/lib/supabase/server";

type Supabase = Awaited<ReturnType<typeof createClient>>;

/**
 * Schreib-Client für order_items einer Bestellung.
 *
 * Lieferanten dürfen per RLS order_items nur LESEN. Aktionen, die Lieferanten
 * erlaubt sind (Bestell-ETA ändern, Teillieferungen anlegen/zuordnen/löschen),
 * müssen aber Positionen mitändern. Mit dem User-Client lief das Update still
 * ins Leere (0 Zeilen, kein Fehler) — Bug 23.10.2026: Amanda änderte die ETAs,
 * die Positionen behielten die alten Daten.
 *
 * Absicherung: Zugriff auf die Bestellung wird über den User-Client (RLS) geprüft;
 * nur wenn der User sie sehen darf, wird mit Service-Rechten geschrieben.
 */
export async function orderItemsWriter(supabase: Supabase, orderId: string) {
  const { data } = await supabase.from("orders").select("id").eq("id", orderId).maybeSingle();
  if (!data) return null;
  return createServiceClient();
}
