"use server";

import { revalidatePath } from "next/cache";
import { createServiceClient } from "@/lib/supabase/server";
import { requireFeature, requireAdmin } from "@/lib/auth";
import { countWorkdays, countCalendarDays } from "@/lib/staff/holidays";
import type { FeatureKey } from "@/lib/types";

const STAFF_FEATURE = "staff" as FeatureKey;
const BUCKET = "staff-documents";

function str(v: FormDataEntryValue | null): string | null {
  const s = (v == null ? "" : String(v)).trim();
  return s === "" ? null : s;
}
function numOr(v: FormDataEntryValue | null, fallback: number): number {
  const n = Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : fallback;
}

function revalidateAll() {
  revalidatePath("/staff/vacation");
  revalidatePath("/staff/sick");
  revalidatePath("/staff/members");
}

// ─── Mitarbeiter-Stammdaten ──────────────────────────────────────

export async function createStaffMember(_prev: unknown, formData: FormData) {
  const profile = await requireFeature(STAFF_FEATURE);
  const isAdmin = profile.role === "admin" || profile.is_admin;
  const svc = createServiceClient();
  const name = str(formData.get("name"));
  const team = str(formData.get("team"));
  if (!name) return { error: "Name fehlt." };
  if (!team) return { error: "Team fehlt." };

  const employmentStart = str(formData.get("employment_start"));
  const { data: inserted, error } = await svc.from("staff_members").insert({
    name,
    team,
    annual_vacation_days: numOr(formData.get("annual_vacation_days"), 0),
    carryover_days: numOr(formData.get("carryover_days"), 0),
    carryover_expires_on: str(formData.get("carryover_expires_on")),
    employment_start: employmentStart,
    is_trainee: formData.get("is_trainee") === "true",
    birth_date: str(formData.get("birth_date")),
    active: true,
  }).select("id").single();
  if (error) return { error: error.message };

  // Startgehalt (brutto) optional gleich anlegen — nur Admins dürfen Gehalt setzen.
  const initialSalary = formData.get("initial_salary");
  if (isAdmin && inserted && initialSalary != null && String(initialSalary).trim() !== "") {
    await svc.from("staff_salary_changes").insert({
      staff_id: inserted.id,
      effective_date: employmentStart ?? new Date().toISOString().slice(0, 10),
      amount: numOr(initialSalary, 0),
      note: str(formData.get("initial_salary_note")),
    });
  }
  revalidateAll();
  return { ok: true };
}

export async function updateStaffMember(id: string, formData: FormData) {
  await requireFeature(STAFF_FEATURE);
  const svc = createServiceClient();
  const update: Record<string, unknown> = {};
  if (formData.has("name")) update.name = str(formData.get("name"));
  if (formData.has("team")) update.team = str(formData.get("team"));
  if (formData.has("annual_vacation_days"))
    update.annual_vacation_days = numOr(formData.get("annual_vacation_days"), 0);
  if (formData.has("carryover_days"))
    update.carryover_days = numOr(formData.get("carryover_days"), 0);
  if (formData.has("carryover_expires_on"))
    update.carryover_expires_on = str(formData.get("carryover_expires_on"));
  if (formData.has("employment_start"))
    update.employment_start = str(formData.get("employment_start"));
  if (formData.has("is_trainee")) update.is_trainee = formData.get("is_trainee") === "true";
  if (formData.has("birth_date")) update.birth_date = str(formData.get("birth_date"));
  if (formData.has("active")) update.active = formData.get("active") === "true";

  const { error } = await svc.from("staff_members").update(update).eq("id", id);
  if (error) return { error: error.message };
  revalidateAll();
  return { ok: true };
}

export async function deleteStaffMember(id: string) {
  await requireFeature(STAFF_FEATURE);
  const svc = createServiceClient();
  // Bescheinigungs-Dateien des Mitarbeiters aus dem Bucket entfernen.
  const { data: sick } = await svc
    .from("sick_days")
    .select("certificate_path")
    .eq("staff_id", id);
  const paths = (sick ?? []).map((s) => s.certificate_path).filter(Boolean) as string[];
  if (paths.length) await svc.storage.from(BUCKET).remove(paths);

  const { error } = await svc.from("staff_members").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidateAll();
  return { ok: true };
}

// ─── Team-Einstellungen (Mindestbesetzung) ──────────────────────

export async function updateTeamSetting(team: string, maxOnVacation: number) {
  await requireFeature(STAFF_FEATURE);
  const svc = createServiceClient();
  const max = Number.isFinite(maxOnVacation) && maxOnVacation >= 0 ? Math.floor(maxOnVacation) : 99;
  const { error } = await svc
    .from("team_settings")
    .upsert(
      { team, max_on_vacation: max, updated_at: new Date().toISOString() },
      { onConflict: "team" },
    );
  if (error) return { error: error.message };
  revalidateAll();
  return { ok: true };
}

