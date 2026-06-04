import { requireFeature } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import type { FeatureKey, StaffMember, TeamSetting } from "@/lib/types";
import MembersClient from "./members-client";

export const dynamic = "force-dynamic";
const STAFF_FEATURE = "staff" as FeatureKey;

export default async function StaffMembersPage() {
  await requireFeature(STAFF_FEATURE);
  const svc = createServiceClient();
  const [{ data }, { data: settings }] = await Promise.all([
    svc.from("staff_members").select("*").order("active", { ascending: false }).order("name"),
    svc.from("team_settings").select("*"),
  ]);

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Mitarbeiter</h1>
        <p className="text-sm text-neutral-500">
          Stammdaten, Team, Jahresurlaub, Azubis, Geburtstage und Team-Besetzung
        </p>
      </div>
      <MembersClient
        members={(data ?? []) as StaffMember[]}
        settings={(settings ?? []) as TeamSetting[]}
      />
    </div>
  );
}
