import { requireFeature } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import type {
  FeatureKey, StaffMember, TeamSetting, SalaryChange, StaffWarning,
  VacationRequest, VacationBlackout,
} from "@/lib/types";
import MembersClient from "./members-client";

export const dynamic = "force-dynamic";
const STAFF_FEATURE = "staff" as FeatureKey;

export default async function StaffMembersPage() {
  const profile = await requireFeature(STAFF_FEATURE);
  const isAdmin = profile.role === "admin" || profile.is_admin;
  const svc = createServiceClient();

  const [{ data }, { data: settings }, { data: requests }, { data: blackouts }] = await Promise.all([
    svc.from("staff_members").select("*").order("active", { ascending: false }).order("name"),
    svc.from("team_settings").select("*"),
    svc.from("vacation_requests").select("*").order("start_date", { ascending: false }),
    svc.from("vacation_blackouts").select("*").order("start_md"),
  ]);

  const requestsByMember = groupBy((requests ?? []) as VacationRequest[], (r) => r.staff_id);

  // Sensible Daten (Gehalt, Verwarnungen) NUR für Admins laden.
  let salaryByMember: Record<string, SalaryChange[]> = {};
  let warningsByMember: Record<string, StaffWarning[]> = {};
  if (isAdmin) {
    const [{ data: salaries }, { data: warnings }] = await Promise.all([
      svc.from("staff_salary_changes").select("*").order("effective_date", { ascending: false }),
      svc.from("staff_warnings").select("*").order("warning_date", { ascending: false }),
    ]);
    salaryByMember = groupBy((salaries ?? []) as SalaryChange[], (s) => s.staff_id);
    warningsByMember = groupBy((warnings ?? []) as StaffWarning[], (w) => w.staff_id);
  }

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Mitarbeiter</h1>
        <p className="text-sm text-neutral-500">
          Stammdaten, Team, Jahresurlaub, Azubis, Geburtstage und Team-Besetzung
          {isAdmin && " · Gehalt, Probezeit & Verwarnungen (nur Admin)"}
        </p>
      </div>
      <MembersClient
        members={(data ?? []) as StaffMember[]}
        settings={(settings ?? []) as TeamSetting[]}
        blackouts={(blackouts ?? []) as VacationBlackout[]}
        requestsByMember={requestsByMember}
        isAdmin={isAdmin}
        today={today}
        salaryByMember={salaryByMember}
        warningsByMember={warningsByMember}
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
