"use server";

import { createClient, createServiceClient } from "@/lib/supabase/server";
import { revalidatePath } from "next/cache";
import type { StockCheckResult } from "@/lib/reservations/stock-match";

export type ReservationLine = "russisch" | "usbekisch";
export type ReservationLengthCm = 45 | 55 | 60 | 65 | 85;
export type ReservationMethodKind =
  | "tape" | "mini_tape"
  | "genius_weft" | "classic_weft" | "invisible_weft"
  | "bonding" | "clip" | "ponytail";

export interface ReservationInput {
  sessionId?: string;
  productName: string;
  productUrl?: string;
  color?: string;
  method?: string;
  etaHint?: string;
  notes?: string;
  // Strukturierte Felder (Bot kann diese vorab aus Foto/Text ableiten,
  // MA ergänzt fehlende via Modal)
  line?: ReservationLine | null;
  lengthCm?: ReservationLengthCm | null;
  methodKind?: ReservationMethodKind | null;
}

/**
 * Heuristisch line/length/method_kind aus Free-Text ableiten —
 * fürs Bot-Tool gedacht, damit das Insert direkt strukturierte
 * Felder mitbekommt soweit eindeutig erkennbar.
 */
function detectStructured(input: ReservationInput): {
  line: ReservationLine | null;
  length_cm: ReservationLengthCm | null;
  method_kind: ReservationMethodKind | null;
  structured_complete: boolean;
} {
  const text = [input.productName, input.method, input.color, input.notes].filter(Boolean).join(" ").toLowerCase();

  // LINE
  let line: ReservationLine | null = input.line ?? null;
  if (!line) {
    if (/\b(russisch|russische|russischer|russisches|glatt)\b/.test(text)) line = "russisch";
    else if (/\b(usbekisch|usbekische|us\s+wellig|wellig|wellige)\b/.test(text)) line = "usbekisch";
  }

  // LENGTH
  let length_cm: ReservationLengthCm | null = input.lengthCm ?? null;
  if (!length_cm) {
    const m = text.match(/\b(45|55|60|65|85)\s*cm\b/);
    if (m) length_cm = parseInt(m[1], 10) as ReservationLengthCm;
    // Wenn russisch und keine Länge → 60cm implicit
    else if (line === "russisch") length_cm = 60;
  }

  // METHOD KIND
  let method_kind: ReservationMethodKind | null = input.methodKind ?? null;
  if (!method_kind) {
    if (/\bmini[\s-]?tape/.test(text)) method_kind = "mini_tape";
    else if (/\bgenius[\s-]?(weft|tresse|tressen)/.test(text)) method_kind = "genius_weft";
    else if (/\bclassic[\s-]?(weft|tresse|tressen)/.test(text)) method_kind = "classic_weft";
    else if (/\b(invisible|butterfly)[\s-]?(weft|tresse|tressen)/.test(text)) method_kind = "invisible_weft";
    else if (/\bbonding/.test(text)) method_kind = "bonding";
    else if (/\b(clip[\s-]?in|clip[\s-]?on|invisible[\s-]?clip)/.test(text)) method_kind = "clip";
    else if (/\bponytail/.test(text)) method_kind = "ponytail";
    else if (/\b(standard[\s-]?)?tape\b/.test(text)) method_kind = "tape";
  }

  return {
    line,
    length_cm,
    method_kind,
    structured_complete: !!(line && length_cm && method_kind),
  };
}

/**
 * Validiert ob eine product_url konsistent zur method ist.
 * Bug-Pattern: Bot speichert URL aus letztem get_available_colors-Tool-Result,
 * die zu einer ANDEREN Method gehört als die in der Reservation gesetzte.
 * Beispiel: method="Standard Tapes" + url=".../mini-tape-extensions..." → falsch.
 *
 * Returns die URL wenn konsistent, sonst null. Konservativ: bei Unsicherheit
 * lieber null als falscher Link.
 *
 * NOTE: Keine Server-Action — private Helper (deshalb nicht exported, da
 * "use server" Modul nur async exports erlaubt).
 */
