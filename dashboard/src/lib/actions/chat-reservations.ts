"use server";

import { createClient, createServiceClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";

export interface ReservationInput {
  sessionId?: string;
  productName: string;
  productUrl?: string;
  color?: string;
  method?: string;
  etaHint?: string;
  notes?: string;
}

/**
 * Reservierung anlegen — wird vom Bot-Tool aufgerufen (create_reservation)
 * oder manuell vom Mitarbeiter. Session-Daten (channel, external_id, customer_name)
 * werden aus der Session gespiegelt, damit der spätere Notification-Versand
 * nicht von der Session abhängt.
 */
export async function createReservation(input: ReservationInput, createdByBot = true) {
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

  const { data, error } = await svc.from("chat_reservations").insert({
    session_id:    input.sessionId || null,
    customer_name: session?.customer_name || null,
    channel:       session?.channel || null,
    external_id:   session?.external_id || null,
    product_name:  input.productName,
    product_url:   input.productUrl || null,
    color:         input.color || null,
    method:        input.method || null,
    eta_hint:      input.etaHint || null,
    notes:         input.notes || null,
    status:        "waiting",
    created_by_bot: createdByBot,
  }).select().single();

  if (error) throw new Error(error.message);
  revalidatePath("/chatbot/reservations");
  return data;
}

/** Reservierung manuell vom Mitarbeiter anlegen */
export async function createReservationManual(formData: FormData) {
  const input: ReservationInput = {
    sessionId:   (formData.get("session_id") as string) || undefined,
    productName: formData.get("product_name") as string,
    productUrl:  (formData.get("product_url") as string) || undefined,
    color:       (formData.get("color") as string) || undefined,
    method:      (formData.get("method") as string) || undefined,
    etaHint:     (formData.get("eta_hint") as string) || undefined,
    notes:       (formData.get("notes") as string) || undefined,
  };
  if (!input.productName?.trim()) throw new Error("Produktname fehlt");
  await createReservation(input, false);
}

/**
 * Standard-Nachricht für eine Reservierung — wird im UI vorausgefüllt,
 * Mitarbeiter kann editieren bevor er sendet.
 */
export async function defaultNotificationText(reservationId: string): Promise<string> {
  const svc = createServiceClient();
  const { data: r } = await svc
    .from("chat_reservations")
    .select("product_name, color, method, product_url, customer_name")
    .eq("id", reservationId).single();
  if (!r) return "";
  const prod = [r.color, r.method].filter(Boolean).join(" ").trim() || r.product_name;
  let txt = `Hallo Liebes 💕\n\nGute Nachrichten — die ${prod} sind jetzt wieder da! 🥳`;
  if (r.product_url) txt += `\n\n${r.product_url}`;
  txt += `\n\nMagst du sie noch? Sag Bescheid wenn ich dir weiterhelfen soll 🩷`;
  return txt;
}

/**
 * Sendet die Reservierungs-Nachricht an den ursprünglichen Channel
 * + erzeugt eine human_agent-Message im Chat (damit es im Verlauf sichtbar bleibt).
 */
export async function sendReservationNotification(reservationId: string, customText?: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const svc = createServiceClient();
  const { data: r } = await svc.from("chat_reservations").select("*").eq("id", reservationId).single();
  if (!r) throw new Error("Reservierung nicht gefunden");
  if (r.status !== "waiting") throw new Error("Reservierung ist nicht mehr offen");

  const text = (customText || await defaultNotificationText(reservationId)).trim();
  if (!text) throw new Error("Leerer Text");

  // Versand
  if (r.channel === "instagram" && r.external_id) {
    const { sendInstagramMessage } = await import("@/lib/messaging/meta");
    const result = await sendInstagramMessage(r.external_id, text);
    if (!result.success) throw new Error(`IG send failed: ${result.error}`);
  } else if (r.channel === "whatsapp" && r.external_id) {
    const { sendWhatsAppMessage } = await import("@/lib/messaging/meta");
    const result = await sendWhatsAppMessage(r.external_id, text);
    if (!result.success) throw new Error(`WA send failed: ${result.error}`);
  }

  // Chat-Message-Eintrag (damit es im Verlauf erscheint)
  if (r.session_id) {
    await svc.from("chat_messages").insert({
      session_id: r.session_id,
      role:       "human_agent",
      content:    text,
      agent_id:   user.id,
    });
    await svc.from("chat_sessions").update({
      last_message_at:       new Date().toISOString(),
      last_seen_by_agent_at: new Date().toISOString(),
    }).eq("id", r.session_id);
  }

  // Status aktualisieren
  await svc.from("chat_reservations").update({
    status:               "notified",
    notified_at:          new Date().toISOString(),
    notified_by:          user.id,
    notification_message: text,
  }).eq("id", reservationId);

  revalidatePath("/chatbot/reservations");
  if (r.session_id) revalidatePath(`/chatbot/inbox/${r.session_id}`);
}

/** Reservierung stornieren (z.B. Kundin hat sich anderweitig entschieden) */
export async function cancelReservation(reservationId: string, reason?: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const svc = createServiceClient();
  await svc.from("chat_reservations").update({
    status:        "cancelled",
    cancelled_at:  new Date().toISOString(),
    cancelled_by:  user.id,
    cancel_reason: reason || null,
  }).eq("id", reservationId);
  revalidatePath("/chatbot/reservations");
}

/** Notizen aktualisieren */
export async function updateReservationNotes(reservationId: string, notes: string) {
  const svc = createServiceClient();
  await svc.from("chat_reservations").update({ notes }).eq("id", reservationId);
  revalidatePath("/chatbot/reservations");
}

/** Komplett löschen */
export async function deleteReservation(reservationId: string) {
  const svc = createServiceClient();
  await svc.from("chat_reservations").delete().eq("id", reservationId);
  revalidatePath("/chatbot/reservations");
}
