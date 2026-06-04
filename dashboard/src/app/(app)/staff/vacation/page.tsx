import { requireFeature } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import type { FeatureKey, StaffMember, VacationRequest } from "@/lib/types";
import VacationClient from "./vacation-client";

export const dynamic = "force-dynamic";
const STAFF_FEATURE = "staff" as FeatureKey;

export default async function VacationPage() {
  await requireFeature(STAFF_FEATURE);
  const svc = createServiceClient();

  const [{ data: members }, { data: requests }] = await Promise.all([
    svc.from("staff_members").select("*").eq("active", true).order("name"),
    svc.from("vacation_requests").select("*").order("start_date", { ascending: false }),
  ]);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Urlaubskalender</h1>
        <p className="text-sm text-neutral-500">
          Anspruch, Übertrag, verbraucht, geplant — und vor allem: wie viel noch verfügbar ist
        </p>
      </div>
      <VacationClient
        members={(members ?? []) as StaffMember[]}
        requests={(requests ?? []) as VacationRequest[]}
        today={today}
      />
    </div>
  );
}
