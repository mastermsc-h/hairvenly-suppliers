import type { SupabaseClient } from "@supabase/supabase-js";
import {
  AUTO_NOTIFY_SIGNATURE,
  buildNotificationText,
  isInSendWindow,
  parseAutoNotifyMode,
  planAutoNotifyBatch,
  type AutoNotifyMode,
  type NotifyProduct,
} from "./auto-notify";
import { runReservationStockCheck, type CheckedReservation } from "./stock-check";

/**
 * Versand einer Wartelisten-Benachrichtigung — gemeinsamer Pfad für den
 * Mitarbeiter-Button (sendReservationNotification) und den Auto-Cron.
 *
 * Genau-einmal-Garantie: Vor dem Senden wird pro Reservierung eine Sperre
 * (notify_lock_until) per bedingtem UPDATE gesetzt. Nur wer die Sperre
 * bekommt, sendet — Button und Cron (oder zwei Cron-Läufe) können dieselbe
 * Kundin also nie doppelt anschreiben.
 */

const LOCK_MINUTES = 10;

interface NotifyRow extends NotifyProduct {
  id: string;
  session_id: string | null;
  channel: string | null;
  external_id: string | null;
  notify_attempts?: number | null;
}

/** Sperre setzen; liefert die IDs, für die dieser Aufrufer senden darf. */
async function claim(svc: SupabaseClient, rows: NotifyRow[], countAttempt: boolean, now: Date): Promise<string[]> {
  const nowIso = now.toISOString();
  const lockUntil = new Date(now.getTime() + LOCK_MINUTES * 60_000).toISOString();
  const claimed: string[] = [];
  for (const r of rows) {
    let q = svc
      .from("chat_reservations")
      .update(
        countAttempt
          ? { notify_lock_until: lockUntil, notify_attempts: (r.notify_attempts ?? 0) + 1, last_notify_attempt_at: nowIso }
          : { notify_lock_until: lockUntil },
      )
      .eq("id", r.id)
      .eq("status", "waiting")
      .or(`notify_lock_until.is.null,notify_lock_until.lt.${nowIso}`);
    // Optimistische Sperre auf den Zähler: ein paralleler Lauf mit demselben
    // Ausgangswert findet die Zeile danach nicht mehr.
    if (countAttempt) q = q.eq("notify_attempts", r.notify_attempts ?? 0);
    const { data, error } = await q.select("id");
    if (error) throw new Error(`Sperre setzen: ${error.message}`);
    if (data && data.length > 0) claimed.push(r.id);
  }
  return claimed;
}

async function sendToChannel(channel: string | null, externalId: string | null, text: string) {
  if (channel === "instagram" && externalId) {
    const { sendInstagramMessage } = await import("@/lib/messaging/meta");
    const result = await sendInstagramMessage(externalId, text);
    if (!result.success) return { ok: false as const, error: `IG send failed: ${result.error}` };
    return { ok: true as const, messageId: result.message_id ?? null };
  }
  if (channel === "whatsapp" && externalId) {
    const { sendWhatsAppMessage } = await import("@/lib/messaging/meta");
    const result = await sendWhatsAppMessage(externalId, text);
    if (!result.success) return { ok: false as const, error: `WA send failed: ${result.error}` };
    return { ok: true as const, messageId: result.message_id ?? null };
  }
  // Web-Chat: kein externer Kanal — nur Verlauf + Status (wie bisher)
  return { ok: true as const, messageId: null };
}

/**
 * Sendet EINE Nachricht für eine oder mehrere Reservierungen derselben Kundin.
 * agentId = Mitarbeiter (Button) → human_agent-Message; null = Autobot → assistant, auto_sent.
 */
