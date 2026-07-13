import { redirect } from "next/navigation";
import { requireFeature } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import type {
  FeatureKey, StaffMember, TeamSetting, SalaryChange, StaffWarning,
  VacationRequest, VacationBlackout, StaffReview, StaffGoal, StaffTraining, StaffMemberMeta,
} from "@/lib/types";
import MembersClient from "./members-client";

export const dynamic = "force-dynamic";
const STAFF_FEATURE = "staff" as FeatureKey;

export default async function StaffMembersPage() {
  const profile = await requireFeature(STAFF_FEATURE);
  // Mitarbeiter-Stammdaten/Gehalt/Krankheit/Personalakte nur für den echten Admin.
  if (profile.role !== "admin") redirect("/staff/vacation");
  const svc = createServiceClient();

  const [
    { data }, { data: settings }, { data: requests }, { data: blackouts },
    { data: salaries }, { data: warnings },
    { data: reviews }, { data: goals }, { data: trainings }, { data: meta },
  ] = await Promise.all([
    svc.from("staff_members").select("*").order("active", { ascending: false }).order("name"),
    svc.from("team_settings").select("*"),
    svc.from("vacation_requests").select("*").order("start_date", { ascending: false }),
    svc.from("vacation_blackouts").select("*").order("start_md"),
    svc.from("staff_salary_changes").select("*").order("effective_date", { ascending: false }),
    svc.from("staff_warnings").select("*").order("warning_date", { ascending: false }),
    svc.from("staff_reviews").select("*").order("review_date", { ascending: false }),
    svc.from("staff_goals").select("*").order("created_at", { ascending: false }),
    svc.from("staff_trainings").select("*").order("training_date", { ascending: false }),
    svc.from("staff_member_meta").select("*"),
  ]);

  const requestsByMember = groupBy((requests ?? []) as VacationRequest[], (r) => r.staff_id);
  const salaryByMember = groupBy((salaries ?? []) as SalaryChange[], (s) => s.staff_id);
  const warningsByMember = groupBy((warnings ?? []) as StaffWarning[], (w) => w.staff_id);
  const reviewsByMember = groupBy((reviews ?? []) as StaffReview[], (r) => r.staff_id);
  const goalsByMember = groupBy((goals ?? []) as StaffGoal[], (g) => g.staff_id);
  const trainingsByMember = groupBy((trainings ?? []) as StaffTraining[], (t) => t.staff_id);
  const metaByMember: Record<string, StaffMemberMeta> = {};
  for (const m of (meta ?? []) as StaffMemberMeta[]) metaByMember[m.staff_id] = m;

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Mitarbeiter</h1>
        <p className="text-sm text-neutral-500">
          Stammdaten, Team, Urlaub · Gehalt, Probezeit, Verwarnungen, Ziele, Schulungen &amp; Gespräche (nur Admin)
        </p>
      </div>
      <MembersClient
        members={(data ?? []) as StaffMember[]}
        settings={(settings ?? []) as TeamSetting[]}
        blackouts={(blackouts ?? []) as VacationBlackout[]}
        requestsByMember={requestsByMember}
        isAdmin={true}
        today={today}
        salaryByMember={salaryByMember}
        warningsByMember={warningsByMember}
        reviewsByMember={reviewsByMember}
        goalsByMember={goalsByMember}
        trainingsByMember={trainingsByMember}
        metaByMember={metaByMember}
      />
    </div>
  );
}

function groupBy<T>(arr: T[], key: (t: T) => string): Record<string, T[]> {
  const out: Record<string, T[]> = {};
  for (const item of arr) {
    const k = key(item);
    (out[k] ??= []).push(item);
  }
  return out;
}
