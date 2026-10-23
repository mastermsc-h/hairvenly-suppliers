// Backfill für die Kunden-Analyse: alle Shopify-Bestellungen → kunden_bestellungen
// inkl. Namensherkunft (nur Hash-Cache, keine Klarnamen in der DB).
// Usage (aus dashboard/, Node ≥22): node --env-file=.env.local scripts/sync-kunden-analyse.mts [seitIsoDatum]
// Ohne Datum: kompletter Lauf. Wiederholbar — bereits klassifizierte Namen kommen aus dem Cache.

import { createClient } from "@supabase/supabase-js";
import { syncKundenBestellungen } from "../src/lib/kunden-analyse.ts";

const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

const seit = process.argv[2] ?? null;
const t0 = Date.now();
const res = await syncKundenBestellungen(supabase, { sinceIso: seit, log: (s) => console.log(s) });
console.log(`Fertig in ${Math.round((Date.now() - t0) / 1000)}s:`, res);
