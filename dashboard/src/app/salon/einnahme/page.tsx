import { isSalonDevicePaired } from "@/lib/salon/auth";
import { createClient } from "@/lib/supabase/server";
import EinnahmeClient from "./einnahme-client";

export const dynamic = "force-dynamic";

// Öffentlich erreichbar (Mitarbeiter-Handys ohne Dashboard-Login) — nur auf freigeschalteten Geräten nutzbar
export default async function SalonEinnahmePage() {
  if (!(await isSalonDevicePaired())) {
    return (
      <div className="flex-1 flex items-center justify-center p-6 text-center">
        <div className="max-w-sm space-y-3">
          <div className="text-2xl font-bold">Gerät nicht freigeschaltet</div>
          <div className="text-neutral-400">
            Bitte im Dashboard unter Salon → Einnahmen „Handy freischalten“ wählen und den QR-Code mit diesem Gerät scannen.
          </div>
        </div>
      </div>
    );
  }
  // Zurück zum Salon-Menü nur, wenn das Gerät auch im Dashboard eingeloggt ist (Salon-iPad)
  const { data } = await (await createClient()).auth.getUser();
  return <EinnahmeClient zurueck={!!data.user} />;
}
