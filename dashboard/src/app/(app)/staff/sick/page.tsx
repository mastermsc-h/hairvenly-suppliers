import { redirect } from "next/navigation";
import { requireFeature } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import type { FeatureKey, StaffMember, SickDay } from "@/lib/types";
import SickClient from "./sick-client";

export const dynamic = "force-dynamic";
const STAFF_FEATURE = "staff" as FeatureKey;

export default async function SickPage() {
  const profile = await requireFeature(STAFF_FEATURE);
  // Krankheitstage sind sensibel → nur für den echten Admin.
  if (profile.role !== "admin") redirect("/staff/vacation");
  const svc = createServiceClient();

  const [{ data: members }, { data: sick }] = await Promise.all([
    svc.from("staff_members").select("*").eq("active", true).order("name"),
    svc.from("sick_days").select("*").order("start_date", { ascending: false }),
  ]);

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Krankheitstage</h1>
        <p className="text-sm text-neutral-500">
          Übersicht je Mitarbeiter, Bescheinigungs-Status und Krankheitsquote — ohne Diagnose
        </p>
      </div>
      <SickClient
        members={(members ?? []) as StaffMember[]}
        sickDays={(sick ?? []) as SickDay[]}
        today={today}
      />
    </div>
  );
}