// ─── Kritische Zeiträume / Sperrzeiten ──────────────────────────

export async function addBlackout(_prev: unknown, formData: FormData) {
  await requireFeature(STAFF_FEATURE);
  const svc = createServiceClient();
  const label = str(formData.get("label"));
  const start = str(formData.get("start_date")); // volles Datum, nur MM-DD wird genutzt
  const end = str(formData.get("end_date"));
  if (!label) return { error: "Bezeichnung fehlt." };
  if (!start || !end) return { error: "Von und Bis sind Pflicht." };
  const teamRaw = str(formData.get("team"));
  const { error } = await svc.from("vacation_blackouts").insert({
    label,
    start_md: start.slice(5),
    end_md: end.slice(5),
    team: teamRaw === "all" ? null : teamRaw,
    note: str(formData.get("note")),
  });
  if (error) return { error: error.message };
  revalidateAll();
  return { ok: true };
}

export async function deleteBlackout(id: string) {
  await requireFeature(STAFF_FEATURE);
  const svc = createServiceClient();
  const { error } = await svc.from("vacation_blackouts").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidateAll();
  return { ok: true };
}

// ─── Urlaubsanträge ──────────────────────────────────────────────

export async function createVacationRequest(_prev: unknown, formData: FormData) {
  const profile = await requireFeature(STAFF_FEATURE);
  const isAdmin = profile.role === "admin" || profile.is_admin;
  const svc = createServiceClient();
  const staffId = str(formData.get("staff_id"));
  const start = str(formData.get("start_date"));
  const end = str(formData.get("end_date"));
  if (!staffId || !start || !end) return { error: "Mitarbeiter, Start und Ende sind Pflicht." };
  if (end < start) return { error: "Enddatum liegt vor dem Startdatum." };

  // Tage automatisch berechnen (Werktage Bremen); manuelle Korrektur erlaubt,
  // z.B. für halbe Tage über das Feld days_override.
  const auto = countWorkdays(start, end);
  const override = formData.get("days_override");
  const days = override != null && String(override).trim() !== ""
    ? numOr(override, auto)
    : auto;

  // Admins können direkt "genehmigt" eintragen (in den Kalender), sonst Antrag.
  const wantApproved = formData.get("status") === "approved";
  const directApprove = isAdmin && wantApproved;

  const { error } = await svc.from("vacation_requests").insert({
    staff_id: staffId,
    start_date: start,
    end_date: end,
    days,
    paid: formData.get("paid") !== "false",
    status: directApprove ? "approved" : "submitted",
    decided_at: directApprove ? new Date().toISOString() : null,
    decided_by: directApprove ? profile.id : null,
    note: str(formData.get("note")),
  });
  if (error) return { error: error.message };
  revalidateAll();
  return { ok: true };
}

export async function updateVacationRequest(id: string, formData: FormData) {
  await requireFeature(STAFF_FEATURE);
  const svc = createServiceClient();
  const start = str(formData.get("start_date"));
  const end = str(formData.get("end_date"));
  if (!start || !end) return { error: "Start und Ende sind Pflicht." };
  if (end < start) return { error: "Enddatum liegt vor dem Startdatum." };
  const auto = countWorkdays(start, end);
  const override = formData.get("days_override");
  const days = override != null && String(override).trim() !== "" ? numOr(override, auto) : auto;
  const update: Record<string, unknown> = {
    start_date: start,
    end_date: end,
    days,
    paid: formData.get("paid") !== "false",
    note: str(formData.get("note")),
  };
  const { error } = await svc.from("vacation_requests").update(update).eq("id", id);
  if (error) return { error: error.message };
  revalidateAll();
  return { ok: true };
}

export async function decideVacation(id: string, decision: "approved" | "rejected") {
  const profile = await requireFeature(STAFF_FEATURE);
  const svc = createServiceClient();
  const { error } = await svc
    .from("vacation_requests")
    .update({
      status: decision,
      decided_at: new Date().toISOString(),
      decided_by: profile.id,
    })
    .eq("id", id);
  if (error) return { error: error.message };
  revalidateAll();
  return { ok: true };
}

export async function deleteVacation(id: string) {
  await requireFeature(STAFF_FEATURE);
  const svc = createServiceClient();
  const { error } = await svc.from("vacation_requests").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidateAll();
  return { ok: true };
}

// ─── Krankheitstage ──────────────────────────────────────────────

