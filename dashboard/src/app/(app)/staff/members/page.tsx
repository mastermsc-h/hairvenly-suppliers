import { requireFeature } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import type { FeatureKey, StaffMember } from "@/lib/types";
import MembersClient from "./members-client";

export const dynamic = "force-dynamic";
const STAFF_FEATURE = "staff" as FeatureKey;

export default async function StaffMembersPage() {
  await requireFeature(STAFF_FEATURE);
  const svc = createServiceClient();
  const { data } = await svc
    .from("staff_members")
    .select("*")
    .order("active", { ascending: false })
    .order("name");

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Mitarbeiter</h1>
        <p className="text-sm text-neutral-500">
          Stammdaten, Team, Jahresurlaub und Übertrag aus dem Vorjahr
        </p>
      </div>
      <MembersClient members={(data ?? []) as StaffMember[]} />
    </div>
  );
}
