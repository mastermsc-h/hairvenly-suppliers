/**
 * Automatische Wartelisten-Benachrichtigung — reine Entscheidungslogik.
 *
 * Kein I/O, damit der Smoke-Test jeden Fall festnageln kann
 * (scripts/smoke/reservation-auto-notify.spec.mjs). Versand/DB: notify.ts.
 *
 * Grundsatz: lieber eine Kundin NICHT automatisch anschreiben (Mitarbeiterin
 * sieht sie grün markiert und klickt) als eine falsche Nachricht schicken.
 * Gesendet wird nur, wenn GENAU die reservierte Variante vorrätig ist.
 */
import type { StockCheckResult } from "./stock-match";

export type AutoNotifyMode = "off" | "shadow" | "live";
export type AutoNotifyDecision = "would_send" | "skip";

export const AUTO_NOTIFY_MAX_ATTEMPTS = 3;
export const AUTO_NOTIFY_MAX_MESSAGES_PER_RUN = 30;
export const AUTO_NOTIFY_SIGNATURE = "/Ava von Hairvenly";

export function parseAutoNotifyMode(v: unknown): AutoNotifyMode {
  return v === "live" || v === "shadow" || v === "off" ? v : "off";
}

export interface NotifyState {
  id: string;
  status: string;
  channel: string | null;
  external_id: string | null;
  notify_attempts: number | null;
  last_notify_attempt_at: string | null;
}

const berlinDate = (d: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Berlin" }).format(d);

const NOT_IN_STOCK_REASON: Record<StockCheckResult["status"], string> = {
  in_stock: "",
  unterwegs: "noch unterwegs",
  out_of_stock: "ausverkauft",
  unknown: "kein passendes Produkt im Lager-Sheet",
  service_item: "kein Lagerartikel",
};

export function decideAutoNotify(
  r: NotifyState,
  result: StockCheckResult | undefined,
  now: Date,
): { decision: AutoNotifyDecision; reason: string } {
  const skip = (reason: string) => ({ decision: "skip" as const, reason });
  if (r.status !== "waiting") return skip("nicht mehr offen");
  if (!result) return skip("nicht geprüft");
  if (result.status !== "in_stock") return skip(NOT_IN_STOCK_REASON[result.status] || result.status);
  if (result.variantCount !== 1) {
    return skip(`Treffer nicht eindeutig (${result.variantCount ?? "?"} Varianten passen) — bitte manuell prüfen`);
  }
  // WhatsApp-Versand ist noch nicht freigeschaltet, Web-Chats haben keinen Kanal
  if (r.channel !== "instagram" || !r.external_id) return skip("kein Instagram-Kontakt — bitte manuell");
  const attempts = r.notify_attempts ?? 0;
  if (attempts >= AUTO_NOTIFY_MAX_ATTEMPTS) return skip(`${attempts} Fehlversuche — bitte manuell`);
  if (r.last_notify_attempt_at && berlinDate(new Date(r.last_notify_attempt_at)) === berlinDate(now)) {
    return skip("heute schon versucht — nächster Versuch morgen");
  }
  return { decision: "would_send", reason: "eindeutig auf Lager" };
}

/**
 * Sendefenster (Absicherung zusätzlich zum Cron-Zeitplan): Mo–Sa 9–19 Uhr
 * Berlin. Ein versehentlich manuell ausgelöster Cron sendet nachts/sonntags nie.
 */
export function isInSendWindow(now: Date): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Berlin", weekday: "short", hour: "2-digit", hour12: false,
  }).formatToParts(now);
  const weekday = parts.find(p => p.type === "weekday")?.value;
  const hour = parseInt(parts.find(p => p.type === "hour")?.value || "0", 10);
  return weekday !== "Sun" && hour >= 9 && hour < 19;
}

/**
 * Versand-Stunden (Berlin). Der Cron feuert einmal täglich 10:00 UTC (Vercel
 * Hobby erlaubt nur tägliche Crons) = 11 Uhr Winter / 12 Uhr Sommer. Beides
 * liegt nach dem Lager-Refresh in Apps Script (startet zwischen 9 und 10 Uhr,
 * schreibt 20+ Minuten in Batches) und vor dem 18-Uhr-Refresh.
 */
export const AUTO_NOTIFY_HOURS_BERLIN = [11, 12];

/** Berliner Stunde (0–23). */
export function berlinHour(now: Date): number {
  return parseInt(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Berlin", hour: "2-digit", hour12: false }).format(now), 10);
}

export interface SendCandidate {
  id: string;
  channel: string;
  external_id: string;
}

export interface RecipientGroup {
  channel: string;
  external_id: string;
  ids: string[];
}

/**
 * Pro Kundin EINE Nachricht (auch bei mehreren Reservierungen), höchstens
 * `maxMessages` Nachrichten pro Lauf — der Rest wartet bis zum nächsten Tag.
 */
export function planAutoNotifyBatch(
  candidates: SendCandidate[],
  maxMessages: number = AUTO_NOTIFY_MAX_MESSAGES_PER_RUN,
): { groups: RecipientGroup[]; deferredIds: string[] } {
  const byRecipient = new Map<string, RecipientGroup>();
  for (const c of candidates) {
    const key = `${c.channel}|${c.external_id}`;
    const g = byRecipient.get(key);
    if (g) g.ids.push(c.id);
    else byRecipient.set(key, { channel: c.channel, external_id: c.external_id, ids: [c.id] });
  }
  const all = [...byRecipient.values()];
  return {
    groups: all.slice(0, Math.max(0, maxMessages)),
    deferredIds: all.slice(Math.max(0, maxMessages)).flatMap(g => g.ids),
  };
}

export interface NotifyProduct {
  product_name: string;
  color: string | null;
  method: string | null;
  product_url: string | null;
}

const productLabel = (p: NotifyProduct) => [p.color, p.method].filter(Boolean).join(" ").trim() || p.product_name;

/**
 * Benachrichtigungs-Text. Ein Produkt → exakt der bisherige Standardtext
 * (Mitarbeiter-Button nutzt dieselbe Funktion ohne Signatur). Mehrere
 * Produkte → Liste. Automatisch gesendete Texte signiert der Autobot mit
 * „/Ava von Hairvenly".
 */
export function buildNotificationText(products: NotifyProduct[], opts: { signature?: string } = {}): string {
  if (products.length === 0) return "";
  let txt: string;
  if (products.length === 1) {
    const p = products[0];
    txt = `Hallo Liebes 💕\n\nGute Nachrichten — die ${productLabel(p)} sind jetzt wieder da! 🥳`;
    if (p.product_url) txt += `\n\n${p.product_url}`;
  } else {
    txt = `Hallo Liebes 💕\n\nGute Nachrichten — diese Produkte sind jetzt wieder da! 🥳\n`;
    for (const p of products) txt += `\n• ${productLabel(p)}${p.product_url ? `\n${p.product_url}` : ""}`;
  }
  txt += `\n\nMagst du sie noch? Sag Bescheid wenn ich dir weiterhelfen soll 🩷`;
  if (opts.signature) txt += `\n\n${opts.signature}`;
  return txt;
}