export async function deliverReservationNotification(
  svc: SupabaseClient,
  rows: NotifyRow[],
  text: string,
  opts: { agentId: string | null; now?: Date },
): Promise<{ sentIds: string[]; error?: string }> {
  const now = opts.now ?? new Date();
  const auto = opts.agentId === null;
  const claimedIds = await claim(svc, rows, auto, now);
  if (claimedIds.length === 0) {
    return { sentIds: [], error: "Reservierung wird gerade benachrichtigt oder ist nicht mehr offen" };
  }
  const claimed = rows.filter(r => claimedIds.includes(r.id));
  // Text nur für die tatsächlich gesperrten Reservierungen (bei Teil-Sperre neu bauen)
  const finalText = claimed.length === rows.length || !auto
    ? text
    : buildNotificationText(claimed, { signature: AUTO_NOTIFY_SIGNATURE });
  const { channel, external_id, session_id } = claimed[0];

  const sent = await sendToChannel(channel, external_id, finalText);
  if (!sent.ok) {
    await svc.from("chat_reservations").update({
      notify_lock_until: null,
      ...(auto ? { last_notify_error: sent.error } : {}),
    }).in("id", claimedIds);
    return { sentIds: [], error: sent.error };
  }

  const nowIso = new Date().toISOString();
  // Chat-Verlauf, damit es im Chat sichtbar ist
  if (session_id) {
    await svc.from("chat_messages").insert(
      auto
        ? { session_id, role: "assistant", content: finalText, auto_sent: true, external_id: sent.messageId }
        : { session_id, role: "human_agent", content: finalText, agent_id: opts.agentId },
    );
    await svc.from("chat_sessions").update(
      auto ? { last_message_at: nowIso } : { last_message_at: nowIso, last_seen_by_agent_at: nowIso },
    ).eq("id", session_id);
  }

  const { error } = await svc.from("chat_reservations").update({
    status:               "notified",
    notified_at:          nowIso,
    notified_by:          opts.agentId,
    notified_auto:        auto,
    notification_message: finalText,
    last_notify_error:    null,
    notify_lock_until:    null,
  }).in("id", claimedIds);
  if (error) console.error("[reservations/notify] Status-Update nach Versand fehlgeschlagen:", error.message, claimedIds);
  return { sentIds: claimedIds };
}

export async function loadAutoNotifyMode(svc: SupabaseClient): Promise<AutoNotifyMode> {
  const { data } = await svc.from("chatbot_settings").select("reservation_auto_notify").eq("id", 1).maybeSingle();
  return parseAutoNotifyMode(data?.reservation_auto_notify);
}

export interface AutoNotifyRun {
  mode: AutoNotifyMode;
  checked: number;
  wouldSend: number;
  sent: number;
  failed: { id: string; error: string }[];
  deferred: number;
  skippedReason?: string;
}

/**
 * Cron-Lauf: frischer Lager-Check (speichert Entscheidungen = Probelauf-Anzeige),
 * dann — nur im Modus "live" und im Sendefenster — Versand.
 */
export async function runAutoNotify(svc: SupabaseClient, now: Date = new Date()): Promise<AutoNotifyRun> {
  const mode = await loadAutoNotifyMode(svc);
  const { checked } = await runReservationStockCheck(svc, now, { retries: 3 });
  const toSend = checked.filter(c => c.decision === "would_send");
  const base: AutoNotifyRun = { mode, checked: checked.length, wouldSend: toSend.length, sent: 0, failed: [], deferred: 0 };

  if (mode !== "live") return { ...base, skippedReason: mode === "shadow" ? "Probelauf — nichts gesendet" : "aus" };
  if (!isInSendWindow(now)) return { ...base, skippedReason: "außerhalb des Sendefensters (Mo–Sa 9–19 Uhr)" };

  const byId = new Map<string, CheckedReservation>(checked.map(c => [c.id, c]));
  const { groups, deferredIds } = planAutoNotifyBatch(
    toSend.map(c => ({ id: c.id, channel: c.channel!, external_id: c.external_id! })),
  );
  if (deferredIds.length > 0) {
    await svc.from("chat_reservations")
      .update({ auto_notify_reason: "Tagesdeckel erreicht — nächster Lauf morgen" })
      .in("id", deferredIds);
  }

  let sent = 0;
  const failed: AutoNotifyRun["failed"] = [];
  for (const g of groups) {
    const rows = g.ids.map(id => byId.get(id)!).map(c => ({
      ...c,
      // Shop-Link: gespeicherter Link der Reservierung, sonst der des eindeutigen Lager-Treffers
      product_url: c.product_url || c.result?.matchedUrl || null,
    }));
    const text = buildNotificationText(rows, { signature: AUTO_NOTIFY_SIGNATURE });
    try {
      const res = await deliverReservationNotification(svc, rows, text, { agentId: null, now });
      if (res.sentIds.length > 0) sent += res.sentIds.length;
      else if (res.error) failed.push(...g.ids.map(id => ({ id, error: res.error! })));
    } catch (e) {
      failed.push(...g.ids.map(id => ({ id, error: e instanceof Error ? e.message : String(e) })));
    }
  }
  return { ...base, sent, failed, deferred: deferredIds.length };
}
