import { redirect } from "next/navigation";
import { Users } from "lucide-react";
import { requireProfile } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import KundenAnalyse, { type KundenDaten } from "./kunden-analyse";

export const dynamic = "force-dynamic";

// Supabase liefert max. 1000 Zeilen pro Request → seitenweise laden
async function alle<T>(
  supabase: ReturnType<typeof createServiceClient>,
  view: string,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from(view).select("*").range(from, from + 999);
    if (error) throw new Error(`${view}: ${error.message}`);
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < 1000) return out;
  }
}

export default async function KundenPage() {
  const profile = await requireProfile();
  // Umsätze + geschätzte Namensherkunft: nur der echte Admin (Mitarbeiter haben is_admin in der DB)
  if (profile.role !== "admin") redirect("/");
  const supabase = createServiceClient();

  const [monat, segment, land, stadt, kanal, lifetime, stand] = await Promise.all([
    alle<KundenDaten["monat"][number]>(supabase, "kunden_monat_v"),
    alle<KundenDaten["segment"][number]>(supabase, "kunden_segment_monat_v"),
    alle<KundenDaten["land"][number]>(supabase, "kunden_land_monat_v"),
    alle<KundenDaten["stadt"][number]>(supabase, "kunden_stadt_v"),
    alle<KundenDaten["kanal"][number]>(supabase, "kunden_kanal_monat_v"),
    alle<KundenDaten["lifetime"][number]>(supabase, "kunden_lifetime_v"),
    supabase.from("kunden_bestellungen").select("synced_at").order("synced_at", { ascending: false }).limit(1),
  ]);

  const zuletzt = stand.data?.[0]?.synced_at as string | undefined;

  return (
    <div className="p-4 md:p-8 max-w-6xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-neutral-900 inline-flex items-center gap-2">
          <Users size={22} className="text-indigo-500" /> Kundenanalyse
        </h1>
        <p className="text-sm text-neutral-500 mt-1">
          Alle Shopify-Bestellungen seit Juli 2024 (ohne Stornos, Umsatz nach Erstattungen)
          {zuletzt && <> · Stand {new Date(zuletzt).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "short" })}</>}
        </p>
      </div>
      {monat.length === 0 ? (
        <div className="bg-white rounded-2xl border border-neutral-200 p-6 shadow-sm text-sm text-neutral-500">
          Noch keine Daten — der Import läuft nachts automatisch.
        </div>
      ) : (
        <KundenAnalyse daten={{ monat, segment, land, stadt, kanal, lifetime }} />
      )}
    </div>
  );
}