function validateProductUrlAgainstMethod(
  url: string | undefined,
  method: string | undefined,
): string | null {
  if (!url) return null;
  if (!method) return url; // ohne method-Info kein Check möglich, durchlassen
  const m = method.toLowerCase();
  const u = url.toLowerCase();

  // Method-Klassifizierung
  const isStandard = /\b(standard\s*tape|standard.tape)/i.test(method) && !/mini/i.test(method);
  const isMini     = /mini\s*tape/i.test(method);
  const isBonding  = /\bbonding/i.test(method);
  const isTresse   = /\b(tresse|tressen|weft)/i.test(method) && !/clip/i.test(method);
  const isClip     = /\b(clip[- ]?in|clip[- ]?on)/i.test(method);
  const isPonytail = /\bponytail/i.test(method);

  // URL-Slug-Klassifizierung
  const urlHasMini     = /mini[- ]tape/i.test(url);
  const urlHasStandard = /standard[- ]tape/i.test(url);
  const urlHasBonding  = /bonding/i.test(url);
  const urlHasTresse   = /(tresse|weft)/i.test(url) && !/clip/i.test(url);
  const urlHasClip     = /clip[- ]?in|clip[- ]?ext/i.test(url);
  const urlHasPonytail = /ponytail/i.test(url);
  const urlHasTape     = /tape/i.test(url);

  // Widerspruchs-Check
  if (isStandard && urlHasMini) return null;          // Standard ≠ Mini
  if (isMini && urlHasStandard) return null;          // Mini ≠ Standard
  if (isBonding && !urlHasBonding && urlHasTape) return null;   // Bonding ≠ Tape
  if (isTresse && (urlHasTape || urlHasClip || urlHasBonding)) return null;  // Tresse ≠ andere
  if (isClip && (urlHasTape || urlHasBonding || urlHasTresse)) return null;  // Clip ≠ andere
  if (isPonytail && !urlHasPonytail) return null;      // Ponytail muss Slug haben
  // Wenn method "tape" sagt und url keinen "tape" hat → vermutlich falsche Kategorie
  if (/\btape/i.test(method) && !urlHasTape && (urlHasBonding || urlHasClip || urlHasTresse)) {
    return null;
  }

  void u; void m; // (lint) — Variables reserved for future synonym-checks
  return url;
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

  // URL-Method-Validator: Bot liefert manchmal URL aus dem letzten
  // get_available_colors-Output, der zur FALSCHEN Method gehört.
  // Beispiel-Bug (User-Report 2026-05): method="Standard Tapes" aber URL
  // hat slug "...mini-tape...". Konservativ: bei Widerspruch URL droppen,
  // MA findet richtigen Link selbst — besser als falscher Link.
  const validatedUrl = validateProductUrlAgainstMethod(input.productUrl, input.method);

  // Strukturierte Felder ableiten (Bot/Free-Text-Heuristik)
  const struct = detectStructured(input);

  const { data, error } = await svc.from("chat_reservations").insert({
    session_id:    input.sessionId || null,
    customer_name: session?.customer_name || null,
    channel:       session?.channel || null,
    external_id:   session?.external_id || null,
    product_name:  input.productName,
    product_url:   validatedUrl,
    color:         input.color || null,
    method:        input.method || null,
    eta_hint:      input.etaHint || null,
    notes:         input.notes || null,
    status:        "waiting",
    created_by_bot: createdByBot,
    line:          struct.line,
    length_cm:     struct.length_cm,
    method_kind:   struct.method_kind,
    structured_complete: struct.structured_complete,
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
    line:        (formData.get("line") as ReservationLine) || undefined,
    lengthCm:    formData.get("length_cm") ? (parseInt(formData.get("length_cm") as string, 10) as ReservationLengthCm) : undefined,
    methodKind:  (formData.get("method_kind") as ReservationMethodKind) || undefined,
  };
  if (!input.productName?.trim()) throw new Error("Produktname fehlt");
  await createReservation(input, false);
}

/**
 * Strukturierte Felder einer Reservierung nachträglich setzen/ergänzen
 * (vom Modal "Angaben vervollständigen"). Setzt structured_complete=true
 * wenn alle 3 strukturierten Felder gefüllt sind.
 */
export async function updateReservationStructured(
  reservationId: string,
  fields: {
    line: ReservationLine | null;
    lengthCm: ReservationLengthCm | null;
    methodKind: ReservationMethodKind | null;
    color?: string;
  },
) {
  const svc = createServiceClient();
  const complete = !!(fields.line && fields.lengthCm && fields.methodKind);
  const update: Record<string, unknown> = {
    line: fields.line,
    length_cm: fields.lengthCm,
    method_kind: fields.methodKind,
    structured_complete: complete,
  };
  if (fields.color !== undefined) update.color = fields.color || null;
  const { error } = await svc.from("chat_reservations").update(update).eq("id", reservationId);
  if (error) throw new Error(error.message);
  revalidatePath("/chatbot/reservations");
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
  const { buildNotificationText } = await import("@/lib/reservations/auto-notify");
  return buildNotificationText([r]);
}

/**
 * Sendet die Reservierungs-Nachricht an den ursprünglichen Channel
 * + erzeugt eine human_agent-Message im Chat (damit es im Verlauf sichtbar bleibt).
 * Gemeinsamer Versandpfad mit der Auto-Benachrichtigung (Sperre gegen Doppelversand).
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

  const { deliverReservationNotification } = await import("@/lib/reservations/notify");
  const res = await deliverReservationNotification(svc, [r], text, { agentId: user.id });
  if (res.sentIds.length === 0) throw new Error(res.error || "Versand fehlgeschlagen");

  revalidatePath("/chatbot/reservations");
  if (r.session_id) revalidatePath(`/chatbot/inbox/${r.session_id}`);
}

/** Reservierung stornieren (z.B. Kundin hat sich anderweitig entschieden) */
export async function cancelReservation(reservationId: string, reason?: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const svc = createServiceClient();
  // Session-Id vorab holen, damit wir die Session-Page mit-revalidieren
  // können (Banner im Chat soll sofort verschwinden).
  const { data: existing } = await svc
    .from("chat_reservations")
    .select("session_id")
    .eq("id", reservationId)
    .maybeSingle();
  await svc.from("chat_reservations").update({
    status:        "cancelled",
    cancelled_at:  new Date().toISOString(),
    cancelled_by:  user.id,
    cancel_reason: reason || null,
  }).eq("id", reservationId);
  revalidatePath("/chatbot/reservations");
  if (existing?.session_id) {
    revalidatePath(`/chatbot/inbox/${existing.session_id}`);
    revalidatePath("/chatbot/inbox");
  }
}

/** Notizen aktualisieren */
export async function updateReservationNotes(reservationId: string, notes: string) {
  const svc = createServiceClient();
  await svc.from("chat_reservations").update({ notes }).eq("id", reservationId);
  revalidatePath("/chatbot/reservations");
}

export type { StockCheckResult } from "@/lib/reservations/stock-match";

/**
 * Lager-Scan (Button „Lager-Check"): prüft jede "waiting"-Reservierung gegen
 * die Stock-Sheets und speichert das Ergebnis pro Reservierung — dieselbe
 * Funktion wie der tägliche Cron /api/cron/reservations-check.
 */
export async function scanReservationsAgainstStock(): Promise<StockCheckResult[]> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

  const { runReservationStockCheck } = await import("@/lib/reservations/stock-check");
  const { results } = await runReservationStockCheck(createServiceClient());
  revalidatePath("/chatbot/reservations");
  return results;
}

/** Komplett löschen */
export async function deleteReservation(reservationId: string) {
  const svc = createServiceClient();
  await svc.from("chat_reservations").delete().eq("id", reservationId);
  revalidatePath("/chatbot/reservations");
}
