import { requireFeature } from "@/lib/auth";
import { createServiceClient } from "@/lib/supabase/server";
import type { FeatureKey, StaffMember, VacationRequest, TeamSetting, VacationBlackout } from "@/lib/types";
import VacationClient from "./vacation-client";

export const dynamic = "force-dynamic";
const STAFF_FEATURE = "staff" as FeatureKey;

export default async function VacationPage() {
  const profile = await requireFeature(STAFF_FEATURE);
  // Nur der echte Admin (role==="admin") darf verwalten + kumulierte Stände sehen.
  // Mitarbeiter (role==="employee") sind reine Betrachter des Kalenders.
  const isAdmin = profile.role === "admin";
  const svc = createServiceClient();

  const [{ data: membersRaw }, { data: requests }, { data: settings }, { data: blackouts }] = await Promise.all([
    svc.from("staff_members").select("*").eq("active", true).order("name"),
    svc.from("vacation_requests").select("*").order("start_date", { ascending: false }),
    svc.from("team_settings").select("*"),
    svc.from("vacation_blackouts").select("*").order("start_md"),
  ]);

  // Für Nicht-Admins sensible Urlaubs-Kennzahlen (Anspruch/Übertrag) entfernen,
  // damit auch im Netzwerk-Payload keine kumulierten Stände anderer sichtbar sind.
  const members = ((membersRaw ?? []) as StaffMember[]).map((m) =>
    isAdmin ? m : { ...m, annual_vacation_days: 0, carryover_days: 0, carryover_expires_on: null, employment_start: null },
  );

  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="p-4 md:p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Urlaubskalender</h1>
        <p className="text-sm text-neutral-500">
          {isAdmin
            ? "Anspruch, Übertrag, verbraucht, geplant — und vor allem: wie viel noch verfügbar ist"
            : "Übersicht, wer wann im Urlaub ist"}
        </p>
      </div>
      <VacationClient
        members={members}
        requests={(requests ?? []) as VacationRequest[]}
        settings={(settings ?? []) as TeamSetting[]}
        blackouts={(blackouts ?? []) as VacationBlackout[]}
        isAdmin={isAdmin}
        today={today}
      />
    </div>
  );
}