export async function createSickDay(_prev: unknown, formData: FormData) {
  await requireFeature(STAFF_FEATURE);
  const svc = createServiceClient();
  const staffId = str(formData.get("staff_id"));
  const start = str(formData.get("start_date"));
  const end = str(formData.get("end_date"));
  if (!staffId || !start || !end) return { error: "Mitarbeiter, Start und Ende sind Pflicht." };
  if (end < start) return { error: "Enddatum liegt vor dem Startdatum." };

  const days = countCalendarDays(start, end);
  // AU-Pflicht in DE i.d.R. ab dem 4. Kalendertag der Erkrankung.
  const certRequired = days > 3;

  const { error } = await svc.from("sick_days").insert({
    staff_id: staffId,
    start_date: start,
    end_date: end,
    days,
    category: str(formData.get("category")) ?? "own",
    certificate_required: certRequired,
    certificate_expires_on: str(formData.get("certificate_expires_on")),
    note: str(formData.get("note")),
  });
  if (error) return { error: error.message };
  revalidateAll();
  return { ok: true };
}

export async function uploadSickCertificate(sickId: string, formData: FormData) {
  await requireFeature(STAFF_FEATURE);
  const svc = createServiceClient();
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) return { error: "Keine Datei ausgewählt." };

  const safeName = file.name.replace(/[^\w.\-]+/g, "_");
  const path = `${sickId}/${Date.now()}_${safeName}`;
  const { error: upErr } = await svc.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) return { error: upErr.message };

  const expires = str(formData.get("certificate_expires_on"));
  const update: Record<string, unknown> = {
    certificate_uploaded: true,
    certificate_path: path,
    certificate_file_name: file.name,
  };
  if (expires) update.certificate_expires_on = expires;

  const { error: dbErr } = await svc.from("sick_days").update(update).eq("id", sickId);
  if (dbErr) return { error: dbErr.message };
  revalidateAll();
  return { ok: true };
}

export async function deleteSickDay(id: string) {
  await requireFeature(STAFF_FEATURE);
  const svc = createServiceClient();
  const { data: row } = await svc
    .from("sick_days")
    .select("certificate_path")
    .eq("id", id)
    .single();
  if (row?.certificate_path) await svc.storage.from(BUCKET).remove([row.certificate_path]);
  const { error } = await svc.from("sick_days").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidateAll();
  return { ok: true };
}

/** Signierte URL (10 Min) für die Vorschau/Download einer Bescheinigung. */
export async function getCertificateSignedUrl(filePath: string): Promise<string | null> {
  await requireFeature(STAFF_FEATURE);
  const svc = createServiceClient();
  const { data, error } = await svc.storage
    .from(BUCKET)
    .createSignedUrl(filePath, 60 * 10);
  if (error) return null;
  return data.signedUrl;
}

// ─── Gehalt + Verwarnungen (NUR ADMIN) ──────────────────────────
// requireAdmin() leitet Nicht-Admins weg → diese sensiblen Daten sind
// ausschließlich für Admins schreib-/lesbar (DB zusätzlich per RLS gesperrt).

export async function addSalaryChange(staffId: string, formData: FormData) {
  await requireAdmin();
  const svc = createServiceClient();
  const effective = str(formData.get("effective_date"));
  const amount = formData.get("amount");
  if (!effective) return { error: "Datum fehlt." };
  if (amount == null || String(amount).trim() === "") return { error: "Betrag fehlt." };
  const { error } = await svc.from("staff_salary_changes").insert({
    staff_id: staffId,
    effective_date: effective,
    amount: numOr(amount, 0),
    note: str(formData.get("note")),
  });
  if (error) return { error: error.message };
  revalidatePath("/staff/members");
  return { ok: true };
}

export async function deleteSalaryChange(id: string) {
  await requireAdmin();
  const svc = createServiceClient();
  const { error } = await svc.from("staff_salary_changes").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/staff/members");
  return { ok: true };
}

export async function addWarning(staffId: string, formData: FormData) {
  await requireAdmin();
  const svc = createServiceClient();
  const date = str(formData.get("warning_date"));
  const type = str(formData.get("type"));
  if (!date) return { error: "Datum fehlt." };
  if (type !== "oral" && type !== "written") return { error: "Art fehlt." };
  const { error } = await svc.from("staff_warnings").insert({
    staff_id: staffId,
    warning_date: date,
    type,
    reason: str(formData.get("reason")),
  });
  if (error) return { error: error.message };
  revalidatePath("/staff/members");
  return { ok: true };
}

export async function deleteWarning(id: string) {
  await requireAdmin();
  const svc = createServiceClient();
  const { error } = await svc.from("staff_warnings").delete().eq("id", id);
  if (error) return { error: error.message };
  revalidatePath("/staff/members");
  return { ok: true };
}
