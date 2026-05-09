import { requireFeature } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import EmployeeManager from "./employee-manager";
import type { FeatureKey } from "@/lib/types";

export const dynamic = "force-dynamic";
const SALON_FEATURE = "salon" as FeatureKey;

export default async function SalonEmployeesPage() {
  await requireFeature(SALON_FEATURE);
  const svc = createServiceClient();
  const { data } = await svc
    .from("salon_employees")
    .select("id, name, pin, color, active")
    .order("name");
  return (
    <div className="p-4 md:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Salon-Mitarbeiter</h1>
        <p className="text-sm text-neutral-500">PINs fuer das Friseur-iPad</p>
      </div>
      <EmployeeManager
        employees={(data ?? []).map((e) => ({
          id: e.id,
          name: e.name,
          pin: e.pin,
          color: e.color,
          active: e.active,
        }))}
      />
    </div>
  );
}
