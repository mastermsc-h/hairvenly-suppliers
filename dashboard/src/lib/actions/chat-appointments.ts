"use server";

import { createClient, createServiceClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { AppointmentServiceType } from "@/lib/appointments-constants";

export interface AppointmentInput {
  sessionId?: string;
  serviceType: AppointmentServiceType;
  requestedDate?: string;          // ISO date "2026-06-15"
  requestedTime?: string;          // free-text
  notes?: string;
}

/**
 * Termin-Anfrage anlegen — Bot-Tool oder MA manuell.
 */
export async function createAppointmentRequest(
  input: AppointmentInput,
  createdByBot = true,
) {
  const svc = createServiceClient();
  let session: { channel: string | null; external_id: string | null; customer_name: string | null } | null = null;
  if (input.sessionId) {
    const { data } = await svc
      .from("chat_sessions")
      .select("channel, external_id, customer_name")
      .eq("id", input.sessionId)
      .single();
    session = data;
  }
  const { data, error } = await svc.from("chat_appointment_requests").insert({
    session_id:    input.sessionId || null,
    customer_name: session?.customer_name || null,
    channel:       session?.channel || null,
    external_id:   session?.external_id || null,
    service_type:  input.serviceType,
    requested_date: input.requestedDate || null,
    requested_time: input.requestedTime || null,
    notes:         input.notes || null,
    status:        "pending",
    created_by_bot: createdByBot,
  }).select().single();
  if (error) throw new Error(error.message);
  revalidatePath("/chatbot/appointments");
  return data;
}

/** Termin manuell anlegen (Mitarbeiter FormData) */
export async function createAppointmentManual(formData: FormData) {
  const input: AppointmentInput = {
    sessionId:     (formData.get("session_id") as string) || undefined,
    serviceType:   formData.get("service_type") as AppointmentServiceType,
    requestedDate: (formData.get("requested_date") as string) || undefined,
    requestedTime: (formData.get("requested_time") as string) || undefined,
    notes:         (formData.get("notes") as string) || undefined,
  };
  if (!input.serviceType) throw new Error("Service-Typ fehlt");
  await createAppointmentRequest(input, false);
}

/** Termin-Felder updaten (z.B. nachträglich Datum oder Notizen ändern) */
export async function updateAppointmentRequest(
  appointmentId: string,
  fields: {
    serviceType?: AppointmentServiceType;
    requestedDate?: string | null;
    requestedTime?: string | null;
    notes?: string | null;
  },
) {
  const svc = createServiceClient();
  const update: Record<string, unknown> = {};
  if (fields.serviceType !== undefined) update.service_type = fields.serviceType;
  if (fields.requestedDate !== undefined) update.requested_date = fields.requestedDate || null;
  if (fields.requestedTime !== undefined) update.requested_time = fields.requestedTime || null;
  if (fields.notes !== undefined) update.notes = fields.notes || null;
  const { error } = await svc.from("chat_appointment_requests").update(update).eq("id", appointmentId);
  if (error) throw new Error(error.message);
  revalidatePath("/chatbot/appointments");
}

/** Termin bestätigen (MA setzt konkretes Datum + sendet ggf. Bestätigung an Kundin) */
export async function confirmAppointment(
  appointmentId: string,
  confirmedDate: string,        // ISO datetime "2026-06-15T14:00:00Z"
  confirmationMessage?: string, // Text der an Kundin geschickt wird (optional)
) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const svc = createServiceClient();
  const { data: appt } = await svc.from("chat_appointment_requests").select("*").eq("id", appointmentId).single();
  if (!appt) throw new Error("Termin nicht gefunden");
  if (appt.status !== "pending" && appt.status !== "rescheduled") throw new Error("Termin ist nicht mehr offen");

  // Optional: Bestätigung an Kunden-Channel senden
  if (confirmationMessage && appt.channel && appt.external_id) {
    const text = confirmationMessage.trim();
    if (text) {
      if (appt.channel === "instagram") {
        const { sendInstagramMessage } = await import("@/lib/messaging/meta");
        await sendInstagramMessage(appt.external_id, text);
      } else if (appt.channel === "whatsapp") {
        const { sendWhatsAppMessage } = await import("@/lib/messaging/meta");
        await sendWhatsAppMessage(appt.external_id, text);
      }
      if (appt.session_id) {
        await svc.from("chat_messages").insert({
          session_id: appt.session_id,
          role: "human_agent",
          content: text,
          agent_id: user.id,
        });
        await svc.from("chat_sessions").update({
          last_message_at: new Date().toISOString(),
          last_seen_by_agent_at: new Date().toISOString(),
        }).eq("id", appt.session_id);
      }
    }
  }

  await svc.from("chat_appointment_requests").update({
    status: "confirmed",
    confirmed_at: new Date().toISOString(),
    confirmed_by: user.id,
    confirmed_date: confirmedDate,
    confirmation_message: confirmationMessage || null,
  }).eq("id", appointmentId);

  revalidatePath("/chatbot/appointments");
  if (appt.session_id) revalidatePath(`/chatbot/inbox/${appt.session_id}`);
}

/** Termin verschieben (zurück auf rescheduled — MA bestätigt später erneut) */
export async function rescheduleAppointment(appointmentId: string, newDate?: string) {
  const svc = createServiceClient();
  const update: Record<string, unknown> = { status: "rescheduled" };
  if (newDate) update.requested_date = newDate;
  await svc.from("chat_appointment_requests").update(update).eq("id", appointmentId);
  revalidatePath("/chatbot/appointments");
}

/** Termin stornieren */
export async function cancelAppointment(appointmentId: string, reason?: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const svc = createServiceClient();
  await svc.from("chat_appointment_requests").update({
    status: "cancelled",
    cancelled_at: new Date().toISOString(),
    cancelled_by: user.id,
    cancel_reason: reason || null,
  }).eq("id", appointmentId);
  revalidatePath("/chatbot/appointments");
}

/** Termin als erledigt markieren (nach Salon-Besuch) */
export async function completeAppointment(appointmentId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");
  const svc = createServiceClient();
  await svc.from("chat_appointment_requests").update({
    status: "completed",
    completed_at: new Date().toISOString(),
    completed_by: user.id,
  }).eq("id", appointmentId);
  revalidatePath("/chatbot/appointments");
}

/** Termin löschen (Datenfehler / Test-Eintrag) */
export async function deleteAppointment(appointmentId: string) {
  const svc = createServiceClient();
  await svc.from("chat_appointment_requests").delete().eq("id", appointmentId);
  revalidatePath("/chatbot/appointments");
}
